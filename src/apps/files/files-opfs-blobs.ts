/**
 * 内部卷大文件正文：按内容编号存在 Origin Private File System。
 * 目录对用户不可见，不镜像 `/user` 树；IndexedDB 只保留索引。
 *
 * 测试可切到内存后端（Node 无 OPFS）；生产走 navigator.storage.getDirectory。
 */

/** 新正文超过该大小进 OPFS；已在 OPFS 的保持，不因变短搬回 IndexedDB。 */
export const OPFS_SPILL_THRESHOLD = 25 << 20

const OPFS_BLOBS_DIR = 'instant-os-file-blobs'

type MemoryFile = { bytes: Uint8Array }

export type OpfsBlobWriter = {
  writeAt(offset: number, data: Uint8Array): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}

let memoryFiles: Map<string, MemoryFile> | undefined
let blobsDirPromise: Promise<FileSystemDirectoryHandle> | undefined

function hasNativeOpfs(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    navigator.storage !== undefined &&
    typeof navigator.storage.getDirectory === 'function'
  )
}

export function isOpfsAvailable(): boolean {
  return memoryFiles !== undefined || hasNativeOpfs()
}

/** 测试用：改走内存，不碰浏览器 OPFS。可重复调用，不清已有内容。 */
export function useMemoryOpfsForTests(): void {
  if (memoryFiles === undefined) memoryFiles = new Map()
  blobsDirPromise = undefined
}

/** 测试用：清空正文；内存模式保持开启。 */
export function resetOpfsBlobsForTests(): void {
  memoryFiles?.clear()
  blobsDirPromise = undefined
}

function opfsFileName(blobId: string): string {
  return blobId.replaceAll(':', '_')
}

function copyBytes(data: Uint8Array): Uint8Array {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy
}

function copyArrayBuffer(data: Uint8Array): ArrayBuffer {
  return copyBytes(data).buffer as ArrayBuffer
}

function writeMemoryAt(file: MemoryFile, offset: number, data: Uint8Array): void {
  const end = offset + data.byteLength
  if (file.bytes.byteLength < end) {
    const next = new Uint8Array(end)
    next.set(file.bytes)
    file.bytes = next
  }
  file.bytes.set(data, offset)
}

async function getBlobsDir(): Promise<FileSystemDirectoryHandle> {
  if (blobsDirPromise) return blobsDirPromise
  blobsDirPromise = (async () => {
    const root = await navigator.storage.getDirectory()
    return root.getDirectoryHandle(OPFS_BLOBS_DIR, { create: true })
  })()
  try {
    return await blobsDirPromise
  } catch (error) {
    blobsDirPromise = undefined
    throw error
  }
}

async function getNativeFileHandle(
  blobId: string,
  create: boolean,
): Promise<FileSystemFileHandle | undefined> {
  const dir = await getBlobsDir()
  const name = opfsFileName(blobId)
  try {
    return await dir.getFileHandle(name, { create })
  } catch {
    if (create) throw new Error('无法在 OPFS 中创建正文文件')
    return undefined
  }
}

function memoryFile(blobId: string, create: boolean): MemoryFile | undefined {
  const name = opfsFileName(blobId)
  const existing = memoryFiles?.get(name)
  if (existing) return existing
  if (!create || memoryFiles === undefined) return undefined
  const created: MemoryFile = { bytes: new Uint8Array(0) }
  memoryFiles.set(name, created)
  return created
}

/** 整份覆盖正文（会截断到新长度）。 */
export async function writeOpfsBlobBytes(blobId: string, data: Uint8Array): Promise<void> {
  const bytes = copyArrayBuffer(data)
  if (memoryFiles !== undefined) {
    memoryFiles.set(opfsFileName(blobId), { bytes: new Uint8Array(bytes) })
    return
  }
  const handle = await getNativeFileHandle(blobId, true)
  if (!handle) throw new Error('无法打开 OPFS 正文文件')
  const writable = await handle.createWritable()
  try {
    if (bytes.byteLength > 0) await writable.write(bytes)
    await writable.close()
  } catch (error) {
    try {
      await writable.abort()
    } catch {
      // 已关闭
    }
    throw error
  }
}

/** 从指定位置覆盖写入；必要时扩展文件。返回写入后的文件大小。 */
export async function writeOpfsBlobRange(
  blobId: string,
  offset: number,
  data: Uint8Array,
): Promise<number> {
  if (memoryFiles !== undefined) {
    const file = memoryFile(blobId, true)
    if (!file) throw new Error('无法打开 OPFS 正文文件')
    writeMemoryAt(file, offset, data)
    return file.bytes.byteLength
  }
  const handle = await getNativeFileHandle(blobId, true)
  if (!handle) throw new Error('无法打开 OPFS 正文文件')
  // 不能走 createWritable({ keepExistingData: true })：浏览器会先把整份正文
  // 拷进临时文件，GB 级镜像会 Array buffer allocation failed。
  const { writeOpfsRangeViaAccessWorker } = await import('./files-opfs-access-client.ts')
  return writeOpfsRangeViaAccessWorker(handle, offset, data)
}

export async function readOpfsBlobBytes(blobId: string): Promise<ArrayBuffer | undefined> {
  if (memoryFiles !== undefined) {
    const file = memoryFiles.get(opfsFileName(blobId))
    if (!file) return undefined
    return copyArrayBuffer(file.bytes)
  }
  const handle = await getNativeFileHandle(blobId, false)
  if (!handle) return undefined
  const file = await handle.getFile()
  return file.arrayBuffer()
}

export async function readOpfsBlobRange(
  blobId: string,
  offset: number,
  length: number,
): Promise<ArrayBuffer | undefined> {
  const start = Math.max(0, offset)
  const want = Math.max(0, length)
  if (memoryFiles !== undefined) {
    const file = memoryFiles.get(opfsFileName(blobId))
    if (!file) return undefined
    const to = Math.min(file.bytes.byteLength, start + want)
    if (to <= start) return new ArrayBuffer(0)
    return copyArrayBuffer(file.bytes.subarray(start, to))
  }
  const handle = await getNativeFileHandle(blobId, false)
  if (!handle) return undefined
  const file = await handle.getFile()
  if (start >= file.size) return new ArrayBuffer(0)
  return file.slice(start, start + want).arrayBuffer()
}

export async function copyOpfsBlob(fromId: string, toId: string): Promise<void> {
  if (memoryFiles !== undefined) {
    const src = memoryFiles.get(opfsFileName(fromId))
    memoryFiles.set(opfsFileName(toId), {
      bytes: src ? copyBytes(src.bytes) : new Uint8Array(0),
    })
    return
  }
  const srcHandle = await getNativeFileHandle(fromId, false)
  const destHandle = await getNativeFileHandle(toId, true)
  if (!destHandle) throw new Error('无法创建 OPFS 正文副本')
  const writable = await destHandle.createWritable()
  try {
    if (srcHandle) {
      const file = await srcHandle.getFile()
      await file.stream().pipeTo(writable)
      return
    }
    await writable.close()
  } catch (error) {
    try {
      await writable.abort()
    } catch {
      // 已关闭
    }
    throw error
  }
}

export async function deleteOpfsBlob(blobId: string): Promise<void> {
  if (memoryFiles !== undefined) {
    memoryFiles.delete(opfsFileName(blobId))
    return
  }
  try {
    const dir = await getBlobsDir()
    await dir.removeEntry(opfsFileName(blobId))
  } catch {
    // 文件本就不在
  }
}

/** 打开可持续写入的会话（流式追加 / 边写边增长）。 */
export async function openOpfsBlobWriter(blobId: string): Promise<OpfsBlobWriter> {
  if (memoryFiles !== undefined) {
    const file = memoryFile(blobId, true)
    if (!file) throw new Error('无法打开 OPFS 正文文件')
    let closed = false
    return {
      async writeAt(offset, data) {
        if (closed) throw new Error('OPFS 写入已结束')
        writeMemoryAt(file, offset, data)
      },
      async close() {
        closed = true
      },
      async abort() {
        closed = true
      },
    }
  }
  const handle = await getNativeFileHandle(blobId, true)
  if (!handle) throw new Error('无法打开 OPFS 正文文件')
  // 不能走 createWritable({ keepExistingData: true })：浏览器会先把整份正文
  // 拷进临时文件，已有 GB 级镜像再开会话会 Array buffer allocation failed。
  const { openOpfsAccessSession } = await import('./files-opfs-access-client.ts')
  const session = await openOpfsAccessSession(handle)
  let closed = false
  return {
    async writeAt(offset, data) {
      if (closed) throw new Error('OPFS 写入已结束')
      await session.writeAt(offset, data)
    },
    async close() {
      if (closed) return
      closed = true
      await session.close()
    },
    async abort() {
      if (closed) return
      closed = true
      await session.abort()
    },
  }
}

export async function opfsBlobExists(blobId: string): Promise<boolean> {
  if (memoryFiles !== undefined) return memoryFiles.has(opfsFileName(blobId))
  if (!hasNativeOpfs()) return false
  const handle = await getNativeFileHandle(blobId, false)
  return handle !== undefined
}
