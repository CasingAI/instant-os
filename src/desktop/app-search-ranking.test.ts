/**
 * 桌面应用搜索分层匹配：拼音（全拼/简拼）、模糊子序列、排序与高亮区间。
 * 运行：node --experimental-strip-types src/desktop/app-search-ranking.test.ts
 */
import assert from 'node:assert/strict'
import {
  APP_SEARCH_TIERS,
  getAppSearchPinyinKeys,
  rankDesktopAppSearchEntry,
} from './app-search-ranking.ts'
import type { DesktopAppSearchEntry } from './desktop-app-search.ts'

function entry(id: string, name: string): DesktopAppSearchEntry {
  return { id, name, kind: 'builtin' }
}

const CATALOG: DesktopAppSearchEntry[] = [
  entry('weather', '天气'),
  entry('settings', '系统设置'),
  entry('help', '帮助'),
  entry('virtual-machine', '虚拟机'),
  entry('gen:clock', '天气时钟'),
  entry('gen:cat', 'CatGPT 助手'),
]

function testPinyinKeys(): void {
  const weather = getAppSearchPinyinKeys('天气时钟')
  assert.ok(weather)
  assert.equal(weather!.full, 'tianqishizhong')
  assert.deepEqual(weather!.syllables, ['tian', 'qi', 'shi', 'zhong'])
  assert.deepEqual(weather!.syllableCharIndex, [0, 1, 2, 3])

  const settings = getAppSearchPinyinKeys('系统设置')
  assert.ok(settings)
  assert.equal(settings!.full, 'xitongshezhi')

  // ü → v，符合「lv 打出 绿」的输入习惯
  assert.deepEqual(getAppSearchPinyinKeys('绿色')?.syllables, ['lv', 'se'])

  // 纯英文名不产生拼音键，交给模糊匹配
  assert.equal(getAppSearchPinyinKeys('CatGPT'), null)
  console.log('ok: pinyin keys')
}

function testFullPinyin(): void {
  const shezhi = rankDesktopAppSearchEntry(entry('settings', '设置'), 'shezhi')
  assert.ok(shezhi)
  assert.equal(shezhi!.tier, APP_SEARCH_TIERS.pinyinPrefix)

  // 大小写不敏感
  const upper = rankDesktopAppSearchEntry(entry('weather', '天气'), 'TIANQI')
  assert.ok(upper)
  assert.equal(upper!.tier, APP_SEARCH_TIERS.pinyinPrefix)
  const upperAbbrev = rankDesktopAppSearchEntry(entry('weather', '天气'), 'TQ')
  assert.ok(upperAbbrev)
  assert.equal(upperAbbrev!.tier, APP_SEARCH_TIERS.pinyinAbbrev)

  // 全拼包含：tongshe 命中 系统设置 的中段
  const mid = rankDesktopAppSearchEntry(entry('settings', '系统设置'), 'tongshe')
  assert.ok(mid)
  assert.equal(mid!.tier, APP_SEARCH_TIERS.pinyinContains)
  console.log('ok: full pinyin')
}

function testAbbrev(): void {
  const cases = ['sz', 'shzh', 'shz', 'shzhi', 'szhi']
  for (const query of cases) {
    const match = rankDesktopAppSearchEntry(entry('settings', '设置'), query)
    assert.ok(match, `简拼 ${query} 应命中 设置`)
    assert.equal(match!.tier, APP_SEARCH_TIERS.pinyinAbbrev)
  }

  // shez 同时是全拼 shezhi 的前缀，全拼层优先
  const shez = rankDesktopAppSearchEntry(entry('settings', '设置'), 'shez')
  assert.ok(shez)
  assert.equal(shez!.tier, APP_SEARCH_TIERS.pinyinPrefix)

  // xz 跳过中间音节（x_zhi，xi 未消耗），不允许
  assert.equal(rankDesktopAppSearchEntry(entry('settings', '设置'), 'xz'), undefined)
  // 少于音节前缀规则：zshe（z 不是 she 的前缀开头组合）不应命中
  assert.equal(rankDesktopAppSearchEntry(entry('settings', '设置'), 'zshe'), undefined)
  console.log('ok: pinyin abbrev')
}

function testAbbrevRanges(): void {
  const match = rankDesktopAppSearchEntry(entry('settings', '系统设置'), 'sz')
  assert.ok(match)
  assert.deepEqual(match!.nameRanges, [[2, 4]])
  console.log('ok: abbrev highlight ranges')
}

function testFuzzy(): void {
  const byId = rankDesktopAppSearchEntry(entry('weather', '天气'), 'wr')
  assert.ok(byId)
  assert.equal(byId!.tier, APP_SEARCH_TIERS.fuzzyId)

  const byName = rankDesktopAppSearchEntry(entry('gen:cat', 'CatGPT 助手'), 'cgpt')
  assert.ok(byName)
  assert.equal(byName!.tier, APP_SEARCH_TIERS.fuzzyName)

  // 含汉字的查询不进模糊层，避免中文误撞拼音串
  assert.equal(rankDesktopAppSearchEntry(entry('weather', '天气'), '天气q'), undefined)
  console.log('ok: fuzzy subsequence')
}

function testTierPrecedence(): void {
  // 原名前缀(t0) < 全拼前缀(t2) < id 前缀(t5) < 模糊(t7+)
  const prefix = rankDesktopAppSearchEntry(entry('weather', '天气'), '天')
  assert.equal(prefix!.tier, APP_SEARCH_TIERS.namePrefix)
  const pinyin = rankDesktopAppSearchEntry(entry('weather', '天气'), 'tianqi')
  assert.equal(pinyin!.tier, APP_SEARCH_TIERS.pinyinPrefix)
  const id = rankDesktopAppSearchEntry(entry('weather', '天气'), 'wea')
  assert.equal(id!.tier, APP_SEARCH_TIERS.idPrefix)
  console.log('ok: tier precedence')
}

function testEmptyAndBlocked(): void {
  assert.equal(rankDesktopAppSearchEntry(entry('weather', '天气'), ''), undefined)
  assert.equal(rankDesktopAppSearchEntry(entry('weather', '天气'), '   '), undefined)
  assert.equal(rankDesktopAppSearchEntry(entry('weather', '天气'), 'zzzzzzz'), undefined)
  console.log('ok: empty and miss')
}

testPinyinKeys()
testFullPinyin()
testAbbrev()
testAbbrevRanges()
testFuzzy()
testTierPrecedence()
testEmptyAndBlocked()
console.log('app-search-ranking: all passed')
