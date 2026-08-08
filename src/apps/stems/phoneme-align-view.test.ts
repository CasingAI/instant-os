/**
 * 双轨对齐视图纯逻辑单测（逐字时间线解析 / 音素→字映射 / 明细聚合）。
 * 运行：node --experimental-strip-types src/apps/stems/phoneme-align-view.test.ts
 */
import assert from 'node:assert/strict'
import {
  assignPhonesToChars,
  buildCharPhoneRows,
  charColorIndex,
  parseAlignLrcTimeline,
} from './phoneme-align-view.ts'
import type { AlignedPhone } from './phoneme-types.ts'

function phone(symbol: string, start: number, end: number): AlignedPhone {
  return { symbol, start, end }
}

function testEnhancedLrcTimeline(): void {
  // 增强 LRC 逐字：行起止取相邻行首个时间戳，末行用 duration 兜底
  const lrc =
    '<0:00.50>春<0:00.80>眠<0:01.10>不<0:01.40>觉<0:01.70>晓\n' +
    '<0:02.50>处<0:02.80>处<0:03.10>闻<0:03.40>啼<0:03.70>鸟'
  const parsed = parseAlignLrcTimeline(lrc, 4.0)
  assert.equal(parsed.hasWordTimestamps, true)
  assert.equal(parsed.durationSec, 4.0)
  assert.equal(parsed.timeline.length, 2)
  const [line0, line1] = parsed.timeline
  assert.equal(line0.lineText, '春眠不觉晓')
  assert.equal(line0.start, 0.5)
  assert.equal(line0.end, 2.5) // 下一行首字时间戳
  assert.deepEqual(
    line0.chars?.map((c) => [c.char, c.start, c.end]),
    [
      ['春', 0.5, 0.8],
      ['眠', 0.8, 1.1],
      ['不', 1.1, 1.4],
      ['觉', 1.4, 1.7],
      ['晓', 1.7, 2.5], // 末字 end 兜底到行尾
    ],
  )
  assert.equal(line1.start, 2.5)
  assert.equal(line1.end, 4.0) // 末行 end = duration
}

function testStandardLrcFallsBackToLineBlocks(): void {
  const parsed = parseAlignLrcTimeline('[00:10.00]第一句\n[00:20.00]第二句', 30)
  assert.equal(parsed.hasWordTimestamps, false)
  assert.equal(parsed.timeline.length, 2)
  const [line0] = parsed.timeline
  assert.equal(line0.lineText, '第一句')
  assert.equal(line0.chars, undefined) // 整行单块
  assert.equal(line0.start, 10)
  assert.equal(line0.end, 20)
}

function testDurationFallback(): void {
  // 未传 duration：末行 end = 末行 start + 3
  const parsed = parseAlignLrcTimeline('<0:00.50>春', undefined)
  assert.equal(parsed.timeline[0].end, 3.5)
  assert.equal(parsed.durationSec, 3.5)
}

function testOffsetAndMultiCharWord(): void {
  // [offset:-100] 整体前移 100ms
  const parsed = parseAlignLrcTimeline('[offset:-100]\n<0:00.50>春天<0:01.10>眠', 5)
  const [line0] = parsed.timeline
  assert.equal(line0.start, 0.4)
  // 多字 word：<ts>春天 在 [0.5, 1.1] 内按字数均分
  assert.deepEqual(
    line0.chars?.map((c) => [c.char, c.start, c.end]),
    [
      ['春', 0.4, 0.7],
      ['天', 0.7, 1.0],
      ['眠', 1.0, 5.0],
    ],
  )
}

function testAssignPhonesToChars(): void {
  const lrc =
    '[00:00.20]<0:00.50>春<0:00.80>眠<0:01.10>不<0:01.40>觉<0:01.70>晓\n' +
    '<0:02.50>处<0:02.80>处<0:03.10>闻<0:03.40>啼<0:03.70>鸟'
  const parsed = parseAlignLrcTimeline(lrc, 4.0)
  const assignments = assignPhonesToChars(
    [
      phone('tɕ', 0.55, 0.75), // mid 0.65 → 春(0.5-0.8)
      phone('ʊ', 0.78, 0.82), // mid 0.80 → 眠（边界归下一字）
      phone('m', 1.55, 1.6), // mid 1.575 → 觉(1.4-1.7)
      phone('i', 0.3, 0.4), // mid 0.35 → 行内间隙（首字前）
      phone('n', 0.05, 0.15), // mid 0.1 → 行外静音
      phone('<pad>', 0.6, 0.7), // CTC 特殊标记被过滤
    ],
    parsed.timeline,
  )
  assert.equal(assignments.length, 5)
  const [c0, c1, c2, gap, outside] = assignments
  assert.deepEqual(
    [c0.char, c0.lineIndex, c0.charIndex, c0.pinyin],
    ['春', 0, 0, 'j'],
  )
  assert.deepEqual([c1.char, c1.charIndex], ['眠', 1])
  assert.deepEqual([c2.char, c2.charIndex], ['觉', 3])
  assert.deepEqual([gap.lineIndex, gap.charIndex, gap.char], [0, -1, ''])
  assert.deepEqual([outside.lineIndex, outside.charIndex], [-1, -1])
}

function testStandardLrcAssignment(): void {
  // 无逐字时间戳：行内所有音素归到 charIndex 0，char = 整行文本
  const parsed = parseAlignLrcTimeline('[00:10.00]第一句', 20)
  const assignments = assignPhonesToChars([phone('tɕ', 10.2, 10.4)], parsed.timeline)
  assert.equal(assignments.length, 1)
  assert.deepEqual(
    [assignments[0].char, assignments[0].charIndex, assignments[0].lineIndex],
    ['第一句', 0, 0],
  )
}

function testBuildCharPhoneRows(): void {
  const lrc = '<0:00.50>春<0:00.80>眠<0:01.10>不<0:01.40>觉<0:01.70>晓'
  const parsed = parseAlignLrcTimeline(lrc, 3)
  const assignments = assignPhonesToChars(
    [
      phone('tɕ', 0.55, 0.75), // 春
      phone('ʊ', 0.78, 0.82), // 眠
      phone('m', 1.2, 1.3), // 不
    ],
    parsed.timeline,
  )
  const rows = buildCharPhoneRows(assignments, parsed.timeline)
  assert.equal(rows.length, 5) // 骨架行：无音素的字也出现
  const chun = rows[0]
  assert.equal(chun.char, '春')
  assert.deepEqual(
    chun.phones.map((p) => [p.pinyin, p.symbol]),
    [['j', 'tɕ']],
  )
  assert.equal(rows[1].phones.length, 1) // 眠
  assert.equal(rows[2].phones.length, 1) // 不
  assert.equal(rows[3].phones.length, 0) // 觉：无音素命中
  assert.equal(rows[4].phones.length, 0) // 晓
  // 行内间隙音素不占行
  const gapRows = buildCharPhoneRows(
    assignPhonesToChars([phone('i', 0.3, 0.4)], parsed.timeline),
    parsed.timeline,
  )
  assert.ok(gapRows.every((row) => row.phones.length === 0))
}

function testCharColorIndex(): void {
  assert.equal(charColorIndex(0, 0), 0)
  assert.equal(charColorIndex(0, 8), 0) // 8 色循环
  assert.equal(charColorIndex(1, 0), 7) // 31 % 8 = 7
  assert.equal(charColorIndex(0, 5), 5)
}

testEnhancedLrcTimeline()
testStandardLrcFallsBackToLineBlocks()
testDurationFallback()
testOffsetAndMultiCharWord()
testAssignPhonesToChars()
testStandardLrcAssignment()
testBuildCharPhoneRows()
testCharColorIndex()
console.log('phoneme-align-view: all tests passed')
