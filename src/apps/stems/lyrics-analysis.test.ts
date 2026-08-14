/**
 * 歌词分析纯函数单测（node --experimental-strip-types 直接跑）。
 * 验证：computeLineStats（红词/挤压/括号）、detectGaps（断层切片）、
 * alignWithoutParens（括号剔除）、sliceSegments（合并识别段）。
 */

import assert from 'node:assert/strict'
import { parseLrc } from '../music/music-lyrics.ts'
import type { HypSegment } from '../align/align-text-dtw.ts'
import {
  computeLineStats,
  detectGaps,
  resolveLineTimes,
  splitLineParens,
  alignWithoutParens,
  sliceSegments,
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
