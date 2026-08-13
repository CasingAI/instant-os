/**
 * 确定性 G2P 单测（node --experimental-strip-types 直接跑）。
 * 用真实 wav2vec2 vocab 构建反向索引，验证：
 *  1. 拼音归一化（声调/ü）；
 *  2. 反向索引的等价类（i 系列、n、j 系列）；
 *  3. 音节 → 候选组（含零声母、ü、复韵母降级拆分）；
 *  4. 整句歌词逐字 G2P 与 toG2pLines。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  buildPinyinReverseIndex,
  lyricsToPinyinLines,
  normalizePinyin,
  stripLrcMarkup,
  syllableToSymbolGroups,
  toG2pLines,
} from './pinyin-g2p.ts'

const vocabPath = fileURLToPath(
  new URL('../../../public/assets/phoneme/vocab.json', import.meta.url),
)
const vocabJson = JSON.parse(readFileSync(vocabPath, 'utf8')) as Record<string, number>
const vocabSymbols = Object.keys(vocabJson)
const index = buildPinyinReverseIndex(vocabSymbols)

// —— 1. 拼音归一化 ——
{
  assert.equal(normalizePinyin('nǐ'), 'ni')
  assert.equal(normalizePinyin('hǎo'), 'hao')
  assert.equal(normalizePinyin('ī'), 'i')
  assert.equal(normalizePinyin('ǚ'), 'yu')
  assert.equal(normalizePinyin('üè'), 'yue')
}

// —— 2. 反向索引等价类 ——
{
  const iGroup = index.get('i')
  assert.ok(iGroup, '应有 i 组')
  for (const s of ['i', 'i.5', 'i̪5', 'iː', 'ɪ', 'i1', 'i2', 'i4']) {
    assert.ok(iGroup.includes(s), `i 组应含 ${s}`)
  }

  const nGroup = index.get('n')
  assert.ok(nGroup && nGroup.length > 0, '应有 n 组')
  assert.ok(nGroup.includes('n'))

  const jGroup = index.get('j')
  assert.ok(jGroup && jGroup.length > 0, '应有 j 组')
  assert.ok(jGroup.includes('tɕ'), 'j 组应含 tɕ')

  const aGroup = index.get('a')
  assert.ok(aGroup && aGroup.length > 0, '应有 a 组')
  assert.ok(aGroup.includes('a'))

  // 未识别符号（IPA 原样）不入索引
  for (const key of index.keys()) {
    assert.match(key, /^[a-z]+$/u, `索引键应为纯拉丁：${key}`)
  }
}

// —— 3. 音节 → 候选组 ——
{
  // nǐ → [n 组, i 组]
  const ni = syllableToSymbolGroups('nǐ', index)
  assert.equal(ni.length, 2)
  assert.ok(ni[0].includes('n'))
  assert.ok(ni[1].includes('i'))

  // yī → [y 组, i 组]（pinyin-pro 把 y 当作声母）
  const yi = syllableToSymbolGroups('yī', index)
  assert.ok(yi.length >= 2)
  assert.ok(yi[0].includes('j'), 'y 组应含 j')
  assert.ok(yi[1].includes('i'))

  // nǚ → [n 组, yu 组]
  const nv = syllableToSymbolGroups('nǚ', index)
  assert.equal(nv.length, 2)
  assert.ok(nv[1].some((s) => index.get('yu')?.includes(s)))

  // 复韵母：xiǎng → [x 组, i 组, ang 组]（iang 降级拆为 i + ang）
  const xiang = syllableToSymbolGroups('xiǎng', index)
  assert.ok(xiang.length >= 2)
  assert.ok(xiang[0].includes('ɕ'), 'x 组应含 ɕ')

  // 零声母：ài → [ai 组]
  const ai = syllableToSymbolGroups('ài', index)
  assert.ok(ai.length >= 1)
}

// —— 4. 整句歌词逐字 G2P ——
{
  const lines = lyricsToPinyinLines('夜空中最亮的星 能否听清', index)
  assert.equal(lines.length, 1)
  const texts = lines[0].units.map((u) => u.text)
  assert.equal(texts.length, 11)
  assert.equal(texts[0], '夜')
  assert.ok(lines[0].units[0].symbolGroups.length >= 2, '夜 应有音素组')
  // 空白被分词跳过
  assert.ok(!texts.includes(' '))

  // 多音字上下文消歧
  const hang = lyricsToPinyinLines('银行行长', index)
  assert.ok(hang[0].units.length >= 4)

  // 标点单元无音素
  const punct = lyricsToPinyinLines('你好，世界', index)
  const p = punct[0].units.find((u) => u.text === '，')
  assert.ok(p, '标点应成单元')
  assert.deepEqual(p.symbolGroups, [])
}

// —— 5. toG2pLines ——
{
  const lines = lyricsToPinyinLines('你好', index)
  const g2p = toG2pLines(lines)
  assert.equal(g2p.length, 1)
  assert.equal(g2p[0].units[0].text, '你')
  assert.ok(g2p[0].units[0].phones.length >= 2)
}

// —— 6. 歌词清洗：剥离 LRC 时间戳 / 元数据 / 增强标签 ——
{
  // 用户复制的完整 .lrc：时间戳 + 元数据行
  const lrc = `[ti:新的千年]
[ar:自由页]
[00:00.00]新的千年-自由页
[00:04.45]词：自由页
[00:21.28]已经到了千禧年的第二个十年
`
  assert.equal(
    stripLrcMarkup(lrc),
    ['新的千年-自由页', '词：自由页', '已经到了千禧年的第二个十年'].join('\n'),
  )

  // 增强 LRC（含逐字标签）重新导入
  const enhanced = '[00:21.28]<00:21.28>新<00:21.28>的<00:21.28>千<00:21.28>禧<00:21.28>年'
  assert.equal(stripLrcMarkup(enhanced), '新的千禧年')

  // 坏 LRC 嵌套标签（用户反馈的形态）：整行剥成纯文本
  const broken =
    '[00:21.28]<00:21.28>[<00:21.28>00:<00:21.28>00.<00:21.28>00]<00:21.28>新<00:21.28>的<00:21.28>千<00:21.28>禧<00:21.28>年'
  assert.equal(stripLrcMarkup(broken), '新的千禧年')

  // 元数据标签后接歌词文本
  assert.equal(stripLrcMarkup('[ti:新的千年]新的千年-自由页'), '新的千年-自由页')

  // 纯时间戳行/纯元数据行 → 空
  assert.equal(stripLrcMarkup('[00:00.00]\n[offset:500]\n'), '')
  assert.equal(stripLrcMarkup(''), '')
}
