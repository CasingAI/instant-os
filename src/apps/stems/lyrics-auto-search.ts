/**
 * 自动放慢重识别搜索（纯函数编排 + 注入回调，供 Debug 抽屉「自动放慢并重识别」使用）。
 *
 * 前提：放慢速率由 planStretchParams 对当前行窗口分析直接确定（唯一最优 rate，
 * 不参与重试），因此组合空间 = 2 算法 × 2 模型（最多 4 次识别）。按推荐算法排序、
 * 用户所选模型优先，串行执行：放慢 → 识别 → 时间戳映射回原轴 → 行内对齐 → 评分。
 * 评分 1（全部非标点词对上识别）立即停；否则全部组合试完后按匹配度选优，
 * 候选必须严格优于原行基线才采用（与 lyrics-line-rescue 的 pickBestLine 语义一致）。
 *
 * 模型调用通过注入回调实现，本模块保持纯函数可单测。
 */

import type { HypSegment } from '../align/align-text-dtw.ts'
import type { LyricsLine } from '../music/music-lyrics.ts'
import { pickBestLine, scoreLineUnits } from './lyrics-line-rescue.ts'
import type { AlignModel } from './lyrics-analysis.ts'
import type { StretchMethod, StretchPlan } from './lyrics-time-stretch.ts'

/** 一个待尝试组合：速率 × 算法 × 模型 */
export type AutoSearchCombo = {
  rate: number
  method: StretchMethod
  model: AlignModel
}

export type AutoSearchCallbacks = {
  /** 保调放慢：按组合速率/算法拉伸，返回 interleaved stereo PCM */
  stretch: (rate: number, method: StretchMethod) => Float32Array
  /** 识别：返回相对切片起点的识别段；null = 识别失败/无结果 */
  recognize: (audio: Float32Array, model: AlignModel) => Promise<HypSegment[] | null>
  /** 识别段（已偏移回全局时间轴）→ 行对齐结果 */
  alignBySegments: (segments: HypSegment[], lineText: string) => LyricsLine | null
}

/** 已尝试组合留痕：combo + 匹配度（识别/对齐失败为 -1） */
export type AutoSearchAttempt = {
  combo: AutoSearchCombo
  score: number
}

export type AutoSearchResult = {
  /** 采用的候选；null = 所有组合均未优于原行（保持原行） */
  best: LyricsLine | null
  bestScore?: number
  baselineScore?: number
  /** 采用候选的组合（source 标注模型用） */
  bestCombo?: AutoSearchCombo
  /** 采用候选的识别段（全局轴，追踪图展示用） */
  bestSegments?: HypSegment[]
  /** 已尝试的组合留痕（含失败项） */
  attempts: AutoSearchAttempt[]
  /** 实际尝试的组合数 */
  attempted: number
}

export type AutoSearchLineParams = {
  lineText: string
  plan: StretchPlan
  /** 用户所选模型：它排在两个模型组合的前面 */
  userModel: AlignModel
  /** 行窗口起点（全局秒），识别段据此偏移回全局时间轴 */
  offsetSec: number
  /** 原行：作为选优基线，候选不优于原行时保持原行 */
  currentLine?: LyricsLine | null
  callbacks: AutoSearchCallbacks
  /** 每个组合开始识别前回调（进度展示）；index 从 1 起 */
  onAttempt?: (index: number, total: number) => void
}

type StretchCandidate = {
  line: LyricsLine
  combo: AutoSearchCombo
  segments: HypSegment[]
  score?: number
}

/**
 * 自动搜索编排：按「推荐算法 × 用户模型优先」排序串行尝试组合，
 * score=1 提前停；否则 pickBestLine 选优（严格优于原行基线才采用）。
 */
export async function autoSearchLine(params: AutoSearchLineParams): Promise<AutoSearchResult> {
  const { lineText, plan, userModel, offsetSec, currentLine, callbacks, onAttempt } = params
  const models: AlignModel[] =
    userModel === 'zipformer' ? ['zipformer', 'sense-voice'] : ['sense-voice', 'zipformer']
  // rate=1 时算法维度冗余（不拉伸），只按模型区分；否则按 推荐算法×模型 排序
  const combos: AutoSearchCombo[] =
    plan.rate >= 1
      ? models.map((model) => ({ rate: plan.rate, method: plan.methods[0], model }))
      : plan.methods.flatMap((method) => models.map((model) => ({ rate: plan.rate, method, model })))

  const attempts: AutoSearchAttempt[] = []
  const candidates: StretchCandidate[] = []
  const baselineScore = currentLine ? scoreLineUnits(currentLine) : 0
  // 原行已满分（全部词对上识别）：无需再搜索
  if (baselineScore >= 1) return { best: null, baselineScore, attempts, attempted: 0 }

  for (const combo of combos) {
    onAttempt?.(attempts.length + 1, combos.length)
    const stretched = callbacks.stretch(combo.rate, combo.method)
    const segments = await callbacks.recognize(stretched, combo.model)
    if (!segments || segments.length === 0) {
      attempts.push({ combo, score: -1 })
      continue
    }
    // 放慢轴时间戳 → 原轴（× rate）→ 全局轴（+ 窗口起点）
    const shifted = segments.map((s) => ({
      ...s,
      start: s.start * combo.rate + offsetSec,
      end: s.end * combo.rate + offsetSec,
    }))
    const line = callbacks.alignBySegments(shifted, lineText)
    if (!line || !line.words || line.words.length === 0) {
      attempts.push({ combo, score: -1 })
      continue
    }
    const score = scoreLineUnits(line)
    attempts.push({ combo, score })
    if (score >= 1) {
      return {
        best: line,
        bestScore: 1,
        baselineScore,
        bestCombo: combo,
        bestSegments: shifted,
        attempts,
        attempted: attempts.length,
      }
    }
    candidates.push({ line, combo, segments: shifted, score })
  }

  const best = pickBestLine(candidates, baselineScore)
  return best
    ? {
        best: best.line,
        bestScore: best.score,
        baselineScore,
        bestCombo: best.combo,
        bestSegments: best.segments,
        attempts,
        attempted: attempts.length,
      }
    : { best: null, baselineScore, attempts, attempted: attempts.length }
}
