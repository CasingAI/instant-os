import type OpenAI from 'openai'
import type { TokenUsageSnapshot } from '../apps/browser/browser-token-usage.ts'
import { recordAiEventLog } from './ai-event-log.ts'
import type { AiEventLogMessage } from './ai-event-log-types.ts'
import { serializeCompletionResponse } from './ai-event-log-serialize.ts'
import { recordAiTokenUsage, type AiUsageContext } from './ai-token-usage.ts'

export type OpenAiUsageLike = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export function snapshotFromOpenAiUsage(
  usage: OpenAiUsageLike | null | undefined,
): TokenUsageSnapshot | undefined {
  if (!usage) {
    return undefined
  }

  const promptTokens = usage.prompt_tokens ?? 0
  const completionTokens = usage.completion_tokens ?? 0
  const totalTokens = usage.total_tokens ?? promptTokens + completionTokens
  if (totalTokens <= 0) {
    return undefined
  }

  return { promptTokens, completionTokens, totalTokens }
}

export function recordOpenAiCompletionUsage(
  response: OpenAI.Chat.ChatCompletion,
  context: AiUsageContext,
  log?: {
    model?: string
    thinkingEnabled?: boolean
    messages?: AiEventLogMessage[]
  },
): void {
  const usage = snapshotFromOpenAiUsage(response.usage)
  recordAiTokenUsage(context, usage)
  if (log?.messages?.length) {
    recordAiEventLog(context, {
      model: log.model,
      thinkingEnabled: log.thinkingEnabled,
      messages: log.messages,
      response: serializeCompletionResponse(response),
      usage,
    })
  }
}
