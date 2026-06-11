function createAbortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

export function throwIfStreamAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createAbortError()
  }
}

export function isStreamAbortError(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
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
    return Promise.reject(createAbortError())
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(createAbortError())
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

export async function forEachStreamChunk<T>(
  stream: AsyncIterable<T>,
  onChunk: (chunk: T) => void,
  signal?: AbortSignal,
): Promise<void> {
  throwIfStreamAborted(signal)
  const iterator = stream[Symbol.asyncIterator]()

  try {
    while (true) {
      throwIfStreamAborted(signal)
      const next = await raceWithAbortSignal(iterator.next(), signal)
      if (next.done) {
        break
      }
      onChunk(next.value)
    }
  } finally {
    await iterator.return?.()
  }
}
