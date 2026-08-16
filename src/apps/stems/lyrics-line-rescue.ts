/**
 * 歌词行级备选引擎补救（纯函数 + 编排，供音乐实验室主流程使用）。
 *
 * 默认模型（SenseVoice）整首对齐后，某些行（如 Rap 段）效果差：红词多、
 * 词被挤压。对这些失败行切行窗口音频，依次尝试备选方案：
 *  - Zipformer recognize 该行窗口 → 行内对齐（「Zipformer 识别这一行」）
 *  - 放慢自动搜索（可选注入）：保调放慢后 2 算法 × 2 模型组合重识别（主流程注入）
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
import { buildLineFromUnits, type AlignModel, type LineStats } from './lyrics-analysis.ts'

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

/** 补救采用方案：方案1 = Zipformer 识别行窗；方案2 = 放慢自动搜索；方案3 = Zipformer CTC 强制对齐 */
export type RescueSource = 'rescue-recognize' | 'rescue-slow' | 'rescue-ctc'

/** 选优候选最小结构：有行结果，可回填匹配度（pickBestLine 泛型约束） */
export type PickBestCandidate = {
  line: LyricsLine
  score?: number
}

/** 补救候选：一行结果 + 其产出方案（供选优后记录行来源） */
export type RescueCandidate = PickBestCandidate & {
  source: RescueSource
  /** 方案1/方案2（识别）产出的全局轴识别段：供追踪图展示候选的真实识别证据 */
  segments?: HypSegment[]
  /** 方案2（放慢搜索）采用的识别模型：source 标注模型后缀用 */
  model?: AlignModel
}

/**
 * 候选行中选匹配度最高者（同分取先出现的，即先执行的组合优先）。
 * baselineScore = 原行匹配度：候选必须严格优于原行才胜出，否则返回 null（保持原行）。
 * 避免「补救」把还不错的行换成全红候选（原实现 bestScore 初始 -1，任何有词候选都会被选中）。
 */
export function pickBestLine<T extends PickBestCandidate>(
  candidates: T[],
  baselineScore = 0,
): T | null {
  let best: T | null = null
  let bestScore = -1
  for (const candidate of candidates) {
    if (!candidate.line || !candidate.line.words || candidate.line.words.length === 0) continue
    const score = scoreLineUnits(candidate.line)
    // 顺手回填候选分：供调用方复盘留痕（未选中的候选也带分）
    candidate.score = score
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return best && bestScore > baselineScore ? best : null
}

export type RescueLineCallbacks = {
  /** 方案 1：切行窗口识别。返回相对切片起点的识别段；null = 识别失败/无结果 */
  recognize: (slice: Float32Array) => Promise<{ segments: HypSegment[] } | null>
  /** 方案 2：放慢自动搜索（可选；未注入则跳过）。返回全局轴识别段 + 采用模型 + 匹配度；null = 无候选 */
  autoStretchSearch?: (slice: Float32Array) => Promise<{
    line: LyricsLine
    segments: HypSegment[]
    model: AlignModel
    score: number
  } | null>
  /** 方案 3：切行窗口 CTC 强制对齐。返回相对切片起点的单元；null = 失败/无结果 */
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
  /** 原行（当前对齐结果）：作为选优基线，候选不优于原行时保持原行 */
  currentLine?: LyricsLine | null
  callbacks: RescueLineCallbacks
}

/** 单行补救结果：采用的歌词行 + 产出该行的方案；全失败时 line 为 null。 */
export type RescueLineResult = {
  line: LyricsLine | null
  source: RescueSource | null
  /** 采用方案的识别段（方案1/2 全局轴；方案3/失败为 undefined），供追踪图展示 */
  segments?: HypSegment[]
  /** 方案2（放慢搜索）采用的识别模型：source 标注模型后缀用 */
  model?: AlignModel
  /** 采用候选的匹配度（0-1）；未采用为 undefined */
  score?: number
  /** 原行基线匹配度（选优基准；候选必须严格优于它才替换） */
  baselineScore?: number
}

/**
 * 单行补救编排：方案 1（识别）→ 方案 2（放慢自动搜索，可选）→ 方案 3（CTC 强制对齐），
 * 各方案结果按匹配度选优；全部失败返回 { line: null, source: null }（调用方保持原行）。
 */
export async function rescueLine(params: RescueLineParams): Promise<RescueLineResult> {
  const { lineText, slice, startSec, hasLineTime, currentLine, callbacks } = params
  const candidates: RescueCandidate[] = []
  // 原行匹配度作为选优基线：候选必须严格优于原行，否则保持原行（避免越救越差）
  const baselineScore = currentLine ? scoreLineUnits(currentLine) : 0
  if (baselineScore >= 1) return { line: null, source: null }

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
      if (scoreLineUnits(line) >= 1) {
        return {
          line,
          source: 'rescue-recognize',
          segments: shifted,
          score: 1,
          baselineScore,
        }
      }
      candidates.push({ line, source: 'rescue-recognize', segments: shifted })
    }
  }

  // 方案 2：放慢自动搜索（可选注入；主流程注入、手动路径缺省）。返回段已是全局轴。
  if (callbacks.autoStretchSearch) {
    const stretched = await callbacks.autoStretchSearch(slice)
    if (stretched && stretched.line && stretched.line.words && stretched.line.words.length > 0) {
      if (stretched.score >= 1) {
        return {
          line: stretched.line,
          source: 'rescue-slow',
          segments: stretched.segments,
          model: stretched.model,
          score: 1,
          baselineScore,
        }
      }
      candidates.push({
        line: stretched.line,
        source: 'rescue-slow',
        segments: stretched.segments,
        model: stretched.model,
      })
    }
  }

  // 方案 3：CTC 强制对齐（需要行时间戳定位行窗）
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
      if (line) candidates.push({ line, source: 'rescue-ctc' })
    }
  }

  const best = pickBestLine(candidates, baselineScore)
  return best
    ? {
        line: best.line,
        source: best.source,
        segments: best.segments,
        model: best.model,
        score: best.score,
        baselineScore,
      }
    : { line: null, source: null, baselineScore }
}
