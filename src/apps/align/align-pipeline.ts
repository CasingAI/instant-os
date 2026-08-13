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
import { alignTextToUnits, expandHypSegments, type HypSegment } from './align-text-dtw.ts'
import { interpolateUnits } from './align-dtw.ts'
import { buildAlignLrc } from './align-lrc.ts'
import type { AlignedPhone } from './align-types.ts'

/**
 * 把 zipformer 识别段对齐到歌词，产出增强 LRC 文本。
 * 空歌词 / 无可对齐单元时返回空串。
 */
export function alignSegmentsToLrc(segments: HypSegment[], lyricsText: string): string {
  if (segments.length === 0) return ''
  const cleaned = stripLrcMarkup(lyricsText).trim()
  if (!cleaned) return ''
  const refLines = buildLyricsSkeleton(cleaned)
  const refUnits = refLines.flatMap((line) => line.units)
  if (refUnits.length === 0) return ''

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

  const alignedUnits = interpolateUnits(refUnits, known, obs)
  return buildAlignLrc(alignedUnits, refLines).trim()
}
