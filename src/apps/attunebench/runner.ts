/** AttuneBench 单对话状态流 runner（移植自官方 attunebench/runner.py） */

import { PANAS_ITEM_MAX, PANAS_ITEM_MIN, PANAS_ITEMS, PANAS_NEGATIVE, PANAS_POSITIVE, PANAS_TOTAL_MIDPOINT } from './constants.ts'
import { callEm } from './client.ts'
import {
  binaryApplicableIds,
  buildBinaryHpPrompt,
  buildCombinedJudgePrompt,
  buildHpTurnPrompt,
  buildJudgeSystemPrompt,
  buildOmResponsePrompt,
  buildPairwisePrompt,
  buildPostConversationPrompt,
  buildSystemPrompt,
  type Emessage,
} from './prompts.ts'
import type {
  ConversationData,
  EMRunOutput,
  EMPostConversation,
  EMTurnResult,
  MoodShiftTag,
} from './types.ts'
import { clampPanasTotal, normalizeBinaryValue, normalizePairwiseWinner } from './utils.ts'

export type RunConversationOptions = {
  modelRefKey: string
  mode: string
  panasStrategy?: string
  maxTokens?: number
  judgeModelRefKey?: string | null
  signal?: AbortSignal
  onProgress?: (turnNumber: number, message: string) => void
}

// ---------------------------------------------------------------------------
// 解析函数
// ---------------------------------------------------------------------------

function parseEmotionTags(data: Record<string, unknown>): MoodShiftTag[] {
  const panasLower = new Set(PANAS_ITEMS.map((item) => item.toLowerCase()))
  const tags: MoodShiftTag[] = []
  const raw = data.emotion_tags
  if (Array.isArray(raw)) {
    for (const tag of raw) {
      if (typeof tag !== 'object' || tag === null) continue
      const record = tag as Record<string, unknown>
      if (typeof record.emotion !== 'string') continue
      const normalized = record.emotion.trim().toLowerCase()
      if (['neutral/no change', 'neutral', 'no change'].includes(normalized)) continue
      if (!panasLower.has(normalized)) continue
      const intensityVal = record.intensity
      let intensity: number | null = null
      if (typeof intensityVal === 'number') {
        intensity = Math.max(PANAS_ITEM_MIN, Math.min(PANAS_ITEM_MAX, Math.round(intensityVal)))
      } else if (typeof intensityVal === 'string' && intensityVal.trim() !== '' && intensityVal.trim().toLowerCase() !== 'null') {
        const parsed = Number(intensityVal)
        if (Number.isFinite(parsed)) {
          intensity = Math.max(PANAS_ITEM_MIN, Math.min(PANAS_ITEM_MAX, Math.round(parsed)))
        }
      }
      tags.push({ emotion: record.emotion, intensity })
    }
  }
  return tags
}

function parseBinary(data: Record<string, unknown>, key: string): Record<string, string> {
  const result: Record<string, string> = {}
  const section = data[key]
  if (typeof section === 'object' && section !== null && !Array.isArray(section)) {
    for (const [qid, val] of Object.entries(section as Record<string, unknown>)) {
      const normalized = normalizeBinaryValue(val)
      if (normalized !== null) result[qid] = normalized
    }
  }
  return result
}

function parsePairwise(
  data: Record<string, unknown>,
  pairwiseAssignment?: Record<string, Record<string, string>>,
): Record<string, string> {
  const result: Record<string, string> = {}
  const section = data.pairwise_selections
  if (typeof section === 'object' && section !== null && !Array.isArray(section)) {
    for (const [qid, val] of Object.entries(section as Record<string, unknown>)) {
      let normalized = normalizePairwiseWinner(val)
      if (normalized === null && pairwiseAssignment && val !== null && val !== undefined) {
        const text = String(val).trim().toLowerCase()
        // 将掩码标签映射回内部标签
        const maskedToInternal: Record<string, string> = {
          alternate1: 'alternate',
          alternate2: 'human',
          original: 'original',
        }
        const resolved = maskedToInternal[text] ?? text
        const assignment = pairwiseAssignment[qid] ?? {}
        for (const [letter, label] of Object.entries(assignment)) {
          if (label.trim().toLowerCase() === resolved) {
            normalized = letter as 'A' | 'B'
            break
          }
        }
      }
      if (normalized !== null) result[qid] = normalized
    }
  }
  return result
}

function parsePanas(data: Record<string, unknown>) {
  const panasData = (data.predicted_post_panas ?? {}) as Record<string, unknown>

  const items: Record<string, number> = {}
  const itemsSection =
    typeof panasData.items === 'object' && panasData.items !== null
      ? (panasData.items as Record<string, unknown>)
      : {}
  for (const [itemName, val] of Object.entries(itemsSection)) {
    const parsed = Number(val)
    if (Number.isFinite(parsed)) {
      const normalized = itemName.trim()
      const needsTitle = !PANAS_ITEMS.includes(normalized)
      const key = needsTitle ? itemName.trim().charAt(0).toUpperCase() + itemName.trim().slice(1) : normalized
      items[key] = Math.max(PANAS_ITEM_MIN, Math.min(PANAS_ITEM_MAX, Math.round(parsed)))
    }
  }

  let totalPositiveAffect = clampPanasTotal(panasData.totalPositiveAffect, PANAS_TOTAL_MIDPOINT)
  let totalNegativeAffect = clampPanasTotal(panasData.totalNegativeAffect, PANAS_TOTAL_MIDPOINT)

  // 若聚合缺失但从 items 可推导
  if (Object.keys(items).length > 0 && totalPositiveAffect === null) {
    const paSum = PANAS_POSITIVE.reduce(
      (sum, item) => sum + (items[item] ?? 0),
      0,
    )
    if (paSum > 0) totalPositiveAffect = paSum
  }
  if (Object.keys(items).length > 0 && totalNegativeAffect === null) {
    const naSum = PANAS_NEGATIVE.reduce(
      (sum, item) => sum + (items[item] ?? 0),
      0,
    )
    if (naSum > 0) totalNegativeAffect = naSum
  }

  return {
    totalPositiveAffect:
      totalPositiveAffect === null ? null : clampPanasTotal(totalPositiveAffect),
    totalNegativeAffect:
      totalNegativeAffect === null ? null : clampPanasTotal(totalNegativeAffect),
    items,
  }
}

function parseConvWide(data: Record<string, unknown>): import('./types.ts').ConversationWideQuestions {
  const cw = (typeof data.conversation_wide === 'object' && data.conversation_wide !== null
    ? data.conversation_wide
    : {}) as Record<string, unknown>

  const q1 = Array.isArray(cw.q1_lookingFor)
    ? cw.q1_lookingFor.filter((item): item is string => typeof item === 'string')
    : []
  const q2 = typeof cw.q2_emotionClarity === 'string' ? cw.q2_emotionClarity : ''
  const q3 = typeof cw.q3_modelFit === 'string' ? cw.q3_modelFit : ''
  const q3ff = Array.isArray(cw.q3_followUp_whatFeltOff)
    ? cw.q3_followUp_whatFeltOff.filter((item): item is string => typeof item === 'string')
    : []

  const fourBranch: Record<string, number> = {}
  const fourBranchRaw =
    typeof cw.fourBranchScores === 'object' && cw.fourBranchScores !== null
      ? (cw.fourBranchScores as Record<string, unknown>)
      : {}
  for (const [branch, val] of Object.entries(fourBranchRaw)) {
    const parsed = Number(val)
    if (Number.isFinite(parsed)) fourBranch[branch] = parsed
  }

  return {
    q1_lookingFor: q1,
    q2_emotionClarity: q2,
    q3_modelFit: q3,
    q3_followUp_whatFeltOff: q3ff,
    fourBranchScores: fourBranch,
  }
}

// ---------------------------------------------------------------------------
// 主 runner
// ---------------------------------------------------------------------------

export async function runConversation(
  conversation: ConversationData,
  options: RunConversationOptions,
): Promise<EMRunOutput> {
  const {
    modelRefKey,
    mode,
    panasStrategy = 'absolute',
    maxTokens,
    judgeModelRefKey,
    signal,
    onProgress,
  } = options
  const startTime = Date.now()

  const messages: Emessage[] = [buildSystemPrompt(mode)]
  const turnResults: EMTurnResult[] = []

  for (let i = 0; i < conversation.turns.length; i += 1) {
    const turn = conversation.turns[i]
    onProgress?.(turn.turnNumber, `处理第 ${turn.turnNumber} 轮`)

    // --- Call 1: HP draft ---
    const hpPrompt = buildHpTurnPrompt(turn, conversation, i, mode)
    messages.push(hpPrompt)
    const draftResponse = await callEm({
      messages,
      modelRefKey,
      maxTokens,
      signal,
    })
    const draftedResponse =
      typeof draftResponse.drafted_response === 'string' ? draftResponse.drafted_response : null
    const responseReasoning =
      typeof draftResponse.response_reasoning === 'string'
        ? draftResponse.response_reasoning
        : null

    messages.push({ role: 'assistant', content: '{"_elided": "previous draft omitted to save tokens"}' })

    // --- Call 1b+c: Combined judge (optional) ---
    const emDraftJudgeScores: Record<string, number> = {}
    const emDraftJudgeScoresByModel: Record<string, Record<string, number>> = {}
    const emDraftBinaryAssessment: Record<string, string> = {}
    const emDraftBinaryAssessmentByModel: Record<string, Record<string, string>> = {}

    const applicableBinaryIds = binaryApplicableIds(turn)
    const hasReference = Boolean(turn.annotations.alternateResponses?.humanEdited)
    if (judgeModelRefKey && draftedResponse && (hasReference || applicableBinaryIds.length > 0)) {
      const combinedPrompt = buildCombinedJudgePrompt(turn, draftedResponse)
      const messagesCombined: Emessage[] = [buildJudgeSystemPrompt(), combinedPrompt]
      const scoreAccum: Record<string, number[]> = {}
      const binaryVotes: Record<string, string[]> = {}
      try {
        const judgeResponse = await callEm({
          messages: messagesCombined,
          modelRefKey: judgeModelRefKey,
          maxTokens,
          signal,
        })
        const perModel: Record<string, number> = {}
        const scoreKeys = ['overall_score', 'emotional_appropriateness', 'helpfulness', 'tone_match']
        for (const key of scoreKeys) {
          if (key in judgeResponse) {
            const val = Number(judgeResponse[key])
            if (Number.isFinite(val)) {
              perModel[key] = val
              const acc = scoreAccum[key] ?? []
              acc.push(val)
              scoreAccum[key] = acc
            }
          }
        }
        if (Object.keys(perModel).length > 0) {
          emDraftJudgeScoresByModel[judgeModelRefKey] = perModel
        }
        const perModelBin = parseBinary(judgeResponse, 'draft_binary_assessment')
        if (Object.keys(perModelBin).length > 0) {
          emDraftBinaryAssessmentByModel[judgeModelRefKey] = perModelBin
        }
        for (const [k, v] of Object.entries(perModelBin)) {
          const votes = binaryVotes[k] ?? []
          votes.push(v)
          binaryVotes[k] = votes
        }
        for (const [k, v] of Object.entries(scoreAccum)) {
          if (v.length > 0) emDraftJudgeScores[k] = v.reduce((a, b) => a + b, 0) / v.length
        }
        for (const [k, votes] of Object.entries(binaryVotes)) {
          const counts: Record<string, number> = {}
          for (const v of votes) counts[v] = (counts[v] ?? 0) + 1
          // 与官方一致：max(counts, key=(count, val != "no"))——平局偏好非 'no'
          let majority = 'no'
          let bestCount = -1
          for (const [val, count] of Object.entries(counts)) {
            if (count > bestCount || (count === bestCount && val !== 'no')) {
              majority = val
              bestCount = count
            }
          }
          emDraftBinaryAssessment[k] = majority
        }
      } catch {
        // judge 调用失败则跳过
      }
    }

    // --- Call 2: OM response → emotion tags + binary ---
    const omPrompt = buildOmResponsePrompt(turn, mode)
    messages.push(omPrompt)
    const omResponse = await callEm({
      messages,
      modelRefKey,
      maxTokens,
      signal,
    })
    messages.push({ role: 'assistant', content: '{"_elided": "previous analysis omitted to save tokens"}' })

    const emotionTags = parseEmotionTags(omResponse)
    const emotionReasoning =
      typeof omResponse.emotion_reasoning === 'string' ? omResponse.emotion_reasoning : null
    const binaryOm = parseBinary(omResponse, 'binary_om_assessment')
    const binaryHuman = parseBinary(omResponse, 'binary_human_prediction')

    // --- Call 2b: HP-facing binary (out-of-thread) ---
    let binaryOmHp: Record<string, string> = {}
    let binaryHumanHp: Record<string, string> = {}
    const hpBinaryPrompt = buildBinaryHpPrompt(turn, mode)
    if (hpBinaryPrompt !== null) {
      try {
        const hpBinaryResponse = await callEm({
          messages: [...messages, hpBinaryPrompt],
          modelRefKey,
          maxTokens,
          signal,
        })
        binaryOmHp = parseBinary(hpBinaryResponse, 'binary_om_assessment')
        binaryHumanHp = parseBinary(hpBinaryResponse, 'binary_human_prediction')
      } catch {
        // HP 二元调用失败则保留空
      }
    }

    // --- Call 3: Pairwise ---
    const hasPairwise = turn.annotations.pairwiseComparisons.length > 0
    const pairwiseAssignment: Record<string, Record<string, string>> = {}
    for (let pwi = 0; pwi < turn.annotations.pairwiseComparisons.length; pwi += 1) {
      const pw = turn.annotations.pairwiseComparisons[pwi]
      pairwiseAssignment[String(pwi)] = { A: pw.responseA, B: pw.responseB }
    }

    let pairwise: Record<string, string> = {}
    if (hasPairwise) {
      const pwPrompt = buildPairwisePrompt(turn, mode)
      try {
        const pwResponse = await callEm(
          {
            messages: [...messages, pwPrompt],
            modelRefKey,
            maxTokens,
            signal,
          },
          3,
          (d: Record<string, unknown>) => 'pairwise_selections' in d,
        )
        pairwise = parsePairwise(pwResponse, pairwiseAssignment)
      } catch {
        pairwise = {}
      }
    }

    turnResults.push({
      turnNumber: turn.turnNumber,
      em_emotion_tags: emotionTags,
      em_drafted_response: draftedResponse,
      response_reasoning: responseReasoning,
      emotion_reasoning: emotionReasoning,
      pairwise_assignment: pairwiseAssignment,
      em_binary_om_assessment: binaryOm as EMTurnResult['em_binary_om_assessment'],
      em_binary_human_prediction: binaryHuman as EMTurnResult['em_binary_human_prediction'],
      em_binary_om_assessment_hp: binaryOmHp as EMTurnResult['em_binary_om_assessment_hp'],
      em_binary_human_prediction_hp: binaryHumanHp as EMTurnResult['em_binary_human_prediction_hp'],
      em_pairwise_selections: pairwise as EMTurnResult['em_pairwise_selections'],
      em_four_branch_scores: {},
      em_draft_judge_scores: emDraftJudgeScores,
      em_draft_judge_scores_by_model: emDraftJudgeScoresByModel,
      em_draft_binary_assessment: emDraftBinaryAssessment,
      em_draft_binary_assessment_by_model: emDraftBinaryAssessmentByModel,
    })
  }

  // --- Post-conversation ---
  onProgress?.(999, '对话后评估')
  const postPrompt = buildPostConversationPrompt(conversation, panasStrategy)
  messages.push(postPrompt)
  const postResponse = await callEm({
    messages,
    modelRefKey,
    maxTokens,
    signal,
  })

  const predictedConversationWide = parseConvWide(postResponse)

  let predictedPostPanas: ReturnType<typeof parsePanas>
  let predictedPanasDelta: Record<string, number> = {}
  if (panasStrategy === 'delta' || panasStrategy === 'blind_delta') {
    const deltaData = (postResponse.predicted_panas_delta ?? {}) as Record<string, unknown>
    const itemDeltas: Record<string, number> = {}
    const itemsSection =
      typeof deltaData.items === 'object' && deltaData.items !== null
        ? (deltaData.items as Record<string, unknown>)
        : {}
    for (const [itemName, val] of Object.entries(itemsSection)) {
      const parsed = Number(val)
      if (Number.isFinite(parsed)) {
        const key = itemName.trim().charAt(0).toUpperCase() + itemName.trim().slice(1)
        itemDeltas[key] = Math.round(parsed)
      }
    }
    const aggregateDelta: Record<string, number> = {
      totalPositiveAffect_change: Number(deltaData.totalPositiveAffect_change) || 0,
      totalNegativeAffect_change: Number(deltaData.totalNegativeAffect_change) || 0,
    }
    predictedPanasDelta = aggregateDelta

    const pre = conversation.prePanas
    const predictedItems: Record<string, number> = {}
    if (Object.keys(pre.items).length > 0 && Object.keys(itemDeltas).length > 0) {
      for (const [itemName, delta] of Object.entries(itemDeltas)) {
        const preVal = pre.items[itemName] ?? 3
        predictedItems[itemName] = Math.max(
          PANAS_ITEM_MIN,
          Math.min(PANAS_ITEM_MAX, preVal + delta),
        )
      }
    }
    predictedPostPanas = {
      totalPositiveAffect: clampPanasTotal(
        (pre.totalPositiveAffect ?? PANAS_TOTAL_MIDPOINT) + aggregateDelta.totalPositiveAffect_change,
      ),
      totalNegativeAffect: clampPanasTotal(
        (pre.totalNegativeAffect ?? PANAS_TOTAL_MIDPOINT) + aggregateDelta.totalNegativeAffect_change,
      ),
      items: predictedItems,
    }
  } else {
    predictedPostPanas = parsePanas(postResponse)
  }

  const postConv: EMPostConversation = {
    panas_strategy: panasStrategy,
    pre_panas_shown:
      panasStrategy !== 'blind_delta'
        ? conversation.prePanas
        : { totalPositiveAffect: null, totalNegativeAffect: null, items: {} },
    predicted_post_panas: predictedPostPanas,
    predicted_panas_delta: predictedPanasDelta,
    predicted_conversation_wide: predictedConversationWide,
  }

  const durationSeconds = (Date.now() - startTime) / 1000

  return {
    conversationId: conversation.conversationId,
    source_file: `conversation_${conversation.conversationId}.json`,
    em_model: modelRefKey,
    run_timestamp: new Date().toISOString(),
    mode,
    turns: turnResults,
    post_conversation: postConv,
    api_cost: null,
    duration_seconds: Math.round(durationSeconds * 10) / 10,
  }
}
