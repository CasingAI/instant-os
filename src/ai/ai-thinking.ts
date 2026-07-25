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
}

export function supportsThinkingParam(providerId: AiProviderId | undefined): boolean {
  return providerId === 'deepseek' || providerId === 'mimo' || providerId === 'mimo-token-plan'
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

/** DeepSeek / MiMo 要求 thinking 作为请求体顶层字段；Python SDK 的 extra_body 在 TS SDK 中无效。 */
export function buildThinkingRequestExtras(
  providerId: AiProviderId | undefined,
  thinkingEnabled: boolean,
): ThinkingRequestParam | Record<string, never> {
  if (!supportsThinkingParam(providerId)) {
    return {}
  }

  return {
    thinking: { type: thinkingEnabled ? 'enabled' : 'disabled' },
  }
}

/** 多轮工具调用时是否须在 assistant 消息上回传 reasoning_content */
export function providerRequiresReasoningContentEcho(
  providerId: AiProviderId | undefined,
): boolean {
  return supportsThinkingParam(providerId)
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
