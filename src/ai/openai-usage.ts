import type OpenAI from 'openai'
import { finishAiEventLogSession, recordAiEventLog, type AiEventLogSessionHandle } from './ai-event-log.ts'
import type { AiEventLogMessage } from './ai-event-log-types.ts'
import { serializeCompletionResponse } from './ai-event-log-serialize.ts'
import type { AiEventLogTimingInput } from './ai-event-log-timing.ts'
import { recordAiTokenUsage, type AiUsageContext } from './ai-token-usage.ts'
import { snapshotFromOpenAiUsage } from './openai-usage-snapshot.ts'

export type { OpenAiUsageLike } from './openai-usage-snapshot.ts'
export { snapshotFromOpenAiUsage } from './openai-usage-snapshot.ts'

export function recordOpenAiCompletionUsage(
  response: OpenAI.Chat.ChatCompletion,
  context: AiUsageContext,
  log?: {
    model?: string
    thinkingEnabled?: boolean
    messages?: AiEventLogMessage[]
    timing?: AiEventLogTimingInput
    session?: AiEventLogSessionHandle
  },
): void {
  const usage = snapshotFromOpenAiUsage(response.usage)
  recordAiTokenUsage(context, usage)

  if (log?.session) {
    finishAiEventLogSession(log.session, context, {
      response: serializeCompletionResponse(response),
      usage,
      usageEstimated: false,
      status: 'success',
    })
    return
  }

  if (log?.messages?.length) {
    recordAiEventLog(context, {
      model: log.model,
      thinkingEnabled: log.thinkingEnabled,
      messages: log.messages,
      response: serializeCompletionResponse(response),
      usage,
      timing: log.timing,
    })
  }
}
