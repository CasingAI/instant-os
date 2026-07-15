import { formatStreamEventResponse } from './ai-event-log-serialize.ts'
import { buildThinkingRequestExtras, readStreamDelta } from './ai-thinking.ts'
import { recordAiEventLog } from './ai-event-log.ts'
import type { AiEventLogMessage } from './ai-event-log-types.ts'
import type { AiUsageContext } from './ai-usage-context.ts'
import { snapshotFromOpenAiUsage } from './openai-usage.ts'
import { recordAiTokenUsage } from './ai-token-usage.ts'
import { mergeOpenAiConfig } from './openai-config.ts'
import { getOpenAiClient } from './openai-client.ts'

export type StreamChatActivity = 'reasoning' | 'content'

export type StreamChatTurn = {
  role: 'user' | 'assistant'
  content: string
}

export type StreamChatOptions = {
  system: string
  user: string
  /** 首条 user 之后的对话轮次（assistant / user 交替） */
  followUp?: StreamChatTurn[]
  onChunk: (delta: string, accumulated: string) => void
  /** 思考链增量（若模型返回 reasoning_content） */
  onReasoningChunk?: (delta: string, accumulated: string) => void
  /** 覆盖账户里的思考模式开关 */
  thinkingEnabled?: boolean
  /** 超过该毫秒数未收到任何流式分片则中断（不是总生成时长上限） */
  idleTimeoutMs?: number
  onStreamActivity?: (kind: StreamChatActivity) => void
  /** 每收到一个流式分片（含空分片）时调用，用于刷新「仍在传输」状态 */
  onAnyStreamChunk?: () => void
  /** 记录到全局 AI 用量统计 */
  usageContext?: AiUsageContext
  /** API 最大输出 token 数（默认不设，使用模型默认上限） */
  maxCompletionTokens?: number
}

const STREAM_IDLE_ERROR = 'STREAM_IDLE_TIMEOUT'

export function isStreamIdleTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message === STREAM_IDLE_ERROR
}

export async function streamChatCompletion(options: StreamChatOptions): Promise<string> {
  const config = mergeOpenAiConfig()
  const client = getOpenAiClient(config)
  const model = config.defaultModel
  const thinkingEnabled = options.thinkingEnabled ?? config.thinkingEnabled
  const idleTimeoutMs = options.idleTimeoutMs ?? 0
  const abortController = idleTimeoutMs > 0 ? new AbortController() : undefined

  let idleTimer: ReturnType<typeof setTimeout> | undefined

  const resetIdleTimer = () => {
    if (!abortController || idleTimeoutMs <= 0) {
      return
    }
    if (idleTimer) {
      clearTimeout(idleTimer)
    }
    idleTimer = setTimeout(() => {
      abortController.abort(new Error(STREAM_IDLE_ERROR))
    }, idleTimeoutMs)
  }

  const clearIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = undefined
    }
  }

  try {
    const stream = await client.chat.completions.create({
      model,
      stream: true,
      ...(options.usageContext ? { stream_options: { include_usage: true } } : {}),
      ...(options.maxCompletionTokens !== undefined
        ? { max_tokens: options.maxCompletionTokens }
        : {}),
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.user },
        ...(options.followUp ?? []),
      ],
      ...buildThinkingRequestExtras(config.providerId, thinkingEnabled),
      ...(abortController ? { signal: abortController.signal } : {}),
    })

    resetIdleTimer()

    let text = ''
    let reasoningText = ''
    let usage: ReturnType<typeof snapshotFromOpenAiUsage>
    let finishReason: string | undefined

    for await (const chunk of stream) {
      resetIdleTimer()
      options.onAnyStreamChunk?.()

      const chunkUsage = snapshotFromOpenAiUsage(chunk.usage)
      if (chunkUsage) {
        usage = chunkUsage
      }

      const { reasoning, content } = readStreamDelta(chunk.choices[0]?.delta)
      if (reasoning) {
        options.onStreamActivity?.('reasoning')
        reasoningText += reasoning
        options.onReasoningChunk?.(reasoning, reasoningText)
        continue
      }
      if (!content) {
        continue
      }

      options.onStreamActivity?.('content')
      text += content
      options.onChunk(content, text)
      finishReason = chunk.choices[0]?.finish_reason || finishReason
    }

    if (!text.trim()) {
      throw new Error('AI 未返回任何内容')
    }

    const trimmed = text.trim()
    if (options.usageContext) {
      recordAiTokenUsage(options.usageContext, usage)
      const messages: AiEventLogMessage[] = [
        { role: 'system', content: options.system },
        { role: 'user', content: options.user },
        ...(options.followUp ?? []),
      ]
      recordAiEventLog(options.usageContext, {
        model,
        thinkingEnabled,
        messages,
        response: formatStreamEventResponse(reasoningText, trimmed),
        usage,
      })
    }

    if (finishReason === 'length') {
      throw new Error(
        `AI 输出被截断：达到 token 上限（${options.maxCompletionTokens ?? '模型默认'}）。全文 ${trimmed.length} 字符，最后 100 字符：…${trimmed.slice(-100)}`,
      )
    }

    return trimmed
  } catch (error) {
    if (abortController?.signal.aborted && abortController.signal.reason instanceof Error) {
      throw abortController.signal.reason
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(STREAM_IDLE_ERROR)
    }
    throw error
  } finally {
    clearIdleTimer()
  }
}
