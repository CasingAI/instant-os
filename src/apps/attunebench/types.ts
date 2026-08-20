/** AttuneBench 数据类型与解析（移植自官方 attunebench/schemas.py 的 pydantic 模型） */

import {
  clampFourBranchScore,
  clampPanasTotal,
  normalizeBinaryValue,
  normalizeMoodIntensity,
  normalizePairwiseWinner,
} from './utils.ts'
import { FOUR_BRANCHES, PANAS_ITEMS, PANAS_NEGATIVE, PANAS_POSITIVE } from './constants.ts'

// ---------------------------------------------------------------------------
// 输入数据模型（ground-truth 对话文件）
// ---------------------------------------------------------------------------

export type MoodShiftTag = {
  emotion: string
  intensity: number | null
}

export type BinaryJudgement = {
  questionId: string
  llmValue: 'yes' | 'no' | 'na' | null
  observedBehavior: 'yes' | 'no' | 'na' | null
  preferredBehavior: 'yes' | 'no' | 'na' | null
}

export type AlternateResponses = {
  llmImproved: string
  humanEdited: string
}

export type PairwiseComparison = {
  questionId: string
  responseA: string
  responseB: string
  winner: 'A' | 'B' | null
}

export type TurnAnnotations = {
  binaryJudgements: BinaryJudgement[]
  alternateResponses: AlternateResponses | null
  pairwiseComparisons: PairwiseComparison[]
  selectedPairwiseQuestions: string[]
}

export type Turn = {
  turnNumber: number
  userMessage: string
  llmResponse: string
  moodShiftTags: MoodShiftTag[]
  annotations: TurnAnnotations
}

export type PanasScores = {
  totalPositiveAffect: number | null
  totalNegativeAffect: number | null
  items: Record<string, number>
}

export type ConversationWideQuestions = {
  q1_lookingFor: string[]
  q2_emotionClarity: string
  q3_modelFit: string
  q3_followUp_whatFeltOff: string[]
  fourBranchScores: Record<string, number>
}

export type ParticipantProfile = {
  schema_version?: string | null
  participant_id?: string | null
  responses: Record<string, unknown>
  age?: string | null
  traits?: string[]
  goals?: string[]
  extra?: Record<string, unknown>
  [key: string]: unknown
}

export type Metadata = {
  conversationId?: string | null
  model?: string
  provider?: string
  timestamp?: string
  category?: string
  subtopic?: string
  model_version?: string
  text?: string
  conversation_visibility?: string
  turnCount?: number | null
  [key: string]: unknown
}

export type ConversationData = {
  conversationId: string
  metadata: Metadata
  participant_profile: ParticipantProfile | null
  prePanas: PanasScores
  postPanas: PanasScores
  conversationWideQuestions: ConversationWideQuestions
  turns: Turn[]
}

// ---------------------------------------------------------------------------
// EM 输出模型（被评测模型的预测结果）
// ---------------------------------------------------------------------------

export type EMTurnResult = {
  turnNumber: number
  em_emotion_tags: MoodShiftTag[]
  em_drafted_response: string | null
  response_reasoning: string | null
  emotion_reasoning: string | null
  pairwise_assignment: Record<string, Record<string, string>>
  em_binary_om_assessment: Record<string, 'yes' | 'no' | 'na'>
  em_binary_human_prediction: Record<string, 'yes' | 'no' | 'na'>
  em_binary_om_assessment_hp: Record<string, 'yes' | 'no' | 'na'>
  em_binary_human_prediction_hp: Record<string, 'yes' | 'no' | 'na'>
  em_pairwise_selections: Record<string, 'A' | 'B'>
  em_four_branch_scores: Record<string, number>
  em_draft_judge_scores: Record<string, number>
  em_draft_judge_scores_by_model: Record<string, Record<string, number>>
  em_draft_binary_assessment: Record<string, string>
  em_draft_binary_assessment_by_model: Record<string, Record<string, string>>
}

export type EMPostConversation = {
  panas_strategy: string
  pre_panas_shown: PanasScores
  predicted_post_panas: PanasScores
  predicted_panas_delta: Record<string, number>
  predicted_conversation_wide: ConversationWideQuestions
}

export type EMRunOutput = {
  conversationId: string
  source_file: string
  em_model: string
  run_timestamp: string
  mode: string
  turns: EMTurnResult[]
  post_conversation: EMPostConversation
  api_cost: number | null
  duration_seconds: number | null
}

// ---------------------------------------------------------------------------
// 评分结果模型
// ---------------------------------------------------------------------------

export type BinaryClassificationMetrics = {
  tp: number
  tn: number
  fp: number
  fn: number
  accuracy: number
  precision: number
  recall: number
  f1: number
  mcc: number
}

export type TurnScore = {
  turnNumber: number
  emotion_hit_rate: number
  emotion_valence_score: number
  emotion_intensity_mae: number | null
  emotion_precision: number
  emotion_recall: number
  emotion_f1: number
  emotion_f1_intensity: number
  emotion_va_score: number
  emotion_va_intensity_score: number
  binary_om_accuracy: number
  binary_human_accuracy: number
  binary_om_metrics: BinaryClassificationMetrics
  binary_human_metrics: BinaryClassificationMetrics
  binary_om_accuracy_hp: number
  binary_human_accuracy_hp: number
  binary_om_metrics_hp: BinaryClassificationMetrics
  binary_human_metrics_hp: BinaryClassificationMetrics
  pairwise_accuracy: number
  pairwise_kendall_tau: number | null
  response_similarity: number
  response_similarity_original: number
  response_similarity_llm_improved: number
  response_similarity_human_edited: number
  response_preference_alignment: number
  draft_judge_score: number | null
  draft_binary_alignment: number | null
  four_branch_mae: number
}

export type PostConversationScore = {
  panas_mae: number
  panas_normalized: number
  panas_pa_mae: number
  panas_na_mae: number
  panas_pa_normalized: number
  panas_na_normalized: number
  panas_pa_baseline_adjusted: number | null
  panas_na_baseline_adjusted: number | null
  panas_baseline_adjusted: number | null
  panas_item_baseline_adjusted: number | null
  panas_item_mae: number | null
  panas_item_normalized: number | null
  panas_item_errors: Record<string, number>
  q1_looking_for_score: number
  q2_emotion_clarity_match: number
  q3_model_fit_match: number
  q3_model_fit_ordinal_distance: number
  q3_follow_up_score: number
  four_branch_mae: number
  four_branch_normalized: number
  four_branch_per_branch: Record<string, number>
}

export type ConversationScore = {
  conversationId: string
  mode: string
  em_model: string
  turn_scores: TurnScore[]
  post_score: PostConversationScore
  avg_emotion_hit_rate: number
  avg_emotion_hit_rate_tagged_only: number | null
  avg_emotion_intensity_mae: number | null
  avg_emotion_f1: number
  avg_emotion_f1_intensity: number
  avg_emotion_va_score: number
  avg_emotion_va_intensity_score: number
  avg_binary_om_accuracy: number
  avg_binary_human_accuracy: number
  avg_binary_om_accuracy_hp: number
  avg_binary_human_accuracy_hp: number
  avg_pairwise_accuracy: number
  avg_pairwise_kendall_tau: number | null
  avg_response_similarity: number
  avg_response_similarity_original: number
  avg_response_similarity_llm_improved: number
  avg_response_similarity_human_edited: number
  avg_response_preference_alignment: number
  avg_draft_judge_score: number | null
  avg_draft_binary_alignment: number | null
  avg_four_branch_mae: number
  pooled_binary_om_metrics: BinaryClassificationMetrics
  pooled_binary_human_metrics: BinaryClassificationMetrics
  pooled_binary_om_metrics_hp: BinaryClassificationMetrics
  pooled_binary_human_metrics_hp: BinaryClassificationMetrics
  hp_perspective_gap: number
  hp_perspective_alignment: number
  hp_perspective_gap_mcc: number
  hp_perspective_alignment_mcc: number
  turn_level_average: number
  conversation_wide_average: number
  composite_score: number
  equal_weight_composite: number
}

export type AggregateResult = {
  em_model: string
  mode: string
  n_conversations: number
  avg_emotion_hit_rate: number
  avg_emotion_hit_rate_tagged_only: number | null
  avg_emotion_intensity_mae: number | null
  avg_emotion_f1: number
  avg_emotion_f1_intensity: number
  avg_emotion_va_score: number
  avg_emotion_va_intensity_score: number
  avg_binary_om_accuracy: number
  avg_binary_human_accuracy: number
  avg_binary_om_accuracy_hp: number
  avg_binary_human_accuracy_hp: number
  avg_pairwise_accuracy: number
  avg_pairwise_kendall_tau: number | null
  avg_response_similarity: number
  avg_response_similarity_original: number
  avg_response_similarity_llm_improved: number
  avg_response_similarity_human_edited: number
  avg_response_preference_alignment: number
  avg_draft_judge_score: number | null
  avg_draft_binary_alignment: number | null
  avg_four_branch_mae: number
  avg_panas_normalized: number
  avg_panas_item_mae: number | null
  avg_panas_item_normalized: number | null
  avg_q1_looking_for_score: number
  avg_q2_emotion_clarity_match: number
  avg_q3_model_fit_match: number
  avg_q3_model_fit_ordinal_distance: number
  avg_q3_follow_up_score: number
  avg_post_four_branch_normalized: number
  pooled_binary_om_metrics: BinaryClassificationMetrics
  pooled_binary_human_metrics: BinaryClassificationMetrics
  pooled_binary_om_metrics_hp: BinaryClassificationMetrics
  pooled_binary_human_metrics_hp: BinaryClassificationMetrics
  avg_hp_perspective_gap: number
  avg_hp_perspective_alignment: number
  avg_hp_perspective_gap_mcc: number
  avg_hp_perspective_alignment_mcc: number
  turn_level_average: number
  conversation_wide_average: number
  composite_score: number
  equal_weight_composite: number
  se_emotion_hit_rate: number
  se_binary_om_accuracy: number
  se_binary_human_accuracy: number
  se_pairwise_accuracy: number
  se_panas_normalized: number
  se_composite: number
  z_score: number | null
}

// ---------------------------------------------------------------------------
// 解析（对应 pydantic 校验器）
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/** 解析 MoodShiftTag（intensity 需归一化到 1-7） */
export function parseMoodShiftTag(raw: unknown): MoodShiftTag | null {
  if (!isRecord(raw) || typeof raw.emotion !== 'string') return null
  return {
    emotion: raw.emotion,
    intensity: normalizeMoodIntensity(raw.intensity),
  }
}

function parseMoodShiftTags(raw: unknown): MoodShiftTag[] {
  if (!Array.isArray(raw)) return []
  const tags: MoodShiftTag[] = []
  for (const item of raw) {
    const tag = parseMoodShiftTag(item)
    if (tag) tags.push(tag)
  }
  return tags
}

/** 解析 BinaryJudgement（兼容 did_occur / humanValue / actualValue / should_occur / humanPreference 别名） */
export function parseBinaryJudgement(raw: unknown): BinaryJudgement | null {
  if (!isRecord(raw) || typeof raw.questionId !== 'string') return null
  const norm = (value: unknown) => normalizeBinaryValue(value) ?? null
  return {
    questionId: raw.questionId,
    llmValue: norm(raw.llmValue) as 'yes' | 'no' | 'na' | null,
    observedBehavior: norm(
      raw.observedBehavior ?? raw.did_occur ?? raw.humanValue ?? raw.actualValue,
    ) as 'yes' | 'no' | 'na' | null,
    preferredBehavior: norm(
      raw.preferredBehavior ?? raw.should_occur ?? raw.humanPreference,
    ) as 'yes' | 'no' | 'na' | null,
  }
}

/** 解析 AlternateResponses（兼容 blinded 文件的 alternate1/alternate2） */
export function parseAlternateResponses(raw: unknown): AlternateResponses | null {
  if (!isRecord(raw)) return null
  const llmImproved = raw.llmImproved ?? raw.alternate1
  const humanEdited = raw.humanEdited ?? raw.alternate2
  if (typeof llmImproved !== 'string' && typeof humanEdited !== 'string') return null
  return {
    llmImproved: typeof llmImproved === 'string' ? llmImproved : '',
    humanEdited: typeof humanEdited === 'string' ? humanEdited : '',
  }
}

/** 解析 PairwiseComparison（兼容 response_1/response_2 旧键名） */
export function parsePairwiseComparison(raw: unknown): PairwiseComparison | null {
  if (!isRecord(raw) || typeof raw.questionId !== 'string') return null
  const responseA = asString(raw.responseA ?? raw.response_1)
  const responseB = asString(raw.responseB ?? raw.response_2)
  return {
    questionId: raw.questionId,
    responseA,
    responseB,
    winner: normalizePairwiseWinner(raw.winner) as 'A' | 'B' | null,
  }
}

/** 解析 PANAS（解包 responses、从 items 推导 totals、聚合项 clamp 到 10-70） */
export function parsePanasScores(raw: unknown): PanasScores {
  if (!isRecord(raw)) {
    return { totalPositiveAffect: null, totalNegativeAffect: null, items: {} }
  }
  let data = raw
  if (isRecord(raw.responses)) {
    const unwrapped: Record<string, unknown> = { ...raw }
    for (const [key, value] of Object.entries(raw.responses)) {
      if (!(key in unwrapped)) unwrapped[key] = value
    }
    data = unwrapped
  }

  const items: Record<string, number> = {}
  const dataLower = new Map<string, number>()
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'number' || typeof value === 'string') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) dataLower.set(key.toLowerCase(), Math.round(parsed))
    }
  }
  for (const item of PANAS_ITEMS) {
    const direct = data[item]
    if (typeof direct === 'number' || typeof direct === 'string') {
      const parsed = Number(direct)
      if (Number.isFinite(parsed)) items[item] = Math.round(parsed)
    } else if (dataLower.has(item.toLowerCase())) {
      items[item] = dataLower.get(item.toLowerCase())!
    }
  }

  const hasTotals =
    'totalPositiveAffect' in data || 'totalNegativeAffect' in data
  let totalPositiveAffect: number | null = null
  let totalNegativeAffect: number | null = null

  if (hasTotals) {
    totalPositiveAffect = clampPanasTotal(data.totalPositiveAffect)
    totalNegativeAffect = clampPanasTotal(data.totalNegativeAffect)
  } else if (Object.keys(items).length > 0) {
    const pa = PANAS_POSITIVE.filter((item) => item in items).map((item) => items[item])
    const na = PANAS_NEGATIVE.filter((item) => item in items).map((item) => items[item])
    totalPositiveAffect = pa.length > 0 ? pa.reduce((a, b) => a + b, 0) : null
    totalNegativeAffect = na.length > 0 ? na.reduce((a, b) => a + b, 0) : null
  }

  return {
    totalPositiveAffect:
      totalPositiveAffect === null ? null : clampPanasTotal(totalPositiveAffect),
    totalNegativeAffect:
      totalNegativeAffect === null ? null : clampPanasTotal(totalNegativeAffect),
    items,
  }
}

/** 解析 ConversationWideQuestions（兼容 Q1/Q2/Q3 旧键名） */
export function parseConversationWideQuestions(raw: unknown): ConversationWideQuestions {
  if (!isRecord(raw)) {
    return {
      q1_lookingFor: [],
      q2_emotionClarity: '',
      q3_modelFit: '',
      q3_followUp_whatFeltOff: [],
      fourBranchScores: {},
    }
  }
  const fourBranchRaw = isRecord(raw.fourBranchScores) ? raw.fourBranchScores : {}
  const fourBranchScores: Record<string, number> = {}
  for (const branch of FOUR_BRANCHES) {
    const score = clampFourBranchScore(fourBranchRaw[branch])
    if (score !== null) fourBranchScores[branch] = score
  }
  return {
    q1_lookingFor: asStringList(raw.q1_lookingFor ?? raw.Q1),
    q2_emotionClarity: asString(raw.q2_emotionClarity ?? raw.Q2),
    q3_modelFit: asString(raw.q3_modelFit ?? raw.Q3),
    q3_followUp_whatFeltOff: asStringList(raw.q3_followUp_whatFeltOff),
    fourBranchScores,
  }
}

function parseTurnAnnotations(raw: unknown): TurnAnnotations {
  if (!isRecord(raw)) {
    return { binaryJudgements: [], alternateResponses: null, pairwiseComparisons: [], selectedPairwiseQuestions: [] }
  }
  const binaryJudgements = Array.isArray(raw.binaryJudgements)
    ? raw.binaryJudgements
        .map(parseBinaryJudgement)
        .filter((item): item is BinaryJudgement => item !== null)
    : []
  const pairwiseComparisons = Array.isArray(raw.pairwiseComparisons)
    ? raw.pairwiseComparisons
        .map(parsePairwiseComparison)
        .filter((item): item is PairwiseComparison => item !== null)
    : []
  return {
    binaryJudgements,
    alternateResponses: parseAlternateResponses(raw.alternateResponses),
    pairwiseComparisons,
    selectedPairwiseQuestions: asStringList(raw.selectedPairwiseQuestions),
  }
}

/** 解析一条 Turn */
export function parseTurn(raw: unknown): Turn | null {
  if (!isRecord(raw) || typeof raw.turnNumber !== 'number') return null
  return {
    turnNumber: raw.turnNumber,
    userMessage: asString(raw.userMessage),
    llmResponse: asString(raw.llmResponse),
    moodShiftTags: parseMoodShiftTags(raw.moodShiftTags),
    annotations: parseTurnAnnotations(raw.annotations),
  }
}

/** 解析一份对话数据文件；失败返回 null */
export function parseConversationData(raw: unknown): ConversationData | null {
  if (!isRecord(raw) || typeof raw.conversationId !== 'string') return null
  const metadataRaw = isRecord(raw.metadata) ? raw.metadata : {}
  const turns = Array.isArray(raw.turns)
    ? raw.turns.map(parseTurn).filter((turn): turn is Turn => turn !== null)
    : []
  return {
    conversationId: raw.conversationId,
    metadata: metadataRaw as Metadata,
    participant_profile: isRecord(raw.participant_profile)
      ? (raw.participant_profile as ParticipantProfile)
      : null,
    prePanas: parsePanasScores(raw.prePanas),
    postPanas: parsePanasScores(raw.postPanas),
    conversationWideQuestions: parseConversationWideQuestions(raw.conversationWideQuestions),
    turns,
  }
}
