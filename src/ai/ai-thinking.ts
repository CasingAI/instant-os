import type OpenAI from 'openai'
import {
  findAiModelPreset,
  isAiReasoningEffort,
  isMimoUltraSpeedModel,
  REASONING_EFFORTS_BINARY,
  type AiProviderId,
  type AiReasoningEffort,
} from './ai-providers.ts'

export type { AiReasoningEffort } from './ai-providers.ts'
export {
  AI_REASONING_EFFORT_PRESETS,
  REASONING_EFFORTS_BINARY,
  REASONING_EFFORTS_DEEPSEEK_V4,
  REASONING_EFFORTS_GLM,
  REASONING_EFFORTS_LOW_MED_HIGH,
  REASONING_EFFORTS_OPENAI_FULL,
  REASONING_EFFORTS_OPENAI_GPT54,
  isAiReasoningEffort,
} from './ai-providers.ts'

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

/**
 * 传给 OpenAI SDK create() 的 thinking 扩展字段。
 * 运行时仍可发送 DeepSeek 等兼容端的 `max`；SDK 的 ReasoningEffort 不含该字面量，故对外收窄为 SDK 类型。
 */
export type ThinkingRequestParam = {
  thinking: { type: 'enabled' | 'disabled' }
  /** OpenAI 标准推理力度；未设置则不传，走模型默认 */
  reasoning_effort?: OpenAI.ReasoningEffort
}

/** 小米语音识别 / 合成不支持 thinking 参数 */
const THINKING_UNSUPPORTED_MODEL_IDS = new Set([
  'mimo-v2.5-asr',
  'mimo-v2.5-tts',
  'doubao-seed-asr-2.0',
  'doubao-seed-tts-2.0',
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

/**
 * 解析模型支持的思考深度档位。
 * - `null`：未知/自定义，展示完整通用列表
 * - `[]`：仅支持开/关，不展示深度选择
 * - 非空：仅展示这些档位
 */
export function listSupportedReasoningEfforts(
  providerId?: AiProviderId,
  modelId?: string,
): readonly AiReasoningEffort[] | null {
  if (!providerId || !modelId) return null
  if (!supportsThinkingParam(providerId, modelId)) {
    return REASONING_EFFORTS_BINARY
  }
  const preset = findAiModelPreset(providerId, modelId)
  if (preset && preset.reasoningEfforts !== undefined) {
    return preset.reasoningEfforts
  }
  if (providerId === 'custom') return null
  // 内置但未标注时，保守：不展示虚假的全量 OpenAI 档位
  return REASONING_EFFORTS_BINARY
}

export function modelSupportsReasoningEffortPicker(
  providerId?: AiProviderId,
  modelId?: string,
): boolean {
  const efforts = listSupportedReasoningEfforts(providerId, modelId)
  return efforts === null || efforts.length > 0
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
  if (
    providerId === 'deepseek' ||
    providerId === 'mimo' ||
    providerId === 'mimo-token-plan' ||
    providerId === 'ark-coding-plan' ||
    providerId === 'ark-agent-plan'
  ) {
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
    const supported = listSupportedReasoningEfforts(providerId, modelId)
    if (supported === null || supported.includes(thinkingEffort)) {
      // DeepSeek 等扩展档位（如 max）不在 OpenAI SDK ReasoningEffort 联合内，运行时原样发送
      extras.reasoning_effort = thinkingEffort as OpenAI.ReasoningEffort
    }
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
