/**
 * 歌词行级追踪（纯函数，可单测）：把「识别段 → 匹配 → 插值（锚点钉死）」的
 * 中间态组装成抽屉时间连线图（TraceChart）的数据。图不经过 LRC 字符串，
 * 与正式对齐共用同一批对齐步骤，避免两套逻辑分叉。
 */

import {
  alignTextBacktrace,
  collectPositionAnchors,
  expandHypSegments,
  normalizeForMatch,
  type HypSegment,
} from '../align/align-text-dtw.ts'
import { interpolateUnits, type KnownAnchor } from '../align/align-dtw.ts'
import { buildLyricsSkeleton } from '../align/align-g2p.ts'
import { formatLrcTimestamp } from '../align/align-lrc.ts'
import { traceAlignRow, type LineTraceRow, type TraceHypBlock } from '../align/align-pipeline.ts'
import type { AlignedPhone } from '../align/align-types.ts'
import type { LyricsWord } from '../music/music-lyrics.ts'

/** 图里的一个词块 */
export type TraceChartWord = {
  text: string
  startSec: number
  endSec: number
  failed?: boolean
  /** 插值兜底（无识别证据） */
  interpolated?: boolean
  /** 位置锚点钉的时间（内容未对上，仅按位置钉；undefined = 非位置锚点） */
  posAnchorSec?: number
  /** 对应识别块的 refIndex（仅首层词有；-1 = 无匹配识别块） */
  refIndex: number
}

/** 图里的一个词层 */
export type TraceChartLayer = {
  key: string
  label: string
  words: TraceChartWord[]
  /** 本层第 k 个词来自上一层 moveFrom[k] 个词（同序时为 [0..n-1]）；不画移动线则省略 */
  moveFrom?: number[]
}

/** 一张时间连线图 */
export type TraceChart = {
  windowSec: { startSec: number; endSec: number }
  hypBlocks: TraceHypBlock[]
  layers: TraceChartLayer[]
}

/** LyricsWord[] → 图词块（无 end 的用下一词或 +0.4s 兜底） */
export function wordsToTraceWords(words: LyricsWord[]): TraceChartWord[] {
  return words.map((w, i) => {
    const next = words[i + 1]
    const endSec = next ? next.timeMs / 1000 : w.timeMs / 1000 + 0.4
    return {
      text: w.text.trim(),
      startSec: w.timeMs / 1000,
      endSec,
      failed: w.failed,
      refIndex: -1,
    }
  })
}

/** LineTraceRow → 图：首层词 = 插值后（含插值标记与匹配 refIndex）；锚点钉死后无映射层 */
export function traceRowToChart(
  row: LineTraceRow,
  windowSec: { startSec: number; endSec: number },
): TraceChart {
  const layers: TraceChartLayer[] = [
    {
      key: 'words',
      label: '这行歌词',
      words: row.words.map((w, i) => ({
        text: w.text,
        startSec: w.interpStartSec,
        endSec: w.interpEndSec,
        failed: w.interpFailed,
        interpolated: w.interpFailed,
        posAnchorSec: w.posAnchorSec,
        refIndex: Number.isFinite(w.recogStartSec) ? i : -1,
      })),
    },
  ]
  if (row.hasMapping) {
    layers.push({
      key: 'mapped',
      label: '放到这行时间',
      words: row.words.map((w) => ({
        text: w.text,
        startSec: w.finalStartSec,
        endSec: w.finalEndSec,
        failed: w.finalFailed,
        refIndex: -1,
      })),
      moveFrom: row.words.map((_, i) => i),
    })
  }
  return { windowSec, hypBlocks: row.hypBlocks, layers }
}

/** 按文本为上层每个词找下层来源词下标（用于词序列不一致时的移动线） */
export function matchTextMove(
  prev: TraceChartWord[],
  cur: TraceChartWord[],
): number[] {
  const used = new Set<number>()
  return cur.map((w) => {
    for (let i = 0; i < prev.length; i++) {
      if (used.has(i)) continue
      if (normalizeForMatch(prev[i].text) === normalizeForMatch(w.text)) {
        used.add(i)
        return i
      }
    }
    return -1
  })
}

/** 无行时间戳路径的追踪（free / paren 动作）：全局 DTW + 插值，无行窗映射。 */
export function traceAlignGlobal(
  segments: HypSegment[],
  lineText: string,
): LineTraceRow {
  const refLine = buildLyricsSkeleton(lineText)[0]
  const { refToHyp } = alignTextBacktrace(segments, refLine.units)
  const hyp = expandHypSegments(segments)

  const recogStart = new Float64Array(refLine.units.length).fill(Number.NaN)
  const recogEnd = new Float64Array(refLine.units.length).fill(Number.NaN)
  const known: KnownAnchor[] = []
  for (let u = 0; u < refLine.units.length; u++) {
    const h = refToHyp[u]
    if (h >= 0 && h < hyp.length) {
      recogStart[u] = hyp[h].start
      recogEnd[u] = hyp[h].end
      known.push({ unitIndex: u, start: hyp[h].start, end: hyp[h].end })
    }
  }
  // 位置锚点：夹在真锚点间的未匹配识别块（如乱码 �）钉其识别时间但标红
  const posAnchors = collectPositionAnchors(refToHyp, hyp, refLine.units)
  known.push(...posAnchors)
  known.sort((a, b) => a.unitIndex - b.unitIndex)

  const hypToRef = new Map<number, number>()
  for (const k of known) {
    const h = refToHyp[k.unitIndex]
    if (h >= 0) hypToRef.set(h, k.unitIndex)
  }
  const hypToPosRef = new Map<number, number>()
  for (const pa of posAnchors) hypToPosRef.set(pa.hypIndex, pa.unitIndex)
  const hypBlocks: TraceHypBlock[] = hyp.map((b, i) => ({
    hypIndex: i,
    text: b.text,
    startSec: b.start,
    endSec: b.end,
    refIndex: hypToRef.get(i) ?? -1,
    positionRefIndex: hypToPosRef.get(i),
  }))

  const obs: AlignedPhone[] = hyp.map((u) => ({ symbol: u.text, start: u.start, end: u.end }))
  const interpUnits = interpolateUnits(refLine.units, known, obs)

  const posAnchorSec = new Array<number | undefined>(refLine.units.length).fill(undefined)
  for (const pa of posAnchors) posAnchorSec[pa.unitIndex] = pa.start

  const words: LineTraceRow['words'] = refLine.units.map((u, i) => ({
    text: u.text,
    recogStartSec: recogStart[i],
    recogEndSec: recogEnd[i],
    interpStartSec: interpUnits[i].start,
    interpEndSec: interpUnits[i].end,
    interpFailed: interpUnits[i].failed === true,
    posAnchorSec: posAnchorSec[i],
    finalStartSec: interpUnits[i].start,
    finalEndSec: interpUnits[i].end,
    finalFailed: interpUnits[i].failed === true,
  }))

  return { hypBlocks, words, hasMapping: false }
}

/** 聚焦行当前状态追踪：管线重跑（显示引擎当时怎么做）+ 当前结果层（若被修复动作改过）。 */
export function buildFocusTrace(
  phonemes: HypSegment[] | null,
  lineText: string,
  lineStartSec: number,
  lineEndSec: number,
  windowSec: { startSec: number; endSec: number },
  currentWords: LyricsWord[] | undefined,
): TraceChart {
  const refLine = buildLyricsSkeleton(lineText)[0]
  const row = traceAlignRow(phonemes ?? [], refLine, lineStartSec, lineEndSec)
  const chart = traceRowToChart(row, windowSec)

  if (currentWords && currentWords.length > 0) {
    const same =
      currentWords.length === row.words.length &&
      currentWords.every((w, i) => Math.abs(w.timeMs / 1000 - row.words[i].finalStartSec) < 0.02)
    if (!same) {
      const words = wordsToTraceWords(currentWords)
      const prev = chart.layers[chart.layers.length - 1]
      chart.layers.push({
        key: 'current',
        label: '改过之后',
        words,
        moveFrom: matchTextMove(prev.words, words),
      })
    }
  }
  return chart
}

/** 按行时间戳重算 / 重识别：窗口识别段 + 行区间走按行追踪（锚点钉死，无映射层）。 */
export function buildLineMappedTrace(
  segments: HypSegment[],
  lineText: string,
  lineStartSec: number,
  lineEndSec: number,
  windowSec: { startSec: number; endSec: number },
): TraceChart {
  const refLine = buildLyricsSkeleton(lineText)[0]
  const row = traceAlignRow(segments, refLine, lineStartSec, lineEndSec)
  return traceRowToChart(row, windowSec)
}

/** 无行时间戳动作（free / paren）：全局追踪，无行窗映射层。 */
export function buildGlobalTrace(
  segments: HypSegment[],
  lineText: string,
  windowSec: { startSec: number; endSec: number },
): TraceChart {
  const row = traceAlignGlobal(segments, lineText)
  return traceRowToChart(row, windowSec)
}

/** 窗口内识别段展开（对照层，不参与连线） */
export function windowHypBlocks(
  phonemes: HypSegment[],
  windowSec: { startSec: number; endSec: number },
): TraceHypBlock[] {
  const windowSegs = phonemes.filter(
    (s) => s.end >= windowSec.startSec && s.start <= windowSec.endSec,
  )
  const hyp = expandHypSegments(windowSegs)
  return hyp.map((b, i) => ({
    hypIndex: i,
    text: b.text,
    startSec: b.start,
    endSec: b.end,
    refIndex: -1,
  }))
}

/** CTC 强制对齐：识别段仅作对照，词层来自 CTC（无匹配连线）。 */
export function buildCtcTrace(
  phonemes: HypSegment[],
  windowSec: { startSec: number; endSec: number },
  ctcWords: TraceChartWord[],
): TraceChart {
  return {
    windowSec,
    hypBlocks: windowHypBlocks(phonemes, windowSec),
    layers: [{ key: 'ctc', label: '强制对齐结果', words: ctcWords }],
  }
}

/** 摊开：当前词 → 摊开后词（识别段仅作对照）。 */
export function buildSpreadTrace(
  phonemes: HypSegment[],
  windowSec: { startSec: number; endSec: number },
  originalWords: LyricsWord[],
  spreadWords: LyricsWord[],
): TraceChart {
  const original = wordsToTraceWords(originalWords)
  const spread = wordsToTraceWords(spreadWords)
  return {
    windowSec,
    hypBlocks: windowHypBlocks(phonemes, windowSec),
    layers: [
      { key: 'original', label: '改之前', words: original },
      { key: 'spread', label: '均匀铺开后', words: spread, moveFrom: matchTextMove(original, spread) },
    ],
  }
}

function stamp(sec: number): string {
  if (!Number.isFinite(sec)) return '--:--.--'
  return formatLrcTimestamp(sec)
}

function formatHypLine(h: TraceHypBlock, lyricWords: TraceChartWord[]): string {
  const span = `${stamp(h.startSec)}–${stamp(h.endSec)}`
  if (h.refIndex >= 0) {
    const w = lyricWords[h.refIndex]
    const who = w ? `对上这行第 ${h.refIndex + 1} 字「${w.text}」` : `对上歌词下标 ${h.refIndex}`
    return `  ${span}  「${h.text}」  ${who}`
  }
  if (h.positionRefIndex !== undefined && h.positionRefIndex >= 0) {
    const w = lyricWords[h.positionRefIndex]
    const who = w
      ? `位置对上这行第 ${h.positionRefIndex + 1} 字「${w.text}」（内容未对上）`
      : `位置对应歌词下标 ${h.positionRefIndex}`
    return `  ${span}  「${h.text}」  ${who}`
  }
  return `  ${span}  「${h.text}」  没对上这行`
}

function formatWordLine(w: TraceChartWord, i: number): string {
  const flags: string[] = []
  if (w.refIndex >= 0) {
    if (w.interpolated || w.failed) flags.push('对上识别但整行兜底')
    else flags.push('对上识别')
  } else if (w.posAnchorSec !== undefined) {
    flags.push('位置钉时间（内容未对上识别）')
  } else if (w.interpolated || w.failed) {
    flags.push('插值（没对上识别）')
  }
  const mark = flags.length > 0 ? `  ${flags.join('，')}` : ''
  return `  ${i + 1}. 「${w.text}」  ${stamp(w.startSec)}–${stamp(w.endSec)}${mark}`
}

export function formatChartDump(chart: TraceChart): string {
  const firstLyric = chart.layers[0]?.words ?? []
  const lines = [
    `图窗口 ${stamp(chart.windowSec.startSec)}–${stamp(chart.windowSec.endSec)}`,
    '',
    `模型听到的（${chart.hypBlocks.length} 块）`,
  ]
  if (chart.hypBlocks.length === 0) lines.push('  （没有识别段）')
  else for (const h of chart.hypBlocks) lines.push(formatHypLine(h, firstLyric))
  for (const layer of chart.layers) {
    lines.push('')
    lines.push(layer.label)
    if (layer.words.length === 0) lines.push('  （没有字）')
    else layer.words.forEach((w, i) => lines.push(formatWordLine(w, i)))
  }
  return lines.join('\n')
}

/** 把聚焦行的追踪图打成可粘贴文本（给排查用） */
export function formatLineTraceDump(info: {
  lineIndex: number
  lineText: string
  nextLineText?: string
  diagnosis?: string
  lineStartSec?: number
  lineEndSec?: number
  currentWords?: LyricsWord[]
  chart: TraceChart
  previewTitle?: string
  previewNote?: string
  previewChart?: TraceChart
}): string {
  const lines: string[] = ['歌词行追踪']
  const start = info.lineStartSec !== undefined ? stamp(info.lineStartSec) : '--:--.--'
  const end = info.lineEndSec !== undefined ? stamp(info.lineEndSec) : '--:--.--'
  lines.push(`行 #${info.lineIndex + 1}  [${start}]–[${end}]  ${info.lineText}`)
  if (info.nextLineText) lines.push(`下一行  ${info.nextLineText}`)
  if (info.diagnosis) lines.push(`诊断  ${info.diagnosis}`)
  if (info.currentWords && info.currentWords.length > 0) {
    lines.push('')
    lines.push('主界面当前词')
    info.currentWords.forEach((w, i) => {
      const flag = w.failed === true ? '  红词' : ''
      lines.push(`  ${i + 1}. 「${w.text.trim()}」  ${stamp(w.timeMs / 1000)}${flag}`)
    })
  }
  lines.push('')
  lines.push(formatChartDump(info.chart))
  if (info.previewChart) {
    lines.push('')
    lines.push(`修复预览${info.previewTitle ? `（${info.previewTitle}）` : ''}`)
    if (info.previewNote) lines.push(info.previewNote)
    lines.push(formatChartDump(info.previewChart))
  }
  return `${lines.join('\n')}\n`
}

/** 左侧层标签列宽度（绘图区从这里往右才是时间轴） */
export const TRACE_LABEL_W = 96
/** 时间轴最低每秒像素：再窄就横向滚动，避免字叠成一坨 */
export const TRACE_MIN_PX_PER_SEC = 48
const TRACE_CHIP_GAP = 3
const TRACE_MAX_CHIP_W = 72

export type TraceLayoutItem = {
  key: string
  text: string
  startSec: number
  endSec: number
  refIndex?: number
  /** 位置锚点归属的歌词单元下标（识别块专用；内容未对上仅钉时间） */
  positionRefIndex?: number
  interpolated?: boolean
  failed?: boolean
  /** 识别块是否对上了词 */
  matched?: boolean
}

export type TraceLaidOut = TraceLayoutItem & {
  /** 字块左缘（相对绘图区，不含标签列） */
  left: number
  width: number
  /** 时长条（按真实起止，可能比字块宽） */
  barLeft: number
  barWidth: number
  lane: number
  /** 连线用的时间中点 x（夹在绘图区内） */
  cx: number
}

function minChipW(text: string): number {
  return Math.min(TRACE_MAX_CHIP_W, Math.max(16, 10 + Array.from(text).length * 12))
}

/** 横轴要覆盖行切片窗口以及所有块的真实时间，避免块画在窗外被裁掉或堆在边缘。 */
export function computeTraceViewSec(chart: TraceChart): { startSec: number; endSec: number } {
  let lo = chart.windowSec.startSec
  let hi = chart.windowSec.endSec
  const add = (t: number) => {
    if (!Number.isFinite(t)) return
    if (t < lo) lo = t
    if (t > hi) hi = t
  }
  for (const h of chart.hypBlocks) {
    add(h.startSec)
    add(h.endSec)
  }
  for (const layer of chart.layers) {
    for (const w of layer.words) {
      add(w.startSec)
      add(w.endSec)
    }
  }
  if (!(hi > lo)) hi = lo + 0.2
  const pad = Math.max(0.04, (hi - lo) * 0.03)
  return { startSec: lo - pad, endSec: hi + pad }
}

/**
 * 把一层块排进绘图区：时长条跟真实起止走；字块按文本宽度收成可读芯片，
 * 起点对齐；芯片重叠时分到不同轨道，不再叠字。
 * left/cx 都相对绘图区（0 = 时间轴左缘），调用方画 SVG 时再加标签列宽度。
 */
export function layoutTraceItems(
  items: TraceLayoutItem[],
  viewStart: number,
  pxPerSec: number,
  plotW: number,
): { blocks: TraceLaidOut[]; laneCount: number } {
  const xOf = (t: number) => (t - viewStart) * pxPerSec
  const prepared: TraceLaidOut[] = []
  for (const it of items) {
    if (!Number.isFinite(it.startSec)) continue
    const end =
      Number.isFinite(it.endSec) && it.endSec > it.startSec ? it.endSec : it.startSec + 0.04
    const rawL = xOf(it.startSec)
    const rawR = xOf(end)
    if (rawR < -8 || rawL > plotW + 8) continue
    const barLeft = Math.max(0, rawL)
    const barRight = Math.min(plotW, Math.max(rawL + 2, rawR))
    const chipW = minChipW(it.text)
    let left = barLeft
    if (left + chipW > plotW) left = Math.max(0, plotW - chipW)
    const cx = Math.min(plotW, Math.max(0, (xOf(it.startSec) + xOf(end)) / 2))
    prepared.push({
      ...it,
      endSec: end,
      left,
      width: chipW,
      barLeft,
      barWidth: Math.max(2, barRight - barLeft),
      lane: 0,
      cx,
    })
  }
  prepared.sort((a, b) => a.startSec - b.startSec || a.left - b.left)
  const laneEnds: number[] = []
  for (const b of prepared) {
    let lane = 0
    while (lane < laneEnds.length && b.left < laneEnds[lane] + TRACE_CHIP_GAP) lane += 1
    b.lane = lane
    const endPx = b.left + b.width
    if (lane === laneEnds.length) laneEnds.push(endPx)
    else laneEnds[lane] = endPx
  }
  return { blocks: prepared, laneCount: Math.max(1, laneEnds.length) }
}
