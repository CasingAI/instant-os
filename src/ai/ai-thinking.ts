import { isMimoUltraSpeedModel, type AiProviderId } from './ai-providers.ts'

export type StreamTextDelta = {
  reasoning: string
  content: string
}

type ChatCompletionDelta = {
  content?: string | null
  reasoning_content?: string | null
}

export function readStreamDelta(delta: ChatCompletionDelta | null | undefined): StreamTextDelta {
  return {
    reasoning: delta?.reasoning_content ?? '',
    content: delta?.content ?? '',
  }
}

export function totalStreamTextLength(reasoningText: string, contentText: string): number {
  return reasoningText.length + contentText.length
}

export type ThinkingRequestParam = {
  thinking: { type: 'enabled' | 'disabled' }
  /** OpenAI 标准推理力度；未设置则不传，走模型默认 */
  reasoning_effort?: AiReasoningEffort
}

/** OpenAI reasoning_effort 常用档位（模型实际支持集可能更窄） */
export const AI_REASONING_EFFORT_PRESETS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const

export type AiReasoningEffort = (typeof AI_REASONING_EFFORT_PRESETS)[number]

export function isAiReasoningEffort(value: unknown): value is AiReasoningEffort {
  return (
    typeof value === 'string' &&
    (AI_REASONING_EFFORT_PRESETS as readonly string[]).includes(value)
  )
}

/** 小米语音识别 / 合成不支持 thinking 参数 */
const THINKING_UNSUPPORTED_MODEL_IDS = new Set([
  'mimo-v2.5-asr',
  'mimo-v2.5-tts',
])

/**
 * 是否支持深度思考请求参数。
 * 默认支持（含用户自建与各内置文本模型）；仅排除小米 ASR/TTS。
 */
export function supportsThinkingParam(
  _providerId?: AiProviderId,
  modelId?: string,
): boolean {
  const id = modelId?.trim().toLowerCase()
  if (id && THINKING_UNSUPPORTED_MODEL_IDS.has(id)) {
    return false
  }
  return true
}

/** 微应用生成时 DeepSeek / MiMo 始终启用思维链，不受账户设置影响；UltraSpeed 尊重用户设置以保留极速优势。 */
export function resolveAppGenerationThinkingEnabled(
  providerId: AiProviderId | undefined,
  thinkingEnabled: boolean,
  modelId?: string,
): boolean {
  if (modelId && isMimoUltraSpeedModel(modelId)) {
    return thinkingEnabled
  }
  if (providerId === 'deepseek' || providerId === 'mimo' || providerId === 'mimo-token-plan') {
    return true
  }
  return thinkingEnabled
}

/** 兼容端与多数供应商使用 thinking 顶层字段；语音模型不传。 */
export function buildThinkingRequestExtras(
  providerId: AiProviderId | undefined,
  thinkingEnabled: boolean,
  modelId?: string,
  thinkingEffort?: AiReasoningEffort | 'default' | undefined,
): ThinkingRequestParam | Record<string, never> {
  if (!supportsThinkingParam(providerId, modelId)) {
    return {}
  }

  const extras: ThinkingRequestParam = {
    thinking: { type: thinkingEnabled ? 'enabled' : 'disabled' },
  }
  if (
    thinkingEnabled &&
    thinkingEffort &&
    thinkingEffort !== 'default' &&
    isAiReasoningEffort(thinkingEffort)
  ) {
    extras.reasoning_effort = thinkingEffort
  }
  return extras
}

/** 多轮工具调用时是否须在 assistant 消息上回传 reasoning_content */
export function providerRequiresReasoningContentEcho(
  providerId: AiProviderId | undefined,
  modelId?: string,
): boolean {
  return supportsThinkingParam(providerId, modelId)
}

export function resolveAppGenerationPhase(
  reasoningText: string,
  contentText: string,
  streamStarted: boolean,
): 'waiting' | 'thinking' | 'generating' {
  if (contentText.length > 0) {
    return 'generating'
  }
  if (reasoningText.length > 0) {
    return 'thinking'
  }
  return streamStarted ? 'generating' : 'waiting'
}
