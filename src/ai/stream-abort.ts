import type OpenAI from 'openai'
import { isStreamIdleTimeoutError } from './stream-idle-timeout.ts'

function createAbortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

function rejectReasonFromSignal(signal: AbortSignal): Error {
  const reason = signal.reason
  if (reason instanceof Error) {
    return reason
  }
  return createAbortError()
}

/** OpenAI SDK 的 signal 须在 create 第二参数，不能放进 body */
export function createChatCompletionStream(
  client: OpenAI,
  body: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
  signal?: AbortSignal,
) {
  return client.chat.completions.create(body, signal ? { signal } : undefined)
}

export function throwIfStreamAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw rejectReasonFromSignal(signal)
  }
}

/** 用户取消（不含空闲超时） */
export function isStreamAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (isStreamIdleTimeoutError(error)) {
    return false
  }
  if (signal?.aborted === true) {
    if (isStreamIdleTimeoutError(signal.reason)) {
      return false
    }
    return true
  }
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

export function raceWithAbortSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) {
    return promise
  }

  if (signal.aborted) {
    return Promise.reject(rejectReasonFromSignal(signal))
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(rejectReasonFromSignal(signal))
    }

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
    }

    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}

type AbortableStream<T> = AsyncIterable<T> & {
  controller?: AbortController
}

export async function forEachStreamChunk<T>(
  stream: AbortableStream<T>,
  onChunk: (chunk: T) => void,
  signal?: AbortSignal,
): Promise<void> {
  throwIfStreamAborted(signal)
  const iterator = stream[Symbol.asyncIterator]()

  const abortStreamController = () => {
    if (!stream.controller || stream.controller.signal.aborted) return
    stream.controller.abort()
  }

  if (signal) {
    if (signal.aborted) {
      abortStreamController()
      throw rejectReasonFromSignal(signal)
    }
    signal.addEventListener('abort', abortStreamController, { once: true })
  }

  try {
    while (true) {
      throwIfStreamAborted(signal)
      const next = await raceWithAbortSignal(iterator.next(), signal)
      if (next.done) {
        break
      }
      onChunk(next.value)
    }
    throwIfStreamAborted(signal)
  } catch (error) {
    abortStreamController()
    throw error
  } finally {
    signal?.removeEventListener('abort', abortStreamController)
    try {
      await iterator.return?.()
    } catch {
      // 流已因 abort 关闭时忽略 return 错误
    }
  }
}
