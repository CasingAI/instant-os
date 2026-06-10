import { buildThinkingRequestExtras, readStreamDelta } from './ai-thinking.ts'
import { mergeOpenAiConfig } from './openai-config.ts'
import { getOpenAiClient } from './openai-client.ts'

export type StreamChatActivity = 'reasoning' | 'content'

export type StreamChatOptions = {
  system: string
  user: string
  onChunk: (delta: string, accumulated: string) => void
  /** 覆盖账户里的思考模式开关 */
  thinkingEnabled?: boolean
  /** 超过该毫秒数未收到任何流式分片则中断（不是总生成时长上限） */
  idleTimeoutMs?: number
  onStreamActivity?: (kind: StreamChatActivity) => void
  /** 每收到一个流式分片（含空分片）时调用，用于刷新「仍在传输」状态 */
  onAnyStreamChunk?: () => void
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
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.user },
      ],
      ...buildThinkingRequestExtras(config.providerId, thinkingEnabled),
      ...(abortController ? { signal: abortController.signal } : {}),
    })

    resetIdleTimer()

    let text = ''

    for await (const chunk of stream) {
      resetIdleTimer()
      options.onAnyStreamChunk?.()

      const { reasoning, content } = readStreamDelta(chunk.choices[0]?.delta)
      if (reasoning) {
        options.onStreamActivity?.('reasoning')
        continue
      }
      if (!content) {
        continue
      }

      options.onStreamActivity?.('content')
      text += content
      options.onChunk(content, text)
    }

    if (!text.trim()) {
      throw new Error('AI 未返回任何内容')
    }

    return text.trim()
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
