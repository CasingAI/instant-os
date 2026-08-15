/**
 * 歌词分析纯函数单测（node --experimental-strip-types 直接跑）。
 * 验证：computeLineStats（红词/挤压/括号）、detectGaps（断层切片）、
 * alignWithoutParens（括号剔除）、sliceSegments（合并识别段）。
 */

import assert from 'node:assert/strict'
import { parseLrc, type LyricsWord } from '../music/music-lyrics.ts'
import { alignTextBacktrace, type HypSegment } from '../align/align-text-dtw.ts'
import { buildLyricsSkeleton, tokenizeLyricsLine } from '../align/align-g2p.ts'
import { traceAlignRow } from '../align/align-pipeline.ts'
import type { AlignedUnit } from '../align/align-types.ts'
import {
  buildCtcTrace,
  buildFocusTrace,
  buildGlobalTrace,
  buildLineMappedTrace,
  buildSpreadTrace,
  computeTraceViewSec,
  formatChartDump,
  formatLineTraceDump,
  layoutTraceItems,
  TRACE_LABEL_W,
  traceRowToChart,
} from './lyrics-trace.ts'
import {
  alignLineByLineTimes,
  alignLineFree,
  alignLineWithoutParens,
  alignWithoutParens,
  buildLineFromUnits,
  computeLineStats,
  describeLineIssue,
  detectGaps,
  lineWindowSec,
  patchLineIntoAlignedLrc,
  resolveLineTimes,
  sliceSegments,
  spreadLineToWindow,
  splitLineParens,
  summarizeLines,
} from './lyrics-analysis.ts'

/** 构造带逐字时间戳的增强 LRC 解析结果 */
function lrcLines(raw: string) {
  return parseLrc(raw).lines
}

// —— computeLineStats：红词计数与挤压判定 ——
{
  const lines = lrcLines(
    '[00:10.00]<00:10.00>Hello <00:10.30|f>world\n' +
      '[00:12.00]<00:12.00>A <00:12.20>B <00:12.40>C <00:12.60>D <00:12.80>E <00:13.00>F <00:13.20>G <00:13.40>H\n' +
      '[00:14.00]<00:14.00>(Yeah, <00:14.30>okay)',
  )
  const stats = computeLineStats(lines)
  assert.equal(stats.length, 3)

  // 行 0：2 词，1 红，间隔 2s 不挤压
  assert.equal(stats[0].wordCount, 2)
  assert.equal(stats[0].failedCount, 1)
  assert.equal(stats[0].squeezed, false)
  assert.equal(stats[0].hasParen, false)

  // 行 1：8 词，间隔 2s = 8×180ms=1440ms < 2000ms，不挤压
  assert.equal(stats[1].wordCount, 8)
  assert.equal(stats[1].squeezed, false)

  // 行 2：有括号，间隔 2s，2 词
  assert.equal(stats[2].hasParen, true)
  assert.equal(stats[2].wordCount, 2)
}

// —— computeLineStats：挤压行（词数 × 180ms > 行区间） ——
{
  // 6 词但行区间只有 0.5s（500ms < 6×180=1080ms）
  const lines = lrcLines(
    '[00:10.00]<00:10.00>a<00:10.01>b<00:10.02>c<00:10.03>d<00:10.04>e<00:10.05>f\n[00:10.50]next',
  )
  const stats = computeLineStats(lines)
  assert.equal(stats[0].squeezed, true)
}

// —— detectGaps：无识别段的断层行合并为切片 ——
{
  const phonemes: HypSegment[] = [
    { symbol: 'HELLO', start: 1, end: 1.3 },
    { symbol: 'WORLD', start: 8, end: 8.4 },
  ]
  // 行区间：0-3s（有段）、3-7s（断层，>2s）、7-10s（有段）
  const lineTimes = [0, 3000, 7000, 10000]
  const gaps = detectGaps(phonemes, lineTimes, 2)
  assert.equal(gaps.length, 1)
  assert.equal(gaps[0].startSec, 3)
  assert.equal(gaps[0].endSec, 7)
  assert.deepEqual(gaps[0].lineIndexes, [1])
}

// —— detectGaps：相邻断层行合并 ——
{
  const phonemes: HypSegment[] = [{ symbol: 'X', start: 1, end: 1.2 }]
  const lineTimes = [0, 3000, 6000, 9000]
  const gaps = detectGaps(phonemes, lineTimes, 2)
  // 0-3 有段跳过；3-6、6-9 均断层且相邻 → 合并成一个切片
  assert.equal(gaps.length, 1)
  assert.equal(gaps[0].startSec, 3)
  assert.equal(gaps[0].endSec, 9)
  assert.deepEqual(gaps[0].lineIndexes, [1, 2])
}

// —— detectGaps：短区间不判断层 ——
{
  const phonemes: HypSegment[] = []
  const lineTimes = [0, 1000, 2000]
  const gaps = detectGaps(phonemes, lineTimes, 2)
  assert.equal(gaps.length, 0)
}

// —— splitLineParens：拆出主词与括号段 ——
{
  const s = splitLineParens('In New York (Ayy, aha) (Uh, yeah)')
  assert.equal(s.mainText, 'In New York')
  assert.equal(s.adlibs.length, 2)
  assert.equal(s.adlibs[0].text, 'Ayy, aha')
  assert.equal(s.adlibs[1].text, 'Uh, yeah')
}

// —— splitLineParens：无括号时主词即原文 ——
{
  const s = splitLineParens('Concrete jungle where dreams are made of')
  assert.equal(s.mainText, 'Concrete jungle where dreams are made of')
  assert.equal(s.adlibs.length, 0)
}

// —— alignWithoutParens：括号段不参与对齐（主词仍对齐） ——
{
  const phonemes: HypSegment[] = [
    { symbol: 'IN', start: 10, end: 10.2 },
    { symbol: 'NEW', start: 10.3, end: 10.5 },
    { symbol: 'YORK', start: 10.6, end: 10.9 },
  ]
  const result = alignWithoutParens(phonemes, 'In New York (Ayy, aha) (Uh, yeah)')
  assert.equal(result.adlibCount, 2)
  assert.ok(result.lines.length >= 1)
  // 主词行不包含括号
  assert.ok(!result.lines[0].text.includes('('))
  assert.ok(!result.lines[0].text.includes(')'))
}

// —— sliceSegments：删除切片区间内旧段并插入新段 ——
{
  const old: HypSegment[] = [
    { symbol: 'A', start: 1, end: 1.5 },
    { symbol: 'B', start: 2, end: 2.5 }, // 在 [2, 4) 内，应被删
    { symbol: 'C', start: 4.5, end: 5 }, // 在 [2, 4) 外，保留
  ]
  const fresh: HypSegment[] = [
    { symbol: 'X', start: 2.1, end: 2.3 },
    { symbol: 'Y', start: 3.0, end: 3.4 },
  ]
  const merged = sliceSegments(old, 2, 4, fresh)
  assert.deepEqual(
    merged.map((s) => s.symbol),
    ['A', 'X', 'Y', 'C'],
  )
  // 新段排序在保留段之间
  assert.ok(merged.every((s, i) => i === 0 || merged[i - 1].start <= s.start))
}

// —— summarizeLines：红词比例 ——
{
  const lines = lrcLines('[00:10.00]<00:10.00>a<00:10.10>b<00:10.20|c>c')
  const s = summarizeLines(lines)
  assert.equal(s.totalWords, 3)
  assert.equal(s.failedWords, 1)
  assert.ok(Math.abs(s.failedRatio - 1 / 3) < 1e-9)
}

// —— resolveLineTimes：优先源 LRC 行时间戳 ——
{
  const lyrics = 'Hello world\nSecond line'
  const lyricsLrc = '[00:11.20]Hello world\n[00:15.80]Second line'
  const karaokeLines = lrcLines('[00:09.00]<00:09.00>Hello <00:09.30>world\n[00:14.00]Second line')
  const times = resolveLineTimes(lyrics, lyricsLrc, karaokeLines)
  assert.deepEqual(times, [11200, 15800])
}

// —— resolveLineTimes：无 lyricsLrc 时回退 karaokeLines ——
{
  const lyrics = 'Hello world'
  const karaokeLines = lrcLines('[00:09.00]Hello world')
  const times = resolveLineTimes(lyrics, null, karaokeLines)
  assert.deepEqual(times, [9000])
}

// —— resolveLineTimes：lyricsLrc 匹配不到时回退 ——
{
  const lyrics = 'Edited line'
  const lyricsLrc = '[00:11.20]Original line'
  const karaokeLines = lrcLines('[00:09.00]Edited line')
  const times = resolveLineTimes(lyrics, lyricsLrc, karaokeLines)
  assert.deepEqual(times, [9000])
}

// —— describeLineIssue：挤压 / 红词 / 括号 / 正常 ——
{
  // 6 词压进 0.5s → 挤压
  const squeezed = lrcLines(
    '[00:10.00]<00:10.00>a<00:10.01>b<00:10.02>c<00:10.03>d<00:10.04>e<00:10.05>f\n[00:10.50]next',
  )
  assert.ok(describeLineIssue(computeLineStats(squeezed)[0]).includes('压进'))

  // 1 红词 → 红词诊断
  const red = lrcLines('[00:10.00]<00:10.00|f>a<00:10.30>b\n[00:12.00]next')
  assert.ok(describeLineIssue(computeLineStats(red)[0]).includes('红词'))

  // 括号行（无红词无挤压）→ 括号诊断
  const paren = lrcLines('[00:10.00]<00:10.00>(Yeah, <00:10.30>okay)\n[00:12.00]next')
  assert.ok(describeLineIssue(computeLineStats(paren)[0]).includes('括号'))

  // 正常行
  const ok = lrcLines('[00:10.00]<00:10.00>Hello <00:10.30>world\n[00:12.00]next')
  assert.ok(describeLineIssue(computeLineStats(ok)[0]).includes('正常'))
}

// —— describeLineIssue：追踪提供真锚点比例，几乎没对上不算「正常」 ——
{
  // 5 词行，只对上 1 个（或 0 个）→ 明确报不可靠，不能是「正常」
  const stats = lrcLines('[00:10.00]<00:10.00>大<00:11.00>家<00:12.00>来<00:13.00>恋<00:14.00>爱\n[00:16.00]next')
  const st = computeLineStats(stats)[0]
  assert.equal(
    describeLineIssue(st, { matched: 1, total: 5 }),
    '这行 5 词只对上 1 个识别，其余是插值兜底、时间不可靠',
  )
  assert.ok(!describeLineIssue(st, { matched: 1, total: 5 }).includes('正常'))
  assert.ok(describeLineIssue(st, { matched: 0, total: 5 }).includes('一个都没对上'))
  // 全对上 → 正常；对上过半但有插值 → 报红词，不报正常
  assert.ok(describeLineIssue(st, { matched: 5, total: 5 }).includes('正常'))
  assert.ok(describeLineIssue(st, { matched: 3, total: 5 }).includes('红词'))
  // 标点不算词：你好，世界 → 只有 4 个可对齐词
  const punct = lrcLines('[00:10.00]<00:10.00>你<00:10.10>好<00:10.20>，<00:10.30>世<00:10.40>界\n[00:12.00]next')
  const stPunct = computeLineStats(punct)[0]
  assert.ok(describeLineIssue(stPunct, { matched: 4, total: 4 }).includes('正常'), '标点不应计入红词')
}

// —— spreadLineToWindow：词均匀铺进行区间 ——
{
  const line = lrcLines('[00:10.00]<00:10.00>a<00:10.05>b<00:10.10>c\n[00:13.00]next')[0]
  const spread = spreadLineToWindow(line, 10, 13)
  assert.equal(spread.words!.length, 3)
  assert.equal(spread.timeMs, 10000)
  assert.equal(spread.words![0].timeMs, 10000)
  assert.equal(spread.words![1].timeMs, 11500)
  assert.equal(spread.words![2].timeMs, 13000)
}

// —— spreadLineToWindow：保留 failed 标记（摊开不洗白插值词） ——
{
  const line = lrcLines('[00:10.00]<00:10.00|f>a<00:10.05|f>b\n[00:13.00]next')[0]
  const spread = spreadLineToWindow(line, 10, 13)
  assert.ok(spread.words!.every((w) => w.failed === true), '插值词摊开后仍应标红')
}

// —— spreadLineToWindow：单词取区间中点 ——
{
  const line = lrcLines('[00:10.00]<00:10.00>only\n[00:13.00]next')[0]
  const spread = spreadLineToWindow(line, 10, 13)
  assert.equal(spread.words!.length, 1)
  assert.equal(spread.words![0].timeMs, 11500)
}

// —— lineWindowSec：常规行带 pad ——
{
  const w = lineWindowSec([10000, 13000], 0, 0.8)
  assert.equal(w.startSec, 9.5)
  assert.equal(w.endSec, 13.5)
}

// —— lineWindowSec：末行用 fallback ——
{
  const w = lineWindowSec([10000, 13000], 1, 0.8)
  assert.equal(w.startSec, 12.5)
  assert.ok(w.endSec >= 13.5)
}

// —— lineWindowSec：开头 clamp 到 0 ——
{
  const w = lineWindowSec([0, 2000], 0, 0.8)
  assert.equal(w.startSec, 0)
}

// —— patchLineIntoAlignedLrc：只替换聚焦行，其余行原样 ——
{
  const lrc =
    '[00:10.00]<00:10.00>Hello <00:10.30>world\n' +
    '[00:12.00]<00:12.00>A <00:12.20>B\n' +
    '[00:14.00]<00:14.00>C <00:14.30>D'
  const newWords = [
    { timeMs: 12000, text: 'A ' },
    { timeMs: 12040, text: 'B' },
    { timeMs: 12080, text: 'C' },
  ]
  const patched = patchLineIntoAlignedLrc(lrc, 1, newWords)
  const lines = patched.split('\n')
  assert.equal(lines[0], '[00:10.00]<00:10.00>Hello <00:10.30>world')
  assert.equal(lines[1], '[00:12.00]<00:12.00>A <00:12.04>B<00:12.08>C')
  assert.equal(lines[2], '[00:14.00]<00:14.00>C <00:14.30>D')
}

// —— patchLineIntoAlignedLrc：保留 failed 标记 ——
{
  const lrc = '[00:12.00]<00:12.00>A <00:12.20>B'
  const newWords = [
    { timeMs: 12000, text: 'A ', failed: true },
    { timeMs: 12040, text: 'B', failed: true },
  ]
  const patched = patchLineIntoAlignedLrc(lrc, 0, newWords)
  assert.equal(patched, '[00:12.00]<00:12.00|f>A <00:12.04|f>B')
}

// —— patchLineIntoAlignedLrc：空 words 不修改 ——
{
  const lrc = '[00:12.00]<00:12.00>A <00:12.20>B'
  assert.equal(patchLineIntoAlignedLrc(lrc, 0, []), lrc)
}

// —— buildLineFromUnits：单元 → 增强行 ——
{
  const units: AlignedUnit[] = [
    { text: 'Hello', phones: [], start: 10, end: 10.2 },
    { text: 'world', phones: [], start: 10.3, end: 10.6 },
  ]
  const line = buildLineFromUnits(units)
  assert.ok(line)
  assert.equal(line!.words!.length, 2)
  assert.equal(line!.words![0].text, 'Hello ')
  assert.equal(line!.words![0].timeMs, 10000)
  assert.equal(line!.words![1].timeMs, 10300)
}

// —— alignLineByLineTimes：行时间戳主导的单行对齐 ——
{
  const phonemes: HypSegment[] = [
    { symbol: 'IN', start: 9.8, end: 10 },
    { symbol: 'NEW', start: 10.2, end: 10.4 },
    { symbol: 'YORK', start: 10.5, end: 10.8 },
  ]
  const line = alignLineByLineTimes(phonemes, 'In New York', 10000, 13000)
  assert.ok(line)
  assert.equal(line!.words!.length, 3)
  assert.ok(line!.words!.every((w) => w.failed !== true))
}

// —— alignLineFree：不锁行区间的自由对齐 ——
{
  const phonemes: HypSegment[] = [
    { symbol: 'IN', start: 9.8, end: 10 },
    { symbol: 'NEW', start: 10.2, end: 10.4 },
    { symbol: 'YORK', start: 10.5, end: 10.8 },
  ]
  const line = alignLineFree(phonemes, 'In New York', 10.3)
  assert.ok(line)
  assert.equal(line!.words!.length, 3)
}

// —— alignLineWithoutParens：行级括号剔除 ——
{
  const phonemes: HypSegment[] = [
    { symbol: 'IN', start: 10, end: 10.2 },
    { symbol: 'NEW', start: 10.3, end: 10.5 },
    { symbol: 'YORK', start: 10.6, end: 10.9 },
  ]
  const { mainLine, adlibTexts } = alignLineWithoutParens(
    phonemes,
    'In New York (Ayy, aha)',
    9.5,
    11.5,
  )
  assert.deepEqual(adlibTexts, ['Ayy, aha'])
  assert.ok(mainLine)
  assert.ok(!mainLine!.text.includes('('))
}

// —— 行级追踪（时间连线图数据） ——

const refLineOf = (text: string) => buildLyricsSkeleton(text)[0]

// 1. 编辑距离回溯：识别多出的段被跳过（hyp 无归属词），漏识别的词走插值
{
  const segments: HypSegment[] = [
    { symbol: 'In', start: 10, end: 10.2 },
    { symbol: 'filler', start: 10.2, end: 10.5 }, // 识别多出的（歌词里没有）
    { symbol: 'New', start: 10.6, end: 10.8 },
    { symbol: 'York', start: 10.9, end: 11.2 },
  ]
  const refUnits = tokenizeLyricsLine('In New York').map((t) => ({ text: t, phones: [] as string[] }))
  const { refToHyp, hypCount } = alignTextBacktrace(segments, refUnits)
  assert.equal(hypCount, 4, '展开识别单元：In/filler/New/York')
  assert.ok(refToHyp[0] >= 0, 'In 匹配到识别块')
  assert.ok(refToHyp[1] >= 0, 'New 匹配到识别块')
  assert.ok(refToHyp[2] >= 0, 'York 匹配到识别块')
  // 被跳过的识别块（filler，展开下标 1）不归任何词
  const row = traceAlignRow(segments, refLineOf('In New York'), 10, 13)
  const filler = row.hypBlocks.find((h) => h.text === 'filler')
  assert.ok(filler, '被跳过的识别块仍在 hypBlocks 里')
  assert.equal(filler!.refIndex, -1, 'filler 未匹配到任何歌词词')
}

// 2. 无识别段：整行无匹配 → 均摊插值、全标红
{
  const row = traceAlignRow([], refLineOf('In New York'), 10, 13)
  assert.equal(row.words.length, 3)
  assert.ok(row.words.every((w) => w.interpFailed && w.finalFailed), '无匹配词整行标红')
  assert.ok(row.words.every((w) => Number.isNaN(w.recogStartSec)), '无识别证据')
}

// 2b. 发音锚点回归：上一句「来/爱」+ 后面英文 JUST/SAY 混进窗口，
// 只有真听到的「大」是锚点；5 字只对上 1 个 → 锚点钉死：
// 大保持识别时间不红，其余 4 字插值标红
{
  const segs: HypSegment[] = [
    { symbol: '爱', start: 108.04, end: 108.1 }, // 上一句「特别可爱」（在「大」之前）
    { symbol: '来', start: 110.92, end: 110.98 }, // 上一句「停不下来」（在「大」之前）
    { symbol: '大', start: 111.46, end: 111.52 }, // 这行真匹配
    { symbol: 'SAY', start: 118.4, end: 118.58 }, // 下一句英文
    { symbol: 'JUST', start: 123.26, end: 123.44 }, // 下一句英文
  ]
  const row = traceAlignRow(segs, refLineOf('大家来恋爱'), 111.5, 118.74)
  assert.equal(row.hypBlocks.find((h) => h.text === '大')?.refIndex, 0, '「大」应真匹配第 1 字')
  assert.equal(row.hypBlocks.find((h) => h.text === 'JUST')?.refIndex, -1, 'JUST 不是「来」，不应连上')
  assert.equal(row.hypBlocks.find((h) => h.text === 'SAY')?.refIndex, -1, 'SAY 不是「爱」，不应连上')
  const matched = row.words.filter((w) => Number.isFinite(w.recogStartSec)).length
  assert.equal(matched, 1, '只有「大」是真锚点')
  assert.equal(row.words.filter((w) => w.finalFailed).length, 4, '大不红，其余 4 字插值标红')
  assert.ok(
    Math.abs(row.words[0].interpStartSec - 111.46) < 0.05,
    '「大」保持识别时间不被整行均摊',
  )
  // 复制文本口径：JUST/SAY 不写「对上」；大对上不兜底，其余插值标红
  const chart = traceRowToChart(row, { startSec: 106.5, endSec: 123.74 })
  const dump = formatLineTraceDump({
    lineIndex: 21,
    lineText: '大家来恋爱',
    chart,
  })
  assert.ok(dump.includes('「JUST」  没对上这行'))
  assert.ok(dump.includes('「SAY」  没对上这行'))
  assert.ok(dump.includes('「大」  对上这行第 1 字「大」'))
  assert.ok(dump.includes('插值（没对上识别）'))
}

// 2c. 短行 2 字对上 1 个：仍插值，不清整行
{
  const segs: HypSegment[] = [{ symbol: '大', start: 10, end: 10.2 }]
  const row = traceAlignRow(segs, refLineOf('大家'), 10, 13)
  const matched = row.words.filter((w) => Number.isFinite(w.recogStartSec)).length
  assert.equal(matched, 1)
  assert.equal(row.words[0].interpFailed, false, '匹配词不标红')
  assert.equal(row.words[1].interpFailed, true, '未匹配词插值标红')
  assert.ok(!row.words.every((w) => w.finalFailed), '短行 2 对 1 不应整行失败')
}

// 3. 锚点钉死：不出现「放到这行时间」映射层，锚点保留识别时间
{
  // 识别挤在 9.6–10.6，行区间 10–13：锚点保持识别时间，无映射层
  const segs: HypSegment[] = [
    { symbol: 'In', start: 9.6, end: 9.8 },
    { symbol: 'New', start: 10.0, end: 10.2 },
    { symbol: 'York', start: 10.3, end: 10.6 },
  ]
  const chart = buildLineMappedTrace(segs, 'In New York', 10, 13, { startSec: 9.5, endSec: 13.5 })
  assert.ok(!chart.layers.some((l) => l.key === 'mapped'), '锚点钉死：不应出现行窗映射层')
  assert.equal(chart.layers.length, 1, '只显示识别域一层')
  assert.ok(Math.abs(chart.layers[0].words[0].startSec - 9.6) < 0.05, '锚点保留识别时间')
}

{
  // 识别正好铺满行区间（10–11.1）：映射恒等 → 无映射层
  const segs: HypSegment[] = [
    { symbol: 'In', start: 10, end: 10.2 },
    { symbol: 'New', start: 10.4, end: 10.7 },
    { symbol: 'York', start: 10.8, end: 11.1 },
  ]
  const chart = buildLineMappedTrace(segs, 'In New York', 10, 11.1, { startSec: 9.5, endSec: 11.5 })
  assert.ok(!chart.layers.some((l) => l.key === 'mapped'), '无实质位移时不画映射层')
}

// 3b. 位置锚点：乱码块按位置钉「恋」时间，内容仍标红，hypBlocks 带 positionRefIndex
{
  const segs: HypSegment[] = [
    { symbol: '大', start: 111.46, end: 111.5 },
    { symbol: '家', start: 111.64, end: 111.68 },
    { symbol: '来', start: 111.96, end: 112.0 },
    { symbol: '\ufffd', start: 112.28, end: 112.32 },
    { symbol: '爱', start: 112.6, end: 112.64 },
  ]
  const row = traceAlignRow(segs, refLineOf('大家来恋爱'), 111.5, 118.74)
  assert.ok(
    Math.abs(row.words[3].interpStartSec - 112.28) < 0.05,
    `「恋」钉乱码块识别时间而非插值拉长：${row.words[3].interpStartSec}`,
  )
  assert.equal(row.words[3].interpFailed, true, '位置锚点内容没对上 → 仍标红')
  assert.equal(row.words[3].finalFailed, true, '最终层保持红词')
  const unk = row.hypBlocks.find((b) => b.text === '\ufffd')
  assert.ok(unk, '乱码块应在 hypBlocks 中')
  assert.equal(unk!.refIndex, -1, '乱码块未真匹配歌词')
  assert.equal(unk!.positionRefIndex, 3, '乱码块位置对上第 4 字「恋」')
  assert.ok(
    Math.abs(row.words[0].interpStartSec - 111.46) < 0.05,
    '「大」仍保留识别时间',
  )
  const chart = buildLineMappedTrace(segs, '大家来恋爱', 111.5, 118.74, {
    startSec: 111.0,
    endSec: 119.24,
  })
  const dump = formatChartDump(chart)
  assert.ok(dump.includes('位置钉时间（内容未对上识别）'), '恋标注为位置钉时间')
  assert.ok(dump.includes('位置对上这行第 4 字'), '乱码块 dump 标注位置对上')
}

// 3c. 稀疏锚点不再整行均摊：Why/you/talki' 保持识别时间，垃圾前缀标红
{
  const segs: HypSegment[] = [
    { symbol: 'SAY', start: 58.4, end: 58.58 },
    { symbol: 'WHY', start: 58.58, end: 58.76 },
    { symbol: 'YOUE', start: 58.82, end: 59.12 },
    { symbol: 'TALKING', start: 59.12, end: 59.54 },
  ]
  const row = traceAlignRow(segs, refLineOf("孔： Why you talki' that mess huh"), 58.74, 60.29)
  assert.equal(row.words.length, 8, "孔/：/Why/you/talki'/that/mess/huh")
  assert.ok(Math.abs(row.words[2].interpStartSec - 58.58) < 0.05, 'Why 保持识别时间')
  assert.equal(row.words[2].interpFailed, false, 'Why 不标红')
  assert.ok(Math.abs(row.words[3].interpStartSec - 58.82) < 0.05, 'you 保持识别时间')
  assert.equal(row.words[3].interpFailed, false, 'you 不标红')
  assert.ok(Math.abs(row.words[4].interpStartSec - 59.12) < 0.05, "talki' 保持识别时间")
  assert.equal(row.words[4].interpFailed, false, "talki' 不标红")
  for (const idx of [0, 1, 5, 6, 7]) {
    assert.equal(row.words[idx].interpFailed, true, `词 ${idx} 应插值标红`)
  }
}

// 4. buildFocusTrace：当前结果与管线不一致时追加「当前结果」层
{
  const segs: HypSegment[] = [
    { symbol: 'In', start: 10, end: 10.2 },
    { symbol: 'New', start: 10.4, end: 10.7 },
    { symbol: 'York', start: 10.8, end: 11.1 },
  ]
  const current: LyricsWord[] = [
    { timeMs: 12000, text: 'In' },
    { timeMs: 13000, text: 'New' },
    { timeMs: 14000, text: 'York' },
  ]
  const chart = buildFocusTrace(segs, 'In New York', 10, 11.1, { startSec: 9.5, endSec: 11.5 }, current)
  const cur = chart.layers.find((l) => l.key === 'current')
  assert.ok(cur, '当前结果与管线不一致时应追加当前结果层')
  assert.equal(cur!.words[0].startSec, 12)
  assert.ok(cur!.moveFrom && cur!.moveFrom[0] === 0, '按文本匹配到原词')
}

// 5. 未被改过：不画当前结果层
{
  const segs: HypSegment[] = [
    { symbol: 'In', start: 10, end: 10.2 },
    { symbol: 'New', start: 10.4, end: 10.7 },
    { symbol: 'York', start: 10.8, end: 11.1 },
  ]
  const chart = buildFocusTrace(segs, 'In New York', 10, 11.1, { startSec: 9.5, endSec: 11.5 }, undefined)
  assert.ok(!chart.layers.some((l) => l.key === 'current'))
}

// 6. CTC / 摊开 的图结构
{
  const chart = buildCtcTrace([{ symbol: 'In', start: 10, end: 10.2 }], { startSec: 9.5, endSec: 11 }, [
    { text: 'In', startSec: 10.1, endSec: 10.3, refIndex: -1 },
  ])
  assert.equal(chart.layers.length, 1)
  assert.equal(chart.hypBlocks[0].refIndex, -1, 'CTC 的识别段仅作对照，不连线')
}

{
  const orig: LyricsWord[] = [
    { timeMs: 10000, text: 'In' },
    { timeMs: 10100, text: 'New' },
  ]
  const spread: LyricsWord[] = [
    { timeMs: 10500, text: 'In' },
    { timeMs: 11000, text: 'New' },
  ]
  const chart = buildSpreadTrace([], { startSec: 9.5, endSec: 12 }, orig, spread)
  assert.equal(chart.layers.length, 2)
  const s = chart.layers[1]
  assert.ok(s.moveFrom && s.moveFrom[0] === 0 && s.moveFrom[1] === 1, '摊开层按顺序连接原词')
}

// 7. traceRowToChart：无插值且无映射时只画一层词
{
  const segs: HypSegment[] = [
    { symbol: 'In', start: 10, end: 10.2 },
    { symbol: 'New', start: 10.4, end: 10.7 },
    { symbol: 'York', start: 10.8, end: 11.1 },
  ]
  const row = traceAlignRow(segs, refLineOf('In New York'), 10, 11.1)
  const chart = traceRowToChart(row, { startSec: 9.5, endSec: 11.5 })
  assert.equal(chart.layers.length, 1, '全匹配且无映射时仅一层词')
  assert.equal(chart.layers[0].words[0].refIndex, 0, '首词 refIndex 指向匹配的识别块')
}

// 8. 绘图布局：块 left 不含标签列；窗外时间会撑开横轴；同时刻芯片分轨道
{
  const atStart = layoutTraceItems(
    [{ key: 'a', text: '大', startSec: 10, endSec: 10.2 }],
    10,
    100,
    400,
  )
  assert.ok(atStart.blocks[0].left < 8, '窗口起点的块应贴着绘图区左边')
  assert.ok(atStart.blocks[0].left < TRACE_LABEL_W, '块坐标不含标签列宽度')
  assert.equal(atStart.laneCount, 1)

  const piled = layoutTraceItems(
    [
      { key: '1', text: '大', startSec: 10, endSec: 10.08 },
      { key: '2', text: '家', startSec: 10, endSec: 10.08 },
      { key: '3', text: '来', startSec: 10, endSec: 10.08 },
    ],
    10,
    100,
    400,
  )
  assert.ok(piled.laneCount >= 3, '同一时刻多个字应分到不同轨道，而不是叠在一起')
  assert.equal(new Set(piled.blocks.map((b) => b.lane)).size, piled.laneCount)

  const skipped = layoutTraceItems(
    [
      { key: 'ok', text: '大', startSec: 10, endSec: 10.2 },
      { key: 'bad', text: 'x', startSec: Number.NaN, endSec: 10.2 },
    ],
    10,
    100,
    400,
  )
  assert.equal(skipped.blocks.length, 1, '无有效时间的块不画')

  const view = computeTraceViewSec({
    windowSec: { startSec: 10, endSec: 11 },
    hypBlocks: [{ hypIndex: 0, text: 'x', startSec: 8, endSec: 8.5, refIndex: -1 }],
    layers: [
      {
        key: 'words',
        label: '词',
        words: [{ text: '大', startSec: 12, endSec: 12.3, refIndex: -1 }],
      },
    ],
  })
  assert.ok(view.startSec < 8.1, '识别段在切片窗外时横轴应向左扩展')
  assert.ok(view.endSec > 12.2, '词在切片窗外时横轴应向右扩展')
}

// 9. 复制文本：含行原文、没对上的识别、插值词
{
  const segs: HypSegment[] = [
    { symbol: '大', start: 10, end: 10.2 },
    { symbol: 'SAY', start: 12, end: 12.3 },
  ]
  const chart = buildLineMappedTrace(segs, '大家', 10, 13, { startSec: 9.5, endSec: 13.5 })
  const dump = formatLineTraceDump({
    lineIndex: 3,
    lineText: '大家',
    nextLineText: 'SAY YOU LOVE',
    diagnosis: '这行对齐正常，无异常标记',
    lineStartSec: 10,
    lineEndSec: 13,
    currentWords: [
      { timeMs: 10000, text: '大' },
      { timeMs: 11000, text: '家', failed: true },
    ],
    chart,
  })
  assert.ok(dump.includes('大家'))
  assert.ok(dump.includes('下一行  SAY YOU LOVE'))
  assert.ok(dump.includes('「SAY」  没对上这行'))
  assert.ok(dump.includes('插值（没对上识别）'))
  assert.ok(dump.includes('主界面当前词'))
}
