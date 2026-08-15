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
import { buildLyricsSkeleton } from './align-g2p.ts'
import {
  alignTextBacktrace,
  alignTextToUnits,
  anchorSpanForUnit,
  buildHypToRef,
  collectFallbackAnchors,
  collectPositionAnchors,
  expandHypSegments,
  type HypSegment,
} from './align-text-dtw.ts'
import { interpolateUnits, type KnownAnchor } from './align-dtw.ts'
import { estimateLineTimes, expandStarvedLineTimes, MIN_LINE_WORD_MS } from './align-line-times.ts'
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

/** 行时间窗口半宽（秒）：识别段落在该行时间 ± 窗口内才参与行内对齐。 */
const LINE_WINDOW_HALF_SEC = 5

/**
 * 按行隔离对齐：每行用 .lrc 行时间窗口裁剪识别段，行内独立 DTW，
 * 锚点（对上的词）保持识别时间，未匹配词在锚点间插值填空。
 * 词不再跨行匹配；对上的词不再被行时间戳拉走。
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
  const estimatedTimes = estimated as number[]
  const lastSegEndMs =
    segments.length > 0 ? segments[segments.length - 1].end * 1000 : estimatedTimes[estimatedTimes.length - 1]
  const lastLineWords = Math.max(1, refLines[refLines.length - 1]?.units.length ?? 1)
  const fallbackEndMs = Math.max(
    estimatedTimes[estimatedTimes.length - 1] + lastLineWords * MIN_LINE_WORD_MS,
    lastSegEndMs,
  )
  const times = expandStarvedLineTimes(
    estimatedTimes,
    refLines.map((line) => line.units.length),
    fallbackEndMs,
  )

  // 声学行尾：每行区间内（识别段起点落入 [times[i], times[i+1])）音素段的实际演唱末尾。
  // 劣质 .lrc 行时间被压扁时，用它把行尾扩展到音素时间戳所示的演唱结束处，
  // 让「有人唱但行时间戳没给时长」的区间被歌词词覆盖。
  const voicedEnds = new Array<number>(times.length).fill(-Infinity)
  for (const s of segments) {
    const startMs = s.start * 1000
    let lo = 0
    let hi = times.length - 1
    let idx = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (times[mid] <= startMs) {
        idx = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    if (idx >= 0) voicedEnds[idx] = Math.max(voicedEnds[idx], s.end)
  }

  const allUnits: AlignedUnit[] = []
  for (let i = 0; i < refLines.length; i++) {
    const line = refLines[i]
    const tStart = times[i] / 1000
    // 行尾：正常取下一行时间（末行用 fallback），取较大者覆盖到声学演唱末尾
    const tEndFinal = Math.max(
      i + 1 < times.length
        ? times[i + 1] / 1000
        : Math.max(
            fallbackEndMs / 1000,
            i > 0 ? tStart + (tStart - times[i - 1] / 1000) : tStart + 0.5,
          ),
      Number.isFinite(voicedEnds[i]) && voicedEnds[i] > tStart ? voicedEnds[i] : -Infinity,
    )

    // 窗口裁剪：该行时间 ± 5s 内的识别段
    const lo = tStart - LINE_WINDOW_HALF_SEC
    const hi = tEndFinal + LINE_WINDOW_HALF_SEC
    const windowSegs = segments.filter((s) => s.end >= lo && s.start <= hi)

    // 行内独立 DTW：只有「听起来像同一个词」且时间贴近本行的识别段才拿得到时间戳，
    // 对不上的（含跨行中文、后面英文）代价高于跳过 → 在代价层直接跳过，不留假锚点
    const { refToHyp, mergedSecond } = alignTextBacktrace(windowSegs, line.units, {
      startSec: tStart,
      endSec: tEndFinal,
    })
    const hyp = expandHypSegments(windowSegs)
    const rowKnown: KnownAnchor[] = []
    for (let u = 0; u < line.units.length; u++) {
      const span = anchorSpanForUnit(u, refToHyp, hyp, line.units, mergedSecond)
      if (span) {
        rowKnown.push({ unitIndex: u, start: span.start, end: span.end })
      }
    }
    // 位置锚点：夹在真锚点间的未匹配识别块（如乱码 �）钉其识别时间但标红——
    // 「没对上歌词」不等于「没有声学证据」，那块声学证据应归属该位置
    rowKnown.push(...collectPositionAnchors(refToHyp, hyp, line.units, mergedSecond))
    rowKnown.sort((a, b) => a.unitIndex - b.unitIndex)

    // 行内单元初值：匹配词用识别时间，未匹配为 NaN
    const rowUnits: AlignedUnit[] = line.units.map((u, k) => {
      const span = anchorSpanForUnit(k, refToHyp, hyp, line.units, mergedSecond)
      return {
        text: u.text,
        phones: u.phones,
        start: span ? span.start : Number.NaN,
        end: span ? span.end : Number.NaN,
      }
    })

    const obsForRow = hyp.map((u) => ({
      symbol: u.text,
      start: u.start,
      end: u.end,
    }))

    let mappedRow: AlignedUnit[]
    // 完全没有声学证据才整行均摊并标红；只要行内有 ≥1 个锚点（含位置锚点），
    // 一律锚点钉死：interpolateUnits 保持锚点识别时间、未匹配词在锚点间插值
    if (rowKnown.length === 0) {
      // 无真锚点但行区间内有识别段（如 pot→BOK、where we→WERL 内容没对上）：
      // 声学证据仍应归属该行，按位置兜底钉时间并标红——比行时间均摊更贴真实演唱
      const fallback = collectFallbackAnchors(hyp, line.units, {
        startSec: tStart,
        endSec: tEndFinal,
      })
      if (fallback.length > 0) {
        mappedRow = interpolateUnits(line.units, fallback, obsForRow, {
          leftSec: tStart,
          rightSec: tEndFinal,
        })
      } else {
        // 行内均匀分摊到 [tStart, tEndFinal]（整行声学证据不足 → 全部标红）
        const n = rowUnits.length
        const span = Math.max(0.05, tEndFinal - tStart)
        mappedRow = rowUnits.map((u, k) => ({
          ...u,
          failed: true,
          start: tStart + (n === 1 ? 0 : (k / (n - 1)) * span),
          end: tStart + (n === 1 ? span : ((k + 1) / (n - 1)) * span),
        }))
      }
    } else {
      // 锚点钉死：行首/行尾未匹配词铺到行区间边界，锚点保持识别时间，
      // 不做行窗映射，避免把对上的词从演唱处拉走
      mappedRow = interpolateUnits(line.units, rowKnown, obsForRow, {
        leftSec: tStart,
        rightSec: tEndFinal,
      })
    }

    for (const u of mappedRow) allUnits.push(u)
  }
  return allUnits
}

/** 识别块追踪：字级展开的识别块（含归属歌词单元） */
export type TraceHypBlock = {
  /** 展开后下标（在 expandHypSegments 结果中） */
  hypIndex: number
  text: string
  startSec: number
  endSec: number
  /** 匹配到的歌词单元下标（-1 = 未匹配到任何词） */
  refIndex: number
  /** 位置锚点归属的歌词单元下标（内容未对上，仅按位置钉时间；undefined = 无） */
  positionRefIndex?: number
}

/** 歌词单元追踪：识别域 → 插值（锚点钉死，未匹配词在锚点间铺开） */
export type TraceUnitWord = {
  text: string
  /** 识别域时间（匹配到真实识别段）；未匹配为 NaN */
  recogStartSec: number
  recogEndSec: number
  /** 插值后时间（未匹配词从左右锚点线性填）；known 词与识别域一致 */
  interpStartSec: number
  interpEndSec: number
  /** 该词是否为插值兜底（无识别证据） */
  interpFailed: boolean
  /** 位置锚点钉的时间（未匹配识别块按位置钉，内容仍标红；undefined = 非位置锚点） */
  posAnchorSec?: number
  /** 最终时间（= 插值结果，锚点保持识别时间） */
  finalStartSec: number
  finalEndSec: number
  /** 最终失败标记（红词） */
  finalFailed: boolean
}

/** 一行歌词的对齐追踪：与 alignSegmentsByLine 同一套步骤，但保留中间态 */
export type LineTraceRow = {
  hypBlocks: TraceHypBlock[]
  words: TraceUnitWord[]
  /** 是否做过行窗映射（锚点钉死后恒为 false，仅保留字段供追踪层判断） */
  hasMapping: boolean
}

/**
 * 行级对齐追踪：窗口裁剪 → 假匹配剔除 → 编辑距离回溯 → 插值（锚点钉死），
 * 每一步都留下中间态，供「修这一行」抽屉画时间连线图。
 * 与 alignSegmentsByLine 的单行步骤完全一致（同一批私有工具函数），
 * 只额外输出追踪数据，不改动正式对齐结果。
 */
export function traceAlignRow(
  segments: HypSegment[],
  refLine: G2pLine,
  tStart: number,
  tEndFinal: number,
): LineTraceRow {
  const lo = tStart - LINE_WINDOW_HALF_SEC
  const hi = tEndFinal + LINE_WINDOW_HALF_SEC
  const windowSegs = segments.filter((s) => s.end >= lo && s.start <= hi)

  // 编辑距离回溯：只有「听起来像同一个词」且时间贴近本行的识别段才匹配（假匹配在代价层被跳过）
  const { refToHyp, mergedSecond } = alignTextBacktrace(windowSegs, refLine.units, {
    startSec: tStart,
    endSec: tEndFinal,
  })
  const hyp = expandHypSegments(windowSegs)

  const recogStart = new Float64Array(refLine.units.length).fill(Number.NaN)
  const recogEnd = new Float64Array(refLine.units.length).fill(Number.NaN)
  const known: KnownAnchor[] = []
  for (let u = 0; u < refLine.units.length; u++) {
    const span = anchorSpanForUnit(u, refToHyp, hyp, refLine.units, mergedSecond)
    if (span) {
      recogStart[u] = span.start
      recogEnd[u] = span.end
      known.push({ unitIndex: u, start: span.start, end: span.end })
    }
  }
  // 位置锚点：夹在真锚点间的未匹配识别块（如乱码 �）钉其识别时间但标红
  const posAnchors = collectPositionAnchors(refToHyp, hyp, refLine.units, mergedSecond)
  known.push(...posAnchors)
  known.sort((a, b) => a.unitIndex - b.unitIndex)

  // 识别块 → 归属歌词单元（真锚点 refIndex；合并块内两段同属一个 ref；位置锚点 positionRefIndex）
  const hypToRef = buildHypToRef(refToHyp, hyp.length, mergedSecond)
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

  const obsForRow: AlignedPhone[] = hyp.map((u) => ({ symbol: u.text, start: u.start, end: u.end }))

  let interpUnits: AlignedUnit[]
  // 完全没有声学证据才整行均摊并标红；只要行内有 ≥1 个锚点（含位置锚点），
  // 一律锚点钉死：interpolateUnits 保持锚点识别时间、未匹配词在锚点间插值
  if (known.length === 0) {
    // 无真锚点但行区间内有识别段：按位置兜底钉时间并标红（与 alignSegmentsByLine 同步骤）
    const fallback = collectFallbackAnchors(hyp, refLine.units, {
      startSec: tStart,
      endSec: tEndFinal,
    })
    if (fallback.length > 0) {
      interpUnits = interpolateUnits(refLine.units, fallback, obsForRow, {
        leftSec: tStart,
        rightSec: tEndFinal,
      })
    } else {
      const n = refLine.units.length
      const span = Math.max(0.05, tEndFinal - tStart)
      interpUnits = refLine.units.map((u, k) => ({
        text: u.text,
        phones: u.phones,
        failed: true,
        start: tStart + (n === 1 ? 0 : (k / (n - 1)) * span),
        end: tStart + (n === 1 ? span : ((k + 1) / (n - 1)) * span),
      }))
    }
  } else {
    // 锚点钉死：行首/行尾未匹配词铺到行区间边界，锚点保持识别时间
    interpUnits = interpolateUnits(refLine.units, known, obsForRow, {
      leftSec: tStart,
      rightSec: tEndFinal,
    })
  }

  // 锚点钉死：不做行窗映射，最终时间 = 识别域插值结果（锚点保持识别时间）
  const finalUnits: AlignedUnit[] = interpUnits

  const posAnchorSec = new Array<number | undefined>(refLine.units.length).fill(undefined)
  for (const pa of posAnchors) posAnchorSec[pa.unitIndex] = pa.start

  const words: TraceUnitWord[] = refLine.units.map((u, i) => ({
    text: u.text,
    recogStartSec: recogStart[i],
    recogEndSec: recogEnd[i],
    interpStartSec: interpUnits[i].start,
    interpEndSec: interpUnits[i].end,
    interpFailed: interpUnits[i].failed === true,
    posAnchorSec: posAnchorSec[i],
    finalStartSec: finalUnits[i].start,
    finalEndSec: finalUnits[i].end,
    finalFailed: finalUnits[i].failed === true,
  }))

  return { hypBlocks, words, hasMapping: false }
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
