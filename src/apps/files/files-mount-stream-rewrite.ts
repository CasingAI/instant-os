/**
 * 挂载卷大文件按偏移改写 / 无 move 重命名：按块泵送，不把整份正文装进 ArrayBuffer。
 * 用户授权目录没有 SyncAccessHandle，只能读原文件流 → 写临时文件 → 替换。
 */

export const MOUNT_STREAM_COPY_CHUNK_SIZE = 4 << 20
const ZERO_CHUNK_MAX = 64 << 10

export type MountByteSink = (chunk: Uint8Array) => void | Promise<void>

function createBytePump(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  let pending: Uint8Array<ArrayBufferLike> = new Uint8Array(0)
  let eof = false
  let released = false

  async function fill(): Promise<void> {
    if (pending.byteLength > 0 || eof) return
    const { done, value } = await reader.read()
    if (done) {
      eof = true
      return
    }
    pending = value ?? new Uint8Array(0)
  }

  async function copy(count: number, write: MountByteSink, chunkSize: number): Promise<number> {
    let remaining = count
    while (remaining > 0) {
      await fill()
      if (pending.byteLength === 0) break
      const take = Math.min(remaining, pending.byteLength, chunkSize)
      const slice = pending.subarray(0, take)
      await write(slice)
      pending = pending.subarray(take)
      remaining -= take
    }
    return count - remaining
  }

  async function skip(count: number): Promise<number> {
    let remaining = count
    while (remaining > 0) {
      await fill()
      if (pending.byteLength === 0) break
      const take = Math.min(remaining, pending.byteLength)
      pending = pending.subarray(take)
      remaining -= take
    }
    return count - remaining
  }

  async function release(): Promise<void> {
    if (released) return
    released = true
    pending = new Uint8Array(0)
    try {
      await reader.cancel()
    } catch {
      // 流已结束
    }
    try {
      reader.releaseLock()
    } catch {
      // 已释放
    }
  }

  return { copy, skip, release }
}

async function writeZeros(count: number, write: MountByteSink, chunkSize: number): Promise<void> {
  if (count <= 0) return
  const zeros = new Uint8Array(Math.min(count, Math.min(chunkSize, ZERO_CHUNK_MAX)))
  let remaining = count
  while (remaining > 0) {
    const n = Math.min(remaining, zeros.byteLength)
    await write(n === zeros.byteLength ? zeros : zeros.subarray(0, n))
    remaining -= n
  }
}

/**
 * 把源文件按 [0, offset) + 补丁 + 尾段 写到 sink。空洞用 0 填充。
 * 除调用方已持有的补丁外，每次交给 sink 的块不超过 chunkSize。
 */
export async function rewriteRangeThroughSink(params: {
  fileSize: number
  source: ReadableStream<Uint8Array>
  offset: number
  patch: Uint8Array
  write: MountByteSink
  chunkSize?: number
}): Promise<number> {
  if (params.offset < 0) {
    throw new Error('offset 不能为负数')
  }
  const chunkSize = params.chunkSize ?? MOUNT_STREAM_COPY_CHUNK_SIZE
  const fileSize = Math.max(0, params.fileSize)
  const patchStart = params.offset
  const patchEnd = params.offset + params.patch.byteLength
  const pump = createBytePump(params.source)
  try {
    if (patchStart > 0) {
      const fromFile = Math.min(patchStart, fileSize)
      await pump.copy(fromFile, params.write, chunkSize)
      if (patchStart > fileSize) {
        await writeZeros(patchStart - fileSize, params.write, chunkSize)
      }
    }
    if (patchStart < fileSize) {
      await pump.skip(Math.min(params.patch.byteLength, fileSize - patchStart))
    }
    if (params.patch.byteLength > 0) {
      await params.write(params.patch)
    }
    if (patchEnd < fileSize) {
      await pump.copy(fileSize - patchEnd, params.write, chunkSize)
    }
    return Math.max(fileSize, patchEnd)
  } finally {
    await pump.release()
  }
}

/** 把源文件流按块拷到 sink，不拼整份。 */
export async function copyStreamToSink(
  stream: ReadableStream<Uint8Array>,
  write: MountByteSink,
): Promise<void> {
  const reader = stream.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      const chunk = value ?? new Uint8Array(0)
      if (chunk.byteLength > 0) await write(chunk)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // 已释放
    }
  }
}
