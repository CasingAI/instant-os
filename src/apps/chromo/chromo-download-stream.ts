function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return
  }
  if (typeof signal.throwIfAborted === 'function') {
    signal.throwIfAborted()
  }
  throw Object.assign(new Error('aborted'), { name: 'AbortError' })
}

export type ChromoDownloadStreamWriter = {
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<unknown>
  abort(): Promise<void>
}

export async function* readResponseBodyChunks(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<Uint8Array> {
  const body = response.body
  if (!body) {
    const buffer = new Uint8Array(await response.arrayBuffer())
    if (buffer.byteLength > 0) {
      yield buffer
    }
    return
  }

  const reader = body.getReader()
  try {
    while (true) {
      throwIfAborted(signal)
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (value && value.byteLength > 0) {
        yield value
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // ignore
    }
  }
}

/**
 * 边收边写。失败 / 取消必须 `abort()`，不要把 chunks 攒成完整 ArrayBuffer。
 */
export async function pipeChunksToStreamWriter(
  writer: ChromoDownloadStreamWriter,
  source: AsyncIterable<Uint8Array>,
  options?: {
    signal?: AbortSignal
    onProgress?: (received: number) => void
    progressIntervalMs?: number
  },
): Promise<number> {
  const interval = options?.progressIntervalMs ?? 160
  let received = 0
  let lastReport = 0
  const report = (force = false) => {
    if (!options?.onProgress) {
      return
    }
    const now = Date.now()
    if (!force && now - lastReport < interval) {
      return
    }
    lastReport = now
    options.onProgress(received)
  }

  try {
    throwIfAborted(options?.signal)
    report(true)
    for await (const chunk of source) {
      throwIfAborted(options?.signal)
      if (!chunk.byteLength) {
        continue
      }
      await writer.write(chunk)
      received += chunk.byteLength
      report()
    }
    report(true)
    await writer.close()
    return received
  } catch (error) {
    await writer.abort().catch(() => undefined)
    throw error
  }
}
