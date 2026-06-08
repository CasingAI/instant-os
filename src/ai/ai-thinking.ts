import type { AiProviderId } from './ai-providers.ts'

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

export type DeepSeekThinkingParam = {
  thinking: { type: 'enabled' | 'disabled' }
}

/** 微应用生成时 DeepSeek 始终启用思维链，不受账户设置影响。 */
export function resolveAppGenerationThinkingEnabled(
  providerId: AiProviderId | undefined,
  thinkingEnabled: boolean,
): boolean {
  if (providerId === 'deepseek') {
    return true
  }
  return thinkingEnabled
}

/** DeepSeek V4 要求 thinking 作为请求体顶层字段；Python SDK 的 extra_body 在 TS SDK 中无效。 */
export function buildThinkingRequestExtras(
  providerId: AiProviderId | undefined,
  thinkingEnabled: boolean,
): DeepSeekThinkingParam | Record<string, never> {
  if (providerId !== 'deepseek') {
    return {}
  }

  return {
    thinking: { type: thinkingEnabled ? 'enabled' : 'disabled' },
  }
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
