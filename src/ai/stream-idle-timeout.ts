export const STREAM_IDLE_ERROR = 'STREAM_IDLE_TIMEOUT'

export function createStreamIdleTimeoutError(): Error {
  return new Error(STREAM_IDLE_ERROR)
}

export function isStreamIdleTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message === STREAM_IDLE_ERROR
}

function createAbortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

export type StreamIdleAbortSession = {
  /** 合并了外部取消与空闲超时的信号；两者皆无时为 undefined */
  signal: AbortSignal | undefined
  resetIdleTimer: () => void
  clearIdleTimer: () => void
  dispose: () => void
}

/**
 * 将外部 AbortSignal 与空闲超时合并为一个 signal。
 * 收到任意流式分片时应调用 resetIdleTimer；结束时 dispose。
 */
export function createStreamIdleAbortSession(options: {
  idleTimeoutMs?: number
  externalSignal?: AbortSignal
}): StreamIdleAbortSession {
  const idleTimeoutMs = options.idleTimeoutMs ?? 0
  const externalSignal = options.externalSignal
  const needsAbort = idleTimeoutMs > 0 || Boolean(externalSignal)

  if (!needsAbort) {
    return {
      signal: undefined,
      resetIdleTimer: () => {},
      clearIdleTimer: () => {},
      dispose: () => {},
    }
  }

  const abortController = new AbortController()

  if (externalSignal?.aborted) {
    const reason = externalSignal.reason
    if (reason instanceof Error) {
      abortController.abort(reason)
    } else {
      abortController.abort(createAbortError())
    }
  }

  const onExternalAbort = () => {
    if (abortController.signal.aborted) return
    const reason = externalSignal?.reason
    if (reason instanceof Error) {
      abortController.abort(reason)
      return
    }
    abortController.abort(createAbortError())
  }
  if (externalSignal && !externalSignal.aborted) {
    externalSignal.addEventListener('abort', onExternalAbort)
  }

  let idleTimer: ReturnType<typeof setTimeout> | undefined

  const clearIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer)
    }
    idleTimer = undefined
  }

  const resetIdleTimer = () => {
    if (idleTimeoutMs <= 0 || abortController.signal.aborted) {
      return
    }
    clearIdleTimer()
    idleTimer = setTimeout(() => {
      if (!abortController.signal.aborted) {
        abortController.abort(createStreamIdleTimeoutError())
      }
    }, idleTimeoutMs)
  }

  return {
    signal: abortController.signal,
    resetIdleTimer,
    clearIdleTimer,
    dispose: () => {
      clearIdleTimer()
      externalSignal?.removeEventListener('abort', onExternalAbort)
    },
  }
}

/** 从 abort 相关错误中归一化空闲超时（保留 reason） */
export function resolveStreamIdleTimeoutError(
  error: unknown,
  signal?: AbortSignal,
): Error | undefined {
  if (isStreamIdleTimeoutError(error)) {
    return createStreamIdleTimeoutError()
  }
  const reason = signal?.aborted && signal.reason instanceof Error ? signal.reason : undefined
  if (isStreamIdleTimeoutError(reason)) {
    return createStreamIdleTimeoutError()
  }
  return undefined
}
