/**
 * 歌词分析（纯函数，可单测）：供「歌词分析抽屉」做行级诊断、问题检测与修复动作。
 *
 * 输入复用现有数据：karaokeLines（alignedLrc 解析）、phonemes（识别段）、
 * 原始歌词 / LRC、行时间戳。行级修复动作输出该行新的逐字时间戳，
 * 由抽屉预览后经 patchLineIntoAlignedLrc 写回主界面。
 */

import { parseLrc, type LyricsLine, type LyricsWord } from '../music/music-lyrics.ts'
import { mapLrcLineTimes, MIN_LINE_WORD_MS } from '../align/align-line-times.ts'
import { alignSegmentsToLrc } from '../align/align-pipeline.ts'
import { buildAlignLrc, formatLrcTimestamp } from '../align/align-lrc.ts'
import type { AlignedUnit } from '../align/align-types.ts'
import type { HypSegment } from '../align/align-text-dtw.ts'

/** 手动修复动作标识（与抽屉「修复动作」一一对应；定义在 analysis 避免 drawer 循环依赖） */
export type ManualActionKey =
  | 'spread'
  | 'line-times'
  | 'paren'
  | 'free'
  | 'rerun-line'
  | 'zip-rerun'
  | 'ctc-align'

/** 手动修复动作中文名（抽屉 ACTION_LABELS 的单一来源，drawer 引用此处） */
export const MANUAL_ACTION_LABELS: Record<ManualActionKey, string> = {
  spread: '摊开到行区间',
  'line-times': '按行时间戳重算',
  paren: '括号不参与',
  free: '不锁行窗口',
  'rerun-line': '重识别这一行',
  'zip-rerun': 'Zipformer 识别这一行',
  'ctc-align': 'Zipformer CTC 强制对齐',
}

/** 一行歌词对齐结果的方案来源（与 karaokeLines / lineSources 行一一对应） */
export type LineSource =
  | 'whole-recognize' // 整首识别 + 文本对齐
  | 'whole-ctc' // 整首 Zipformer CTC 强制对齐
  | 'rescue-recognize' // 失败行补救·方案1：Zipformer 识别行窗
  | 'rescue-ctc' // 失败行补救·方案2：Zipformer CTC 行窗
  | `manual-${ManualActionKey}` // 手动修复动作
  | 'restored' // 载入恢复（旧包无来源记录）

/** 校验任意值是否为合法 LineSource；非法返回 undefined（持久化解析用，兼容旧包） */
export function parseLineSource(raw: unknown): LineSource | undefined {
  if (typeof raw !== 'string') return undefined
  if (
    raw === 'whole-recognize' ||
    raw === 'whole-ctc' ||
    raw === 'rescue-recognize' ||
    raw === 'rescue-ctc' ||
    raw === 'restored'
  ) {
    return raw
  }
  if (raw.startsWith('manual-')) {
    const key = raw.slice('manual-'.length) as ManualActionKey
    if (key in MANUAL_ACTION_LABELS) return `manual-${key}`
  }
  return undefined
}

/** 方案来源中文标签（undefined = 无记录/未知，兜底显示） */
export function lineSourceLabel(src: LineSource | undefined): string {
  switch (src) {
    case 'whole-recognize':
      return '整首识别对齐'
    case 'whole-ctc':
      return '整首 CTC 强制对齐'
    case 'rescue-recognize':
      return '补救·方案1（识别行窗）'
    case 'rescue-ctc':
      return '补救·方案2（CTC 行窗）'
    case 'restored':
      return '载入恢复'
    case undefined:
      return '未知'
    default:
      if (src.startsWith('manual-')) {
        return `手动·${MANUAL_ACTION_LABELS[src.slice('manual-'.length) as ManualActionKey]}`
      }
      return src
  }
}

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

// —— 行级修复动作（抽屉「修这一行」） ——

/** 摊开时单个词的最小时长下限（秒） */
const MIN_WORD_SEC = 0.05

/** 一行歌词的真锚点统计（来自追踪图：真匹配到识别的字数） */
export type LineAnchors = {
  matched: number
  total: number
}

/**
 * 一句话诊断：聚焦行的问题描述。
 * anchors 由追踪图提供（真锚点比例）；没传时退回到只看主界面标记。
 */
export function describeLineIssue(st: LineStats, anchors?: LineAnchors): string {
  if (st.squeezed) {
    const span = st.spanSec !== undefined ? st.spanSec.toFixed(2) : '?'
    return `这行 ${st.wordCount} 个词被压进 ${span} 秒：识别断层期无锚点词被插值堆叠，词几乎同时出现`
  }
  if (st.failedCount > 0) {
    return `这行 ${st.wordCount} 词中 ${st.failedCount} 词无识别证据（红词），时间是插值兜底、不可靠`
  }
  if (st.hasParen) {
    return '含括号 ad-lib：括号词在模型词表外，通常无法对齐（结构性红词）'
  }
  if (anchors && anchors.total > 0) {
    if (anchors.matched < Math.ceil(anchors.total / 2)) {
      return anchors.matched === 0
        ? `这行 ${anchors.total} 词一个都没对上识别，时间是均摊兜底、不可靠`
        : `这行 ${anchors.total} 词只对上 ${anchors.matched} 个识别，其余是插值兜底、时间不可靠`
    }
    const red = anchors.total - anchors.matched
    if (red > 0) {
      return `这行 ${anchors.total} 词中 ${red} 词无识别证据（红词），时间是插值兜底、不可靠`
    }
  }
  return '这行对齐正常，无异常标记'
}

/**
 * 摊开到行区间：行内词均匀铺进 [startSec, endSec]，保留各词 failed 标记。
 * 对应副歌堆叠：不重新识别，先把词在时间轴上散开、立刻能听。
 * 摊开不产生识别证据，插值词维持红词，避免把没有声学支撑的时间洗白。
 */
export function spreadLineToWindow(
  line: LyricsLine,
  startSec: number,
  endSec: number,
): LyricsLine {
  const words = line.words
  if (!words || words.length === 0) return line
  const n = words.length
  const span = Math.max(MIN_WORD_SEC, endSec - startSec)
  const newWords = words.map((w, k) => {
    const t = startSec + (n === 1 ? span / 2 : (k / (n - 1)) * span)
    return { ...w, timeMs: Math.round(t * 1000) }
  })
  return { ...line, timeMs: Math.round(startSec * 1000), words: newWords }
}

/** 行音频切片窗口（秒）：聚焦行 [t_i-0.5s, t_{i+1}+0.5s]；末行用 fallbackSpanSec 兜底 */
export function lineWindowSec(
  lineTimes: (number | undefined)[],
  focusLine: number,
  fallbackSpanSec: number,
  padSec = 0.5,
): { startSec: number; endSec: number } {
  const t = lineTimes[focusLine]
  const next = lineTimes[focusLine + 1]
  const startSec = t !== undefined ? Math.max(0, t / 1000 - padSec) : 0
  const endSec =
    next !== undefined
      ? next / 1000 + padSec
      : startSec + Math.max(fallbackSpanSec, 0.8) + padSec
  return { startSec, endSec: Math.max(startSec + 0.2, endSec) }
}

/**
 * 行级括号剔除：把行内括号（ad-lib）剥掉，主词文本用窗口内识别段重新对齐。
 * 返回主词行（词数可能少于原文）与括号段文本。
 */
export function alignLineWithoutParens(
  phonemes: HypSegment[],
  lineText: string,
  startSec: number,
  endSec: number,
): { mainLine: LyricsLine | null; adlibTexts: string[] } {
  const split = splitLineParens(lineText)
  const adlibTexts = split.adlibs.map((a) => a.text)
  if (!split.mainText) return { mainLine: null, adlibTexts }
  const windowSegs = phonemes.filter((s) => s.end >= startSec && s.start <= endSec)
  const lrc = alignSegmentsToLrc(windowSegs, split.mainText)
  return { mainLine: lrc ? (parseLrc(lrc).lines[0] ?? null) : null, adlibTexts }
}

/** 按行时间戳重算这一行：窗口内识别段 + [lineStartMs, lineEndMs] 行区间做行内对齐 */
export function alignLineByLineTimes(
  phonemes: HypSegment[],
  lineText: string,
  lineStartMs: number,
  lineEndMs: number | undefined,
): LyricsLine | null {
  const lo = lineStartMs / 1000 - 5
  const hi = (lineEndMs ?? lineStartMs) / 1000 + 5
  const windowSegs = phonemes.filter((s) => s.end >= lo && s.start <= hi)
  const lrc = alignSegmentsToLrc(windowSegs, lineText, [
    lineStartMs,
    lineEndMs ?? lineStartMs + 1000,
  ])
  return lrc ? (parseLrc(lrc).lines[0] ?? null) : null
}

/** 不锁行区间：以 centerSec 为中心取邻近识别段自由 DTW 对齐（LRC 行时间不可靠时用） */
export function alignLineFree(
  phonemes: HypSegment[],
  lineText: string,
  centerSec: number,
  radiusSec = 8,
): LyricsLine | null {
  const windowSegs = phonemes.filter(
    (s) => s.end >= centerSec - radiusSec && s.start <= centerSec + radiusSec,
  )
  const lrc = alignSegmentsToLrc(windowSegs, lineText)
  return lrc ? (parseLrc(lrc).lines[0] ?? null) : null
}

/** 对齐单元 → 增强 LRC 单行 → LyricsLine（供 CTC 强制对齐结果使用） */
export function buildLineFromUnits(units: AlignedUnit[]): LyricsLine | null {
  if (units.length === 0) return null
  const lrc = buildAlignLrc(units)
  return lrc ? (parseLrc(lrc).lines[0] ?? null) : null
}

/**
 * 把聚焦行的逐字时间戳替换成 newWords，其余行原样保留，返回新增强 LRC。
 * 行号按 alignedLrc 的非空行计数（与 parseLrc 结果对齐）。
 */
export function patchLineIntoAlignedLrc(
  alignedLrc: string,
  focusLine: number,
  newWords: LyricsWord[],
): string {
  if (newWords.length === 0) return alignedLrc
  const rawLines = alignedLrc.split(/\r?\n/)
  const lineStartMs = newWords[0].timeMs
  const parts = newWords.map((w) => {
    const marker = w.failed ? '|f' : ''
    return `<${formatLrcTimestamp(w.timeMs / 1000)}${marker}>${w.text}`
  })
  const newLine = `[${formatLrcTimestamp(lineStartMs / 1000)}]${parts.join('')}`
  let contentIdx = 0
  let replaced = false
  for (let i = 0; i < rawLines.length; i++) {
    if (rawLines[i].trim().length === 0) continue
    if (contentIdx === focusLine) {
      rawLines[i] = newLine
      replaced = true
      break
    }
    contentIdx += 1
  }
  return replaced ? rawLines.join('\n') : alignedLrc
}
