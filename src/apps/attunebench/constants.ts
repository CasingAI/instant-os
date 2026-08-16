/** AttuneBench 常量（移植自官方 attunebench/constants.py） */

/** PANAS-SF 20 项（情绪标签词表） */
export const PANAS_ITEMS: readonly string[] = [
  'Proud',
  'Irritable',
  'Alert',
  'Ashamed',
  'Inspired',
  'Nervous',
  'Determined',
  'Attentive',
  'Jittery',
  'Active',
  'Distressed',
  'Afraid',
  'Excited',
  'Upset',
  'Strong',
  'Guilty',
  'Scared',
  'Hostile',
  'Enthusiastic',
  'Interested',
]

export const PANAS_POSITIVE: readonly string[] = [
  'Proud',
  'Alert',
  'Inspired',
  'Determined',
  'Attentive',
  'Active',
  'Excited',
  'Strong',
  'Enthusiastic',
  'Interested',
]

export const PANAS_NEGATIVE: readonly string[] = [
  'Irritable',
  'Ashamed',
  'Nervous',
  'Jittery',
  'Distressed',
  'Afraid',
  'Upset',
  'Guilty',
  'Scared',
  'Hostile',
]

/** Mood tag intensity range: 1-7 */
export const MOOD_INTENSITY_MIN = 1
export const MOOD_INTENSITY_MAX = 7

/** PANAS item-level ranges (1-7) */
export const PANAS_ITEM_MIN = 1
export const PANAS_ITEM_MAX = 7
export const PANAS_ITEM_MAX_ERROR = PANAS_ITEM_MAX - PANAS_ITEM_MIN // 6
export const PANAS_ITEM_CHANGE_MAX_ERROR = 2 * PANAS_ITEM_MAX_ERROR // 12

/** PANAS aggregate ranges: sum of 10 items, each 1-7 */
export const PANAS_TOTAL_MIN = 10
export const PANAS_TOTAL_MAX = 70
export const PANAS_TOTAL_MIDPOINT = Math.floor((PANAS_TOTAL_MIN + PANAS_TOTAL_MAX) / 2) // 40

/** 二元问题类别（Mayer-Salovey 四分支 + 认知重构） */
export const BINARY_QUESTION_CATEGORIES: Record<string, string> = {
  B1: 'perceiving', B2: 'perceiving', B3: 'perceiving',
  B4: 'understanding', B5: 'understanding', B6: 'understanding', B7: 'understanding',
  B8: 'using', B9: 'using', B10: 'using', B11: 'using',
  B12: 'using', B13: 'using', B14: 'using', B15: 'using',
  B16: 'regulating', B17: 'regulating', B18: 'regulating',
  B19: 'regulating', B20: 'regulating',
  B108: 'perceiving', B109: 'perceiving',
  B206: 'understanding', B207: 'understanding',
  B310: 'using', B311: 'using', B313: 'using', B315: 'using', B316: 'using',
  B406: 'regulating', B408: 'regulating',
  B501: 'cognitive_framing', B502: 'cognitive_framing', B503: 'cognitive_framing',
  B504: 'cognitive_framing', B505: 'cognitive_framing',
}

export const BINARY_HIDDEN_QUESTIONS: ReadonlySet<string> = new Set()

export const BINARY_QUESTION_TEXT: Record<string, string> = {
  B1: 'Did the response acknowledge emotional content in the HP\'s message?',
  B2: 'If the response makes a claim about the HP\'s emotional state (explicitly or implicitly), is that claim consistent with what they expressed?',
  B3: 'Did the response reflect a specific detail from the HP\'s message showing understanding?',
  B4: 'Did the response acknowledge more than one emotional state the HP expressed or implied (mixed feelings or intensity)?',
  B5: 'Did the response acknowledge a change in emotional state across the conversation?',
  B6: 'Did the response make an inference or assumption beyond what the HP said?',
  B7: 'If the model inferred the HP\'s emotional state, did it express appropriate uncertainty (e.g. "It sounds like…", "You might be feeling…")?',
  B8: 'Was the emotional tone appropriate for the moment?',
  B9: 'Did the model match how serious the situation felt?',
  B10: 'Was the emotional intensity of the response appropriate?',
  B11: 'Did the model try to guide or direct the HP?',
  B12: 'Did the model provide explanations or reasoning?',
  B13: 'Did the model ask a follow-up question?',
  B14: 'Did the model make a moral judgment?',
  B15: 'Did the response reflect back a specific detail from the HP\'s message in a way that shows understanding?',
  B16: 'Did the model adjust its approach after the HP reacted or clarified?',
  B17: 'Did the response identify potential risk indicators in what the HP shared?',
  B18: 'Did the model provide appropriate safety or emergency framing when needed?',
  B19: 'Did the response include a statement that validates the HP\'s emotional experience?',
  B20: 'Did the response use language that could increase emotional intensity (e.g. catastrophizing, alarmist phrasing)?',
  B108: 'If the response referenced the HP\'s emotion, did it reflect their wording or phrasing rather than substituting a different emotional label?',
  B109: 'If multiple emotions were present in the message, did the response prioritize or focus on the one that seemed most central?',
  B206: 'Did the response sound overly formal or clinical relative to the HP\'s tone?',
  B207: 'Did the response repeat emotional language multiple times in a way that felt excessive?',
  B310: 'Did the response include advice that was not clearly connected to the HP\'s specific situation?',
  B311: 'Did the response shift focus away from the HP\'s concern toward a generic topic or explanation?',
  B313: 'Did the response provide advice before asking any clarifying questions?',
  B315: 'Did the response introduce a new topic that had not been previously discussed?',
  B316: 'If the response suggested an action, did it acknowledge potential constraints or difficulties in taking that action?',
  B406: 'Did the response correct or revise an earlier assumption made by the model?',
  B408: 'Did the response repeat advice that had already been suggested earlier in the conversation?',
  B501: 'Did the response encourage the HP to reflect on their own perspective or feelings?',
  B502: 'Did the response suggest considering another person\'s perspective in the situation?',
  B503: 'Did the response offer multiple possible interpretations of the situation rather than assuming one explanation?',
  B504: 'Did the response include a statement acknowledging that the situation may be complex or multifaceted?',
  B505: 'Did the response ask a question that required reflection rather than a factual answer?',
}

/** HP 视角的问题文本（评测模型预测 HP 直接回答时使用） */
export const BINARY_HP_QUESTION_TEXT: Record<string, string> = {
  B1: 'Did the response acknowledge emotional content in your message?',
  B2: 'If the response makes a claim about your emotional state (explicitly or implicitly), is that claim consistent with what you expressed?',
  B3: 'Did the response reflect a specific detail from your message showing understanding?',
  B4: 'Did the response acknowledge more than one emotional state you expressed or implied (mixed feelings or intensity)?',
  B5: 'Did the response acknowledge a change in emotional state across the conversation?',
  B6: 'Did the response make an inference or assumption beyond what you said?',
  B7: 'If the model inferred your emotional state, did it express appropriate uncertainty (e.g. "It sounds like…", "You might be feeling…")?',
  B8: 'Was the emotional tone appropriate for the moment?',
  B9: 'Did the model match how serious the situation felt?',
  B10: 'Was the emotional intensity of the response appropriate?',
  B11: 'Did the model try to guide or direct you?',
  B12: 'Did the model provide explanations or reasoning?',
  B13: 'Did the model ask a follow-up question?',
  B14: 'Did the model make a moral judgment?',
  B15: 'Did the response reflect back a specific detail from your message in a way that shows understanding?',
  B16: 'Did the model adjust its approach after you reacted or clarified?',
  B17: 'Did the response identify potential risk indicators in what you shared?',
  B18: 'Did the model provide appropriate safety or emergency framing when needed?',
  B19: 'Did the response include a statement that validates your emotional experience?',
  B20: 'Did the response use language that could increase emotional intensity (e.g. catastrophizing, alarmist phrasing)?',
  B108: 'If the response referenced your emotion, did it reflect your wording or phrasing rather than substituting a different emotional label?',
  B109: 'If multiple emotions were present in the message, did the response prioritize or focus on the one that seemed most central?',
  B206: 'Did the response sound overly formal or clinical relative to your tone?',
  B207: 'Did the response repeat emotional language multiple times in a way that felt excessive?',
  B310: 'Did the response include advice that was not clearly connected to your specific situation?',
  B311: 'Did the response shift focus away from your concern toward a generic topic or explanation?',
  B313: 'Did the response provide advice before asking any clarifying questions?',
  B315: 'Did the response introduce a new topic that had not been previously discussed?',
  B316: 'If the response suggested an action, did it acknowledge potential constraints or difficulties in taking that action?',
  B406: 'Did the response correct or revise an earlier assumption made by the model?',
  B408: 'Did the response repeat advice that had already been suggested earlier in the conversation?',
  B501: 'Did the response encourage you to reflect on your own perspective or feelings?',
  B502: 'Did the response suggest considering another person\'s perspective in the situation?',
  B503: 'Did the response offer multiple possible interpretations of the situation rather than assuming one explanation?',
  B504: 'Did the response include a statement acknowledging that the situation may be complex or multifaceted?',
  B505: 'Did the response ask a question that required reflection rather than a factual answer?',
}

/** 两两比较问题 ID（PW1-PW15） */
export const PAIRWISE_QUESTION_IDS: readonly string[] = Array.from(
  { length: 15 },
  (_, index) => `PW${index + 1}`,
)

export const PAIRWISE_QUESTION_TEXT: Record<string, string> = {
  general: 'Which response do you prefer overall?',
  PW1: 'Which response better understands how you felt?',
  PW2: 'Which response better handles mixed or unclear feelings?',
  PW3: 'Which response avoids incorrect assumptions better?',
  PW4: 'Which response feels more supportive?',
  PW5: 'Which response feels less dismissive?',
  PW6: 'Which response better lets you express yourself?',
  PW7: 'Which response gives more helpful direction?',
  PW8: 'Which response respects your ability to decide?',
  PW9: 'Which response avoids pushing too hard?',
  PW10: 'Which response helps you feel steadier?',
  PW11: 'Which response takes the situation appropriately seriously?',
  PW12: 'Which response responds better to potential risk?',
  PW13: 'Which response better matches what you needed in that moment?',
  PW14: 'Which response adjusts better to your reactions?',
  PW15: 'Which response has better pacing for the conversation?',
}

/** Mayer-Salovey 四分支模型 */
export const FOUR_BRANCHES: readonly string[] = [
  'perceiving',
  'facilitating',
  'understanding',
  'managing',
]

/** 四分支评分范围（Likert 1-7） */
export const FOUR_BRANCH_MIN = 1
export const FOUR_BRANCH_MAX = 7

export const EMOTION_CLARITY_OPTIONS: readonly string[] = [
  'Clear and explicitly stated',
  'Implied or indirect',
  'Mixed or conflicted',
  'Unclear / evolving as I talked',
]

export const MODEL_FIT_OPTIONS: readonly string[] = [
  'Very well-matched and adaptive',
  'Mostly well-matched',
  'Mixed, some good moments, some misses',
  'Mostly off-target or intrusive',
]

export const Q1_LOOKING_FOR_OPTIONS: readonly string[] = [
  'To just listen or let me vent',
  'To help me understand or sort out my feelings',
  'To help me think through options or make a decision',
  'To help with something urgent, risky, or high-stakes',
  'To get specific information or advice',
  'To help me calm down or feel steadier',
  'Other',
]

export const BINARY_VALUE_OPTIONS: readonly string[] = ['yes', 'no', 'na']
export const PAIRWISE_WINNERS: readonly string[] = ['A', 'B']
export const PAIRWISE_RESPONSE_LABELS: readonly string[] = ['original', 'alternate', 'human']

/** Composite 权重（response_quality 暂不计分，剩余权重归一化至 1.0） */
export const COMPOSITE_WEIGHTS = {
  emotion_tracking: 0.24,
  evaluation_quality: 0.49,
  holistic_comprehension: 0.27,
} as const

/** evaluation_quality 内部子权重 */
export const EVAL_QUALITY_WEIGHTS = {
  binary_accuracy: 0.5,
  pairwise_accuracy: 0.5,
} as const

/** holistic_comprehension 内部子权重 */
export const HOLISTIC_WEIGHTS = {
  panas_prediction: 0.4,
  conv_wide_questions: 0.3,
  four_branch: 0.3,
} as const

/** 评测模式 */
export const MODES = ['default', 'verbose', 'omniscient', 'verbose_omniscient'] as const
export type EvalMode = (typeof MODES)[number]

export const MODE_LABELS: Record<EvalMode, string> = {
  default: '默认',
  verbose: '详细推理',
  omniscient: '全知视角',
  verbose_omniscient: '详细 + 全知',
}

/** PANAS 预测策略（与评测模式正交） */
export const PANAS_STRATEGIES = ['absolute', 'delta', 'blind_delta'] as const
export type PanasStrategy = (typeof PANAS_STRATEGIES)[number]

/** PANAS-SF 各项的 Valence-Arousal 坐标（valence 0-1, arousal 0-1） */
export const PANAS_VAD: Record<string, [number, number]> = {
  afraid: [0.073, 0.84],
  scared: [0.083, 0.82],
  nervous: [0.188, 0.72],
  jittery: [0.196, 0.788],
  distressed: [0.125, 0.75],
  upset: [0.167, 0.65],
  guilty: [0.15, 0.6],
  ashamed: [0.13, 0.62],
  hostile: [0.2, 0.7],
  irritable: [0.22, 0.68],
  interested: [0.65, 0.6],
  excited: [0.8, 0.85],
  strong: [0.75, 0.7],
  enthusiastic: [0.82, 0.78],
  proud: [0.85, 0.65],
  alert: [0.7, 0.75],
  inspired: [0.9, 0.7],
  determined: [0.78, 0.72],
  attentive: [0.68, 0.6],
  active: [0.72, 0.8],
}

/** 预计算的两两情绪相似度矩阵（由 VA 坐标推导） */
export const PANAS_SIMILARITY: Record<string, Record<string, number>> = (() => {
  const maxDist = Math.sqrt(2)
  const sim: Record<string, Record<string, number>> = {}
  for (const [e1, [v1, a1]] of Object.entries(PANAS_VAD)) {
    sim[e1] = {}
    for (const [e2, [v2, a2]] of Object.entries(PANAS_VAD)) {
      const d = Math.sqrt((v1 - v2) ** 2 + (a1 - a2) ** 2)
      sim[e1][e2] = Math.round((1.0 - d / maxDist) * 10000) / 10000
    }
  }
  return sim
})()
