/** AttuneBench 提示词构建器（移植自官方 attunebench/prompts.py） */

import {
  BINARY_HIDDEN_QUESTIONS,
  BINARY_HP_QUESTION_TEXT,
  BINARY_QUESTION_TEXT,
  EMOTION_CLARITY_OPTIONS,
  FOUR_BRANCHES,
  MODEL_FIT_OPTIONS,
  PAIRWISE_QUESTION_TEXT,
  PANAS_ITEMS,
  PANAS_POSITIVE,
  Q1_LOOKING_FOR_OPTIONS,
} from './constants.ts'
import type { ConversationData, Turn } from './types.ts'

export type Emessage = { role: 'system' | 'user' | 'assistant'; content: string }

function jsonDump(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function buildJudgeSystemPrompt(): Emessage {
  return {
    role: 'system',
    content:
      'You are an expert evaluator assessing the quality of AI responses ' +
      'in emotional support conversations. Respond with valid JSON only. ' +
      'No additional text outside the JSON.',
  }
}

export function buildSystemPrompt(mode: string): Emessage {
  const verbose = mode === 'verbose' || mode === 'verbose_omniscient'
  const omniscient = mode === 'omniscient' || mode === 'verbose_omniscient'

  const parts: string[] = [
    'You are an expert in emotional intelligence evaluation. You are stepping through ',
    'a conversation between a Human Participant (HP) and an Original Model (OM), one turn ',
    'at a time.',
    '',
    'Each turn has up to three steps:',
    '1. You see the HP message and draft your own response.',
    '2. You see the OM response, then predict the HP\'s emotions and make binary assessments.',
    '3. You see alternate responses and make pairwise preference predictions.',
    '',
    'IMPORTANT: You must respond with valid JSON only. No additional text outside the JSON.',
  ]

  if (verbose) {
    parts.push(
      '',
      'VERBOSE MODE: Provide a reasoning trace to justify your choices. ',
      'Cite information directly from the content, including the userMessage and/or llmResponse. ',
      'This can include specific terms, phrasing, or any other information that informed your ratings/responses. ',
      'When prompted to draft your own response, include an explanation of why you think the content/tone of the drafted message is appropriate. ',
      'When prompted to predict the user\'s emotions, explain why you think this is how the user feels. ',
      'When prompted to evaluate the OM\'s responses, explain why you think the content/tone of the model response is or is not appropriate.',
    )
  }

  if (omniscient) {
    parts.push(
      '',
      'OMNISCIENT MODE: You have access to additional background information that you ',
      'would not normally see. Specifically, you will be shown the participant\'s ',
      'demographic profile, their pre-conversation PANAS scores (state of mind ',
      'before the conversation), and their self-reported attitude toward the ',
      'conversation topic (if available). Use this context to inform your predictions.',
    )
  }

  return { role: 'system', content: parts.join('\n') }
}

// ---------------------------------------------------------------------------
// Call 1: HP draft
// ---------------------------------------------------------------------------

function isOmniscient(mode: string): boolean {
  return mode === 'omniscient' || mode === 'verbose_omniscient'
}

export function buildHpTurnPrompt(
  turn: Turn,
  conversation: ConversationData,
  turnIndex: number,
  mode: string,
): Emessage {
  const verbose = mode === 'verbose' || mode === 'verbose_omniscient'
  const omniscient = isOmniscient(mode)

  const parts: string[] = []

  if (omniscient && turnIndex === 0) {
    parts.push('## Background Information (Omniscient Context)', '')
    if (conversation.participant_profile) {
      const profile = conversation.participant_profile
      const profileData: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(profile)) {
        if (key === 'responses') profileData.responses = value
        else profileData[key] = value
      }
      const nonNull = Object.fromEntries(
        Object.entries(profileData).filter(
          ([, value]) => value !== null && value !== undefined && value !== '',
        ),
      )
      if (Object.keys(nonNull).length > 0) {
        parts.push('**Participant Profile:**', jsonDump(nonNull), '')
      }
    }
    const prePanas = conversation.prePanas
    if (prePanas) {
      const preDict = toPanasDict(prePanas)
      if (Object.values(preDict).some((v) => v !== null)) {
        parts.push('**Pre-Conversation PANAS (state of mind before the conversation):**', jsonDump(preDict), '')
      }
    }
    parts.push('Use this background information to inform your analysis throughout the conversation.', '', '---', '')
  }

  parts.push(
    `## Turn ${turn.turnNumber} — Step 1: Draft Response`,
    '',
    '**Human Participant says:**',
    `"${turn.userMessage}"`,
    '',
    'Draft your own response to the HP as if you were the OM. ',
    'Do not attempt to predict emotions yet — that comes after you see the OM response.',
    '',
    'IMPORTANT: Ensure all double-quote characters within string values are escaped as \\".',
    '',
    'Respond with JSON in exactly this format:',
    '```json',
  )

  const responseSchema: Record<string, unknown> = {
    drafted_response: '<your response to the HP as if you were the OM>',
  }
  if (verbose) {
    responseSchema.response_reasoning =
      '<reasoning trace: why you think the content/tone of your drafted message is appropriate>'
  }

  parts.push(jsonDump(responseSchema), '```')

  return { role: 'user', content: parts.join('\n') }
}

// ---------------------------------------------------------------------------
// Call 2: OM review
// ---------------------------------------------------------------------------

/**
 * 判定本轮适用的二元判断题（与官方 `_binary_applicable_ids` 一致）：
 * `(obs is None and pref is None) or (obs not in (None,'na') or pref not in (None,'na'))`
 */
export function binaryApplicableIds(turn: Turn): string[] {
  return turn.annotations.binaryJudgements
    .filter((bj) => {
      if (BINARY_HIDDEN_QUESTIONS.has(bj.questionId)) return false
      const obs = bj.observedBehavior
      const pref = bj.preferredBehavior
      const obsIsNone = obs === null
      const prefIsNone = pref === null
      const obsHasValue = !obsIsNone && obs !== 'na'
      const prefHasValue = !prefIsNone && pref !== 'na'
      return (obsIsNone && prefIsNone) || obsHasValue || prefHasValue
    })
    .map((bj) => bj.questionId)
}

export function buildOmResponsePrompt(turn: Turn, mode: string): Emessage {
  const verbose = mode === 'verbose' || mode === 'verbose_omniscient'
  const applicableIds = binaryApplicableIds(turn)
  const applicableSet = new Set(applicableIds)
  const naIds = turn.annotations.binaryJudgements
    .filter((bj) => !BINARY_HIDDEN_QUESTIONS.has(bj.questionId) && !applicableSet.has(bj.questionId))
    .map((bj) => bj.questionId)

  const parts: string[] = [
    `## Turn ${turn.turnNumber} — Step 2: Emotion Analysis & Binary Assessment`,
    '',
    '**Human Participant said:**',
    `"${turn.userMessage}"`,
    '',
    '**Original Model (OM) responded:**',
    `"${turn.llmResponse}"`,
    '',
    'Now that you have seen both the HP message and the OM response, analyze the ',
    'emotional content and assess the OM response quality.',
    '',
    'Tag the emotion(s) the HP is experiencing using **only** the 20 PANAS-SF items ',
    'below. Do NOT use any other emotion words — only these 20 items are valid:',
    PANAS_ITEMS.join(', '),
    '',
    'If the HP shows no clear emotional shift or is in a neutral/stable state, ',
    'output an empty list: "emotion_tags": []',
    '',
    'IMPORTANT: Ensure all double-quote characters within string values are escaped as \\".',
    '',
    'Respond with JSON in exactly this format:',
    '```json',
  ]

  const responseSchema: Record<string, unknown> = {
    emotion_tags: [
      { emotion: '<MUST be one of the 20 PANAS items above>', intensity: '<1-7 integer or null>' },
    ],
  }

  if (verbose) {
    responseSchema.emotion_reasoning = '<reasoning trace: why you think this is how the user feels>'
  }

  if (applicableIds.length > 0) {
    responseSchema.binary_om_assessment = Object.fromEntries(applicableIds.map((qid) => [qid, '<yes|no>']))
    responseSchema.binary_human_prediction = Object.fromEntries(applicableIds.map((qid) => [qid, '<yes|no>']))
  }

  parts.push(jsonDump(responseSchema), '```')

  if (applicableIds.length > 0) {
    parts.push(
      '',
      '**Binary Judgments (IMPORTANT DISTINCTION):**',
      '',
      'For each question, provide two answers:',
      '',
      '1. binary_om_assessment:',
      '   Did the OM actually exhibit this behavior? Answer factually.',
      "   - Answer 'yes' if the behavior occurred",
      "   - Answer 'no' if it did not occur",
      '',
      '2. binary_human_prediction:',
      "   Based on the HP's emotional state and apparent needs, predict whether",
      '   the HP would have answered yes or no to this question.',
      '',
      'These two answers can differ if the behavior occurred but was unwanted,',
      "or if it was wanted but didn't occur.",
      '',
      jsonDump(
        applicableIds.map((qid) => ({
          questionId: qid,
          question: BINARY_QUESTION_TEXT[qid] ?? qid,
        })),
      ),
    )
  }

  if (naIds.length > 0) {
    parts.push(
      '',
      `The following questions are NOT APPLICABLE for this turn (skip them): ${naIds.join(', ')}`,
    )
  }

  return { role: 'user', content: parts.join('\n') }
}

export function buildBinaryHpPrompt(turn: Turn, mode: string): Emessage | null {
  void mode
  const applicableIds = binaryApplicableIds(turn)
  if (applicableIds.length === 0) return null

  const parts: string[] = [
    `## Turn ${turn.turnNumber} — HP-Perspective Binary`,
    '',
    'Answer the binary questions again, but this time using the exact questions',
    'the human participant was asked directly about this response.',
    '',
    'For each question, provide two answers:',
    '',
    '1. binary_om_assessment:',
    '   Did the OM actually exhibit this behavior? Answer factually.',
    "   - Answer 'yes' if the behavior occurred",
    "   - Answer 'no' if it did not occur",
    '',
    '2. binary_human_prediction:',
    '   Predict how the human participant answered this exact question.',
    '',
    'These two answers can differ. Example — if the model gave unwanted advice:',
    "- binary_om_assessment = 'yes'  (it DID give advice)",
    "- binary_human_prediction = 'no' (the human answered 'no' — they did not want advice)",
    '',
    'Respond with JSON:',
    '```json',
  ]

  const responseSchema: Record<string, unknown> = {
    binary_om_assessment: Object.fromEntries(applicableIds.map((qid) => [qid, '<yes|no>'])),
    binary_human_prediction: Object.fromEntries(applicableIds.map((qid) => [qid, '<yes|no>'])),
  }
  parts.push(jsonDump(responseSchema), '```')
  parts.push(
    '',
    jsonDump(
      applicableIds.map((qid) => ({
        questionId: qid,
        question: BINARY_HP_QUESTION_TEXT[qid] ?? BINARY_QUESTION_TEXT[qid] ?? qid,
      })),
    ),
  )

  return { role: 'user', content: parts.join('\n') }
}

// ---------------------------------------------------------------------------
// Call 3: Pairwise
// ---------------------------------------------------------------------------

function responseTextForLabel(turn: Turn, label: string): string {
  const normalized = label.trim().toLowerCase()
  const alternates = turn.annotations.alternateResponses

  if (normalized === 'original') return turn.llmResponse
  if ((normalized === 'alternate' || normalized === 'alternate1') && alternates) {
    return alternates.llmImproved
  }
  if ((normalized === 'human' || normalized === 'alternate2' || normalized === 'humanedited') && alternates) {
    return alternates.humanEdited
  }
  return ''
}

function pairwiseQuestionText(questionId: string): string {
  if (questionId.startsWith('custom:')) {
    return questionId.split('custom:', 1)[1]?.trim() || questionId
  }
  return PAIRWISE_QUESTION_TEXT[questionId] ?? questionId
}

function maskLabel(label: string): string {
  const normalized = label.trim().toLowerCase()
  if (normalized === 'original') return 'original'
  if (normalized === 'alternate' || normalized === 'llmimproved') return 'alternate1'
  if (normalized === 'human' || normalized === 'humanedited') return 'alternate2'
  return label
}

export function buildPairwisePrompt(turn: Turn, mode: string): Emessage {
  void mode
  const pairwiseItems = turn.annotations.pairwiseComparisons.map((pw, i) => ({
    comparisonId: String(i),
    questionId: pw.questionId,
    question: pairwiseQuestionText(pw.questionId),
    responseA_label: maskLabel(pw.responseA),
    responseA_text: responseTextForLabel(turn, pw.responseA),
    responseB_label: maskLabel(pw.responseB),
    responseB_text: responseTextForLabel(turn, pw.responseB),
  }))

  const parts: string[] = [
    `## Turn ${turn.turnNumber} — Step 3: Pairwise Comparison`,
    '',
    '**Human Participant said:**',
    `"${turn.userMessage}"`,
    '',
    '**Original Model response:**',
    `"${turn.llmResponse}"`,
  ]

  const alternates = turn.annotations.alternateResponses
  if (alternates) {
    parts.push(
      '',
      '**Alternate responses:**',
      jsonDump({
        alternate1: alternates.llmImproved,
        alternate2: alternates.humanEdited,
      }),
    )
  }

  parts.push(
    '',
    'The human participant was asked each question below directly about these responses. ',
    'For each pair, predict how they answered by selecting A or B. ',
    'Note that A and B assignments differ across questions — read each pair carefully.',
    '',
    jsonDump(pairwiseItems),
    '',
    'Respond with JSON in exactly this format:',
    '```json',
  )

  const responseSchema: Record<string, unknown> = {
    pairwise_selections: Object.fromEntries(
      pairwiseItems.map((item) => [item.comparisonId, '<A|B>']),
    ),
  }
  parts.push(jsonDump(responseSchema), '```')

  return { role: 'user', content: parts.join('\n') }
}

// ---------------------------------------------------------------------------
// Post-conversation
// ---------------------------------------------------------------------------

export function toPanasDict(panas: {
  totalPositiveAffect: number | null
  totalNegativeAffect: number | null
}): Record<string, number | null> {
  return {
    totalPositiveAffect: panas.totalPositiveAffect,
    totalNegativeAffect: panas.totalNegativeAffect,
  }
}

export function buildPostConversationPrompt(
  conversation: ConversationData,
  panasStrategy: string = 'absolute',
): Emessage {
  const preDict = toPanasDict(conversation.prePanas)

  const panasItemsList = PANAS_ITEMS.map(
    (item) => `  - ${item} (${PANAS_POSITIVE.includes(item) ? 'positive' : 'negative'})`,
  ).join('\n')

  const parts: string[] = [
    '## Post-Conversation Assessment',
    '',
    'You have now reviewed the entire conversation. Please make the following predictions.',
    '',
  ]

  let panasSchema: Record<string, unknown>
  if (panasStrategy === 'blind_delta') {
    parts.push(
      'Based on the conversation you\'ve observed, predict how the HP\'s emotional ',
      'state changed. You do NOT have access to their pre-conversation scores.',
      '',
      '1. **PANAS Change**: Predict how each of the 20 PANAS-SF items changed ',
      '(positive or negative integer for each).',
      '',
      'The 20 PANAS-SF items (each rated 1-7):',
      panasItemsList,
      '',
    )
    panasSchema = {
      predicted_panas_delta: {
        items: Object.fromEntries(PANAS_ITEMS.map((item) => [item, '<integer change, e.g. +1 or -2>'])),
      },
    }
  } else if (panasStrategy === 'delta') {
    parts.push(
      '**HP\'s Pre-Conversation PANAS totals (state of mind BEFORE the conversation):**',
      jsonDump(preDict),
      '',
      'Based on the conversation you\'ve observed, predict how the HP\'s emotional ',
      'state changed from pre to post conversation.',
      '',
      '1. **PANAS Change**: Predict how each of the 20 PANAS-SF items changed ',
      '(positive or negative integer for each).',
      '',
      'The 20 PANAS-SF items (each rated 1-7):',
      panasItemsList,
      '',
    )
    panasSchema = {
      predicted_panas_delta: {
        items: Object.fromEntries(PANAS_ITEMS.map((item) => [item, '<integer change, e.g. +1 or -2>'])),
      },
    }
  } else {
    parts.push(
      '**HP\'s Pre-Conversation PANAS totals (state of mind BEFORE the conversation):**',
      jsonDump(preDict),
      '',
      'Based on the conversation you\'ve observed, predict the HP\'s emotional state ',
      'AFTER the conversation.',
      '',
      '1. **Post-PANAS**: Predict each of the 20 PANAS-SF items individually (1-7 each). ',
      'Aggregate totals will be derived from your item-level predictions.',
      '',
      'The 20 PANAS-SF items (each rated 1-7):',
      panasItemsList,
      '',
    )
    panasSchema = {
      predicted_post_panas: {
        items: Object.fromEntries(PANAS_ITEMS.map((item) => [item, '<1-7>'])),
      },
    }
  }

  parts.push(
    '2. **Conversation-Wide Questions**:',
    '   - q1_lookingFor: What was the human participant looking for from this conversation? ',
    `Select all that apply from: ${Q1_LOOKING_FOR_OPTIONS.join(', ')}`,
    '   - q2_emotionClarity: How clearly did the model understand their emotions? ',
    `Choose one of: ${EMOTION_CLARITY_OPTIONS.join(', ')}`,
    '   - q3_modelFit: Overall model fit for the conversation. ',
    `Choose one of: ${MODEL_FIT_OPTIONS.join(', ')}`,
    '   - q3_followUp_whatFeltOff: If the fit was mixed or off-target, what felt off? ',
    '(list of strings, any number of items)',
    '   - fourBranchScores: Rate each of the four branches on a 1-7 scale using the definitions below:',
    '       * perceiving: The model\'s ability to identify the current emotional state of the human.',
    '       * facilitating: The model\'s ability to consider the human\'s emotional state and the overall ',
    'emotional context of the conversation when problem solving, reasoning, and crafting responses.',
    '       * understanding: The model\'s ability to understand how the human\'s emotions might combine, ',
    'change and manifest over time. Beyond the human\'s current emotional state, how does the model predict ',
    'this might change based on different directions the conversation and situation could develop.',
    '       * managing: The model\'s ability to invoke and convey emotions clearly and appropriately. ',
    'Does the model respond to the human in a manner that seems thoughtful?',
    '',
    'Respond with JSON:',
    '```json',
  )

  const responseSchema = {
    ...panasSchema,
    conversation_wide: {
      q1_lookingFor: ['<option from the list above>'],
      q2_emotionClarity: '<one option>',
      q3_modelFit: '<one option>',
      q3_followUp_whatFeltOff: ['<issue1>'],
      fourBranchScores: Object.fromEntries(FOUR_BRANCHES.map((branch) => [branch, '<1-7 score>'])),
    },
  }
  parts.push(jsonDump(responseSchema), '```')

  return { role: 'user', content: parts.join('\n') }
}

// ---------------------------------------------------------------------------
// Draft Judge
// ---------------------------------------------------------------------------

export function buildCombinedJudgePrompt(
  turn: Turn,
  emDraftedResponse: string,
): Emessage {
  const hasReference = Boolean(turn.annotations.alternateResponses?.humanEdited)
  const humanEdited = hasReference ? turn.annotations.alternateResponses!.humanEdited : ''

  const applicableIds = turn.annotations.binaryJudgements
    .filter(
      (bj) =>
        !BINARY_HIDDEN_QUESTIONS.has(bj.questionId) &&
        ((bj.observedBehavior === null && bj.preferredBehavior === null) ||
          bj.observedBehavior !== null ||
          bj.preferredBehavior !== null),
    )
    .filter(
      (bj) =>
        bj.observedBehavior !== null &&
        bj.preferredBehavior !== null &&
        bj.observedBehavior !== 'na' &&
        bj.preferredBehavior !== 'na' ||
        (bj.observedBehavior !== null && bj.observedBehavior !== 'na') ||
        (bj.preferredBehavior !== null && bj.preferredBehavior !== 'na') ||
        (bj.observedBehavior === null && bj.preferredBehavior === null),
    )
    .map((bj) => bj.questionId)

  const parts: string[] = [
    '## Response Evaluation',
    '',
    '**Human Participant (HP) said:**',
    `"${turn.userMessage}"`,
    '',
    '**Drafted Response:**',
    `"${emDraftedResponse}"`,
    '',
  ]

  const responseSchema: Record<string, unknown> = {}

  if (hasReference) {
    parts.push(
      '**Human-Edited Reference Response:**',
      `"${humanEdited}"`,
      '',
      '### Part 1: Quality Scores',
      'Rate the drafted response on each dimension using a 1-7 scale ',
      '(1 = very poor match, 7 = excellent match) relative to the human-edited reference.',
      '',
      '- **overall_score**: Overall quality and intent match',
      '- **emotional_appropriateness**: Recognizes and responds to HP\'s emotional state appropriately',
      '- **helpfulness**: Addresses HP\'s needs as effectively as the reference',
      '- **tone_match**: Matches warmth, formality, directness, and empathy of the reference',
      '',
    )
    responseSchema.overall_score = '<1-7>'
    responseSchema.emotional_appropriateness = '<1-7>'
    responseSchema.helpfulness = '<1-7>'
    responseSchema.tone_match = '<1-7>'
  }

  if (applicableIds.length > 0) {
    parts.push(
      `### Part ${hasReference ? '2' : '1'}: Binary Assessment`,
      'For each question below, answer yes or no based on whether the drafted response ',
      'exhibits the described behavior.',
      '',
      jsonDump(
        applicableIds.map((qid) => ({
          questionId: qid,
          question: BINARY_QUESTION_TEXT[qid] ?? qid,
        })),
      ),
      '',
    )
    responseSchema.draft_binary_assessment = Object.fromEntries(
      applicableIds.map((qid) => [qid, '<yes|no>']),
    )
  }

  parts.push('```json', jsonDump(responseSchema), '```')

  return { role: 'user', content: parts.join('\n') }
}
