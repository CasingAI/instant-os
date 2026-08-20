/** AttuneBench 评分引擎（移植自官方 attunebench/scorer.py，纯函数无 LLM 调用） */

import {
  BINARY_HIDDEN_QUESTIONS,
  COMPOSITE_WEIGHTS,
  EVAL_QUALITY_WEIGHTS,
  FOUR_BRANCHES,
  FOUR_BRANCH_MAX,
  FOUR_BRANCH_MIN,
  HOLISTIC_WEIGHTS,
  MODEL_FIT_OPTIONS,
  PANAS_ITEM_MAX_ERROR,
  PANAS_ITEMS,
  PANAS_NEGATIVE,
  PANAS_POSITIVE,
  PANAS_SIMILARITY,
  PANAS_TOTAL_MAX,
  PANAS_TOTAL_MIN,
} from './constants.ts'
import {
  isAnsweredBinary,
  normalizeBinaryValue,
  normalizeEmotion,
  setHitRate,
  tokenJaccard,
} from './utils.ts'
import type {
  AggregateResult,
  BinaryClassificationMetrics,
  ConversationData,
  ConversationScore,
  EMPostConversation,
  EMRunOutput,
  EMTurnResult,
  PanasScores,
  PostConversationScore,
  Turn,
  TurnScore,
} from './types.ts'

// ---------------------------------------------------------------------------
// 二元分类辅助
// ---------------------------------------------------------------------------

export function computeBinaryMetrics(
  tp: number,
  tn: number,
  fp: number,
  fn: number,
): BinaryClassificationMetrics {
  const total = tp + tn + fp + fn
  const accuracy = total > 0 ? (tp + tn) / total : 0.0

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0.0
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0.0
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0.0

  const denom = Math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn))
  const mcc = denom > 0 ? (tp * tn - fp * fn) / denom : 0.0

  return { tp, tn, fp, fn, accuracy, precision, recall, f1, mcc }
}

function accumulateBinaryConfusion(
  gtJudgements: Record<string, { observedBehavior: 'yes' | 'no' | 'na' | null; preferredBehavior: 'yes' | 'no' | 'na' | null; llmValue: 'yes' | 'no' | 'na' | null }>,
  emAssessments: Record<string, string>,
  gtKeyFn: (gt: { observedBehavior: 'yes' | 'no' | 'na' | null; preferredBehavior: 'yes' | 'no' | 'na' | null; llmValue: 'yes' | 'no' | 'na' | null }) => 'yes' | 'no' | 'na' | null | undefined,
): [number, number, number, number] {
  let tp = 0
  let tn = 0
  let fp = 0
  let fn = 0
  for (const [qid, gt] of Object.entries(gtJudgements)) {
    const gtVal = normalizeBinaryValue(gtKeyFn(gt))
    if (!isAnsweredBinary(gtVal)) continue
    const predVal = emAssessments[qid]
    if (predVal === undefined || predVal === null || predVal === 'na') {
      if (gtVal === 'yes') {
        fn += 1
      } else {
        tn += 1
      }
      continue
    }
    if (gtVal === 'yes' && predVal === 'yes') tp += 1
    else if (gtVal === 'no' && predVal === 'no') tn += 1
    else if (gtVal === 'no' && predVal === 'yes') fp += 1
    else if (gtVal === 'yes' && predVal === 'no') fn += 1
  }
  return [tp, tn, fp, fn]
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0
}

// ---------------------------------------------------------------------------
// 每轮评分
// ---------------------------------------------------------------------------

/** 情绪标签命中率 */
export function scoreEmotionTags(turn: Turn, emTurn: EMTurnResult): number {
  const groundTruth = new Set(turn.moodShiftTags.map((tag) => normalizeEmotion(tag.emotion)))
  const predicted = new Set(emTurn.em_emotion_tags.map((tag) => normalizeEmotion(tag.emotion)))
  return setHitRate(predicted, groundTruth)
}

/** DEPRECATED：情绪效价评分（已被 VA 相似度取代，仅保留移植） */
export function scoreEmotionValence(turn: Turn, emTurn: EMTurnResult): number {
  const posLower = new Set(PANAS_POSITIVE.map((e) => e.toLowerCase()))
  const negLower = new Set(PANAS_NEGATIVE.map((e) => e.toLowerCase()))

  const valence = (emotion: string): 'positive' | 'negative' | null => {
    const e = emotion.trim().toLowerCase()
    if (posLower.has(e)) return 'positive'
    if (negLower.has(e)) return 'negative'
    return null
  }

  const gtTags = turn.moodShiftTags.map((tag) => normalizeEmotion(tag.emotion))
  const predTags = new Set(emTurn.em_emotion_tags.map((tag) => normalizeEmotion(tag.emotion)))

  if (gtTags.length === 0) {
    return predTags.size === 0 ? 1.0 : 0.0
  }

  let totalCredit = 0.0
  for (const gtEmo of gtTags) {
    if (predTags.has(gtEmo)) {
      totalCredit += 1.0
    } else {
      const gtVal = valence(gtEmo)
      if (gtVal && [...predTags].some((p) => valence(p) === gtVal)) {
        totalCredit += 0.5
      }
    }
  }
  return totalCredit / gtTags.length
}

/** 匹配情绪标签的强度 MAE；无匹配时返回 null */
export function scoreEmotionIntensity(turn: Turn, emTurn: EMTurnResult): number | null {
  const gtMap = new Map(
    turn.moodShiftTags.map((tag) => [normalizeEmotion(tag.emotion), tag.intensity]),
  )
  const predMap = new Map(
    emTurn.em_emotion_tags.map((tag) => [normalizeEmotion(tag.emotion), tag.intensity]),
  )

  const errors: number[] = []
  for (const [emotion, gtIntensity] of gtMap) {
    if (!predMap.has(emotion)) continue
    const predIntensity = predMap.get(emotion)
    if (gtIntensity !== null && predIntensity !== null && predIntensity !== undefined) {
      errors.push(Math.abs(gtIntensity - predIntensity))
    }
  }
  return errors.length > 0 ? mean(errors) : null
}

/** 情绪标签 precision/recall/F1，以及 F1×强度 */
export function scoreEmotionF1(
  turn: Turn,
  emTurn: EMTurnResult,
): [number, number, number, number] {
  const gtSet = new Set(turn.moodShiftTags.map((tag) => normalizeEmotion(tag.emotion)))
  const predSet = new Set(emTurn.em_emotion_tags.map((tag) => normalizeEmotion(tag.emotion)))

  if (gtSet.size === 0 && predSet.size === 0) return [1.0, 1.0, 1.0, 1.0]
  if (gtSet.size === 0 && predSet.size > 0) return [0.0, 0.0, 0.0, 0.0]

  let tpCount = 0
  for (const item of gtSet) {
    if (predSet.has(item)) tpCount += 1
  }
  const fp = predSet.size - tpCount
  const fn = gtSet.size - tpCount

  const precision = tpCount + fp > 0 ? tpCount / (tpCount + fp) : 0.0
  const recall = tpCount + fn > 0 ? tpCount / (tpCount + fn) : 0.0
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0.0

  let f1Intensity = 0.0
  if (tpCount > 0) {
    const gtMap = new Map(
      turn.moodShiftTags.map((tag) => [normalizeEmotion(tag.emotion), tag.intensity]),
    )
    const predMap = new Map(
      emTurn.em_emotion_tags.map((tag) => [normalizeEmotion(tag.emotion), tag.intensity]),
    )
    const intensityScores: number[] = []
    for (const emo of gtSet) {
      if (!predSet.has(emo)) continue
      const gtI = gtMap.get(emo)
      const predI = predMap.get(emo)
      if (gtI !== null && gtI !== undefined && predI !== null && predI !== undefined) {
        intensityScores.push(1.0 - Math.abs(gtI - predI) / PANAS_ITEM_MAX_ERROR)
      }
    }
    f1Intensity = intensityScores.length > 0 ? f1 * mean(intensityScores) : 0.0
  }

  return [precision, recall, f1, f1Intensity]
}

/** scipy 不可用时的贪婪匹配回退 */
function greedyMatch(costMatrix: number[][]): Array<[number, number]> {
  const nRows = costMatrix.length
  if (nRows === 0) return []
  const nCols = costMatrix[0].length
  const usedRows = new Set<number>()
  const usedCols = new Set<number>()
  const matches: Array<[number, number]> = []

  const candidates: Array<[number, number, number]> = []
  for (let r = 0; r < nRows; r += 1) {
    for (let c = 0; c < nCols; c += 1) {
      candidates.push([costMatrix[r][c], r, c])
    }
  }
  candidates.sort((a, b) => a[0] - b[0])

  for (const [cost, r, c] of candidates) {
    void cost
    if (usedRows.has(r) || usedCols.has(c)) continue
    matches.push([r, c])
    usedRows.add(r)
    usedCols.add(c)
    if (matches.length === Math.min(nRows, nCols)) break
  }
  return matches
}

/** VA 相似度评分（匈牙利匹配，回退贪婪匹配） */
export function scoreEmotionVa(
  turn: Turn,
  emTurn: EMTurnResult,
  alpha = 0.7,
): [number, number] {
  const gtTags = turn.moodShiftTags
  const predTags = emTurn.em_emotion_tags

  const gtEmotions = gtTags.map((tag) => normalizeEmotion(tag.emotion))
  const predEmotions = predTags.map((tag) => normalizeEmotion(tag.emotion))

  if (gtEmotions.length === 0 && predEmotions.length === 0) return [1.0, 1.0]
  if (gtEmotions.length === 0 || predEmotions.length === 0) return [0.0, 0.0]

  const vaCostMatrix: number[][] = []
  const vaIntCostMatrix: number[][] = []

  for (let i = 0; i < gtEmotions.length; i += 1) {
    const vaRow: number[] = []
    const vaIntRow: number[] = []
    const gtIntensity = gtTags[i].intensity
    for (let j = 0; j < predEmotions.length; j += 1) {
      const emoSim = PANAS_SIMILARITY[gtEmotions[i]]?.[predEmotions[j]] ?? 0.0
      vaRow.push(1.0 - emoSim)

      const predIntensity = predTags[j].intensity
      const intSim =
        gtIntensity !== null && gtIntensity !== undefined && predIntensity !== null && predIntensity !== undefined
          ? 1.0 - Math.abs(gtIntensity - predIntensity) / PANAS_ITEM_MAX_ERROR
          : 0.0
      const combined = alpha * emoSim + (1.0 - alpha) * intSim
      vaIntRow.push(1.0 - combined)
    }
    vaCostMatrix.push(vaRow)
    vaIntCostMatrix.push(vaIntRow)
  }

  const vaMatches = greedyMatch(vaCostMatrix)
  const vaIntMatches = greedyMatch(vaIntCostMatrix)

  let vaTotal = 0.0
  for (const [r, c] of vaMatches) {
    vaTotal += 1.0 - vaCostMatrix[r][c]
  }
  let vaIntTotal = 0.0
  for (const [r, c] of vaIntMatches) {
    vaIntTotal += 1.0 - vaIntCostMatrix[r][c]
  }

  const nMatched = Math.min(gtEmotions.length, predEmotions.length)
  const vaScoreRaw = nMatched > 0 ? vaTotal / nMatched : 0.0
  const vaIntScoreRaw = nMatched > 0 ? vaIntTotal / nMatched : 0.0

  const coverage = Math.min(gtEmotions.length, predEmotions.length) / Math.max(gtEmotions.length, predEmotions.length)
  return [vaScoreRaw * coverage, vaIntScoreRaw * coverage]
}

/** 二元判断准确率（OM 评估 + HP 预测） */
export function scoreBinaryJudgements(
  turn: Turn,
  emTurn: EMTurnResult,
): [number, number, BinaryClassificationMetrics, BinaryClassificationMetrics] {
  const gtJudgements: Record<string, Turn['annotations']['binaryJudgements'][number]> = {}
  for (const bj of turn.annotations.binaryJudgements) {
    if (!BINARY_HIDDEN_QUESTIONS.has(bj.questionId)) {
      gtJudgements[bj.questionId] = bj
    }
  }

  if (Object.keys(gtJudgements).length === 0) {
    const empty = computeBinaryMetrics(0, 0, 0, 0)
    return [1.0, 1.0, empty, empty]
  }

  const [omTp, omTn, omFp, omFn] = accumulateBinaryConfusion(
    gtJudgements,
    emTurn.em_binary_om_assessment,
    (gt) => gt.observedBehavior ?? gt.llmValue,
  )
  const omMetrics = computeBinaryMetrics(omTp, omTn, omFp, omFn)

  const [humanTp, humanTn, humanFp, humanFn] = accumulateBinaryConfusion(
    gtJudgements,
    emTurn.em_binary_human_prediction,
    (gt) => gt.preferredBehavior ?? gt.observedBehavior,
  )
  const humanMetrics = computeBinaryMetrics(humanTp, humanTn, humanFp, humanFn)

  return [omMetrics.accuracy, humanMetrics.accuracy, omMetrics, humanMetrics]
}

/** 两两比较准确率 */
export function scorePairwiseComparisons(turn: Turn, emTurn: EMTurnResult): number {
  const comparisons = turn.annotations.pairwiseComparisons
  if (comparisons.length === 0) return 1.0

  let correct = 0
  for (let i = 0; i < comparisons.length; i += 1) {
    const emWinner = emTurn.em_pairwise_selections[String(i)]
    if (emWinner === comparisons[i].winner) correct += 1
  }
  return correct / comparisons.length
}

/** Kendall Tau 排名相关 */
export function scorePairwiseKendallTau(turn: Turn, emTurn: EMTurnResult): number | null {
  const gtWins = new Map<string, number>()
  const emWins = new Map<string, number>()

  for (let i = 0; i < turn.annotations.pairwiseComparisons.length; i += 1) {
    const pw = turn.annotations.pairwiseComparisons[i]
    if (pw.winner !== null) {
      const gtWinnerLabel = pw.winner === 'A' ? pw.responseA : pw.responseB
      gtWins.set(gtWinnerLabel, (gtWins.get(gtWinnerLabel) ?? 0) + 1)
    }
    const emWinnerLetter = emTurn.em_pairwise_selections[String(i)]
    if (emWinnerLetter !== undefined) {
      const emWinnerLabel = emWinnerLetter === 'A' ? pw.responseA : pw.responseB
      emWins.set(emWinnerLabel, (emWins.get(emWinnerLabel) ?? 0) + 1)
    }
  }

  const allLabelsSet = new Set<string>()
  for (const pw of turn.annotations.pairwiseComparisons) {
    allLabelsSet.add(pw.responseA)
    allLabelsSet.add(pw.responseB)
  }

  if (allLabelsSet.size < 2 || emWins.size === 0) return null

  const allLabels = [...allLabelsSet].sort()
  if (allLabels.length < 2) return null

  const gtRanking = [...allLabels].sort((a, b) => (gtWins.get(b) ?? 0) - (gtWins.get(a) ?? 0))
  const emRanking = [...allLabels].sort((a, b) => (emWins.get(b) ?? 0) - (emWins.get(a) ?? 0))

  const n = allLabels.length
  let concordant = 0
  let discordant = 0
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const gtOrder = gtRanking.indexOf(allLabels[i]) - gtRanking.indexOf(allLabels[j])
      const emOrder = emRanking.indexOf(allLabels[i]) - emRanking.indexOf(allLabels[j])
      if (gtOrder * emOrder > 0) concordant += 1
      else if (gtOrder * emOrder < 0) discordant += 1
    }
  }

  const totalPairs = concordant + discordant
  if (totalPairs === 0) return 0.0
  return (concordant - discordant) / totalPairs
}

/** 响应相似度（token Jaccard，取所有参考中最优） */
export function scoreResponseSimilarity(turn: Turn, emTurn: EMTurnResult): number {
  return scoreResponseSimilarityBreakdown(turn, emTurn)[0]
}

export function scoreResponseSimilarityBreakdown(
  turn: Turn,
  emTurn: EMTurnResult,
): [number, number, number, number] {
  if (!emTurn.em_drafted_response) return [0.0, 0.0, 0.0, 0.0]

  const originalSimilarity = tokenJaccard(emTurn.em_drafted_response, turn.llmResponse)
  let llmImprovedSimilarity = 0.0
  let humanEditedSimilarity = 0.0
  const alternates = turn.annotations.alternateResponses
  if (alternates) {
    if (alternates.llmImproved) {
      llmImprovedSimilarity = tokenJaccard(emTurn.em_drafted_response, alternates.llmImproved)
    }
    if (alternates.humanEdited) {
      humanEditedSimilarity = tokenJaccard(emTurn.em_drafted_response, alternates.humanEdited)
    }
  }

  const overall = Math.max(originalSimilarity, llmImprovedSimilarity, humanEditedSimilarity)
  return [overall, originalSimilarity, llmImprovedSimilarity, humanEditedSimilarity]
}

/** 偏好加权相似度 */
export function scoreResponsePreferenceAlignment(turn: Turn, emTurn: EMTurnResult): number {
  if (!emTurn.em_drafted_response) return 0.0

  const wins = new Map<string, number>()
  let totalComparisons = 0
  for (const pw of turn.annotations.pairwiseComparisons) {
    if (pw.winner === null) continue
    const winnerLabel = pw.winner === 'A' ? pw.responseA : pw.responseB
    const key = winnerLabel.trim().toLowerCase()
    wins.set(key, (wins.get(key) ?? 0) + 1)
    totalComparisons += 1
  }

  if (totalComparisons === 0) {
    return scoreResponseSimilarity(turn, emTurn)
  }

  const labelToText: Record<string, string> = { original: turn.llmResponse }
  const alternates = turn.annotations.alternateResponses
  if (alternates) {
    if (alternates.llmImproved) labelToText.alternate = alternates.llmImproved
    if (alternates.humanEdited) labelToText.human = alternates.humanEdited
  }

  let weightedSum = 0.0
  let weightSum = 0.0
  for (const [label, winCount] of wins) {
    const text = labelToText[label] ?? ''
    if (text) {
      const sim = tokenJaccard(emTurn.em_drafted_response, text)
      const weight = winCount / totalComparisons
      weightedSum += sim * weight
      weightSum += weight
    }
  }
  return weightSum > 0 ? weightedSum / weightSum : 0.0
}

/** 草稿与 HP 二元偏好的对齐准确率 */
export function scoreDraftBinaryAlignment(turn: Turn, emTurn: EMTurnResult): number | null {
  if (!emTurn.em_draft_binary_assessment) return null

  const gtJudgements: Record<string, Turn['annotations']['binaryJudgements'][number]> = {}
  for (const bj of turn.annotations.binaryJudgements) {
    if (!BINARY_HIDDEN_QUESTIONS.has(bj.questionId)) {
      gtJudgements[bj.questionId] = bj
    }
  }
  if (Object.keys(gtJudgements).length === 0) return null

  let correct = 0
  let total = 0
  for (const [qid, bj] of Object.entries(gtJudgements)) {
    const gtVal = normalizeBinaryValue(bj.preferredBehavior ?? bj.observedBehavior)
    if (!isAnsweredBinary(gtVal)) continue

    const draftVal = normalizeBinaryValue(emTurn.em_draft_binary_assessment[qid])
    if (draftVal === null || draftVal === 'na') {
      total += 1
      continue
    }
    total += 1
    if (draftVal === gtVal) correct += 1
  }
  return total > 0 ? correct / total : null
}

/** 单轮全量评分 */
export function scoreTurn(turn: Turn, emTurn: EMTurnResult): TurnScore {
  const emotionHit = scoreEmotionTags(turn, emTurn)
  const emotionIntensity = scoreEmotionIntensity(turn, emTurn)
  const [emPrecision, emRecall, emF1, emF1Intensity] = scoreEmotionF1(turn, emTurn)
  const [emVaScore, emVaIntensityScore] = scoreEmotionVa(turn, emTurn)
  const [omAcc, humanAcc, omMetrics, humanMetrics] = scoreBinaryJudgements(turn, emTurn)

  const gtJudgements: Record<string, Turn['annotations']['binaryJudgements'][number]> = {}
  for (const bj of turn.annotations.binaryJudgements) {
    if (!BINARY_HIDDEN_QUESTIONS.has(bj.questionId)) {
      gtJudgements[bj.questionId] = bj
    }
  }

  const [omTpHp, omTnHp, omFpHp, omFnHp] = accumulateBinaryConfusion(
    gtJudgements,
    emTurn.em_binary_om_assessment_hp,
    (gt) => gt.observedBehavior ?? gt.llmValue,
  )
  const omMetricsHp = computeBinaryMetrics(omTpHp, omTnHp, omFpHp, omFnHp)
  const [humanTpHp, humanTnHp, humanFpHp, humanFnHp] = accumulateBinaryConfusion(
    gtJudgements,
    emTurn.em_binary_human_prediction_hp,
    (gt) => gt.preferredBehavior ?? gt.observedBehavior,
  )
  const humanMetricsHp = computeBinaryMetrics(humanTpHp, humanTnHp, humanFpHp, humanFnHp)

  const pairwiseAcc = scorePairwiseComparisons(turn, emTurn)
  const kendallTau = scorePairwiseKendallTau(turn, emTurn)
  const [respSim, respSimOriginal, respSimLlmImproved, respSimHumanEdited] =
    scoreResponseSimilarityBreakdown(turn, emTurn)
  const prefAlignment = scoreResponsePreferenceAlignment(turn, emTurn)

  // 草稿裁判分（多个子维度平均，归一化 1-7 → 0-1）
  let draftJudge: number | null = null
  if (emTurn.em_draft_judge_scores && Object.keys(emTurn.em_draft_judge_scores).length > 0) {
    const dimKeys = ['overall_score', 'emotional_appropriateness', 'helpfulness', 'tone_match'] as const
    const dimVals = dimKeys
      .filter((key) => key in emTurn.em_draft_judge_scores)
      .map((key) => emTurn.em_draft_judge_scores[key])
    if (dimVals.length > 0) {
      const avgScore = mean(dimVals)
      draftJudge = Math.max(0.0, Math.min(1.0, (avgScore - 1) / 6))
    }
  }

  const draftBinaryAlign = scoreDraftBinaryAlignment(turn, emTurn)

  return {
    turnNumber: turn.turnNumber,
    emotion_hit_rate: emotionHit,
    emotion_valence_score: 0.0,
    emotion_intensity_mae: emotionIntensity,
    emotion_precision: emPrecision,
    emotion_recall: emRecall,
    emotion_f1: emF1,
    emotion_f1_intensity: emF1Intensity,
    emotion_va_score: emVaScore,
    emotion_va_intensity_score: emVaIntensityScore,
    binary_om_accuracy: omAcc,
    binary_human_accuracy: humanAcc,
    binary_om_metrics: omMetrics,
    binary_human_metrics: humanMetrics,
    binary_om_accuracy_hp: omMetricsHp.accuracy,
    binary_human_accuracy_hp: humanMetricsHp.accuracy,
    binary_om_metrics_hp: omMetricsHp,
    binary_human_metrics_hp: humanMetricsHp,
    pairwise_accuracy: pairwiseAcc,
    pairwise_kendall_tau: kendallTau,
    response_similarity: respSim,
    response_similarity_original: respSimOriginal,
    response_similarity_llm_improved: respSimLlmImproved,
    response_similarity_human_edited: respSimHumanEdited,
    response_preference_alignment: prefAlignment,
    draft_judge_score: draftJudge,
    draft_binary_alignment: draftBinaryAlign,
    four_branch_mae: 0.0,
  }
}

// ---------------------------------------------------------------------------
// 对话后评分
// ---------------------------------------------------------------------------

/** 若聚合值缺失但 item 存在，由 item 推导聚合值 */
function deriveAggregates(panasDict: Partial<PanasScores>): Partial<PanasScores> {
  const result = { ...panasDict }
  const items = result.items ?? {}
  if (Object.keys(items).length > 0) {
    if (result.totalPositiveAffect === null || result.totalPositiveAffect === undefined) {
      const paVals = PANAS_POSITIVE.filter((k) => k in items).map((k) => items[k])
      if (paVals.length > 0) result.totalPositiveAffect = paVals.reduce((a, b) => a + b, 0)
    }
    if (result.totalNegativeAffect === null || result.totalNegativeAffect === undefined) {
      const naVals = PANAS_NEGATIVE.filter((k) => k in items).map((k) => items[k])
      if (naVals.length > 0) result.totalNegativeAffect = naVals.reduce((a, b) => a + b, 0)
    }
  }
  return result
}

/** 基线调整分：(-1, 1)，post == pre 时返回 null */
export function baselineAdjusted(
  post: number,
  pred: number,
  pre: number,
  maxError: number,
): number | null {
  if (post === pre) return null
  const naiveScore = Math.max(0.0, 1.0 - Math.abs(post - pre) / maxError)
  const rawScore = Math.max(0.0, 1.0 - Math.abs(post - pred) / maxError)
  const denom = 1.0 - naiveScore
  if (denom === 0.0) return null
  return Math.max(-1.0, Math.min(1.0, (rawScore - naiveScore) / denom))
}

/** PANAS 聚合级预测评分 */
export function scorePanasPrediction(
  actualPostPanas: Partial<PanasScores>,
  predictedPostPanas: Partial<PanasScores>,
  prePanas: Partial<PanasScores> | null = null,
): [number, number, number, number, number, number, number | null, number | null, number | null] {
  const maxError = PANAS_TOTAL_MAX - PANAS_TOTAL_MIN // 60
  const midpoint = (PANAS_TOTAL_MIN + PANAS_TOTAL_MAX) / 2

  const actual = deriveAggregates(actualPostPanas)
  const predicted = deriveAggregates(predictedPostPanas)
  const pre = prePanas !== null ? deriveAggregates(prePanas) : null

  const paActual = actual.totalPositiveAffect
  const paPred = predicted.totalPositiveAffect
  const naActual = actual.totalNegativeAffect
  const naPred = predicted.totalNegativeAffect

  const errors: number[] = []
  let paMae = 0.0
  let naMae = 0.0

  if (paActual !== null && paActual !== undefined || paPred !== null && paPred !== undefined) {
    const _paActual = paActual ?? midpoint
    const _paPred = paPred ?? midpoint
    paMae = Math.abs(_paActual - _paPred)
    errors.push(paMae)
  }
  if (naActual !== null && naActual !== undefined || naPred !== null && naPred !== undefined) {
    const _naActual = naActual ?? midpoint
    const _naPred = naPred ?? midpoint
    naMae = Math.abs(_naActual - _naPred)
    errors.push(naMae)
  }

  const mae = errors.length > 0 ? mean(errors) : 0.0
  const normalized = maxError > 0 ? Math.max(0.0, 1.0 - mae / maxError) : 1.0
  const paNormalized = maxError > 0 ? Math.max(0.0, 1.0 - paMae / maxError) : 1.0
  const naNormalized = maxError > 0 ? Math.max(0.0, 1.0 - naMae / maxError) : 1.0

  let paBaselineAdj: number | null = null
  let naBaselineAdj: number | null = null
  let panasBaselineAdj: number | null = null

  if (pre !== null) {
    const paPre = pre.totalPositiveAffect
    const naPre = pre.totalNegativeAffect

    if (paActual !== null && paActual !== undefined && paPred !== null && paPred !== undefined && paPre !== null && paPre !== undefined) {
      paBaselineAdj = baselineAdjusted(paActual, paPred, paPre, maxError)
    }
    if (naActual !== null && naActual !== undefined && naPred !== null && naPred !== undefined && naPre !== null && naPre !== undefined) {
      naBaselineAdj = baselineAdjusted(naActual, naPred, naPre, maxError)
    }

    const adjVals = [paBaselineAdj, naBaselineAdj].filter((v): v is number => v !== null)
    panasBaselineAdj = adjVals.length > 0 ? mean(adjVals) : null
  }

  return [mae, normalized, paMae, naMae, paNormalized, naNormalized, paBaselineAdj, naBaselineAdj, panasBaselineAdj]
}

/** PANAS item 级评分 */
export function scorePanasItemLevel(
  actualItems: Record<string, number>,
  predictedItems: Record<string, number>,
  preItems: Record<string, number> | null = null,
): [number | null, Record<string, number>, number | null, number | null] {
  const perItemErrors: Record<string, number> = {}
  for (const item of PANAS_ITEMS) {
    const actual = actualItems[item]
    const predicted = predictedItems[item]
    if (actual !== undefined && predicted !== undefined) {
      perItemErrors[item] = Math.abs(actual - predicted)
    }
  }

  const itemMae = Object.keys(perItemErrors).length > 0 ? mean(Object.values(perItemErrors)) : null

  let itemBaselineAdj: number | null = null
  if (preItems !== null) {
    const adjScores: number[] = []
    for (const item of PANAS_ITEMS) {
      const actual = actualItems[item]
      const predicted = predictedItems[item]
      const pre = preItems[item]
      if (actual !== undefined && predicted !== undefined && pre !== undefined) {
        const adj = baselineAdjusted(actual, predicted, pre, PANAS_ITEM_MAX_ERROR)
        if (adj !== null) adjScores.push(adj)
      }
    }
    itemBaselineAdj = adjScores.length > 0 ? mean(adjScores) : null
  }

  const itemNormalized = itemMae !== null ? 1.0 - itemMae / PANAS_ITEM_MAX_ERROR : null
  return [itemMae, perItemErrors, itemBaselineAdj, itemNormalized]
}

// ---------------------------------------------------------------------------
// 活跃 F1 评分器（对过度/欠预测对称惩罚）
// ---------------------------------------------------------------------------

function setF1Score(gtItems: string[], predItems: string[]): number {
  if (gtItems.length === 0 && predItems.length === 0) return 1.0
  if (gtItems.length === 0 || predItems.length === 0) return 0.0

  const gtSet = new Set(gtItems.map((item) => item.trim().toLowerCase()))
  const predSet = new Set(predItems.map((item) => item.trim().toLowerCase()))
  let tpCount = 0
  for (const item of gtSet) {
    if (predSet.has(item)) tpCount += 1
  }
  const precision = tpCount / predSet.size
  const recall = tpCount / gtSet.size
  if (precision + recall === 0.0) return 0.0
  return (2.0 * precision * recall) / (precision + recall)
}

function fuzzySetF1Score(gtItems: string[], predItems: string[], threshold = 0.3): number {
  if (gtItems.length === 0 && predItems.length === 0) return 1.0
  if (gtItems.length === 0 || predItems.length === 0) return 0.0

  const gtNorm = gtItems.map((item) => item.trim().toLowerCase())
  const predNorm = predItems.map((item) => item.trim().toLowerCase())
  const gtSet = new Set(gtNorm)
  const predSet = new Set(predNorm)

  let recallCredit = 0.0
  for (const gtItem of gtNorm) {
    if (predSet.has(gtItem)) {
      recallCredit += 1.0
      continue
    }
    let best = 0.0
    for (const p of predNorm) {
      best = Math.max(best, tokenJaccard(gtItem, p))
    }
    if (best >= threshold) recallCredit += best
  }
  const fuzzyRecall = recallCredit / gtNorm.length

  let precCredit = 0.0
  for (const predItem of predNorm) {
    if (gtSet.has(predItem)) {
      precCredit += 1.0
      continue
    }
    let best = 0.0
    for (const g of gtNorm) {
      best = Math.max(best, tokenJaccard(predItem, g))
    }
    if (best >= threshold) precCredit += best
  }
  const fuzzyPrecision = precCredit / predNorm.length

  if (fuzzyPrecision + fuzzyRecall === 0.0) return 0.0
  return (2.0 * fuzzyPrecision * fuzzyRecall) / (fuzzyPrecision + fuzzyRecall)
}

/** 跨对话问题评分 */
export function scoreConvWideQuestions(
  gtQ1: string[],
  gtQ2: string,
  gtQ3: string,
  gtQ3FollowUp: string[],
  predQ1: string[],
  predQ2: string,
  predQ3: string,
  predQ3FollowUp: string[],
): [number, number, number, number, number] {
  const q1Score = setF1Score(gtQ1, predQ1)
  const q2Score = gtQ2.trim().toLowerCase() === predQ2.trim().toLowerCase() ? 1.0 : 0.0
  const q3Score = gtQ3.trim().toLowerCase() === predQ3.trim().toLowerCase() ? 1.0 : 0.0
  const q3Distance = scoreModelFitOrdinalDistance(gtQ3, predQ3)
  const q3FollowUpScore = fuzzySetF1Score(gtQ3FollowUp, predQ3FollowUp)
  return [q1Score, q2Score, q3Score, q3Distance, q3FollowUpScore]
}

/** Q3 model-fit 标签的序数距离 */
export function scoreModelFitOrdinalDistance(gtQ3: string, predQ3: string): number {
  const indexMap = new Map(MODEL_FIT_OPTIONS.map((label, idx) => [label.trim().toLowerCase(), idx]))
  const gtIdx = indexMap.get(gtQ3.trim().toLowerCase())
  const predIdx = indexMap.get(predQ3.trim().toLowerCase())

  if (gtIdx === undefined && predIdx === undefined) return 0.0
  if (gtIdx === undefined || predIdx === undefined) return MODEL_FIT_OPTIONS.length - 1
  return Math.abs(gtIdx - predIdx)
}

/** 四分支对话级评分 */
export function scorePostFourBranch(
  gtScores: Record<string, number>,
  predScores: Record<string, number>,
): [number, number, Record<string, number>] {
  const maxError = FOUR_BRANCH_MAX - FOUR_BRANCH_MIN // 6
  const midpoint = (FOUR_BRANCH_MIN + FOUR_BRANCH_MAX) / 2

  const perBranch: Record<string, number> = {}
  for (const branch of FOUR_BRANCHES) {
    const gt = gtScores[branch]
    if (gt === undefined) continue
    const pred = predScores[branch] ?? midpoint
    perBranch[branch] = Math.abs(gt - pred)
  }

  if (Object.keys(perBranch).length === 0) return [0.0, 1.0, {}]

  const mae = mean(Object.values(perBranch))
  const normalized = maxError > 0 ? 1.0 - mae / maxError : 1.0
  return [mae, Math.max(0.0, normalized), perBranch]
}

/** 对话后全量评分 */
export function scorePostConversation(
  conversation: ConversationData,
  emPost: EMPostConversation,
): PostConversationScore {
  const actualPanas = conversation.postPanas
  const predictedPanas = emPost.predicted_post_panas
  const prePanas = conversation.prePanas

  const [panasMae, panasNorm, paMae, naMae, paNormalized, naNormalized, paBaselineAdj, naBaselineAdj, panasBaselineAdj] =
    scorePanasPrediction(actualPanas, predictedPanas, prePanas)

  let panasItemMae: number | null = null
  let panasItemNorm: number | null = null
  let panasItemErrors: Record<string, number> = {}
  let panasItemBaselineAdj: number | null = null
  if (conversation.postPanas.items && Object.keys(conversation.postPanas.items).length > 0 &&
      emPost.predicted_post_panas.items && Object.keys(emPost.predicted_post_panas.items).length > 0) {
    const preItems =
      conversation.prePanas.items && Object.keys(conversation.prePanas.items).length > 0
        ? conversation.prePanas.items
        : null
    ;[panasItemMae, panasItemErrors, panasItemBaselineAdj, panasItemNorm] = scorePanasItemLevel(
      conversation.postPanas.items,
      emPost.predicted_post_panas.items,
      preItems,
    )
  }

  const gtCw = conversation.conversationWideQuestions
  const predCw = emPost.predicted_conversation_wide
  const [q1, q2, q3, q3Distance, q3FollowUp] = scoreConvWideQuestions(
    gtCw.q1_lookingFor,
    gtCw.q2_emotionClarity,
    gtCw.q3_modelFit,
    gtCw.q3_followUp_whatFeltOff,
    predCw.q1_lookingFor,
    predCw.q2_emotionClarity,
    predCw.q3_modelFit,
    predCw.q3_followUp_whatFeltOff,
  )

  const [fbMae, fbNorm, fbPerBranch] = scorePostFourBranch(
    gtCw.fourBranchScores,
    predCw.fourBranchScores,
  )

  return {
    panas_mae: panasMae,
    panas_normalized: panasNorm,
    panas_pa_mae: paMae,
    panas_na_mae: naMae,
    panas_pa_normalized: paNormalized,
    panas_na_normalized: naNormalized,
    panas_pa_baseline_adjusted: paBaselineAdj,
    panas_na_baseline_adjusted: naBaselineAdj,
    panas_baseline_adjusted: panasBaselineAdj,
    panas_item_baseline_adjusted: panasItemBaselineAdj,
    panas_item_mae: panasItemMae,
    panas_item_normalized: panasItemNorm,
    panas_item_errors: panasItemErrors,
    q1_looking_for_score: q1,
    q2_emotion_clarity_match: q2,
    q3_model_fit_match: q3,
    q3_model_fit_ordinal_distance: q3Distance,
    q3_follow_up_score: q3FollowUp,
    four_branch_mae: fbMae,
    four_branch_normalized: fbNorm,
    four_branch_per_branch: fbPerBranch,
  }
}

// ---------------------------------------------------------------------------
// 完整对话评分
// ---------------------------------------------------------------------------

function poolBinaryMetrics(metricsList: BinaryClassificationMetrics[]): BinaryClassificationMetrics {
  let totalTp = 0
  let totalTn = 0
  let totalFp = 0
  let totalFn = 0
  for (const m of metricsList) {
    totalTp += m.tp
    totalTn += m.tn
    totalFp += m.fp
    totalFn += m.fn
  }
  return computeBinaryMetrics(totalTp, totalTn, totalFp, totalFn)
}

/** 评分一整条对话 */
export function scoreConversation(
  conversation: ConversationData,
  emOutput: EMRunOutput,
): ConversationScore {
  const gtTurns = new Map(conversation.turns.map((t) => [t.turnNumber, t]))
  const emTurns = new Map(emOutput.turns.map((t) => [t.turnNumber, t]))

  const turnScores: TurnScore[] = []
  for (const turnNum of [...gtTurns.keys()].sort((a, b) => a - b)) {
    const emTurn = emTurns.get(turnNum)
    if (emTurn) {
      turnScores.push(scoreTurn(gtTurns.get(turnNum)!, emTurn))
    }
  }

  const avgEmotion = mean(turnScores.map((ts) => ts.emotion_hit_rate))

  const taggedScores: number[] = []
  for (const turnNum of [...gtTurns.keys()].sort((a, b) => a - b)) {
    const gtTurn = gtTurns.get(turnNum)!
    if (gtTurn.moodShiftTags.length > 0 && emTurns.has(turnNum)) {
      const tsMatch = turnScores.find((ts) => ts.turnNumber === turnNum)
      if (tsMatch) taggedScores.push(tsMatch.emotion_hit_rate)
    }
  }
  const avgEmotionTagged = taggedScores.length > 0 ? mean(taggedScores) : null

  const intensityValues = turnScores
    .map((ts) => ts.emotion_intensity_mae)
    .filter((v): v is number => v !== null)
  const avgIntensity = intensityValues.length > 0 ? mean(intensityValues) : null

  const avgEmotionF1 = mean(turnScores.map((ts) => ts.emotion_f1))
  const avgEmotionF1Intensity = mean(turnScores.map((ts) => ts.emotion_f1_intensity))
  const avgEmotionVaScore = mean(turnScores.map((ts) => ts.emotion_va_score))
  const avgEmotionVaIntensityScore = mean(turnScores.map((ts) => ts.emotion_va_intensity_score))
  const avgBinaryOm = mean(turnScores.map((ts) => ts.binary_om_accuracy))
  const avgBinaryHuman = mean(turnScores.map((ts) => ts.binary_human_accuracy))
  const avgBinaryOmHp = mean(turnScores.map((ts) => ts.binary_om_accuracy_hp))
  const avgBinaryHumanHp = mean(turnScores.map((ts) => ts.binary_human_accuracy_hp))
  const avgPairwise = mean(turnScores.map((ts) => ts.pairwise_accuracy))

  const tauValues = turnScores
    .map((ts) => ts.pairwise_kendall_tau)
    .filter((v): v is number => v !== null)
  const avgKendallTau = tauValues.length > 0 ? mean(tauValues) : null

  const avgRespSim = mean(turnScores.map((ts) => ts.response_similarity))
  const avgRespSimOriginal = mean(turnScores.map((ts) => ts.response_similarity_original))
  const avgRespSimLlmImproved = mean(turnScores.map((ts) => ts.response_similarity_llm_improved))
  const avgRespSimHumanEdited = mean(turnScores.map((ts) => ts.response_similarity_human_edited))
  const avgPrefAlignment = mean(turnScores.map((ts) => ts.response_preference_alignment))

  const draftJudgeVals = turnScores
    .map((ts) => ts.draft_judge_score)
    .filter((v): v is number => v !== null)
  const avgDraftJudge = draftJudgeVals.length > 0 ? mean(draftJudgeVals) : null
  const draftBinaryVals = turnScores
    .map((ts) => ts.draft_binary_alignment)
    .filter((v): v is number => v !== null)
  const avgDraftBinary = draftBinaryVals.length > 0 ? mean(draftBinaryVals) : null

  const pooledOm = poolBinaryMetrics(turnScores.map((ts) => ts.binary_om_metrics))
  const pooledHuman = poolBinaryMetrics(turnScores.map((ts) => ts.binary_human_metrics))
  const pooledOmHp = poolBinaryMetrics(turnScores.map((ts) => ts.binary_om_metrics_hp))
  const pooledHumanHp = poolBinaryMetrics(turnScores.map((ts) => ts.binary_human_metrics_hp))

  const hpGap = avgBinaryHuman - avgBinaryHumanHp
  const hpAlignment = avgBinaryHuman > 0 ? avgBinaryHumanHp / avgBinaryHuman : 0.0
  const hpGapMcc = pooledHuman.mcc - pooledHumanHp.mcc
  const hpAlignmentMcc = pooledHuman.mcc > 0 ? pooledHumanHp.mcc / pooledHuman.mcc : 0.0

  const postScore = scorePostConversation(conversation, emOutput.post_conversation)

  const turnLevelAvg = computeTurnLevelAverage(
    avgEmotionF1,
    avgEmotionVaScore,
    avgBinaryOm,
    avgBinaryHuman,
    avgPairwise,
  )

  const convWideAvg = computeConversationWideAverage(
    postScore.panas_baseline_adjusted,
    postScore.q1_looking_for_score,
    postScore.q2_emotion_clarity_match,
    postScore.q3_model_fit_match,
    postScore.q3_follow_up_score,
    postScore.four_branch_normalized,
  )

  const composite = computeComposite(
    avgEmotionF1,
    avgEmotionVaScore,
    avgBinaryOm,
    avgBinaryHuman,
    avgPairwise,
    postScore.panas_baseline_adjusted,
    postScore.q1_looking_for_score,
    postScore.q2_emotion_clarity_match,
    postScore.q3_model_fit_match,
    postScore.q3_follow_up_score,
    postScore.four_branch_normalized,
  )

  const equalWt = computeEqualWeightComposite(turnLevelAvg, convWideAvg)

  return {
    conversationId: conversation.conversationId,
    mode: emOutput.mode,
    em_model: emOutput.em_model,
    turn_scores: turnScores,
    post_score: postScore,
    avg_emotion_hit_rate: avgEmotion,
    avg_emotion_hit_rate_tagged_only: avgEmotionTagged,
    avg_emotion_intensity_mae: avgIntensity,
    avg_emotion_f1: avgEmotionF1,
    avg_emotion_f1_intensity: avgEmotionF1Intensity,
    avg_emotion_va_score: avgEmotionVaScore,
    avg_emotion_va_intensity_score: avgEmotionVaIntensityScore,
    avg_binary_om_accuracy: avgBinaryOm,
    avg_binary_human_accuracy: avgBinaryHuman,
    avg_binary_om_accuracy_hp: avgBinaryOmHp,
    avg_binary_human_accuracy_hp: avgBinaryHumanHp,
    avg_pairwise_accuracy: avgPairwise,
    avg_pairwise_kendall_tau: avgKendallTau,
    avg_response_similarity: avgRespSim,
    avg_response_similarity_original: avgRespSimOriginal,
    avg_response_similarity_llm_improved: avgRespSimLlmImproved,
    avg_response_similarity_human_edited: avgRespSimHumanEdited,
    avg_response_preference_alignment: avgPrefAlignment,
    avg_draft_judge_score: avgDraftJudge,
    avg_draft_binary_alignment: avgDraftBinary,
    avg_four_branch_mae: postScore.four_branch_mae,
    pooled_binary_om_metrics: pooledOm,
    pooled_binary_human_metrics: pooledHuman,
    pooled_binary_om_metrics_hp: pooledOmHp,
    pooled_binary_human_metrics_hp: pooledHumanHp,
    hp_perspective_gap: hpGap,
    hp_perspective_alignment: hpAlignment,
    hp_perspective_gap_mcc: hpGapMcc,
    hp_perspective_alignment_mcc: hpAlignmentMcc,
    turn_level_average: turnLevelAvg,
    conversation_wide_average: convWideAvg,
    composite_score: composite,
    equal_weight_composite: equalWt,
  }
}

/** 轮级平均（0-1） */
export function computeTurnLevelAverage(
  emotionF1: number,
  emotionVaScore: number,
  binaryOmAccuracy: number,
  binaryHumanAccuracy: number,
  pairwiseAccuracy: number,
): number {
  const emotionBlended = 0.5 * emotionF1 + 0.5 * emotionVaScore
  const metrics = [
    emotionBlended,
    (binaryOmAccuracy + binaryHumanAccuracy) / 2,
    pairwiseAccuracy,
  ]
  return mean(metrics)
}

/** 对话级平均（0-1）；PANAS 基线调整分从 [-1,1] 重映射到 [0,1] */
export function computeConversationWideAverage(
  panasBaselineAdjusted: number | null,
  q1Score: number,
  q2Match: number,
  q3Match: number,
  q3FollowUpScore: number,
  fourBranchNormalized: number,
): number {
  const panasScore =
    panasBaselineAdjusted !== null ? (panasBaselineAdjusted + 1.0) / 2.0 : 0.5
  const convWideQAvg = (q1Score + q2Match + q3Match + q3FollowUpScore) / 4
  const metrics = [panasScore, convWideQAvg, fourBranchNormalized]
  return mean(metrics)
}

/** 加权 Composite（0-100）：情绪追踪 24% + 评估质量 49% + 整体理解 27% */
export function computeComposite(
  emotionF1: number,
  emotionVaScore: number,
  binaryOmAccuracy: number,
  binaryHumanAccuracy: number,
  pairwiseAccuracy: number,
  panasBaselineAdjusted: number | null,
  q1Score: number,
  q2Match: number,
  q3Match: number,
  q3FollowUpScore: number,
  fourBranchNormalized: number,
): number {
  const emotionBlended = 0.5 * emotionF1 + 0.5 * emotionVaScore

  const binaryAvg = (binaryOmAccuracy + binaryHumanAccuracy) / 2
  const evalQuality =
    EVAL_QUALITY_WEIGHTS.binary_accuracy * binaryAvg +
    EVAL_QUALITY_WEIGHTS.pairwise_accuracy * pairwiseAccuracy

  const convWideAvg = (q1Score + q2Match + q3Match + q3FollowUpScore) / 4
  const panasScore = panasBaselineAdjusted !== null ? (panasBaselineAdjusted + 1.0) / 2.0 : 0.5

  const holistic =
    HOLISTIC_WEIGHTS.panas_prediction * panasScore +
    HOLISTIC_WEIGHTS.conv_wide_questions * convWideAvg +
    HOLISTIC_WEIGHTS.four_branch * fourBranchNormalized

  const composite =
    COMPOSITE_WEIGHTS.emotion_tracking * emotionBlended +
    COMPOSITE_WEIGHTS.evaluation_quality * evalQuality +
    COMPOSITE_WEIGHTS.holistic_comprehension * holistic

  return Math.round(composite * 100 * 100) / 100
}

/** 等权 Composite（0-100） */
export function computeEqualWeightComposite(turnLevelAvg: number, convWideAvg: number): number {
  return Math.round(((turnLevelAvg + convWideAvg) / 2) * 100 * 100) / 100
}

// ---------------------------------------------------------------------------
// 聚合与 z-score
// ---------------------------------------------------------------------------

function avg(values: number[]): number {
  return values.length > 0 ? mean(values) : 0.0
}

function se(values: number[]): number {
  if (values.length < 2) return 0.0
  const m = mean(values)
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance) / Math.sqrt(values.length)
}

/** 按 (em_model, mode) 分组聚合所有对话得分 */
export function aggregateConversations(scores: ConversationScore[]): AggregateResult[] {
  const groups = new Map<string, ConversationScore[]>()
  for (const s of scores) {
    const key = `${s.em_model}\u0000${s.mode}`
    const list = groups.get(key) ?? []
    list.push(s)
    groups.set(key, list)
  }

  const results: AggregateResult[] = []
  for (const [key, group] of groups) {
    const [model, mode] = key.split('\u0000')
    const n = group.length

    const pooledOm = poolBinaryMetrics(group.map((s) => s.pooled_binary_om_metrics))
    const pooledHuman = poolBinaryMetrics(group.map((s) => s.pooled_binary_human_metrics))

    const intensityVals = group
      .map((s) => s.avg_emotion_intensity_mae)
      .filter((v): v is number => v !== null)
    const tauVals = group
      .map((s) => s.avg_pairwise_kendall_tau)
      .filter((v): v is number => v !== null)
    const itemMaeVals = group
      .map((s) => s.post_score.panas_item_mae)
      .filter((v): v is number => v !== null)
    const taggedVals = group
      .map((s) => s.avg_emotion_hit_rate_tagged_only)
      .filter((v): v is number => v !== null)

    const draftJudgeVals = group
      .map((s) => s.avg_draft_judge_score)
      .filter((v): v is number => v !== null)
    const draftBinaryVals = group
      .map((s) => s.avg_draft_binary_alignment)
      .filter((v): v is number => v !== null)
    const panasItemNormVals = group
      .map((s) => s.post_score.panas_item_normalized)
      .filter((v): v is number => v !== null)

    results.push({
      em_model: model,
      mode,
      n_conversations: n,
      avg_emotion_hit_rate: avg(group.map((s) => s.avg_emotion_hit_rate)),
      avg_emotion_hit_rate_tagged_only: taggedVals.length > 0 ? mean(taggedVals) : null,
      avg_emotion_intensity_mae: intensityVals.length > 0 ? mean(intensityVals) : null,
      avg_emotion_f1: avg(group.map((s) => s.avg_emotion_f1)),
      avg_emotion_f1_intensity: avg(group.map((s) => s.avg_emotion_f1_intensity)),
      avg_emotion_va_score: avg(group.map((s) => s.avg_emotion_va_score)),
      avg_emotion_va_intensity_score: avg(group.map((s) => s.avg_emotion_va_intensity_score)),
      avg_binary_om_accuracy: avg(group.map((s) => s.avg_binary_om_accuracy)),
      avg_binary_human_accuracy: avg(group.map((s) => s.avg_binary_human_accuracy)),
      avg_binary_om_accuracy_hp: avg(group.map((s) => s.avg_binary_om_accuracy_hp)),
      avg_binary_human_accuracy_hp: avg(group.map((s) => s.avg_binary_human_accuracy_hp)),
      avg_pairwise_accuracy: avg(group.map((s) => s.avg_pairwise_accuracy)),
      avg_pairwise_kendall_tau: tauVals.length > 0 ? mean(tauVals) : null,
      avg_response_similarity: avg(group.map((s) => s.avg_response_similarity)),
      avg_response_similarity_original: avg(group.map((s) => s.avg_response_similarity_original)),
      avg_response_similarity_llm_improved: avg(group.map((s) => s.avg_response_similarity_llm_improved)),
      avg_response_similarity_human_edited: avg(group.map((s) => s.avg_response_similarity_human_edited)),
      avg_response_preference_alignment: avg(group.map((s) => s.avg_response_preference_alignment)),
      avg_draft_judge_score: draftJudgeVals.length > 0 ? mean(draftJudgeVals) : null,
      avg_draft_binary_alignment: draftBinaryVals.length > 0 ? mean(draftBinaryVals) : null,
      avg_four_branch_mae: avg(group.map((s) => s.post_score.four_branch_mae)),
      avg_panas_normalized: avg(group.map((s) => s.post_score.panas_normalized)),
      avg_panas_item_mae: itemMaeVals.length > 0 ? mean(itemMaeVals) : null,
      avg_panas_item_normalized: panasItemNormVals.length > 0 ? mean(panasItemNormVals) : null,
      avg_q1_looking_for_score: avg(group.map((s) => s.post_score.q1_looking_for_score)),
      avg_q2_emotion_clarity_match: avg(group.map((s) => s.post_score.q2_emotion_clarity_match)),
      avg_q3_model_fit_match: avg(group.map((s) => s.post_score.q3_model_fit_match)),
      avg_q3_model_fit_ordinal_distance: avg(group.map((s) => s.post_score.q3_model_fit_ordinal_distance)),
      avg_q3_follow_up_score: avg(group.map((s) => s.post_score.q3_follow_up_score)),
      avg_post_four_branch_normalized: avg(group.map((s) => s.post_score.four_branch_normalized)),
      pooled_binary_om_metrics: pooledOm,
      pooled_binary_human_metrics: pooledHuman,
      pooled_binary_om_metrics_hp: poolBinaryMetrics(group.map((s) => s.pooled_binary_om_metrics_hp)),
      pooled_binary_human_metrics_hp: poolBinaryMetrics(group.map((s) => s.pooled_binary_human_metrics_hp)),
      avg_hp_perspective_gap: avg(group.map((s) => s.hp_perspective_gap)),
      avg_hp_perspective_alignment: avg(group.map((s) => s.hp_perspective_alignment)),
      avg_hp_perspective_gap_mcc: avg(group.map((s) => s.hp_perspective_gap_mcc)),
      avg_hp_perspective_alignment_mcc: avg(group.map((s) => s.hp_perspective_alignment_mcc)),
      turn_level_average: avg(group.map((s) => s.turn_level_average)),
      conversation_wide_average: avg(group.map((s) => s.conversation_wide_average)),
      composite_score: avg(group.map((s) => s.composite_score)),
      equal_weight_composite: avg(group.map((s) => s.equal_weight_composite)),
      se_emotion_hit_rate: se(group.map((s) => s.avg_emotion_hit_rate)),
      se_binary_om_accuracy: se(group.map((s) => s.avg_binary_om_accuracy)),
      se_binary_human_accuracy: se(group.map((s) => s.avg_binary_human_accuracy)),
      se_pairwise_accuracy: se(group.map((s) => s.avg_pairwise_accuracy)),
      se_panas_normalized: se(group.map((s) => s.post_score.panas_normalized)),
      se_composite: se(group.map((s) => s.composite_score)),
      z_score: null,
    })
  }
  return results
}

/** 为所有 model×mode 组合计算 composite 的 z-score（原地修改并返回） */
export function computeZScores(results: AggregateResult[]): AggregateResult[] {
  const composites = results.map((r) => r.composite_score)
  if (composites.length < 2) {
    for (const r of results) r.z_score = 0.0
    return results
  }

  const m = mean(composites)
  const variance = composites.reduce((acc, v) => acc + (v - m) ** 2, 0) / (composites.length - 1)
  const stdev = Math.sqrt(variance)

  if (stdev === 0) {
    for (const r of results) r.z_score = 0.0
  } else {
    for (const r of results) {
      r.z_score = Math.round(((r.composite_score - m) / stdev) * 10000) / 10000
    }
  }
  return results
}
