/**
 * align-pipeline 单测：Zipformer 识别段 → 增强 LRC 的纯函数流水线。
 * 运行：node --experimental-strip-types src/apps/align/align-pipeline.test.ts
 */
import assert from 'node:assert/strict'
import { alignSegmentsToLrc } from './align-pipeline.ts'
import { stripLrcMarkup } from './pinyin-g2p.ts'
import type { HypSegment } from './align-text-dtw.ts'

const segs = (symbols: [string, number, number][]): HypSegment[] =>
  symbols.map(([symbol, start, end]) => ({ symbol, start, end }))

function testCleanLyrics(): void {
  const segments = segs([
    ['新的千禧年', 21.28, 22.0],
    ['自由页', 22.0, 22.6],
  ])
  const lrc = alignSegmentsToLrc(segments, '新的千禧年\n自由页')
  const lines = lrc.split('\n')
  assert.equal(lines.length, 2)
  // 行首是合法时间戳、无嵌套坏标签
  assert.ok(/^\[\d{2}:\d{2}\.\d{2}\]/.test(lines[0]), lines[0])
  assert.ok(!lines[0].includes('[<'), '不应出现嵌套时间戳')
  assert.ok(lines[0].startsWith('[00:21.28]'), lines[0])
}

function testStripTimestampLyrics(): void {
  // 输入歌词自带 LRC 时间戳：清洗后正确对齐，不产坏 LRC
  const segments = segs([
    ['新的千禧年', 21.28, 22.0],
    ['自由页', 22.0, 22.6],
  ])
  const raw =
    '[00:00.00]新的千禧年-自由页\n' +
    '[00:21.28][00:21.30]新的千禧年\n' +
    '[00:21.60]<00:21.60>自<00:21.80>由<00:21.90>页'
  const lrc = alignSegmentsToLrc(segments, raw)
  const lines = lrc.split('\n')
  assert.equal(lines.length, 3)
  for (const line of lines) {
    assert.ok(!line.includes('[<'), `不应出现嵌套时间戳：${line}`)
    assert.ok(!/[\[\]]/.test(line.replace(/^\[\d{2}:\d{2}\.\d{2}\]/, '')), `不应残留方括号：${line}`)
  }
  assert.ok(stripLrcMarkup(lrc).includes('千禧年'), lrc)
}

function testEmptyLyrics(): void {
  const segments = segs([['你', 0.0, 0.2]])
  assert.equal(alignSegmentsToLrc(segments, ''), '')
  assert.equal(alignSegmentsToLrc(segments, '  \n  '), '')
  // 只含元数据/时间戳的歌词清洗后为空
  assert.equal(alignSegmentsToLrc(segments, '[ti:测试]\n[00:00.00]'), '')
}

function testNoSegments(): void {
  assert.equal(alignSegmentsToLrc([], '新的千禧年'), '')
}

async function runAll(): Promise<void> {
  testCleanLyrics()
  testStripTimestampLyrics()
  testEmptyLyrics()
  testNoSegments()
  console.log('align-pipeline: 全部通过')
}

runAll().catch((error) => {
  console.error(error)
  process.exit(1)
})
