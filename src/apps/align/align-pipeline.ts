/**
 * Zipformer 识别段 → 增强 LRC 的纯函数流水线（供「歌词对齐」App 与音乐实验室共用）。
 *
 * 链路：识别出的 token 段（含时间戳） + 歌词原文 →
 *   stripLrcMarkup 清洗（剥离 LRC 时间戳/元数据，避免时间戳字符被逐字对齐）→
 *   buildLyricsSkeleton 切成逐字单元 → alignTextToUnits 编辑距离对齐 →
 *   interpolateUnits 插值兜底 → buildAlignLrc 生成增强 LRC。
 *
 * 纯函数，可 node --experimental-strip-types 单测；不依赖浏览器/Worker。
 */

import { stripLrcMarkup } from './pinyin-g2p.ts'
import { buildLyricsSkeleton, tokenizeLyricsLine } from './align-g2p.ts'
import {
  alignTextToUnits,
  expandHypSegments,
  normalizeForMatch,
  type HypSegment,
} from './align-text-dtw.ts'
import { interpolateUnits } from './align-dtw.ts'
import { estimateLineTimes } from './align-line-times.ts'
import { buildAlignLrc } from './align-lrc.ts'
import type { AlignedPhone, AlignedUnit, G2pLine } from './align-types.ts'

/**
 * 行时间戳软锚阈值（秒）：识别行首与 .lrc 行时间偏差在该值内才整行归位。
 * 偏差过大说明识别可能更准或歌词前有前奏，不动，避免把识别结果整体带歪。
 */
export const LINE_ANCHOR_THRESHOLD_SEC = 1.5

/**
 * 行级软锚：对每行若存在 .lrc 行时间戳且行内有真实匹配单元，取该行
 * 首个匹配单元 start 计算偏差；|偏差| <= 阈值时整行（含插值单元）
 * 统一平移。该行无任何匹配锚点时不锚（避免把插值垃圾整体搬动）。
 */
export function applyLineAnchors(
  alignedUnits: AlignedUnit[],
  refLines: G2pLine[],
  lineTimes: (number | undefined)[],
  known: { unitIndex: number; start: number; end: number }[],
): AlignedUnit[] {
  if (lineTimes.length === 0) return alignedUnits
  if (refLines.length === 0) return alignedUnits

  // 每行内首个真实匹配单元的扁平下标（known 来自 DTW 匹配，非插值）
  const knownSet = new Set(known.map((k) => k.unitIndex))
  const lineFirstMatch: (number | undefined)[] = []
  {
    let cursor = 0
    for (const line of refLines) {
      let first: number | undefined
      for (let k = 0; k < line.units.length; k++) {
        if (knownSet.has(cursor + k)) {
          first = cursor + k
          break
        }
      }
      lineFirstMatch.push(first)
      cursor += line.units.length
    }
  }

  // 每行平移量（秒）；无时间戳/无锚点/超阈值均为 0
  const offsets: number[] = []
  for (let i = 0; i < refLines.length; i++) {
    const t = lineTimes[i]
    const anchorFlat = lineFirstMatch[i]
    if (t === undefined || anchorFlat === undefined) {
      offsets.push(0)
      continue
    }
    const unit = alignedUnits[anchorFlat]
    if (unit === undefined || !Number.isFinite(unit.start)) {
      offsets.push(0)
      continue
    }
    const offset = t / 1000 - unit.start
    offsets.push(Math.abs(offset) <= LINE_ANCHOR_THRESHOLD_SEC ? offset : 0)
  }
  if (offsets.every((o) => o === 0)) return alignedUnits

  const out = alignedUnits.map((u) => ({ ...u }))
  let cursor = 0
  for (let i = 0; i < refLines.length; i++) {
    const off = offsets[i]
    if (off !== 0) {
      for (let k = 0; k < refLines[i].units.length; k++) {
        const flat = cursor + k
        const u = out[flat]
        if (u === undefined) continue
        u.start += off
        u.end += off
      }
    }
    cursor += refLines[i].units.length
  }
  return out
}

/** 行时间窗口半宽（秒）：识别段落在该行时间 ± 窗口内才参与行内对齐。
 * 须大于 LINE_SCALE_THRESHOLD_SEC，保证「偏差未超阈值」的识别段一定在窗口内。 */
const LINE_WINDOW_HALF_SEC = 5
/** 行内缩放阈值（秒）：行首匹配与 .lrc 行时间偏差在该值内才做行内线性映射 */
const LINE_SCALE_THRESHOLD_SEC = 4

/**
 * 行内时间映射：把行内所有单元从「识别时间域」映射到「.lrc 行时间域」。
 * 以行内首/末匹配词为锚，线性拉伸/压缩整个 [firstStart, lastEnd] → [t_i, t_{i+1}]；
 * 仅单个锚点或末行无 t_{i+1} 时退化为纯平移。
 * 返回新数组（行内单元顺序不变，start/end 更新）。
 */
function scaleLineToAnchor(
  rowUnits: AlignedUnit[],
  lineStartMs: number,
  lineEndMs: number | undefined,
  rowKnown: { unitIndex: number; start: number; end: number }[],
): AlignedUnit[] {
  const out = rowUnits.map((u) => ({ ...u }))
  if (rowKnown.length === 0) return out
  const first = rowKnown[0]
  const last = rowKnown[rowKnown.length - 1]
  const anchorStart = first.start
  const anchorEnd = last.end
  const tStart = lineStartMs / 1000
  const tEnd = lineEndMs !== undefined ? lineEndMs / 1000 : undefined

  // 行首偏差超阈值不锚（识别可能更准/数据版本不对）
  if (Math.abs(tStart - anchorStart) > LINE_SCALE_THRESHOLD_SEC) return out

  if (tEnd === undefined || anchorEnd - anchorStart <= 1e-6 || rowKnown.length === 1) {
    // 退化：纯平移
    const off = tStart - anchorStart
    for (const u of out) {
      u.start += off
      u.end += off
    }
    return out
  }

  // 线性映射 [anchorStart, anchorEnd] → [tStart, tEnd]
  const span = tEnd - tStart
  const srcSpan = anchorEnd - anchorStart
  for (const u of out) {
    u.start = tStart + ((u.start - anchorStart) / srcSpan) * span
    u.end = tStart + ((u.end - anchorStart) / srcSpan) * span
  }
  return out
}

/**
 * 按行隔离对齐：每行用 .lrc 行时间窗口裁剪识别段，行内独立 DTW，
 * 再把行内所有单元线性映射到 [本行时间, 下一行时间]。
 * 词不再跨行匹配；行内分布贴合 .lrc 行时间戳。
 */
export function alignSegmentsByLine(
  segments: HypSegment[],
  refLines: G2pLine[],
  lineTimes: (number | undefined)[],
): AlignedUnit[] {
  const estimated = estimateLineTimes(lineTimes)
  if (estimated.some((t) => t === undefined)) {
    // 仍有无时间戳行 → 无法主导，回退调用方处理
    return []
  }
  const times = estimated as number[]

  const allUnits: AlignedUnit[] = []
  for (let i = 0; i < refLines.length; i++) {
    const line = refLines[i]
    const tStart = times[i] / 1000
    // 末行无下一行时间：用上一行距估算行尾
    const tEndFinal =
      i + 1 < times.length
        ? times[i + 1] / 1000
        : i > 0
          ? tStart + (tStart - times[i - 1] / 1000)
          : tStart + 0.5

    // 窗口裁剪：该行时间 ± 0.8s 内的识别段
    const lo = tStart - LINE_WINDOW_HALF_SEC
    const hi = tEndFinal + LINE_WINDOW_HALF_SEC
    const windowSegs = segments.filter((s) => s.end >= lo && s.start <= hi)

    // 窗口内识别段的归一化文本集合：用于过滤 DTW 的「代价 1 假匹配」
    //（替换与跳过代价相同，DTW 会把无文本对应但时间近的段也算匹配）
    const windowNorm = new Set<string>()
    for (const s of windowSegs) {
      for (const t of tokenizeLyricsLine(s.symbol)) windowNorm.add(normalizeForMatch(t))
    }

    // 行内独立 DTW
    const spans = alignTextToUnits(windowSegs, line.units)
    const rowKnown: { unitIndex: number; start: number; end: number }[] = []
    spans.forEach((span, u) => {
      if (span.start >= 0 && windowNorm.has(normalizeForMatch(line.units[u].text))) {
        rowKnown.push({ unitIndex: u, start: span.start, end: span.end })
      }
    })

    // 行内单元初值：匹配词用识别时间，未匹配为 NaN
    const rowUnits: AlignedUnit[] = line.units.map((u, k) => {
      const kSpan = spans[k]
      return {
        text: u.text,
        phones: u.phones,
        start: kSpan && kSpan.start >= 0 ? kSpan.start : Number.NaN,
        end: kSpan && kSpan.end >= 0 ? kSpan.end : Number.NaN,
      }
    })

    const obsForRow = expandHypSegments(windowSegs).map((u) => ({
      symbol: u.text,
      start: u.start,
      end: u.end,
    }))

    let mappedRow: AlignedUnit[]
    if (rowKnown.length === 0) {
      // 无匹配词：行内均匀分摊到 [tStart, tEndFinal]
      const n = rowUnits.length
      const span = Math.max(0.05, tEndFinal - tStart)
      mappedRow = rowUnits.map((u, k) => ({
        ...u,
        start: tStart + (n === 1 ? 0 : (k / (n - 1)) * span),
        end: tStart + (n === 1 ? span : ((k + 1) / (n - 1)) * span),
      }))
    } else {
      // 先在识别域用 interpolateUnits 填 NaN（未匹配词），再整行线性映射到行时间域
      const filled = interpolateUnits(line.units, rowKnown, obsForRow)
      mappedRow = scaleLineToAnchor(
        filled,
        times[i],
        i + 1 < times.length ? times[i + 1] : tEndFinal * 1000,
        rowKnown,
      )
    }

    for (const u of mappedRow) allUnits.push(u)
  }
  return allUnits
}

/**
 * 把 zipformer/sense-voice 识别段对齐到歌词，产出增强 LRC 文本。
 * lineTimes 可选：与 refLines 一一对应的 .lrc 行时间戳（毫秒）。
 *   存在且非全空 → 按行隔离对齐（行时间戳主导）；
 *   否则 → 回退全局 DTW + 插值 + 平移软锚（纯文本歌词）。
 * 空歌词 / 无可对齐单元时返回空串。
 */
export function alignSegmentsToLrc(
  segments: HypSegment[],
  lyricsText: string,
  lineTimes?: (number | undefined)[],
): string {
  if (segments.length === 0) return ''
  const cleaned = stripLrcMarkup(lyricsText).trim()
  if (!cleaned) return ''
  const refLines = buildLyricsSkeleton(cleaned)
  const refUnits = refLines.flatMap((line) => line.units)
  if (refUnits.length === 0) return ''

  const hasLineTimes = lineTimes !== undefined && lineTimes.some((t) => t !== undefined)
  if (hasLineTimes) {
    const byLine = alignSegmentsByLine(segments, refLines, lineTimes)
    if (byLine.length > 0) return buildAlignLrc(byLine, refLines).trim()
  }

  const spans = alignTextToUnits(segments, refUnits)
  const known: { unitIndex: number; start: number; end: number }[] = []
  spans.forEach((span, u) => {
    if (span.start >= 0) known.push({ unitIndex: u, start: span.start, end: span.end })
  })

  const obs: AlignedPhone[] = expandHypSegments(segments).map((u) => ({
    symbol: u.text,
    start: u.start,
    end: u.end,
  }))

  const interpolated = interpolateUnits(refUnits, known, obs)
  const alignedUnits =
    hasLineTimes
      ? applyLineAnchors(interpolated, refLines, lineTimes as number[], known)
      : interpolated
  return buildAlignLrc(alignedUnits, refLines).trim()
}
