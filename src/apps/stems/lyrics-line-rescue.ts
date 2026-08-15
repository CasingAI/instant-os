/**
 * 歌词行级备选引擎补救（纯函数 + 编排，供音乐实验室主流程使用）。
 *
 * 默认模型（SenseVoice）整首对齐后，某些行（如 Rap 段）效果差：红词多、
 * 词被挤压。对这些失败行切行窗口音频，依次尝试两个备选方案：
 *  - Zipformer recognize 该行窗口 → 行内对齐（「Zipformer 识别这一行」）
 *  - Zipformer CTC 强制对齐该行窗口（「Zipformer CTC 强制对齐」）
 * 按非标点词非红词比例评分，选最优替换原行。
 *
 * 模型调用通过注入回调实现，本模块保持纯函数可单测。
 */

import { isPunctuationOnly } from '../align/align-lrc.ts'
import type { HypSegment } from '../align/align-text-dtw.ts'
import type { AlignedUnit } from '../align/align-types.ts'
import type { ZipformerAlignUnit } from '../align/zipformer-worker.ts'
import type { LyricsLine } from '../music/music-lyrics.ts'
import { buildLineFromUnits, type LineStats } from './lyrics-analysis.ts'

/** 非标点词红词比例触发补救的阈值 */
export const RESCUE_RED_RATIO = 0.5

/**
 * 行匹配度评分：非标点词中非红词比例 [0, 1]。
 * 标点不参与统计（对齐时标点附前词，本身不是词）。
 */
export function scoreLineUnits(line: LyricsLine): number {
  const words = line.words ?? []
  const content = words.filter((w) => !isPunctuationOnly(w.text))
  if (content.length === 0) return 0
  return content.filter((w) => w.failed !== true).length / content.length
}

/**
 * 该行是否需要补救：词被挤压（识别断层期插值堆叠），
 * 或非标点词红词比例达到阈值（无识别证据的词过半）。
 */
export function shouldRescueLine(st: LineStats, line: LyricsLine): boolean {
  if (st.squeezed) return true
  const words = line.words ?? []
  const content = words.filter((w) => !isPunctuationOnly(w.text))
  if (content.length === 0) return false
  const redRatio = content.filter((w) => w.failed === true).length / content.length
  return redRatio >= RESCUE_RED_RATIO
}

/** 候选行中选匹配度最高者（同分取先出现的，即方案 1 优先）。 */
export function pickBestLine(candidates: LyricsLine[]): LyricsLine | null {
  let best: LyricsLine | null = null
  let bestScore = -1
  for (const candidate of candidates) {
    if (!candidate || !candidate.words || candidate.words.length === 0) continue
    const score = scoreLineUnits(candidate)
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return best
}

export type RescueLineCallbacks = {
  /** 方案 1：切行窗口识别。返回相对切片起点的识别段；null = 识别失败/无结果 */
  recognize: (slice: Float32Array) => Promise<{ segments: HypSegment[] } | null>
  /** 方案 2：切行窗口 CTC 强制对齐。返回相对切片起点的单元；null = 失败/无结果 */
  forcedAlign: (slice: Float32Array) => Promise<ZipformerAlignUnit[] | null>
  /** 识别段 → 行对齐（段已偏移回全局时间轴） */
  alignBySegments: (segments: HypSegment[], lineText: string) => LyricsLine | null
}

export type RescueLineParams = {
  lineText: string
  /** 行窗口音频切片（interleaved stereo PCM） */
  slice: Float32Array
  /** 行窗口起点（全局秒），识别段/单元据此偏移回全局时间轴 */
  startSec: number
  /** 是否可跑 CTC 强制对齐方案（该行有行时间戳） */
  hasLineTime: boolean
  callbacks: RescueLineCallbacks
}

/**
 * 单行补救编排：方案 1（识别）→ 方案 2（CTC 强制对齐），
 * 两方案结果按匹配度选优；全部失败返回 null（调用方保持原行）。
 */
export async function rescueLine(params: RescueLineParams): Promise<LyricsLine | null> {
  const { lineText, slice, startSec, hasLineTime, callbacks } = params
  const candidates: LyricsLine[] = []

  // 方案 1：识别该行窗口 → 段偏移回全局轴 → 行内对齐
  const recognized = await callbacks.recognize(slice)
  if (recognized && recognized.segments.length > 0) {
    const shifted = recognized.segments.map((s) => ({
      ...s,
      start: s.start + startSec,
      end: s.end + startSec,
    }))
    const line = callbacks.alignBySegments(shifted, lineText)
    if (line && line.words && line.words.length > 0) {
      // 非标点词全部对上识别：无需再试其他方案
      if (scoreLineUnits(line) >= 1) return line
      candidates.push(line)
    }
  }

  // 方案 2：CTC 强制对齐（需要行时间戳定位行窗）
  if (hasLineTime) {
    const units = await callbacks.forcedAlign(slice)
    if (units && units.length > 0) {
      const offsetUnits: AlignedUnit[] = units.map((u) => ({
        text: u.text,
        phones: [],
        start: u.start + startSec,
        end: u.end + startSec,
        failed: u.confident === false,
      }))
      const line = buildLineFromUnits(offsetUnits)
      if (line) candidates.push(line)
    }
  }

  return pickBestLine(candidates)
}
