/**
 * 虚拟机硬盘差量的隐藏耐久层。
 *
 * 不进文件 App 目录树：运行期底盘只读，脏扇区追加进与镜像绑定的旁路对象。
 * 关机合并成功后才删除；崩溃后下次开机整份重放（对底盘幂等）。
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

export type DiskOverlayKey = {
  imagePath: string
  snapshotPath?: string
}

export type DiskOverlayRun = {
  offset: number
  bytes: Uint8Array
}

export type DiskOverlayStore = {
  append(offset: number, bytes: Uint8Array): Promise<void>
  flush(): Promise<void>
  records(): Promise<readonly DiskOverlayRun[]>
  replaceAll(runs: readonly DiskOverlayRun[]): Promise<void>
  remove(): Promise<void>
}

const OVERLAY_DIR = 'instant-vm-disk-overlays'
const RECORD_HEADER_BYTES = 8

type MemoryFile = { bytes: Uint8Array }

const memoryLogs = new Map<string, MemoryFile>()
const storeCache = new Map<string, DiskOverlayStore>()
let overlayDirPromise: Promise<FileSystemDirectoryHandle> | undefined
let forceMemory = false

function hasNativeOpfs(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    navigator.storage !== undefined &&
    typeof navigator.storage.getDirectory === 'function'
  )
}

function useMemory(): boolean {
  return forceMemory || !hasNativeOpfs()
}

export function overlayStoreId(key: DiskOverlayKey): string {
  const raw = key.snapshotPath ? `${key.imagePath}\0${key.snapshotPath}` : key.imagePath
  return bytesToHex(sha256(new TextEncoder().encode(raw)))
}

export function useMemoryDiskOverlayStoreForTests(): void {
  forceMemory = true
  overlayDirPromise = undefined
}

export function resetDiskOverlayStoreForTests(): void {
  memoryLogs.clear()
  storeCache.clear()
}

function copyBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy
}

function encodeRecord(offset: number, bytes: Uint8Array): Uint8Array {
  const record = new Uint8Array(RECORD_HEADER_BYTES + bytes.byteLength)
  const view = new DataView(record.buffer)
  view.setUint32(0, bytes.byteLength, true)
  view.setUint32(4, offset, true)
  record.set(bytes, RECORD_HEADER_BYTES)
  return record
}

function decodeLog(log: Uint8Array): DiskOverlayRun[] {
  const runs: DiskOverlayRun[] = []
  let cursor = 0
  const view = new DataView(log.buffer, log.byteOffset, log.byteLength)
  while (cursor + RECORD_HEADER_BYTES <= log.byteLength) {
    const length = view.getUint32(cursor, true)
    const offset = view.getUint32(cursor + 4, true)
    const payloadStart = cursor + RECORD_HEADER_BYTES
    const payloadEnd = payloadStart + length
    if (!Number.isFinite(length) || length <= 0 || payloadEnd > log.byteLength) {
      break
    }
    runs.push({ offset, bytes: copyBytes(log.subarray(payloadStart, payloadEnd)) })
    cursor = payloadEnd
  }
  return runs
}

function concatRecords(runs: readonly DiskOverlayRun[]): Uint8Array {
  let total = 0
  for (const run of runs) {
    total += RECORD_HEADER_BYTES + run.bytes.byteLength
  }
  const out = new Uint8Array(total)
  let cursor = 0
  for (const run of runs) {
    const record = encodeRecord(run.offset, run.bytes)
    out.set(record, cursor)
    cursor += record.byteLength
  }
  return out
}

async function getOverlayDir(): Promise<FileSystemDirectoryHandle> {
  if (overlayDirPromise) return overlayDirPromise
  overlayDirPromise = (async () => {
    const root = await navigator.storage.getDirectory()
    return root.getDirectoryHandle(OVERLAY_DIR, { create: true })
  })()
  try {
    return await overlayDirPromise
  } catch (error) {
    overlayDirPromise = undefined
    throw error
  }
}

function memoryFile(id: string, create: boolean): MemoryFile | undefined {
  const existing = memoryLogs.get(id)
  if (existing) return existing
  if (!create) return undefined
  const created: MemoryFile = { bytes: new Uint8Array(0) }
  memoryLogs.set(id, created)
  return created
}

async function readLogBytes(id: string): Promise<Uint8Array> {
  if (useMemory()) {
    return memoryFile(id, false)?.bytes ?? new Uint8Array(0)
  }
  const dir = await getOverlayDir()
  try {
    const handle = await dir.getFileHandle(`${id}.log`)
    const file = await handle.getFile()
    return new Uint8Array(await file.arrayBuffer())
  } catch {
    return new Uint8Array(0)
  }
}

async function writeLogBytes(id: string, bytes: Uint8Array): Promise<void> {
  if (useMemory()) {
    const file = memoryFile(id, true)!
    file.bytes = copyBytes(bytes)
    return
  }
  const dir = await getOverlayDir()
  const handle = await dir.getFileHandle(`${id}.log`, { create: true })
  const writable = await handle.createWritable()
  try {
    await writable.write(copyBytes(bytes))
    await writable.close()
  } catch (error) {
    await writable.abort().catch(() => undefined)
    throw error
  }
}

async function appendLogBytes(id: string, bytes: Uint8Array): Promise<void> {
  if (useMemory()) {
    const file = memoryFile(id, true)!
    const next = new Uint8Array(file.bytes.byteLength + bytes.byteLength)
    next.set(file.bytes)
    next.set(bytes, file.bytes.byteLength)
    file.bytes = next
    return
  }
  const existing = await readLogBytes(id)
  const next = new Uint8Array(existing.byteLength + bytes.byteLength)
  next.set(existing)
  next.set(bytes, existing.byteLength)
  await writeLogBytes(id, next)
}

async function deleteLog(id: string): Promise<void> {
  memoryLogs.delete(id)
  if (useMemory()) {
    return
  }
  try {
    const dir = await getOverlayDir()
    await dir.removeEntry(`${id}.log`)
  } catch {
    // 差量本来就不在
  }
}

export async function openDiskOverlayStore(key: DiskOverlayKey): Promise<DiskOverlayStore> {
  const id = overlayStoreId(key)
  const cached = storeCache.get(id)
  if (cached) {
    return cached
  }
  const store: DiskOverlayStore = {
    async append(offset, bytes) {
      if (!Number.isFinite(offset) || offset < 0 || bytes.byteLength <= 0) {
        return
      }
      await appendLogBytes(id, encodeRecord(offset >>> 0, bytes))
    },
    async flush() {
      // 追加写在 append 里已经落到存储；此处留给调用方统一收口。
    },
    async records() {
      return decodeLog(await readLogBytes(id))
    },
    async replaceAll(runs) {
      await writeLogBytes(id, concatRecords(runs))
    },
    async remove() {
      storeCache.delete(id)
      await deleteLog(id)
    },
  }
  storeCache.set(id, store)
  return store
}

export async function replayDiskOverlayStore(
  key: DiskOverlayKey,
  write: (offset: number, bytes: Uint8Array) => void,
): Promise<void> {
  const store = await openDiskOverlayStore(key)
  for (const run of await store.records()) {
    write(run.offset, run.bytes)
  }
}

export async function overlayStoreHasRecords(key: DiskOverlayKey): Promise<boolean> {
  const bytes = await readLogBytes(overlayStoreId(key))
  return bytes.byteLength >= RECORD_HEADER_BYTES
}

export async function writeDiskOverlaySnapshot(
  key: DiskOverlayKey,
  runs: readonly DiskOverlayRun[],
): Promise<void> {
  const store = await openDiskOverlayStore(key)
  await store.replaceAll(runs)
  await store.flush()
}
