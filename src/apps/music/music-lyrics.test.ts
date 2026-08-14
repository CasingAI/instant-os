/**
 * LRC 歌词解析纯函数单测。
 * 运行：node --experimental-strip-types src/apps/music/music-lyrics.test.ts
 */
import assert from 'node:assert/strict'
import { looksLikeLrc, parseLrc } from './music-lyrics.ts'

function testBasicTimestamps(): void {
  const result = parseLrc('[00:12.34]第一句\n[00:17.50]第二句')
  assert.equal(result.lines.length, 2)
  assert.deepEqual(result.lines[0], { timeMs: 12_340, text: '第一句' })
  assert.deepEqual(result.lines[1], { timeMs: 17_500, text: '第二句' })
  console.log('ok: basic timestamps')
}

function testMetaAndOffset(): void {
  const result = parseLrc('[ti:夜航星]\n[ar:不才]\n[offset:+500]\n[00:12.34]第一句')
  assert.equal(result.meta.ti, '夜航星')
  assert.equal(result.meta.ar, '不才')
  assert.equal(result.offsetMs, 500)
  // offset 已应用：12.34s + 0.5s
  assert.equal(result.lines[0].timeMs, 12_840)
  console.log('ok: meta + offset')
}

function testNegativeOffset(): void {
  const result = parseLrc('[offset:-300]\n[00:10.00]第一句')
  assert.equal(result.lines[0].timeMs, 9_700)
  console.log('ok: negative offset')
}

function testMultiTimestamps(): void {
  const result = parseLrc('[00:10.00][01:20.00]重复句')
  assert.equal(result.lines.length, 2)
  assert.equal(result.lines[0].timeMs, 10_000)
  assert.equal(result.lines[1].timeMs, 80_000)
  assert.equal(result.lines[0].text, '重复句')
  console.log('ok: multi timestamps')
}

function testSorting(): void {
  const result = parseLrc('[01:00.00]晚的\n[00:00.00]早的')
  assert.equal(result.lines[0].text, '早的')
  assert.equal(result.lines[1].text, '晚的')
  console.log('ok: sorting')
}

function testEnhancedWords(): void {
  const result = parseLrc(
    '[00:12.00]<00:12.50>岁<00:13.20>月<00:13.90>如<00:14.60>舟',
  )
  assert.equal(result.lines.length, 1)
  assert.equal(result.lines[0].timeMs, 12_000)
  assert.equal(result.lines[0].text, '岁月如舟')
  assert.deepEqual(result.lines[0].words, [
    { timeMs: 12_500, text: '岁' },
    { timeMs: 13_200, text: '月' },
    { timeMs: 13_900, text: '如' },
    { timeMs: 14_600, text: '舟' },
  ])
  console.log('ok: enhanced words')
}

function testFailedWords(): void {
  // 增强 LRC <mm:ss.xx|f> 内嵌失败标记解析出 failed: true
  const result = parseLrc('[00:01.00]<00:01.00|f>你<00:01.30>好')
  assert.equal(result.lines.length, 1)
  assert.equal(result.lines[0].text, '你好')
  assert.deepEqual(result.lines[0].words, [
    { timeMs: 1000, text: '你', failed: true },
    { timeMs: 1300, text: '好' },
  ])

  // 全行失败词混合英文词间空格也保留
  const enResult = parseLrc('[00:00.00]<00:00.00|f>Love <00:00.30>is')
  assert.deepEqual(enResult.lines[0].words, [
    { timeMs: 0, text: 'Love ', failed: true },
    { timeMs: 300, text: 'is' },
  ])
  console.log('ok: failed words')
}

function testFractionFormats(): void {
  // 2 位小数（厘秒）与 3 位小数（毫秒）
  const a = parseLrc('[00:12.34]a')
  const b = parseLrc('[00:12.345]b')
  assert.equal(a.lines[0].timeMs, 12_340)
  assert.equal(b.lines[0].timeMs, 12_345)
  console.log('ok: fraction formats')
}

function testUntimedLines(): void {
  // 无时间戳的纯文本行保留在末尾
  const result = parseLrc('[00:12.00]第一句\n无时间戳的歌词')
  assert.equal(result.lines.length, 2)
  assert.equal(result.lines[0].timeMs, 12_000)
  assert.equal(result.lines[1].timeMs, undefined)
  assert.equal(result.lines[1].text, '无时间戳的歌词')
  console.log('ok: untimed lines')
}

function testEmptyAndGarbage(): void {
  assert.equal(parseLrc('').lines.length, 0)
  assert.equal(parseLrc('\n\n').lines.length, 0)
  // 只有时间戳没有正文的行被忽略
  assert.equal(parseLrc('[00:12.00]\n[00:13.00]').lines.length, 0)
  console.log('ok: empty / garbage')
}

function testLooksLikeLrc(): void {
  assert.equal(looksLikeLrc('[00:12.34]第一句'), true)
  assert.equal(looksLikeLrc('[ti:标题]'), true)
  assert.equal(looksLikeLrc('普通文本'), false)
  assert.equal(looksLikeLrc(''), false)
  console.log('ok: looksLikeLrc')
}

testBasicTimestamps()
testMetaAndOffset()
testNegativeOffset()
testMultiTimestamps()
testSorting()
testEnhancedWords()
testFailedWords()
testFractionFormats()
testUntimedLines()
testEmptyAndGarbage()
testLooksLikeLrc()
