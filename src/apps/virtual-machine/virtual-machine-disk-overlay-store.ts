/**
 * 虚拟机硬盘缓存：主文件上打了 `vm-disk-cache` 标签的机会压缩附加。
 * 与空白虚拟盘同一套分槽：逻辑大小 = 主盘，槽 1MB，按盘内偏移覆盖；实占随脏槽增加。
 * 旧 v2 段表 / 流水账 / OPFS 旁路日志打开时一次性迁进机会压缩副本后丢掉。
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import {
  filesCreateAttachment,
  filesCreateSparseAttachment,
  filesListAttachments,
  filesReadBlob,
  filesReadBlobRange,
  filesStat,
} from '../files/files-api.ts'
import {
  getFileBlobStorageInfo,
  listSparseOccupiedSlots,
  SPARSE_DEFAULT_CHUNK_SIZE,
  SPARSE_MAX_LOGICAL_BYTES,
  writeBlobBytesRange,
} from '../files/files-storage.ts'
import { removeNodeForced, resolveNodeByAbsolutePath } from '../files/files-vfs.ts'
import { FILES_ATTACH_SEGMENT, VM_DISK_CACHE_ATTACHMENT_TAG } from '../files/files-types.ts'

export type DiskOverlayKey = {
  imagePath: string
}

export type DiskOverlayRun = {
  offset: number
  bytes: Uint8Array
}

export type DiskOverlaySegment = { offset: number; length: number }

export type DiskOverlayStore = {
  append(offset: number, bytes: Uint8Array): Promise<void>
  flush(): Promise<void>
  records(): Promise<readonly DiskOverlayRun[]>
  segments(): Promise<readonly DiskOverlaySegment[]>
  readRun(offset: number, length: number): Promise<Uint8Array>
  /** 与 [offset, offset+length) 相交的已落稳脏槽切片（读路径叠到可见盘上） */
  readOverlapping(offset: number, length: number): Promise<readonly DiskOverlayRun[]>
  replaceAll(runs: readonly DiskOverlayRun[]): Promise<void>
  remove(): Promise<void>
  /** 已落稳脏槽字节合计（同步；合并进度用） */
  dirtyBytes(): number
}

export const VM_DISK_CACHE_ATTACHMENT_NAME = '虚拟机硬盘缓存'
export { VM_DISK_CACHE_ATTACHMENT_TAG }

const MAGIC_BYTES = new TextEncoder().encode('VMDIFFC1')
const HEADER_BYTES = 32
const SEGMENT_ENTRY_BYTES = 16
const LEGACY_RECORD_HEADER_BYTES = 8
const LEGACY_OVERLAY_DIR = 'instant-vm-disk-overlays'

export function vmDiskCacheAttachmentPath(imagePath: string): string {
  return `${imagePath}/${FILES_ATTACH_SEGMENT}/${VM_DISK_CACHE_ATTACHMENT_NAME}`
}

/** 旧 OPFS 旁路日志文件名（只读迁移）。不要当会话键。 */
export function overlayStoreId(key: DiskOverlayKey): string {
  return bytesToHex(sha256(new TextEncoder().encode(key.imagePath)))
}

const memoryLogs = new Map<string, DiskOverlayRun[]>()
const storeCache = new Map<string, DiskOverlayStore>()
let forceMemory = false
let legacyDirPromise: Promise<FileSystemDirectoryHandle> | undefined

export function useMemoryDiskOverlayStoreForTests(): void {
  forceMemory = true
}

export function useRealDiskOverlayStoreForTests(): void {
  forceMemory = false
}

export function resetDiskOverlayStoreForTests(): void {
  memoryLogs.clear()
  storeCache.clear()
}

function useMemory(): boolean {
  return forceMemory
}

function cacheKey(key: DiskOverlayKey): string {
  return useMemory() ? `memory:${key.imagePath}` : key.imagePath
}

function copyBytes(data: Uint8Array): Uint8Array {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy
}

function insertRun(runs: DiskOverlayRun[], offset: number, bytes: Uint8Array): void {
  const end = offset + bytes.byteLength
  let lo = -1
  let hi = -1
  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i]!
    if (run.offset + run.bytes.byteLength >= offset && run.offset <= end) {
      if (lo < 0) lo = i
      hi = i + 1
    }
  }
  if (lo < 0) {
    let at = runs.length
    for (let i = 0; i < runs.length; i += 1) {
      if (runs[i]!.offset > offset) {
        at = i
        break
      }
    }
    runs.splice(at, 0, { offset, bytes: copyBytes(bytes) })
    return
  }
  const first = runs[lo]!
  const last = runs[hi - 1]!
  const start = Math.min(first.offset, offset)
  const fin = Math.max(last.offset + last.bytes.byteLength, end)
  const merged = new Uint8Array(fin - start)
  for (let i = lo; i < hi; i += 1) {
    const run = runs[i]!
    merged.set(run.bytes, run.offset - start)
  }
  merged.set(bytes, offset - start)
  runs.splice(lo, hi - lo, { offset: start, bytes: merged })
}

function runsDirtyBytes(runs: readonly DiskOverlayRun[]): number {
  let total = 0
  for (const run of runs) total += run.bytes.byteLength
  return total
}

function overlappingFromRuns(
  runs: readonly DiskOverlayRun[],
  offset: number,
  length: number,
): DiskOverlayRun[] {
  const end = offset + length
  const out: DiskOverlayRun[] = []
  for (const run of runs) {
    const runEnd = run.offset + run.bytes.byteLength
    if (runEnd <= offset || run.offset >= end) continue
    const from = Math.max(run.offset, offset)
    const to = Math.min(runEnd, end)
    out.push({
      offset: from,
      bytes: copyBytes(run.bytes.subarray(from - run.offset, to - run.offset)),
    })
  }
  return out
}

function decodeHeader(bytes: Uint8Array): { segmentCapacity: number; segmentCount: number } | undefined {
  if (bytes.byteLength < HEADER_BYTES) return undefined
  for (let i = 0; i < MAGIC_BYTES.byteLength; i += 1) {
    if (bytes[i] !== MAGIC_BYTES[i]) return undefined
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const segmentCapacity = view.getUint32(8, true)
  const segmentCount = Math.min(view.getUint32(12, true), segmentCapacity)
  if (segmentCapacity <= 0) return undefined
  return { segmentCapacity, segmentCount }
}

function decodeSegmentTable(bytes: Uint8Array, count: number): DiskOverlaySegment[] {
  const segments: DiskOverlaySegment[] = []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < count && (i + 1) * SEGMENT_ENTRY_BYTES <= bytes.byteLength; i += 1) {
    const offset = view.getFloat64(i * SEGMENT_ENTRY_BYTES, true)
    const length = view.getFloat64(i * SEGMENT_ENTRY_BYTES + 8, true)
    if (!Number.isFinite(offset) || !Number.isFinite(length) || offset < 0 || length <= 0) break
    segments.push({ offset, length })
  }
  return segments
}

function decodeLog(log: Uint8Array): DiskOverlayRun[] {
  const runs: DiskOverlayRun[] = []
  let cursor = 0
  const view = new DataView(log.buffer, log.byteOffset, log.byteLength)
  while (cursor + LEGACY_RECORD_HEADER_BYTES <= log.byteLength) {
    const length = view.getUint32(cursor, true)
    const offset = view.getUint32(cursor + 4, true)
    const payloadStart = cursor + LEGACY_RECORD_HEADER_BYTES
    const payloadEnd = payloadStart + length
    if (!Number.isFinite(length) || length <= 0 || payloadEnd > log.byteLength) {
      break
    }
    insertRun(runs, offset, log.subarray(payloadStart, payloadEnd))
    cursor = payloadEnd
  }
  return runs
}

function hasNativeOpfs(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    navigator.storage !== undefined &&
    typeof navigator.storage.getDirectory === 'function'
  )
}

async function getLegacyOverlayDir(): Promise<FileSystemDirectoryHandle | undefined> {
  if (!hasNativeOpfs()) return undefined
  if (legacyDirPromise) return legacyDirPromise
  legacyDirPromise = (async () => {
    const root = await navigator.storage.getDirectory()
    return root.getDirectoryHandle(LEGACY_OVERLAY_DIR)
  })()
  try {
    return await legacyDirPromise
  } catch {
    legacyDirPromise = undefined
    return undefined
  }
}

async function readLegacyOpfsLog(id: string): Promise<Uint8Array> {
  const dir = await getLegacyOverlayDir()
  if (!dir) return new Uint8Array(0)
  try {
    const handle = await dir.getFileHandle(`${id}.log`)
    const file = await handle.getFile()
    return new Uint8Array(await file.arrayBuffer())
  } catch {
    return new Uint8Array(0)
  }
}

async function deleteLegacyOpfsLog(id: string): Promise<void> {
  const dir = await getLegacyOverlayDir()
  if (!dir) return
  try {
    await dir.removeEntry(`${id}.log`)
  } catch {
    // 旧日志已经不在
  }
}

async function readRangeBytes(path: string, offset: number, length: number): Promise<Uint8Array> {
  if (length <= 0) return new Uint8Array(0)
  const blob = await filesReadBlobRange(path, offset, length)
  return new Uint8Array(await blob.arrayBuffer())
}

async function decodeLegacyAttachmentRuns(
  attachPath: string,
  byteSize: number,
): Promise<DiskOverlayRun[]> {
  if (byteSize <= 0) return []
  const headerBytes = await readRangeBytes(attachPath, 0, Math.min(HEADER_BYTES, byteSize))
  const header = decodeHeader(headerBytes)
  if (header) {
    const tableBytes = await readRangeBytes(
      attachPath,
      HEADER_BYTES,
      header.segmentCount * SEGMENT_ENTRY_BYTES,
    )
    const segments = decodeSegmentTable(tableBytes, header.segmentCount)
    const dataBase = HEADER_BYTES + header.segmentCapacity * SEGMENT_ENTRY_BYTES
    const runs: DiskOverlayRun[] = []
    for (const seg of segments) {
      const bytes = await readRangeBytes(attachPath, dataBase + seg.offset, seg.length)
      insertRun(runs, seg.offset, bytes)
    }
    return runs
  }
  const log = new Uint8Array(await (await filesReadBlob(attachPath)).arrayBuffer())
  return decodeLog(log)
}

function assertImageFitsSparse(byteSize: number): void {
  if (byteSize > SPARSE_MAX_LOGICAL_BYTES) {
    throw new Error(
      '这份硬盘的逻辑大小超过机会压缩上限，关机后写入和不保存不可用。请改用尽快写入，或换一份更小的盘。',
    )
  }
}

async function deleteAttachmentAt(attachPath: string): Promise<void> {
  try {
    const node = await resolveNodeByAbsolutePath(attachPath, { follow: true })
    if (node) await removeNodeForced(node.id)
  } catch {
    // 附加已经不在
  }
}

async function ensureSparseCacheAttachment(key: DiskOverlayKey): Promise<{
  attachPath: string
  imageSize: number
}> {
  const stat = await filesStat(key.imagePath)
  if (!stat || stat.kind !== 'file') {
    throw new Error(`文件不存在：${key.imagePath}`)
  }
  assertImageFitsSparse(stat.byteSize)

  const tagged = await filesListAttachments(key.imagePath, { tag: VM_DISK_CACHE_ATTACHMENT_TAG })
  const all = tagged.length > 0 ? tagged : await filesListAttachments(key.imagePath)
  const untaggedSameName = all.find(
    (item) =>
      item.name === VM_DISK_CACHE_ATTACHMENT_NAME &&
      item.attachmentTags?.includes(VM_DISK_CACHE_ATTACHMENT_TAG) !== true,
  )
  if (untaggedSameName && tagged.length === 0) {
    throw new Error(
      `已有同名附加「${VM_DISK_CACHE_ATTACHMENT_NAME}」，但没有虚拟机硬盘缓存标签，无法复用。请先改名或删掉这份附加。`,
    )
  }

  const existing = tagged[0]
  let migrateRuns: DiskOverlayRun[] = []
  if (existing) {
    const attachPath =
      existing.name === VM_DISK_CACHE_ATTACHMENT_NAME
        ? vmDiskCacheAttachmentPath(key.imagePath)
        : `${key.imagePath}/${FILES_ATTACH_SEGMENT}/${existing.name}`
    const node = await resolveNodeByAbsolutePath(attachPath, { follow: true })
    const info = node ? await getFileBlobStorageInfo(node.id) : undefined
    const sparseOk =
      info?.sparseSlots === true &&
      info.byteSize === stat.byteSize &&
      (info.slotSize ?? SPARSE_DEFAULT_CHUNK_SIZE) === SPARSE_DEFAULT_CHUNK_SIZE
    if (sparseOk) {
      return { attachPath, imageSize: stat.byteSize }
    }
    if (info?.sparseSlots === true && node) {
      for (const slot of await listSparseOccupiedSlots(node.id)) {
        migrateRuns.push({
          offset: slot.offset,
          bytes: await readRangeBytes(attachPath, slot.offset, slot.length),
        })
      }
    } else {
      migrateRuns = await decodeLegacyAttachmentRuns(attachPath, existing.byteSize)
    }
    storeCache.delete(cacheKey(key))
    await deleteAttachmentAt(attachPath)
  } else {
    const legacy = await readLegacyOpfsLog(overlayStoreId(key))
    if (legacy.byteLength > 0) {
      const header = decodeHeader(legacy.subarray(0, Math.min(HEADER_BYTES, legacy.byteLength)))
      if (header) {
        await filesCreateAttachment({
          mainFilePath: key.imagePath,
          name: VM_DISK_CACHE_ATTACHMENT_NAME,
          bytes: legacy.buffer.slice(legacy.byteOffset, legacy.byteOffset + legacy.byteLength) as ArrayBuffer,
          tags: [VM_DISK_CACHE_ATTACHMENT_TAG],
          nameMode: 'exact',
        })
        const tmpPath = vmDiskCacheAttachmentPath(key.imagePath)
        migrateRuns = await decodeLegacyAttachmentRuns(tmpPath, legacy.byteLength)
        await deleteAttachmentAt(tmpPath)
      } else {
        migrateRuns = decodeLog(legacy)
      }
      await deleteLegacyOpfsLog(overlayStoreId(key))
    }
  }

  const created = await filesCreateSparseAttachment({
    mainFilePath: key.imagePath,
    name: VM_DISK_CACHE_ATTACHMENT_NAME,
    byteSize: stat.byteSize,
    tags: [VM_DISK_CACHE_ATTACHMENT_TAG],
    chunkSize: SPARSE_DEFAULT_CHUNK_SIZE,
    nameMode: 'exact',
  })
  const attachPath = created.path
  const store = await makeAttachmentStore(key, attachPath, stat.byteSize)
  for (const run of migrateRuns) {
    await store.append(run.offset, run.bytes)
  }
  await store.flush()
  storeCache.set(cacheKey(key), store)
  return { attachPath, imageSize: stat.byteSize }
}

async function seedSlotBuffer(
  attachPath: string,
  imagePath: string,
  slotOffset: number,
  slotLength: number,
  occupied: ReadonlySet<number>,
): Promise<Uint8Array> {
  if (occupied.has(slotOffset)) {
    return readRangeBytes(attachPath, slotOffset, slotLength)
  }
  return readRangeBytes(imagePath, slotOffset, slotLength)
}

async function writeSeededRange(
  attachPath: string,
  imagePath: string,
  imageSize: number,
  offset: number,
  bytes: Uint8Array,
): Promise<void> {
  const node = await resolveNodeByAbsolutePath(attachPath, { follow: true })
  if (!node) {
    throw new Error(`缓存附加不存在：${attachPath}`)
  }
  const slotSize = SPARSE_DEFAULT_CHUNK_SIZE
  const writeEnd = offset + bytes.byteLength
  const firstSlot = Math.floor(offset / slotSize)
  const lastSlot = Math.floor((writeEnd - 1) / slotSize)
  const occupied = new Set(
    (await listSparseOccupiedSlots(node.id)).map((slot) => slot.offset),
  )
  const rangeStart = firstSlot * slotSize
  const rangeEnd = Math.min((lastSlot + 1) * slotSize, imageSize)
  const buf = new Uint8Array(rangeEnd - rangeStart)
  for (let slot = firstSlot; slot <= lastSlot; slot += 1) {
    const slotOffset = slot * slotSize
    const slotLength = Math.min(slotSize, imageSize - slotOffset)
    if (slotLength <= 0) continue
    buf.set(await seedSlotBuffer(attachPath, imagePath, slotOffset, slotLength, occupied), slotOffset - rangeStart)
  }
  buf.set(bytes, offset - rangeStart)
  await writeBlobBytesRange({
    nodeId: node.id,
    offset: rangeStart,
    bytes: buf,
    retainZeroSlots: true,
  })
}

function makeMemoryStore(id: string): DiskOverlayStore {
  const loadRuns = (): DiskOverlayRun[] => memoryLogs.get(id) ?? []
  return {
    async append(offset, bytes) {
      if (!Number.isFinite(offset) || offset < 0 || bytes.byteLength <= 0) return
      const runs = loadRuns()
      insertRun(runs, offset, bytes)
      memoryLogs.set(id, runs)
    },
    async flush() {},
    async records() {
      return loadRuns().map((run) => ({ offset: run.offset, bytes: copyBytes(run.bytes) }))
    },
    async segments() {
      return loadRuns().map((run) => ({ offset: run.offset, length: run.bytes.byteLength }))
    },
    async readRun(offset, length) {
      if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(length) || length <= 0) {
        return new Uint8Array(0)
      }
      const out = new Uint8Array(length)
      for (const run of overlappingFromRuns(loadRuns(), offset, length)) {
        out.set(run.bytes, run.offset - offset)
      }
      return out
    },
    async readOverlapping(offset, length) {
      return overlappingFromRuns(loadRuns(), offset, length)
    },
    async replaceAll(runs) {
      const next: DiskOverlayRun[] = []
      for (const run of runs) {
        if (!Number.isFinite(run.offset) || run.offset < 0 || run.bytes.byteLength <= 0) continue
        insertRun(next, run.offset, run.bytes)
      }
      memoryLogs.set(id, next)
    },
    async remove() {
      storeCache.delete(id)
      memoryLogs.delete(id)
    },
    dirtyBytes() {
      return runsDirtyBytes(loadRuns())
    },
  }
}

async function makeAttachmentStore(
  key: DiskOverlayKey,
  attachPath: string,
  imageSize: number,
): Promise<DiskOverlayStore> {
  const id = cacheKey(key)
  let cachedDirty = 0
  const refreshDirty = async (): Promise<void> => {
    const node = await resolveNodeByAbsolutePath(attachPath, { follow: true })
    if (!node) {
      cachedDirty = 0
      return
    }
    const slots = await listSparseOccupiedSlots(node.id)
    cachedDirty = slots.reduce((sum, slot) => sum + slot.length, 0)
  }
  await refreshDirty()
  return {
    async append(offset, bytes) {
      if (!Number.isFinite(offset) || offset < 0 || bytes.byteLength <= 0) return
      await writeSeededRange(attachPath, key.imagePath, imageSize, offset, bytes)
      await refreshDirty()
    },
    async flush() {},
    async records() {
      const node = await resolveNodeByAbsolutePath(attachPath, { follow: true })
      if (!node) return []
      const slots = await listSparseOccupiedSlots(node.id)
      const runs: DiskOverlayRun[] = []
      for (const slot of slots) {
        runs.push({ offset: slot.offset, bytes: await readRangeBytes(attachPath, slot.offset, slot.length) })
      }
      return runs
    },
    async segments() {
      const node = await resolveNodeByAbsolutePath(attachPath, { follow: true })
      if (!node) return []
      return listSparseOccupiedSlots(node.id)
    },
    async readRun(offset, length) {
      if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(length) || length <= 0) {
        return new Uint8Array(0)
      }
      return readRangeBytes(attachPath, offset, length)
    },
    async readOverlapping(offset, length) {
      const node = await resolveNodeByAbsolutePath(attachPath, { follow: true })
      if (!node) return []
      const end = offset + length
      const out: DiskOverlayRun[] = []
      for (const slot of await listSparseOccupiedSlots(node.id)) {
        const from = Math.max(slot.offset, offset)
        const to = Math.min(slot.offset + slot.length, end)
        if (to <= from) continue
        out.push({ offset: from, bytes: await readRangeBytes(attachPath, from, to - from) })
      }
      return out
    },
    async replaceAll(runs) {
      await deleteAttachmentAt(attachPath)
      await filesCreateSparseAttachment({
        mainFilePath: key.imagePath,
        name: VM_DISK_CACHE_ATTACHMENT_NAME,
        byteSize: imageSize,
        tags: [VM_DISK_CACHE_ATTACHMENT_TAG],
        chunkSize: SPARSE_DEFAULT_CHUNK_SIZE,
        nameMode: 'exact',
      })
      for (const run of runs) {
        if (!Number.isFinite(run.offset) || run.offset < 0 || run.bytes.byteLength <= 0) continue
        await writeSeededRange(attachPath, key.imagePath, imageSize, run.offset, run.bytes)
      }
      await refreshDirty()
    },
    async remove() {
      storeCache.delete(id)
      await deleteAttachmentAt(attachPath)
      cachedDirty = 0
    },
    dirtyBytes() {
      return cachedDirty
    },
  }
}

export async function openDiskOverlayStore(key: DiskOverlayKey): Promise<DiskOverlayStore> {
  const id = cacheKey(key)
  const cached = storeCache.get(id)
  if (cached) return cached
  if (useMemory()) {
    const store = makeMemoryStore(id)
    storeCache.set(id, store)
    return store
  }
  const { attachPath, imageSize } = await ensureSparseCacheAttachment(key)
  const existing = storeCache.get(id)
  if (existing) return existing
  const store = await makeAttachmentStore(key, attachPath, imageSize)
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

export async function inspectDiskCacheAttachment(
  key: DiskOverlayKey,
): Promise<{ records: number; storedBytes: number } | undefined> {
  const items = await filesListAttachments(key.imagePath, { tag: VM_DISK_CACHE_ATTACHMENT_TAG })
  const hit = items[0]
  if (!hit) return undefined
  const stored = hit.storedByteSize ?? 0
  if (stored <= 0) return undefined
  const attachPath =
    hit.name === VM_DISK_CACHE_ATTACHMENT_NAME
      ? vmDiskCacheAttachmentPath(key.imagePath)
      : `${key.imagePath}/${FILES_ATTACH_SEGMENT}/${hit.name}`
  try {
    const node = await resolveNodeByAbsolutePath(attachPath, { follow: true })
    const slots = node ? await listSparseOccupiedSlots(node.id) : []
    if (slots.length === 0) return { records: 1, storedBytes: stored }
    return { records: slots.length, storedBytes: stored }
  } catch {
    return { records: 1, storedBytes: stored }
  }
}
