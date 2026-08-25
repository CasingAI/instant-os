/**
 * OPFS 原地按偏移写：只改这一段，不把整份文件读进内存。
 * 给 Worker 里的 SyncAccessHandle 用；单测用内存假句柄覆盖同一套规则。
 * getSize / truncate / flush 兼容同步和 Promise（Chrome 已改为同步）。
 */

export type OpfsSyncRangeAccess = {
  getSize: () => number | Promise<number>
  truncate: (size: number) => void | Promise<void>
  write: (buffer: ArrayBuffer, options?: { at?: number }) => number
  flush: () => void | Promise<void>
}

export async function writeToOpfsSyncAccess(
  access: OpfsSyncRangeAccess,
  offset: number,
  bytes: Uint8Array,
): Promise<number> {
  if (offset < 0) {
    throw new Error('offset 不能为负数')
  }
  if (bytes.byteLength === 0) {
    return await access.getSize()
  }
  const end = offset + bytes.byteLength
  const size = await access.getSize()
  if (end > size) {
    await access.truncate(end)
  }
  const payload =
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength &&
    bytes.buffer instanceof ArrayBuffer
      ? bytes.buffer
      : (bytes.slice().buffer as ArrayBuffer)
  const written = access.write(payload, { at: offset })
  if (written !== bytes.byteLength) {
    throw new Error('OPFS 原地写入不完整')
  }
  return await access.getSize()
}

export async function writeThroughOpfsSyncAccess(
  access: OpfsSyncRangeAccess,
  offset: number,
  bytes: Uint8Array,
): Promise<number> {
  const size = await writeToOpfsSyncAccess(access, offset, bytes)
  await access.flush()
  return size
}
