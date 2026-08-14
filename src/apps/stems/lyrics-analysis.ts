/**
 * 歌词分析（纯函数，可单测）：供「歌词分析抽屉」做行级诊断、问题检测与方案对比。
 *
 * 输入复用现有数据：karaokeLines（alignedLrc 解析）、phonemes（识别段）、
 * 原始歌词 / LRC、行时间戳。输出全部是派生统计，不写回主流程。
 */

import { parseLrc, type LyricsLine } from '../music/music-lyrics.ts'
import { mapLrcLineTimes, MIN_LINE_WORD_MS } from '../align/align-line-times.ts'
import { alignSegmentsToLrc } from '../align/align-pipeline.ts'
import type { HypSegment } from '../align/align-text-dtw.ts'

/** 行级诊断：一行歌词的统计信息 */
export type LineStats = {
  lineIndex: number
  /** 行时间戳（秒）；无时间戳行为 undefined */
  timeSec: number | undefined
  /** 行原文 */
  text: string
  /** 词数（有逐字 words 用其长度，否则 0） */
  wordCount: number
  /** 红词数（words 中 failed 标记） */
  failedCount: number
  /** 行区间跨度（到下一行时间戳，秒）；末行用行内最后词或 +1s 兜底 */
  spanSec: number | undefined
  /** 是否挤压：词数 × MIN_LINE_WORD_MS 超过行区间 */
  squeezed: boolean
  /** 是否含括号（ad-lib / 背景和声） */
  hasParen: boolean
}

/** 断层切片：行区间内无任何识别段（音素）的连续段 */
export type GapSlice = {
  startSec: number
  endSec: number
  /** 命中的行下标 */
  lineIndexes: number[]
}

/**
 * 行级统计。squeezed 判定：行内词数 × 每词最少时长（MIN_LINE_WORD_MS）> 行区间，
 * 说明该行词被压进过窄窗口（识别断层期插值堆叠的典型形态）。
 */
export function computeLineStats(karaokeLines: LyricsLine[]): LineStats[] {
  const stats: LineStats[] = []
  for (let i = 0; i < karaokeLines.length; i++) {
    const line = karaokeLines[i]
    const timeSec = line.timeMs !== undefined ? line.timeMs / 1000 : undefined
    const words = line.words
    const wordCount = words && words.length > 0 ? words.length : 0
    const failedCount =
      words && words.length > 0 ? words.filter((w) => w.failed === true).length : 0

    // 行区间：到下一有 timeMs 的行；末行用行内最后词 end + 0.8s（与色带兜底一致）
    let spanSec: number | undefined
    if (timeSec !== undefined) {
      let next: number | undefined
      for (let k = i + 1; k < karaokeLines.length; k++) {
        if (karaokeLines[k].timeMs !== undefined) {
          next = (karaokeLines[k].timeMs as number) / 1000
          break
        }
      }
      if (next !== undefined) {
        spanSec = Math.max(0, next - timeSec)
      } else {
        const lastWordEnd = words && words.length > 0 ? words[words.length - 1].timeMs / 1000 : undefined
        spanSec = Math.max(1, (lastWordEnd ?? timeSec + 1) - timeSec + 0.8)
      }
    }

    const wordMs = wordCount * MIN_LINE_WORD_MS
    const squeezed = timeSec !== undefined && spanSec !== undefined && wordMs > spanSec * 1000

    stats.push({
      lineIndex: i,
      timeSec,
      text: line.text,
      wordCount,
      failedCount,
      spanSec,
      squeezed,
      hasParen: /[()（）]/.test(line.text),
    })
  }
  return stats
}

/**
 * 断层检测：行区间 [t_i, t_{i+1}) 内没有任何识别段（与区间重叠）且区间 > minGapSec → 断层。
 * 相邻断层行合并成连续切片（供局部重跑切片识别）。
 */
export function detectGaps(
  phonemes: HypSegment[],
  lineTimes: (number | undefined)[],
  minGapSec = 2,
): GapSlice[] {
  const slices: GapSlice[] = []
  let current: GapSlice | undefined
  for (let i = 0; i < lineTimes.length; i++) {
    const t = lineTimes[i]
    if (t === undefined) continue
    const startSec = t / 1000
    let endSec: number | undefined
    for (let k = i + 1; k < lineTimes.length; k++) {
      if (lineTimes[k] !== undefined) {
        endSec = (lineTimes[k] as number) / 1000
        break
      }
    }
    if (endSec === undefined) continue
    if (endSec - startSec <= minGapSec) continue

    const overlap = phonemes.some((s) => s.start <= endSec && s.end >= startSec)
    if (overlap) continue

    // 与当前切片相邻（startSec 贴着 current.endSec）则合并，否则开新切片
    if (current && startSec <= current.endSec + 0.001) {
      current.endSec = Math.max(current.endSec, endSec)
      current.lineIndexes.push(i)
    } else {
      current = { startSec, endSec, lineIndexes: [i] }
      slices.push(current)
    }
  }
  return slices
}

/** 方案 B：行时间戳主导重算。返回增强 LRC 解析后的行。 */
export function alignWithLineTimes(
  phonemes: HypSegment[],
  lyrics: string,
  lyricsLrc: string,
  /** 可选：直接提供行时间戳（毫秒），优先于从 lyricsLrc 重新映射 */
  lineTimesOverride?: (number | undefined)[],
): LyricsLine[] {
  const cleaned = lyrics.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const lineTimes =
    lineTimesOverride ?? (lyricsLrc ? mapLrcLineTimes(lyricsLrc, cleaned) : undefined)
  const lrc = alignSegmentsToLrc(phonemes, lyrics, lineTimes)
  if (!lrc) return []
  return parseLrc(lrc).lines
}

/**
 * 解析真实行时间戳（毫秒）：有 lyricsLrc 时用 mapLrcLineTimes（源 LRC 最可靠，
 * 全局对齐结果的 timeMs 可能被挤坏）；否则回退 karaokeLines 自带 timeMs。
 * 供断层检测与方案 D 使用。
 */
export function resolveLineTimes(
  lyrics: string,
  lyricsLrc: string | null,
  karaokeLines: LyricsLine[],
): (number | undefined)[] {
  if (lyricsLrc) {
    const cleaned = lyrics.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const mapped = mapLrcLineTimes(lyricsLrc, cleaned)
    if (mapped.some((t) => t !== undefined)) return mapped
  }
  return karaokeLines.map((l) => l.timeMs)
}

/** 一行歌词拆出的括号段（ad-lib）与主词文本 */
export type ParenSplit = {
  /** 去括号后的主词文本 */
  mainText: string
  /** 括号段：文本 + 相对位置（第几个括号） */
  adlibs: { text: string; index: number }[]
}

/**
 * 把一行歌词拆成主词与括号段（ad-lib）。
 * 括号内的内容不参与对齐（英文模型词表无括号字符，结构性必红）；
 * 这里把主词文本单独取出，括号段单独统计。
 */
export function splitLineParens(line: string): ParenSplit {
  const adlibs: { text: string; index: number }[] = []
  let mainText = ''
  let rest = line
  let index = 0
  // 逐个括号对提取：用正则匹配第一组括号，主词保留括号外文本
  const parenRe = /[()（）]/
  while (parenRe.test(rest)) {
    const open = rest.search(/[()（]/)
    const close = rest.search(/[)）]/)
    if (open < 0 || close <= open) {
      break
    }
    const before = rest.slice(0, open)
    const inside = rest.slice(open + 1, close)
    const after = rest.slice(close + 1)
    mainText += before
    const trimmed = inside.trim()
    if (trimmed) {
      adlibs.push({ text: trimmed, index })
    }
    index += 1
    rest = after
  }
  mainText += rest
  return { mainText: mainText.trim(), adlibs }
}

/** 方案 C：括号剔除对齐。返回主词对齐结果与括号段统计。 */
export function alignWithoutParens(
  phonemes: HypSegment[],
  lyrics: string,
): { lines: LyricsLine[]; adlibCount: number; adlibTexts: string[] } {
  const cleaned = lyrics.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const mainLines = cleaned.map((l) => splitLineParens(l).mainText).filter((t) => t.length > 0)
  const adlibTexts = cleaned.flatMap((l) => splitLineParens(l).adlibs.map((a) => a.text))
  const mainLyrics = mainLines.join('\n')
  const lrc = alignSegmentsToLrc(phonemes, mainLyrics)
  return {
    lines: lrc ? parseLrc(lrc).lines : [],
    adlibCount: adlibTexts.length,
    adlibTexts,
  }
}

/**
 * 合并新旧识别段：删除 [startSec, endSec) 内的旧段，插入新段，按 start 排序。
 * 用于局部重跑：断层段切片用 SenseVoice 重新识别后，替换该区间内的旧 phonemes。
 */
export function sliceSegments(
  phonemes: HypSegment[],
  startSec: number,
  endSec: number,
  newSegments: HypSegment[],
): HypSegment[] {
  const kept = phonemes.filter((s) => s.end <= startSec || s.start >= endSec)
  return [...kept, ...newSegments].sort((a, b) => a.start - b.start)
}

/** 汇总方案统计：红词数/比例 + 总词数（供方案卡片展示） */
export function summarizeLines(lines: LyricsLine[]): {
  totalWords: number
  failedWords: number
  failedRatio: number
} {
  let totalWords = 0
  let failedWords = 0
  for (const line of lines) {
    if (line.words && line.words.length > 0) {
      totalWords += line.words.length
      failedWords += line.words.filter((w) => w.failed === true).length
    }
  }
  return {
    totalWords,
    failedWords,
    failedRatio: totalWords > 0 ? failedWords / totalWords : 0,
  }
}
