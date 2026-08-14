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

function testLineAnchorSmallOffset(): void {
  // 两行都有匹配锚点且各自行时间偏差在阈值内 → 每行独立归位到 .lrc 行时间
  const segments = segs([
    ['hello', 22.0, 22.6],
    ['world', 22.6, 23.2],
  ])
  const raw =
    '[00:21.70]hello\n' +
    '[00:24.10]world'
  const lineTimes = [21700, 24100]
  const lrc = alignSegmentsToLrc(segments, raw, lineTimes)
  const lines = lrc.split('\n')
  assert.equal(lines.length, 2)
  assert.ok(lines[0].startsWith('[00:21.70]'), `第一行应锚到 21.70：${lines[0]}`)
  assert.ok(lines[1].startsWith('[00:24.10]'), `第二行应锚到 24.10：${lines[1]}`)
}

function testLineAnchorHugeOffsetIgnored(): void {
  // 识别 22s，.lrc 行时间 30s（偏差 8s，远超窗口 5s/阈值 4s）→ 识别段不在行窗口内，
  // 视为该行无匹配 → 行时间主导，均匀分摊到行区间（用户判断行时间可信）
  const segments = segs([
    ['hello', 22.0, 22.6],
    ['world', 22.6, 23.2],
  ])
  const raw =
    '[00:30.00]hello\n' +
    '[00:33.00]world'
  const lineTimes = [30000, 33000]
  const lrc = alignSegmentsToLrc(segments, raw, lineTimes)
  const lines = lrc.split('\n')
  assert.equal(lines.length, 2)
  assert.ok(lines[0].startsWith('[00:30.00]'), `行时间主导应锚到 30s：${lines[0]}`)
  assert.ok(lines[1].startsWith('[00:33.00]'), `行时间主导应锚到 33s：${lines[1]}`)
}

function testLineAnchorNoMatchNotAnchored(): void {
  // 第二行歌词（a long extra phrase）在识别中完全没有对应 → 行内无匹配锚点，
  // 行时间主导：整行均匀分摊到行区间（不再保留识别时间）
  const segments = segs([
    ['hello', 22.0, 22.6],
    ['world', 22.6, 23.2],
  ])
  const raw =
    '[00:21.70]hello\n' +
    '[00:24.10]a long extra phrase'
  const lineTimes = [21700, 24100]
  const lrc = alignSegmentsToLrc(segments, raw, lineTimes)
  const lines = lrc.split('\n')
  assert.equal(lines.length, 2)
  assert.ok(lines[0].startsWith('[00:21.70]'), `第一行匹配应锚定：${lines[0]}`)
  assert.ok(lines[1].startsWith('[00:24.10]'), `第二行无匹配也应按行时间分摊：${lines[1]}`)
}

/** 解析增强 LRC 一行的逐词时间（秒） */
function lineWords(lrcLine: string): { text: string; timeSec: number }[] {
  const out: { text: string; timeSec: number }[] = []
  const re = /<(\d{1,2}):(\d{1,2})(?:\.(\d{1,2}))?>([^<]*)/g
  for (const m of lrcLine.matchAll(re)) {
    const min = Number(m[1])
    const sec = Number(m[2])
    const centi = Number(m[3] ?? '0')
    out.push({ text: m[4], timeSec: min * 60 + sec + centi / 100 })
  }
  return out
}

function testPerLineIsolation(): void {
  // 行 0 "hello my friend"（10s），行 1 "you are kind"（16s）。
  // "my" 未识别（全局 DTW 会把它错误匹配到别的行）；按行隔离后应留在行 0 区间内。
  const segments = segs([
    ['hello', 10.2, 10.6],
    ['friend', 12.5, 13.0],
    ['you', 16.2, 16.6],
    ['are', 16.8, 17.2],
    ['kind', 17.4, 18.0],
  ])
  const raw =
    '[00:10.00]hello my friend\n' +
    '[00:16.00]you are kind'
  const lineTimes = [10000, 16000]
  const lrc = alignSegmentsToLrc(segments, raw, lineTimes)
  const lines = lrc.split('\n')
  assert.equal(lines.length, 2)

  const row0 = lineWords(lines[0])
  // 词间空格并入前词文本（增强 LRC 空格落在前一词末尾）
  assert.equal(row0[0].text, 'hello ')
  assert.equal(row0[2].text, 'friend')
  // "my" 应落在行 0 区间 [10, 16]，而非跳到行 1
  assert.ok(row0[1].timeSec >= 10 && row0[1].timeSec <= 16, `my 应在行0区间：${row0[1].timeSec}`)
  // 行 1 词全部在 16s 附近
  const row1 = lineWords(lines[1])
  assert.ok(row1.every((w) => w.timeSec >= 15.5), '行1词应在 16s 附近')
}

function testLineScaleWithin(): void {
  // 行 0 "a b" 行时间 [10, 14]（行 1 起点 14），识别 a@10.5 b@13.0
  // → 行内线性映射：[a 起点 → 10, b 终点 → 14]，保持相对比例
  const segments = segs([
    ['a', 10.5, 10.9],
    ['b', 13.0, 13.4],
  ])
  const raw =
    '[00:10.00]a b\n' +
    '[00:14.00]c'
  const lineTimes = [10000, 14000]
  const lrc = alignSegmentsToLrc(segments, raw, lineTimes)
  const lines = lrc.split('\n')
  const row0 = lineWords(lines[0])
  assert.equal(row0.length, 2)
  // a → 行首 10s
  assert.ok(Math.abs(row0[0].timeSec - 10) < 0.05, `a 应映射到行首：${row0[0].timeSec}`)
  // b 起点按比例 ≈ 10 + (13.0-10.5)/(13.4-10.5)*4 ≈ 13.45，落在 [13.3, 13.6]
  assert.ok(
    row0[1].timeSec >= 13.3 && row0[1].timeSec <= 13.6,
    `b 应按比例映射进行区间：${row0[1].timeSec}`,
  )
}

function testNoMatchSpread(): void {
  // 行 0 无匹配词：3 词均匀分摊到行区间 [10, 14]
  const segments = segs([['something', 5.0, 5.4]])
  const raw =
    '[00:10.00]x y z\n' +
    '[00:14.00]w'
  const lineTimes = [10000, 14000]
  const lrc = alignSegmentsToLrc(segments, raw, lineTimes)
  const words = lineWords(lrc.split('\n')[0])
  assert.equal(words.length, 3)
  assert.ok(Math.abs(words[0].timeSec - 10) < 0.05, `首词应在 10s：${words[0].timeSec}`)
  assert.ok(Math.abs(words[1].timeSec - 12) < 0.05, `中词应在 12s：${words[1].timeSec}`)
  assert.ok(Math.abs(words[2].timeSec - 14) < 0.05, `末词应在 14s：${words[2].timeSec}`)
}

function testOverThresholdNotAnchored(): void {
  // 识别 hello@15，行时间 10s（偏差 5s > 阈值 4s，但在搜索窗口 5s 内）
  // → 找到识别段但不缩放，保留识别时间
  const segments = segs([['hello', 15.0, 15.4]])
  const raw = '[00:10.00]hello'
  const lineTimes = [10000]
  const lrc = alignSegmentsToLrc(segments, raw, lineTimes)
  const words = lineWords(lrc)
  assert.equal(words.length, 1)
  assert.ok(Math.abs(words[0].timeSec - 15) < 0.05, `超阈值不应锚定：${words[0].timeSec}`)
}

function testNoLineTimesFallback(): void {
  // 无行时间戳 → 回退全局对齐，输出与旧路径一致（正常产出）
  const segments = segs([
    ['hello', 10.2, 10.8],
    ['world', 10.8, 11.4],
  ])
  const lrc = alignSegmentsToLrc(segments, 'hello world')
  assert.ok(lrc.includes('hello'), lrc)
  assert.ok(lrc.includes('world'), lrc)
  assert.ok(lrc.startsWith('[00:10.20]'), lrc)
}

function testClusteredLineTimesSpread(): void {
  // 英文行时间挤在 50ms 内（常见劣质 .lrc），识别在后续数秒仍有唱段。
  // 撑开后整行词不应再堆在 150ms 内。
  const segments = segs([
    ['why', 118.5, 118.8],
    ['you', 118.8, 119.1],
    ['give', 124.0, 124.3],
    ['think', 127.4, 127.8],
  ])
  const raw =
    '[01:58.50]Why you talking\n' +
    '[02:03.86]Give it to me now momma\n' +
    '[02:03.91]You must be dreamin if you think\n' +
    '[02:07.76]Love is a game'
  const lineTimes = [118500, 123860, 123910, 127760]
  const lrc = alignSegmentsToLrc(segments, raw, lineTimes)
  const lines = lrc.split('\n')
  assert.equal(lines.length, 4)
  const row1 = lineWords(lines[1])
  assert.ok(row1.length >= 5, `Give 行应有多个词：${lines[1]}`)
  const span = row1[row1.length - 1].timeSec - row1[0].timeSec
  assert.ok(
    span >= 0.7,
    `Give 行不应挤在一瞬间（跨度 ${span.toFixed(3)}s）：${lines[1]}`,
  )
  const row2 = lineWords(lines[2])
  const span2 = row2[row2.length - 1].timeSec - row2[0].timeSec
  assert.ok(
    span2 >= 0.5,
    `dreamin 行不应挤在一瞬间（跨度 ${span2.toFixed(3)}s）：${lines[2]}`,
  )
}

function testVoicedEndExtendsLine(): void {
  // 行时间挤在 10ms 内，但音素显示实际演唱一直持续到 132s。
  // 声学行尾应把行尾从 10ms 撑到音素所示的演唱结束处。
  const segments = segs([
    ['stop', 129.6, 129.8],
    ['dream', 129.8, 130.0],
    ['dreaming', 130.0, 131.0],
    ['hello', 131.5, 132.3],
  ])
  const raw =
    '[02:07.76]Love is so perfect\n' +
    '[02:07.77]So you best stop dreaming\n' +
    '[02:07.83]Love is a game'
  const lineTimes = [127760, 127770, 127830]
  const lrc = alignSegmentsToLrc(segments, raw, lineTimes)
  const lines = lrc.split('\n')
  assert.equal(lines.length, 3)
  // 「Love is a game」行：识别段落在其行区间，声学末尾应扩展该行
  const row2 = lineWords(lines[2])
  assert.ok(row2.length >= 4, `Love is a game 行应有词：${lines[2]}`)
  const lastWord = row2[row2.length - 1]
  assert.ok(
    lastWord.timeSec >= 131,
    `行尾应扩展到声学末尾（实际 ${lastWord.timeSec.toFixed(2)}s）：${lines[2]}`,
  )
  const span = lastWord.timeSec - row2[0].timeSec
  assert.ok(span >= 1.5, `Love is a game 行应铺开（跨度 ${span.toFixed(2)}s）：${lines[2]}`)
}

async function runAll(): Promise<void> {
  testCleanLyrics()
  testStripTimestampLyrics()
  testEmptyLyrics()
  testNoSegments()
  testLineAnchorSmallOffset()
  testLineAnchorHugeOffsetIgnored()
  testLineAnchorNoMatchNotAnchored()
  testPerLineIsolation()
  testLineScaleWithin()
  testNoMatchSpread()
  testOverThresholdNotAnchored()
  testNoLineTimesFallback()
  testClusteredLineTimesSpread()
  testVoicedEndExtendsLine()
  console.log('align-pipeline: 全部通过')
}

runAll().catch((error) => {
  console.error(error)
  process.exit(1)
})
