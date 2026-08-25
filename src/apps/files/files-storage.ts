/**
 * 文件存储底层（系统 / root 层）。
 * 不检查节点 `writable`；内置应用维护受保护数据时应使用本模块或专用 internal 模块，
 * 面向用户的读写请走 files-vfs / files-api。
 */
import { countSystemDebugHot, recordSystemDebugHot, recordSystemDebugTimeline } from '../../os/system-debug-log.ts'
import { osNowMs } from '../../os/os-clock.ts'
import { beginIdbTransaction } from '../../os/idb-transaction.ts'
import {
  getDataCapacityBytes,
  DATA_STORAGE_CHANGED_EVENT,
  getTotalDataStorageBytes,
} from '../../os/device-data-storage.ts'
import { formatStorageSize } from '../../os/format-storage-size.ts'
import {
  newContentRevisionId,
  normalizeFilesNodeAttributes,
  type FilesLocationId,
  type FilesNode,
  type FilesNodeAttributes,
  type FilesNodeKind,
} from './files-types.ts'
import {
  copyOpfsBlob,
  deleteOpfsBlob,
  isOpfsAvailable,
  openOpfsBlobWriter,
  OPFS_SPILL_THRESHOLD,
  readOpfsBlobBytes,
  readOpfsBlobRange,
  resetOpfsBlobsForTests,
  writeOpfsBlobBytes,
  writeOpfsBlobRange,
  type OpfsBlobWriter,
} from './files-opfs-blobs.ts'

export const FILES_DB_NAME = 'instant-os-files'
export const FILES_DB_VERSION = 6
export const FILES_NODES_STORE = 'nodes'
export const FILES_BLOBS_STORE = 'blobs'
export const FILES_CHUNKS_STORE = 'chunks'
export const FILES_META_STORE = 'meta'

/** IndexedDB 复合索引用空字符串表示根目录父级 */
export const FILES_ROOT_PARENT_KEY = ''

export type FilesNodeRecord = {
  id: string
  locationId: FilesLocationId
  parentId: string
  name: string
  /**
   * 名字的大小写与 Unicode（NFC）正规化键；唯一索引 by-parent-name-key 用它。
   * 旧数据 / 写入时缺省由 nodeToRecord 计算；迁移 v6 补全。
   */
  nameKey?: string
  kind: FilesNodeKind
  mimeType?: string
  byteSize: number
  createdAt: number
  updatedAt: number
  /** 内容版本戳；旧记录 / 文件夹可能缺失 */
  contentRevisionId?: string
  /**
   * 指向 blobs 表条目。缺省兼容旧数据：等同 node.id。
   * 仅 kind=file 有意义；clone 共享时多个节点可指向同一 blobId。
   */
  blobId?: string
  /** 符号链接目标；仅 kind=symlink */
  target?: string
  /** 废纸篓来源记录（原位置），仅位于废纸篓卷的节点有意义 */
  trashOrigin?: {
    locationId: FilesLocationId
    parentId: string
    name: string
  }
  /** 旧数据可能缺失；读取时按位置默认补齐 */
  attributes?: FilesNodeAttributes
}

type FilesBlobRecord = {
  id: string
  /**
   * @deprecated 仅兼容旧数据；新写入只存 bytes。迁移后应清空。
   * 与 bytes 可并存；读取优先 bytes。
   */
  text?: string
  /** 文件内容（UTF-8 文本或任意二进制） */
  bytes?: ArrayBuffer
  /** 引用计数；缺省兼容旧数据：按 1 */
  refCount?: number
  /**
   * 分块 blob 标记：内容存在 FILES_CHUNKS_STORE（按 chunkIndex 排序拼接）。
   * 与 bytes / text 互斥；流式写入使用。
   */
  chunked?: boolean
  /**
   * 分块内容单元偏移索引（新格式）。存在 = 新格式：chunkOffsets[i] 为第 i 块
   * 在文件中的起始字节偏移，块大小可变（中间块等长、尾部可合并）。
   * 缺失 = 旧格式：块按写入序号等长与否未知，只能整读。
   */
  chunkOffsets?: number[]
  /** 分块 blob 的内容字节数（chunked 时维护，配额 / 预览免读 chunks） */
  byteSize?: number
  /** 分块数 */
  chunkCount?: number
  /**
   * 等长分块的块大小。有此字段时不必存 chunkOffsets：第 i 块起始为 i * uniformChunkSize，
   * 最后一块可以更短。避免导入大文件时把数万条偏移整份写进 blob 记录。
   */
  uniformChunkSize?: number
  /**
   * 正文所在位置。缺省：IndexedDB（bytes / text / chunks）。
   * opfs：正文在 OPFS，本记录只保留大小与引用。
   */
  backend?: 'opfs'
  /**
   * 已落库正文字节数（实占）。稀疏文件中可能远小于 byteSize。
   * 旧数据缺失时回退到 byteSize，保持既有配额口径。
   */
  storedByteSize?: number
}

/** 分块 blob 内容单元；主键 [blobId, chunkIndex] */
type FilesChunkRecord = {
  blobId: string
  chunkIndex: number
  bytes: ArrayBuffer
}

/**
 * 流式写入的目标块大小（默认值）。
 * 中间块恒为 chunkSize，尾部块在 (0, chunkSize + MIN_TAIL] 内；配合 MIN_TAIL 避免微小尾巴块。
 */
const DEFAULT_STREAM_CHUNK_SIZE = 4 << 20
/** 整块写内容超过该阈值时自动落成 chunkOffsets 分块记录（与流式写同格式）。 */
const BYTES_TO_CHUNK_THRESHOLD = 16 << 20
/** 尾部块最小尺寸：小于该值的块在 close 时合并进前一块（避免一次额外读写）。 */
const MIN_TAIL_CHUNK_BYTES = 1 << 20
/** 切块下限：pending 达到 chunkSize + MIN_TAIL 才切。 */
function flushThreshold(chunkSize: number): number {
  return chunkSize + MIN_TAIL_CHUNK_BYTES
}

function isOpfsBlob(
  record: FilesBlobRecord | undefined,
): record is FilesBlobRecord & { backend: 'opfs' } {
  return record?.backend === 'opfs'
}

function shouldSpillToOpfs(byteLength: number): boolean {
  return byteLength > OPFS_SPILL_THRESHOLD && isOpfsAvailable()
}

function opfsBlobIndexRecord(
  blobId: string,
  byteSize: number,
  refCount = 1,
): FilesBlobRecord {
  return { id: blobId, refCount, backend: 'opfs', byteSize, storedByteSize: byteSize }
}

async function deleteOpfsBlobs(ids: Array<string | undefined>): Promise<void> {
  for (const id of ids) {
    if (id === undefined) continue
    try {
      await deleteOpfsBlob(id)
    } catch {
      // 正文可能已不在
    }
  }
}

function resolveChunkOffsets(blob: FilesBlobRecord): number[] | undefined {
  if (Array.isArray(blob.chunkOffsets) && blob.chunkOffsets.length > 0) {
    return blob.chunkOffsets
  }
  const size = blob.uniformChunkSize
  const count = blob.chunkCount
  if (size !== undefined && size > 0 && count !== undefined && count > 0) {
    const offsets = new Array<number>(count)
    for (let i = 0; i < count; i++) offsets[i] = i * size
    return offsets
  }
  return undefined
}

type FilesMetaRecord = {
  key: 'byte-total'
  totalBytes: number
}

export class FilesStorageFullError extends Error {
  constructor() {
    super(`数据空间已满（${formatStorageSize(getDataCapacityBytes())} 上限）`)
    this.name = 'FilesStorageFullError'
  }
}

/**
 * 目标路径已被同目录同名节点占用（同卷、同父目录、名字经大小写与 Unicode
 * 正规化后相等）。精确路径 API / ensure 撞上非文件夹 / 唯一索引兜底触发。
 * 携带库中已有的节点快照，便于调用方定位失败原因。
 */
export class FilesPathExistsError extends Error {
  /** 已存在的节点快照 */
  readonly node?: FilesNode
  constructor(message = '路径已存在', node?: FilesNode) {
    super(message)
    this.name = 'FilesPathExistsError'
    this.node = node
  }
}

let dbPromise: Promise<IDBDatabase> | undefined

export function openFilesDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(FILES_DB_NAME, FILES_DB_VERSION)
    /** v5 迁移异步执行，失败时记录并中止升级事务 */
    let migrationError: unknown

    request.onupgradeneeded = (event) => {
      const db = request.result
      const tx = request.transaction
      if (!db.objectStoreNames.contains(FILES_NODES_STORE)) {
        const store = db.createObjectStore(FILES_NODES_STORE, { keyPath: 'id' })
        store.createIndex('by-parent', ['locationId', 'parentId'], { unique: false })
        store.createIndex('by-location', 'locationId', { unique: false })
        store.createIndex('by-parent-name-key', ['locationId', 'parentId', 'nameKey'], {
          unique: true,
        })
      }
      if (!db.objectStoreNames.contains(FILES_BLOBS_STORE)) {
        db.createObjectStore(FILES_BLOBS_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(FILES_CHUNKS_STORE)) {
        db.createObjectStore(FILES_CHUNKS_STORE, { keyPath: ['blobId', 'chunkIndex'] })
      }
      if (!db.objectStoreNames.contains(FILES_META_STORE)) {
        db.createObjectStore(FILES_META_STORE, { keyPath: 'key' })
      }

      const oldVersion = event.oldVersion

      // v2/v3 游标迁移与 v5/v6 消重串行执行：跨多版本升级时若并行，
      // 消重的 getAll 可能读到尚未迁移完的旧 locationId / 旧 blob 快照。
      const run = async () => {
        const upgradeTx = tx
        if (!upgradeTx) return
        if (oldVersion > 0 && oldVersion < 2) {
          await migrateV2RepoToDev(upgradeTx)
        }
        if (oldVersion > 0 && oldVersion < 3) {
          await migrateV3BlobRef(upgradeTx)
        }
        if (oldVersion > 0 && oldVersion < 5) {
          await migrateV5UniqueChildNames(upgradeTx)
        }
        if (oldVersion > 0 && oldVersion < 6) {
          await migrateV6UniqueNameKey(upgradeTx)
        }
      }
      void run().catch((error) => {
        console.error('files: 数据库升级迁移失败', error)
        migrationError = error
        tx?.abort()
      })
    }

    request.onsuccess = () => {
      if (migrationError !== undefined) {
        dbPromise = undefined
        request.result.close()
        reject(
          migrationError instanceof Error
            ? migrationError
            : new Error('文件库升级迁移失败'),
        )
        return
      }
      // 首次打开后异步清理孤儿 chunk（崩溃 / 流式中断残留；不影响业务，失败静默）
      void sweepOrphanChunksOnce(request.result)
      resolve(request.result)
    }
    request.onerror = () => {
      dbPromise = undefined
      // 优先透传迁移的真实原因；升级中止后 request.error 只剩 AbortError
      reject(
        migrationError instanceof Error
          ? migrationError
          : request.error ?? new Error('无法打开文件 IndexedDB'),
      )
    }
  })

  return dbPromise
}

/** v2：repo 卷改名为 dev（游标迁移，Promise 化以便与后续消重串行） */
function migrateV2RepoToDev(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    const nodeStore = tx.objectStore(FILES_NODES_STORE)
    const cursorReq = nodeStore.openCursor()
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result
      if (!cursor) {
        resolve()
        return
      }
      const record = cursor.value as FilesNodeRecord
      if ((record.locationId as string) === 'repo') {
        const updateReq = cursor.update({ ...record, locationId: 'dev' })
        updateReq.onsuccess = () => cursor.continue()
        updateReq.onerror = () => reject(updateReq.error ?? new Error('v2 迁移更新失败'))
        return
      }
      cursor.continue()
    }
    cursorReq.onerror = () => reject(cursorReq.error ?? new Error('v2 迁移游标失败'))
  })
}

/** v3：为文件节点补 blobId、为 blob 补 refCount（游标迁移，Promise 化） */
function migrateV3BlobRef(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    const nodeStore = tx.objectStore(FILES_NODES_STORE)
    const blobStore = tx.objectStore(FILES_BLOBS_STORE)

    const nodeCursorReq = nodeStore.openCursor()
    nodeCursorReq.onsuccess = () => {
      const cursor = nodeCursorReq.result
      if (!cursor) {
        runBlobCursor()
        return
      }
      const record = cursor.value as FilesNodeRecord
      if (record.kind === 'file' && record.blobId === undefined) {
        const updateReq = cursor.update({ ...record, blobId: record.id })
        updateReq.onsuccess = () => cursor.continue()
        updateReq.onerror = () => reject(updateReq.error ?? new Error('v3 节点迁移失败'))
        return
      }
      cursor.continue()
    }
    nodeCursorReq.onerror = () => reject(nodeCursorReq.error ?? new Error('v3 节点游标失败'))

    const runBlobCursor = () => {
      const blobCursorReq = blobStore.openCursor()
      blobCursorReq.onsuccess = () => {
        const cursor = blobCursorReq.result
        if (!cursor) {
          resolve()
          return
        }
        const record = cursor.value as FilesBlobRecord
        if (record.refCount === undefined) {
          const updateReq = cursor.update({ ...record, refCount: 1 })
          updateReq.onsuccess = () => cursor.continue()
          updateReq.onerror = () => reject(updateReq.error ?? new Error('v3 blob 迁移失败'))
          return
        }
        cursor.continue()
      }
      blobCursorReq.onerror = () => reject(blobCursorReq.error ?? new Error('v3 blob 游标失败'))
    }
  })
}

/**
 * 清理孤儿 chunk：内容在 FILES_CHUNKS_STORE、但对应 blob 记录已不存在。
 * 正常路径（close / abort / 删除）都会同步删 chunk；孤儿仅在进程崩溃等
 * 中断场景残留，是不可读的纯空间浪费。每进程仅首次打开 DB 时跑一次。
 */
export async function sweepOrphanChunksOnce(db: IDBDatabase): Promise<void> {
  const sweepStartAt = performance.now()
  try {
    if (!db.objectStoreNames.contains(FILES_CHUNKS_STORE)) {
      return
    }
    const tx = beginIdbTransaction(
      db,
      [FILES_BLOBS_STORE, FILES_CHUNKS_STORE],
      'readwrite',
    )
    const blobs = tx.objectStore(FILES_BLOBS_STORE)
    const chunks = tx.objectStore(FILES_CHUNKS_STORE)

    // 收集现存 blob id
    const existingBlobIds = new Set<string>()
    await new Promise<void>((resolve, reject) => {
      const req = blobs.openKeyCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) {
          resolve()
          return
        }
        existingBlobIds.add(String(cursor.key))
        cursor.continue()
      }
      req.onerror = () => reject(req.error ?? new Error('blob 游标失败'))
    })

    // 收集无 blob 记录的孤儿 chunk 主键；游标结束后再删（避免迭代中改 store）
    const orphanBlobIds = new Set<string>()
    await new Promise<void>((resolve, reject) => {
      const req = chunks.openKeyCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) {
          resolve()
          return
        }
        const key = cursor.key as unknown as [string, number]
        const blobId = key[0]
        if (!existingBlobIds.has(blobId)) {
          orphanBlobIds.add(blobId)
        }
        cursor.continue()
      }
      req.onerror = () => reject(req.error ?? new Error('chunk 游标失败'))
    })

    for (const blobId of orphanBlobIds) {
      await requestToPromise(
        chunks.delete(
          IDBKeyRange.bound([blobId, 0], [blobId, Number.MAX_SAFE_INTEGER]),
        ) as IDBRequest<undefined>,
      )
    }
    await waitForTransaction(tx)
  } catch (error) {
    // 清理失败不影响业务
    console.warn('files: orphan chunk sweep failed', error)
  } finally {
    recordSystemDebugTimeline({
      layer: 'files',
      op: 'sweep-orphan-chunks-done',
      durationMs: Math.round(performance.now() - sweepStartAt),
    })
  }
}

/** 测试用：关闭并删除文件 DB，重置单例 */
export async function resetFilesDbForTests(): Promise<void> {
  if (dbPromise) {
    try {
      const db = await dbPromise
      db.close()
    } catch {
      // ignore open failures while resetting
    }
    dbPromise = undefined
  }
  resetOpfsBlobsForTests()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(FILES_DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('无法删除文件 IndexedDB'))
    request.onblocked = () => resolve()
  })
}

function resolveNodeBlobId(record: FilesNodeRecord): string {
  return record.blobId ?? record.id
}

function resolveBlobRefCount(record: FilesBlobRecord): number {
  return record.refCount ?? 1
}

function blobPayloadBytes(record: FilesBlobRecord): number {
  if (record.storedByteSize !== undefined) return record.storedByteSize
  if (isOpfsBlob(record)) return record.byteSize ?? 0
  if (record.chunked === true) return record.byteSize ?? 0
  if (record.bytes !== undefined) return record.bytes.byteLength
  if (record.text !== undefined) return estimateTextBytes(record.text)
  return 0
}

/** 读取某节点对应 blob 的实占字节（逻辑大小走 node.byteSize）。 */
export async function getNodeBlobStoredBytes(nodeId: string): Promise<number> {
  const db = await openFilesDb()
  const tx = beginIdbTransaction(db, [FILES_NODES_STORE, FILES_BLOBS_STORE], 'readonly')
  const nodeRecord = await requestToPromise(
    tx.objectStore(FILES_NODES_STORE).get(nodeId) as IDBRequest<FilesNodeRecord | undefined>,
  )
  if (!nodeRecord || nodeRecord.kind !== 'file') {
    await waitForTransaction(tx)
    return 0
  }
  const blobId = resolveNodeBlobId(nodeRecord)
  const blob = await requestToPromise(
    tx.objectStore(FILES_BLOBS_STORE).get(blobId) as IDBRequest<FilesBlobRecord | undefined>,
  )
  await waitForTransaction(tx)
  return blob ? blobPayloadBytes(blob) : 0
}

export function newFilesBlobId(): string {
  return `blob:${crypto.randomUUID()}`
}

/** 文件正文在 IndexedDB 卷中的存放方式（供属性面板等展示） */
export type FilesBlobStorageInfo = {
  blobId: string
  /** 正文所在存储；节点索引始终在 IndexedDB */
  bodyStore: 'IndexedDB' | 'OPFS'
  /** 正文分块数；未分块时为 1，OPFS 整文件也为 1 */
  chunkCount: number
  /** 逻辑大小（节点 byteSize） */
  byteSize: number
  /** 实占字节；与 byteSize 不同时属性面板可展示「占用」 */
  storedByteSize: number
}

function resolveBlobChunkCount(blob: FilesBlobRecord): number {
  if (isOpfsBlob(blob)) return 1
  if (blob.chunked === true) return blob.chunkCount ?? 0
  return 1
}

/** 读取 IndexedDB 本地卷文件的 blob 存放信息 */
export async function getFileBlobStorageInfo(
  nodeId: string,
): Promise<FilesBlobStorageInfo | undefined> {
  const db = await openFilesDb()
  const tx = beginIdbTransaction(db, [FILES_NODES_STORE, FILES_BLOBS_STORE], 'readonly')
  const node = await requestToPromise(
    tx.objectStore(FILES_NODES_STORE).get(nodeId) as IDBRequest<FilesNodeRecord | undefined>,
  )
  if (!node || node.kind !== 'file') {
    await waitForTransaction(tx)
    return undefined
  }
  const blobId = resolveNodeBlobId(node)
  const blob = await requestToPromise(
    tx.objectStore(FILES_BLOBS_STORE).get(blobId) as IDBRequest<FilesBlobRecord | undefined>,
  )
  await waitForTransaction(tx)
  if (!blob) return undefined
  return {
    blobId,
    bodyStore: isOpfsBlob(blob) ? 'OPFS' : 'IndexedDB',
    chunkCount: resolveBlobChunkCount(blob),
    byteSize: node.byteSize,
    storedByteSize: blobPayloadBytes(blob),
  }
}

/**
 * 若正文仍在 IndexedDB，整份溢到 OPFS（不附加额外写入）。
 * 已在 OPFS 或溢出失败时返回 false，不抛给调用方。
 * 溢出成功且调用方提供 onSpilled 时，会在事务提交后调用它（供安静写入通道刷新 VFS 缓存）。
 */
export async function spillIdbBlobToOpfsIfNeeded(
  nodeId: string,
  options?: { onSpilled?: () => void },
): Promise<boolean> {
  if (!isOpfsAvailable()) return false
  try {
    const db = await openFilesDb()
    const tx = beginIdbTransaction(db, [FILES_NODES_STORE, FILES_BLOBS_STORE], 'readonly')
    const node = await requestToPromise(
      tx.objectStore(FILES_NODES_STORE).get(nodeId) as IDBRequest<FilesNodeRecord | undefined>,
    )
    if (!node || node.kind !== 'file') {
      await waitForTransaction(tx)
      return false
    }
    const blobId = resolveNodeBlobId(node)
    const blob = await requestToPromise(
      tx.objectStore(FILES_BLOBS_STORE).get(blobId) as IDBRequest<FilesBlobRecord | undefined>,
    )
    await waitForTransaction(tx)
    if (!blob) return false
    if (isOpfsBlob(blob)) return true

    const shared = resolveBlobRefCount(blob) > 1
    const targetBlobId = shared ? newFilesBlobId() : blobId
    const writer = await openOpfsBlobWriter(targetBlobId)
    try {
      await copyIdbBlobToOpfsWriter(blobId, blob, writer)
      await writer.close()
    } catch (error) {
      await writer.abort()
      await deleteOpfsBlobs([targetBlobId])
      throw error
    }

    const writeTx = beginIdbTransaction(
      db,
      [FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_CHUNKS_STORE],
      'readwrite',
    )
    if (shared) {
      writeTx.objectStore(FILES_NODES_STORE).put({ ...node, blobId: targetBlobId })
      writeTx
        .objectStore(FILES_BLOBS_STORE)
        .put(opfsBlobIndexRecord(targetBlobId, node.byteSize, 1))
      const releasedOpfs = await releaseBlobRefInTx(writeTx, blobId, blob)
      await waitForTransaction(writeTx)
      await deleteOpfsBlobs([releasedOpfs])
    } else {
      if (blob.chunked === true) {
        await deleteBlobChunksInTx(writeTx, blobId)
      }
      writeTx
        .objectStore(FILES_BLOBS_STORE)
        .put(opfsBlobIndexRecord(blobId, node.byteSize, resolveBlobRefCount(blob)))
      await waitForTransaction(writeTx)
    }
    emitFilesDataStorageChanged()
    options?.onSpilled?.()
    return true
  } catch (error) {
    console.warn('[files] IndexedDB 正文溢到 OPFS 失败', error)
    return false
  }
}

/** 测试用：查看文件节点当前 blob 引用 */
export async function getFileBlobRefForTests(
  nodeId: string,
): Promise<
  { blobId: string; refCount: number; byteLength: number; backend?: 'opfs' } | undefined
> {
  const db = await openFilesDb()
  const tx = beginIdbTransaction(db, [FILES_NODES_STORE, FILES_BLOBS_STORE], 'readonly')
  const node = await requestToPromise(
    tx.objectStore(FILES_NODES_STORE).get(nodeId) as IDBRequest<FilesNodeRecord | undefined>,
  )
  if (!node || node.kind !== 'file') {
    await waitForTransaction(tx)
    return undefined
  }
  const blobId = resolveNodeBlobId(node)
  const blob = await requestToPromise(
    tx.objectStore(FILES_BLOBS_STORE).get(blobId) as IDBRequest<FilesBlobRecord | undefined>,
  )
  await waitForTransaction(tx)
  if (!blob) return undefined
  return {
    blobId,
    refCount: resolveBlobRefCount(blob),
    byteLength: blobPayloadBytes(blob),
    ...(isOpfsBlob(blob) ? { backend: 'opfs' as const } : {}),
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'))
  })
}

function waitForTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务已中止'))
  })
}

function parentKey(parentId: string | undefined): string {
  return parentId ?? FILES_ROOT_PARENT_KEY
}

/**
 * 名字唯一性比较键：大小写折叠 + Unicode NFC 正规化。
 * 同目录下按此键判重（「Foo.txt」与「foo.txt」、组合音标与预组合字符视为同名）。
 */
export function normalizeFilesNameKey(name: string): string {
  return name.normalize('NFC').toLowerCase()
}

/**
 * 写入时对同目录重名节点的处理模式：
 * - unique-suffix：事务内按「 2」「 3」规则自动改名（面向用户的创建 / 复制 / 移动）
 * - exact：同名抛「路径已存在」（精确路径 API / 系统确定性路径）
 * - folder-return：同名且是文件夹则返回已有节点（ensure 幂等），否则抛错
 */
export type FilesNodeNameMode = 'unique-suffix' | 'exact' | 'folder-return'

/**
 * 在名字集合里为 desired 计算不冲突名（「 2」「 3」后缀规则）。
 * 集合可为原始名或 nameKey；无论哪种，占用判断都按大小写 / Unicode 正规化后的
 * nameKey 进行（保证能跳过「Foo 2.txt」「foo 2.txt」这类占用）。
 */
export function uniqueNameAmong(existingNames: ReadonlySet<string>, desired: string): string {
  const keys = new Set<string>()
  for (const name of existingNames) {
    keys.add(normalizeFilesNameKey(name))
  }
  if (!keys.has(normalizeFilesNameKey(desired))) return desired

  const lastDot = desired.lastIndexOf('.')
  const hasExt = lastDot > 0 && lastDot < desired.length - 1 && !desired.slice(lastDot + 1).includes(' ')
  const stem = hasExt ? desired.slice(0, lastDot) : desired
  const ext = hasExt ? desired.slice(lastDot) : ''

  let n = 2
  while (keys.has(normalizeFilesNameKey(`${stem} ${n}${ext}`))) {
    n += 1
  }
  return `${stem} ${n}${ext}`
}

/** 事务内读取同级节点名集合（excludeId 排除自身；同一读写事务内能看到并发已提交的名字） */
async function siblingNamesInTx(
  tx: IDBTransaction,
  locationId: FilesLocationId,
  parentId: string | undefined,
  excludeId?: string,
): Promise<Set<string>> {
  const records = await requestToPromise(
    tx
      .objectStore(FILES_NODES_STORE)
      .index('by-parent')
      .getAll([locationId, parentKey(parentId)]) as IDBRequest<FilesNodeRecord[]>,
  )
  const names = new Set<string>()
  for (const record of records ?? []) {
    if (excludeId !== undefined && record.id === excludeId) continue
    names.add(record.name)
  }
  return names
}

/**
 * 在写入事务内为节点解析最终名称：查重 / 取名与落库同处一个事务，
 * 消除「先读列表 → 再写」的 check-then-act 竞态（唯一索引只做兜底）。
 */
async function resolveNameInTx(
  tx: IDBTransaction,
  identity: { locationId: FilesLocationId; parentId: string | undefined; name: string },
  nameMode: FilesNodeNameMode,
  excludeId?: string,
): Promise<{ name: string; existing?: FilesNodeRecord }> {
  const existing = await requestToPromise(
    tx
      .objectStore(FILES_NODES_STORE)
      .index('by-parent-name-key')
      .get([
        identity.locationId,
        parentKey(identity.parentId),
        normalizeFilesNameKey(identity.name),
      ]) as IDBRequest<FilesNodeRecord | undefined>,
  )
  if (!existing || existing.id === excludeId) return { name: identity.name }
  if (nameMode === 'unique-suffix') {
    const names = await siblingNamesInTx(tx, identity.locationId, identity.parentId, excludeId)
    return { name: uniqueNameAmong(names, identity.name) }
  }
  if (nameMode === 'folder-return' && existing.kind === 'folder') {
    return { name: identity.name, existing }
  }
  throw new FilesPathExistsError('路径已存在', recordToNode(existing))
}

/**
 * v5 升级迁移：消掉同目录同名重复（保留最早创建的记录原名，其余加后缀），
 * 再建 by-parent-name 唯一索引。失败时由升级事务整体回滚。
 */
async function migrateV5UniqueChildNames(tx: IDBTransaction): Promise<void> {
  const nodeStore = tx.objectStore(FILES_NODES_STORE)
  const all = await requestToPromise(nodeStore.getAll() as IDBRequest<FilesNodeRecord[]>)
  if (!all || all.length === 0) {
    nodeStore.createIndex('by-parent-name', ['locationId', 'parentId', 'name'], {
      unique: true,
    })
    return
  }

  const byNameKey = new Map<string, FilesNodeRecord[]>()
  const namesByParent = new Map<string, Set<string>>()
  for (const record of all) {
    const parentKeyOfRecord = `${record.locationId}\0${record.parentId}`
    let names = namesByParent.get(parentKeyOfRecord)
    if (!names) {
      names = new Set()
      namesByParent.set(parentKeyOfRecord, names)
    }
    names.add(record.name)

    const nameKey = `${parentKeyOfRecord}\0${record.name}`
    let group = byNameKey.get(nameKey)
    if (!group) {
      group = []
      byNameKey.set(nameKey, group)
    }
    group.push(record)
  }

  const updates: FilesNodeRecord[] = []
  for (const group of byNameKey.values()) {
    if (group.length <= 1) continue
    group.sort(
      (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    const names = namesByParent.get(`${group[0]!.locationId}\0${group[0]!.parentId}`)!
    for (const record of group.slice(1)) {
      const next = uniqueNameAmong(names, record.name)
      names.add(next)
      updates.push({ ...record, name: next, updatedAt: osNowMs() })
    }
  }

  for (const record of updates) {
    await requestToPromise(nodeStore.put(record) as IDBRequest<unknown>)
  }
  if (updates.length > 0) {
    console.log(
      `files: v5 迁移消重 ${updates.length} 条同目录重名`,
      updates.slice(0, 3).map((record) => record.name),
    )
  }

  // 消重完成后建唯一索引：必须在同一升级事务内、先消重后建，否则已有重复会让升级失败
  nodeStore.createIndex('by-parent-name', ['locationId', 'parentId', 'name'], {
    unique: true,
  })
}

/**
 * v6 升级迁移：名字唯一性升级到大小写 / Unicode（NFC）正规化。
 * 为全部节点补 nameKey；按「卷 + 父目录 + nameKey」分组消重（保留最早创建者原名，
 * 其余加后缀，后缀占用同样按 nameKey 判定）；删除 v5 的 by-parent-name 索引，
 * 新建 by-parent-name-key 唯一索引（键为 nameKey）。
 */
async function migrateV6UniqueNameKey(tx: IDBTransaction): Promise<void> {
  const nodeStore = tx.objectStore(FILES_NODES_STORE)
  const all = await requestToPromise(nodeStore.getAll() as IDBRequest<FilesNodeRecord[]>)
  const records = all ?? []

  const byKey = new Map<string, FilesNodeRecord[]>()
  const nameKeysByParent = new Map<string, Set<string>>()
  for (const record of records) {
    const parentKeyOfRecord = `${record.locationId}\0${record.parentId}`
    const recordKey = normalizeFilesNameKey(record.name)
    let keys = nameKeysByParent.get(parentKeyOfRecord)
    if (!keys) {
      keys = new Set()
      nameKeysByParent.set(parentKeyOfRecord, keys)
    }
    keys.add(recordKey)
    const groupKey = `${parentKeyOfRecord}\0${recordKey}`
    let group = byKey.get(groupKey)
    if (!group) {
      group = []
      byKey.set(groupKey, group)
    }
    group.push(record)
  }

  const renamedById = new Map<string, FilesNodeRecord>()
  for (const group of byKey.values()) {
    if (group.length <= 1) continue
    group.sort(
      (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    const keys = nameKeysByParent.get(`${group[0]!.locationId}\0${group[0]!.parentId}`)!
    for (const record of group.slice(1)) {
      const next = uniqueNameAmong(keys, record.name)
      keys.add(normalizeFilesNameKey(next))
      renamedById.set(record.id, { ...record, name: next, updatedAt: osNowMs() })
    }
  }

  const toWrite: FilesNodeRecord[] = []
  for (const record of records) {
    const renamed = renamedById.get(record.id)
    const finalRecord = renamed ?? record
    const key = normalizeFilesNameKey(finalRecord.name)
    if (renamed || finalRecord.nameKey !== key) {
      toWrite.push({ ...finalRecord, nameKey: key })
    }
  }
  for (const record of toWrite) {
    await requestToPromise(nodeStore.put(record) as IDBRequest<unknown>)
  }

  if (nodeStore.indexNames.contains('by-parent-name')) {
    nodeStore.deleteIndex('by-parent-name')
  }
  nodeStore.createIndex('by-parent-name-key', ['locationId', 'parentId', 'nameKey'], {
    unique: true,
  })
  if (renamedById.size > 0) {
    console.log(
      `files: v6 迁移消重 ${renamedById.size} 条大小写/Unicode 重名`,
      [...renamedById.values()].slice(0, 3).map((record) => record.name),
    )
  }
}

export function recordToNode(record: FilesNodeRecord): FilesNode {
  const node: FilesNode = {
    id: record.id,
    locationId: record.locationId,
    parentId: record.parentId === FILES_ROOT_PARENT_KEY ? undefined : record.parentId,
    name: record.name,
    kind: record.kind,
    mimeType: record.mimeType,
    byteSize: record.byteSize,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    attributes: normalizeFilesNodeAttributes(record.locationId, record.attributes),
  }
  if (record.contentRevisionId !== undefined) {
    node.contentRevisionId = record.contentRevisionId
  }
  if (record.target !== undefined) {
    node.target = record.target
  }
  if (record.trashOrigin !== undefined) {
    node.trashOrigin = {
      locationId: record.trashOrigin.locationId,
      parentId: record.trashOrigin.parentId === FILES_ROOT_PARENT_KEY
        ? undefined
        : record.trashOrigin.parentId,
      name: record.trashOrigin.name,
    }
  }
  return node
}

function nodeToRecord(node: FilesNode, blobId?: string): FilesNodeRecord {
  const record: FilesNodeRecord = {
    id: node.id,
    locationId: node.locationId,
    parentId: parentKey(node.parentId),
    name: node.name,
    nameKey: normalizeFilesNameKey(node.name),
    kind: node.kind,
    byteSize: node.byteSize,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    attributes: node.attributes,
  }
  if (node.mimeType !== undefined) {
    record.mimeType = node.mimeType
  }
  if (node.contentRevisionId !== undefined) {
    record.contentRevisionId = node.contentRevisionId
  }
  if (node.target !== undefined) {
    record.target = node.target
  }
  if (node.trashOrigin !== undefined) {
    record.trashOrigin = {
      locationId: node.trashOrigin.locationId,
      parentId: parentKey(node.trashOrigin.parentId),
      name: node.trashOrigin.name,
    }
  }
  if (node.kind === 'file') {
    record.blobId = blobId ?? node.id
  }
  return record
}

export function estimateTextBytes(text: string): number {
  return new TextEncoder().encode(text).length
}

/** 将文本编码为可写入 IndexedDB 的 ArrayBuffer（拷贝自 TextEncoder 视图） */
export function encodeTextToArrayBuffer(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

export function decodeBytesToText(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return new TextDecoder('utf-8', { fatal: false }).decode(view)
}

export function estimateNodeMetaBytes(
  node: Pick<FilesNode, 'name' | 'kind' | 'mimeType' | 'locationId' | 'attributes'>,
): number {
  return new TextEncoder().encode(
    JSON.stringify({
      name: node.name,
      kind: node.kind,
      mimeType: node.mimeType,
      locationId: node.locationId,
      attributes: node.attributes,
    }),
  ).length
}

export function newFilesNodeId(): string {
  return `file:${crypto.randomUUID()}`
}

export async function getFilesTotalBytes(): Promise<number> {
  const db = await openFilesDb()
  const tx = beginIdbTransaction(db, FILES_META_STORE, 'readonly')
  const meta = await requestToPromise(
    tx.objectStore(FILES_META_STORE).get('byte-total') as IDBRequest<FilesMetaRecord | undefined>,
  )
  await waitForTransaction(tx)
  return meta?.totalBytes ?? 0
}

/** 计入数据空间配额的文件卷（IndexedDB 本地卷） */
export const DATA_SPACE_FILE_LOCATIONS: readonly FilesLocationId[] = ['local', 'dev', 'tmp']

/** 文件应用侧边栏展示占用统计的卷：数据卷 + 废纸篓 */
export const FILE_SIDEBAR_METRIC_LOCATIONS: readonly FilesLocationId[] = [
  'local',
  'dev',
  'tmp',
  'trash',
]

export type FilesLocationBytes = {
  locationId: FilesLocationId
  bytes: number
}

/**
 * 按卷汇总文件实占字节（blob storedByteSize）。
 * 默认统计 local / dev / tmp（设置「文件」次级页展示）；也可传入指定卷列表。
 * 总占用仍以 getFilesTotalBytes() 为准。
 */
export async function getFilesBytesByLocation(
  locations: readonly FilesLocationId[] = DATA_SPACE_FILE_LOCATIONS,
): Promise<FilesLocationBytes[]> {
  const scanStartAt = performance.now()
  const db = await openFilesDb()
  const tx = beginIdbTransaction(
    db,
    [FILES_NODES_STORE, FILES_BLOBS_STORE],
    'readonly',
  )
  const index = tx.objectStore(FILES_NODES_STORE).index('by-location')
  const blobs = tx.objectStore(FILES_BLOBS_STORE)

  const results: FilesLocationBytes[] = []
  for (const locationId of locations) {
    const records = await requestToPromise(
      index.getAll(locationId) as IDBRequest<FilesNodeRecord[]>,
    )
    let bytes = 0
    for (const record of records ?? []) {
      if (record.kind !== 'file') continue
      const blobId = resolveNodeBlobId(record)
      const blob = await requestToPromise(
        blobs.get(blobId) as IDBRequest<FilesBlobRecord | undefined>,
      )
      if (blob) {
        bytes += blobPayloadBytes(blob)
      }
    }
    results.push({ locationId, bytes })
  }

  await waitForTransaction(tx)
  recordSystemDebugTimeline({
    layer: 'files',
    op: 'bytes-by-location-done',
    detail: `${locations.length} locations`,
    durationMs: Math.round(performance.now() - scanStartAt),
  })
  return results
}

function emitFilesDataStorageChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DATA_STORAGE_CHANGED_EVENT))
  }
}

async function assertCapacity(additionalBytes: number): Promise<number> {
  const [filesTotal, dataTotal] = await Promise.all([
    getFilesTotalBytes(),
    getTotalDataStorageBytes(),
  ])
  if (additionalBytes > 0 && filesTotal + dataTotal + additionalBytes > getDataCapacityBytes()) {
    throw new FilesStorageFullError()
  }
  return filesTotal
}

/** 粘贴等批量写入前预检：额外占用是否会超过数据空间上限 */
export async function assertAdditionalBytesAvailable(additionalBytes: number): Promise<void> {
  await assertCapacity(additionalBytes)
}

export async function listChildNodes(
  locationId: FilesLocationId,
  parentId: string | undefined,
): Promise<FilesNode[]> {
  const db = await openFilesDb()
  const tx = beginIdbTransaction(db, FILES_NODES_STORE, 'readonly')
  const index = tx.objectStore(FILES_NODES_STORE).index('by-parent')
  const records = await requestToPromise(
    index.getAll([locationId, parentKey(parentId)]) as IDBRequest<FilesNodeRecord[]>,
  )
  await waitForTransaction(tx)
  const nodes = (records ?? []).map(recordToNode)
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })
  return nodes
}

export async function getNode(id: string): Promise<FilesNode | undefined> {
  const db = await openFilesDb()
  const tx = beginIdbTransaction(db, FILES_NODES_STORE, 'readonly')
  const record = await requestToPromise(
    tx.objectStore(FILES_NODES_STORE).get(id) as IDBRequest<FilesNodeRecord | undefined>,
  )
  await waitForTransaction(tx)
  return record ? recordToNode(record) : undefined
}

export async function readBlobText(nodeId: string): Promise<string> {
  const db = await openFilesDb()
  const tx = beginIdbTransaction(db, [FILES_NODES_STORE, FILES_BLOBS_STORE], 'readonly')
  const nodeRecord = await requestToPromise(
    tx.objectStore(FILES_NODES_STORE).get(nodeId) as IDBRequest<FilesNodeRecord | undefined>,
  )
  if (!nodeRecord || nodeRecord.kind !== 'file') {
    await waitForTransaction(tx)
    return ''
  }
  const blobId = resolveNodeBlobId(nodeRecord)
  const record = await requestToPromise(
    tx.objectStore(FILES_BLOBS_STORE).get(blobId) as IDBRequest<FilesBlobRecord | undefined>,
  )
  await waitForTransaction(tx)
  if (!record) return ''
  if (isOpfsBlob(record)) {
    const bytes = await readOpfsBlobBytes(blobId)
    return bytes === undefined ? '' : decodeBytesToText(bytes)
  }
  if (record.chunked === true) {
    const bytes = await readChunkedBlobBytes(blobId, record)
    return bytes === undefined ? '' : decodeBytesToText(bytes)
  }
  if (record.bytes !== undefined) {
    return decodeBytesToText(record.bytes)
  }
  return record.text ?? ''
}

/** 读取本地卷内容字节；仅有旧 text 时按 UTF-8 编码返回（兼容迁移前数据） */
export async function readBlobBytes(nodeId: string): Promise<ArrayBuffer | undefined> {
  const db = await openFilesDb()
  const tx = beginIdbTransaction(db, [FILES_NODES_STORE, FILES_BLOBS_STORE], 'readonly')
  const nodeRecord = await requestToPromise(
    tx.objectStore(FILES_NODES_STORE).get(nodeId) as IDBRequest<FilesNodeRecord | undefined>,
  )
  if (!nodeRecord || nodeRecord.kind !== 'file') {
    await waitForTransaction(tx)
    return undefined
  }
  const blobId = resolveNodeBlobId(nodeRecord)
  const record = await requestToPromise(
    tx.objectStore(FILES_BLOBS_STORE).get(blobId) as IDBRequest<FilesBlobRecord | undefined>,
  )
  await waitForTransaction(tx)
  if (!record) return undefined
  if (isOpfsBlob(record)) {
    return readOpfsBlobBytes(blobId)
  }
  if (record.chunked === true) {
    return readChunkedBlobBytes(blobId, record)
  }
  if (record.bytes !== undefined) return record.bytes
  if (record.text !== undefined) return encodeTextToArrayBuffer(record.text)
  return undefined
}

/** 按偏移索引读取分块 blob；缺席槽按文件逻辑大小填零。 */
async function readChunkedBlobBytes(
  blobId: string,
  blob: FilesBlobRecord,
): Promise<ArrayBuffer | undefined> {
  let byteSize = blob.byteSize ?? 0
  const offsets = resolveChunkOffsets(blob)
  const db = await openFilesDb()
  const tx = beginIdbTransaction(db, FILES_CHUNKS_STORE, 'readonly')
  const store = tx.objectStore(FILES_CHUNKS_STORE)
  const range = IDBKeyRange.bound([blobId, 0], [blobId, Number.MAX_SAFE_INTEGER])
  const records = await requestToPromise(
    store.getAll(range) as IDBRequest<FilesChunkRecord[]>,
  )
  await waitForTransaction(tx)
  if (!records || records.length === 0) {
    return byteSize === 0 ? undefined : new ArrayBuffer(byteSize)
  }
  // 兼容旧数据：byteSize 缺失时从 chunk 实际长度推导
  if (byteSize === 0) {
    for (const record of records) {
      const idx = record.chunkIndex
      const off = offsets?.[idx]
      if (off !== undefined) {
        byteSize = Math.max(byteSize, off + record.bytes.byteLength)
      } else {
        byteSize += record.bytes.byteLength
      }
    }
  }
  // 整文件物化：getAll 全部 chunk 后在主线程拼整块
  const materializeStartAt = performance.now()
  const out = new Uint8Array(byteSize)
  if (offsets !== undefined) {
    for (const record of records) {
      const offset = offsets[record.chunkIndex]
      if (offset === undefined || offset >= byteSize) continue
      const src = new Uint8Array(record.bytes)
      const len = Math.min(src.byteLength, byteSize - offset)
      out.set(src.subarray(0, len), offset)
    }
  } else {
    let offset = 0
    const sorted = [...records].sort((a, b) => a.chunkIndex - b.chunkIndex)
    for (const record of sorted) {
      const src = new Uint8Array(record.bytes)
      const len = Math.min(src.byteLength, byteSize - offset)
      if (len <= 0) break
      out.set(src.subarray(0, len), offset)
      offset += src.byteLength
    }
  }
  const durationMs = performance.now() - materializeStartAt
  if (byteSize > 8 * 1024 * 1024 || durationMs > 32) {
    recordSystemDebugHot({
      layer: 'files',
      op: 'blob-materialize',
      detail: `${byteSize}B ${records.length} chunks`,
      durationMs,
    })
  } else {
    countSystemDebugHot('files', 'blob-materialize', durationMs)
  }
  return out.buffer
}

/**
 * 按 [offset, offset+length) 读取本地卷内容字节（新格式按偏移索引只取覆盖块，
 * 旧格式/整块 blob 全读后裁切）。返回的 ArrayBuffer 只含请求区间。
 * 越界时按实际可用内容返回（offset 超文件末尾 → 空 ArrayBuffer）。
 */
export async function readBlobBytesRange(
  nodeId: string,
  offset: number,
  length: number,
): Promise<ArrayBuffer | undefined> {
  const start = Math.max(0, offset)
  const want = Math.max(0, length)
  const db = await openFilesDb()
  const tx = beginIdbTransaction(db, [FILES_NODES_STORE, FILES_BLOBS_STORE], 'readonly')
  const nodeRecord = await requestToPromise(
    tx.objectStore(FILES_NODES_STORE).get(nodeId) as IDBRequest<FilesNodeRecord | undefined>,
  )
  if (!nodeRecord || nodeRecord.kind !== 'file') {
    await waitForTransaction(tx)
    return undefined
  }
  const blobId = resolveNodeBlobId(nodeRecord)
  const record = await requestToPromise(
    tx.objectStore(FILES_BLOBS_STORE).get(blobId) as IDBRequest<FilesBlobRecord | undefined>,
  )
  await waitForTransaction(tx)
  if (!record) return undefined

  if (isOpfsBlob(record)) {
    return readOpfsBlobRange(blobId, start, want)
  }

  if (record.chunked === true) {
    const offsets = resolveChunkOffsets(record)
    if (offsets !== undefined) {
      return readChunkedBlobBytesRange(blobId, offsets, record.byteSize ?? 0, start, want)
    }
    // 旧格式（无偏移索引）：整读后裁切（语义正确，仅不省 IO）
    const all = await readChunkedBlobBytes(blobId, record)
    if (all === undefined) return undefined
    return sliceArrayBufferRange(all, start, want)
  }
  if (record.bytes !== undefined) {
    return sliceArrayBufferRange(record.bytes, start, want)
  }
  if (record.text !== undefined) {
    return sliceArrayBufferRange(encodeTextToArrayBuffer(record.text), start, want)
  }
  return undefined
}

/**
 * 按偏移索引读取 [start, start+want) 区间；缺席槽按文件逻辑大小填零。
 * 输出长度 = min(want, byteSize - start)，不会因缺块而截短。
 */
async function readChunkedBlobBytesRange(
  blobId: string,
  chunkOffsets: number[],
  byteSize: number,
  start: number,
  want: number,
): Promise<ArrayBuffer | undefined> {
  if (start >= byteSize || want <= 0) return new ArrayBuffer(0)
  const end = Math.min(start + want, byteSize)
  const outputLength = end - start

  // 二分找 startIdx：最后一个 chunkOffsets[i] <= start；endIdx：chunkOffsets[j] < end
  const firstIndex = upperBound(chunkOffsets, start) - 1
  if (firstIndex < 0) {
    // [0, start) 全是洞，只要 [start, end)
    return new ArrayBuffer(outputLength)
  }
  const lastIndex = Math.max(firstIndex, upperBound(chunkOffsets, end) - 1)

  const db = await openFilesDb()
  const tx = beginIdbTransaction(db, FILES_CHUNKS_STORE, 'readonly')
  const store = tx.objectStore(FILES_CHUNKS_STORE)
  const range = IDBKeyRange.bound([blobId, firstIndex], [blobId, lastIndex])
  const records = await requestToPromise(
    store.getAll(range) as IDBRequest<FilesChunkRecord[]>,
  )
  await waitForTransaction(tx)

  const byIndex = new Map<number, Uint8Array>()
  for (const record of records ?? []) {
    byIndex.set(record.chunkIndex, new Uint8Array(record.bytes))
  }
  const out = new Uint8Array(outputLength)
  for (let i = firstIndex; i <= lastIndex; i++) {
    const chunk = byIndex.get(i)
    if (!chunk) continue
    const chunkStart = chunkOffsets[i]!
    const chunkEnd = chunkStart + chunk.byteLength
    const from = Math.max(start, chunkStart)
    const to = Math.min(end, chunkEnd)
    if (to <= from) continue
    const src = chunk.subarray(from - chunkStart, to - chunkStart)
    out.set(src, from - start)
  }
  return out.buffer
}

/** 二分：返回第一个 arr[i] > target 的索引（arr 升序）。 */
function upperBound(arr: number[], target: number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (arr[mid] <= target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** 从 ArrayBuffer 裁切 [start, start+want)，越界截断。 */
function sliceArrayBufferRange(bytes: ArrayBuffer, start: number, want: number): ArrayBuffer {
  const from = Math.max(0, start)
  const to = Math.min(bytes.byteLength, from + want)
  if (to <= from) return new ArrayBuffer(0)
  return bytes.slice(from, to)
}

function isAllZeros(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.byteLength; i++) {
    if (bytes[i] !== 0) return false
  }
  return true
}

function countNonZeroBytes(bytes: Uint8Array): number {
  let count = 0
  for (let i = 0; i < bytes.byteLength; i++) {
    if (bytes[i] !== 0) count += 1
  }
  return count
}

/** 在既有事务内删除某 blob 的全部分块记录（主键范围删除，O(chunkCount) 由 IDB 承担） */
async function deleteBlobChunksInTx(tx: IDBTransaction, blobId: string): Promise<void> {
  const store = tx.objectStore(FILES_CHUNKS_STORE)
  await requestToPromise(
    store.delete(IDBKeyRange.bound([blobId, 0], [blobId, Number.MAX_SAFE_INTEGER])) as IDBRequest<
      undefined
    >,
  )
}

/**
 * 事务内把 blob 引用减一；归零则删索引和 IDB 分块。
 * 若正文在 OPFS，返回该 id，调用方须在事务提交后再删 OPFS 文件。
 */
async function releaseBlobRefInTx(
  tx: IDBTransaction,
  blobId: string,
  blob: FilesBlobRecord | undefined,
): Promise<string | undefined> {
  if (!blob) return undefined
  const blobs = tx.objectStore(FILES_BLOBS_STORE)
  const nextRef = resolveBlobRefCount(blob) - 1
  if (nextRef > 0) {
    blobs.put({ ...blob, refCount: nextRef } satisfies FilesBlobRecord)
    return undefined
  }
  blobs.delete(blobId)
  if (blob.chunked === true) {
    await deleteBlobChunksInTx(tx, blobId)
  }
  return isOpfsBlob(blob) ? blobId : undefined
}

/** 在既有事务内对 byte-total 做增量修正（避免外部并发写覆盖） */
async function adjustByteTotal(tx: IDBTransaction, delta: number): Promise<void> {
  const meta = tx.objectStore(FILES_META_STORE)
  const current = await requestToPromise(
    meta.get('byte-total') as IDBRequest<FilesMetaRecord | undefined>,
  )
  meta.put({
    key: 'byte-total',
    totalBytes: Math.max(0, (current?.totalBytes ?? 0) + delta),
  } satisfies FilesMetaRecord)
}

/**
 * 在既有事务内落库一个 blob 的内容：超阈值时切成 chunkOffsets 分块记录
 * （与流式写同格式，范围读路径共用），否则维持单条 bytes 整块记录。
 * 仅做 put（不 get），可在 commitFilesBatch 单事务内复用。
 */
function putBlobContentInTx(
  tx: IDBTransaction,
  blobId: string,
  bytes: ArrayBuffer,
  refCount = 1,
): void {
  const blobs = tx.objectStore(FILES_BLOBS_STORE)
  const chunks = tx.objectStore(FILES_CHUNKS_STORE)
  if (bytes.byteLength > BYTES_TO_CHUNK_THRESHOLD) {
    const chunkOffsets: number[] = []
    let offset = 0
    while (offset < bytes.byteLength) {
      const size = Math.min(DEFAULT_STREAM_CHUNK_SIZE, bytes.byteLength - offset)
      chunks.put({
        blobId,
        chunkIndex: chunkOffsets.length,
        bytes: bytes.slice(offset, offset + size),
      } satisfies FilesChunkRecord)
      chunkOffsets.push(offset)
      offset += size
    }
    blobs.put({
      id: blobId,
      refCount,
      chunked: true,
      byteSize: bytes.byteLength,
      chunkCount: chunkOffsets.length,
      chunkOffsets,
      storedByteSize: bytes.byteLength,
    } satisfies FilesBlobRecord)
  } else {
    blobs.put({ id: blobId, bytes, refCount, storedByteSize: bytes.byteLength } satisfies FilesBlobRecord)
  }
}

export async function createFileWithBlob(params: {
  node: FilesNode
  text: string
  metaBytes: number
  nameMode: FilesNodeNameMode
}): Promise<FilesNode> {
  const textBytes = estimateTextBytes(params.text)
  const needed = params.metaBytes + textBytes
  const total = await assertCapacity(needed)
  const node: FilesNode = {
    ...params.node,
    byteSize: textBytes,
    contentRevisionId: newContentRevisionId(),
  }
  const blobId = node.id
  const bytes = encodeTextToArrayBuffer(params.text)
  const useOpfs = shouldSpillToOpfs(bytes.byteLength)
  if (useOpfs) {
    await writeOpfsBlobBytes(blobId, new Uint8Array(bytes))
  }

  const db = await openFilesDb()
  try {
    const tx = beginIdbTransaction(db, [FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_CHUNKS_STORE, FILES_META_STORE], 'readwrite')
    const resolved = await resolveNameInTx(tx, node, params.nameMode)
    if (resolved.existing) {
      await waitForTransaction(tx)
      if (useOpfs) await deleteOpfsBlobs([blobId])
      return recordToNode(resolved.existing)
    }
    const finalNode = resolved.name === node.name ? node : { ...node, name: resolved.name }
    const finalMeta =
      params.metaBytes + (estimateNodeMetaBytes(finalNode) - estimateNodeMetaBytes(node))
    tx.objectStore(FILES_NODES_STORE).put(nodeToRecord(finalNode, blobId))
    if (useOpfs) {
      tx.objectStore(FILES_BLOBS_STORE).put(opfsBlobIndexRecord(blobId, textBytes))
    } else {
      putBlobContentInTx(tx, blobId, bytes)
    }
    tx.objectStore(FILES_META_STORE).put({
      key: 'byte-total',
      totalBytes: total + finalMeta + textBytes,
    } satisfies FilesMetaRecord)
    await waitForTransaction(tx)
    emitFilesDataStorageChanged()
    return finalNode
  } catch (error) {
    if (useOpfs) await deleteOpfsBlobs([blobId])
    throw error
  }
}

export async function createFileWithBytes(params: {
  node: FilesNode
  bytes: ArrayBuffer
  metaBytes: number
  nameMode: FilesNodeNameMode
}): Promise<FilesNode> {
  const contentBytes = params.bytes.byteLength
  const needed = params.metaBytes + contentBytes
  const total = await assertCapacity(needed)
  const node: FilesNode = {
    ...params.node,
    byteSize: contentBytes,
    contentRevisionId: newContentRevisionId(),
  }
  const blobId = node.id
  const useOpfs = shouldSpillToOpfs(contentBytes)
  if (useOpfs) {
    await writeOpfsBlobBytes(blobId, new Uint8Array(params.bytes))
  }

  const db = await openFilesDb()
  try {
    const tx = beginIdbTransaction(db, [FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_CHUNKS_STORE, FILES_META_STORE], 'readwrite')
    const resolved = await resolveNameInTx(tx, node, params.nameMode)
    if (resolved.existing) {
      await waitForTransaction(tx)
      if (useOpfs) await deleteOpfsBlobs([blobId])
      return recordToNode(resolved.existing)
    }
    const finalNode = resolved.name === node.name ? node : { ...node, name: resolved.name }
    const finalMeta =
      params.metaBytes + (estimateNodeMetaBytes(finalNode) - estimateNodeMetaBytes(node))
    tx.objectStore(FILES_NODES_STORE).put(nodeToRecord(finalNode, blobId))
    if (useOpfs) {
      tx.objectStore(FILES_BLOBS_STORE).put(opfsBlobIndexRecord(blobId, contentBytes))
    } else {
      putBlobContentInTx(tx, blobId, params.bytes)
    }
    tx.objectStore(FILES_META_STORE).put({
      key: 'byte-total',
      totalBytes: total + finalMeta + contentBytes,
    } satisfies FilesMetaRecord)
    await waitForTransaction(tx)
    emitFilesDataStorageChanged()
    return finalNode
  } catch (error) {
    if (useOpfs) await deleteOpfsBlobs([blobId])
    throw error
  }
}

/**
 * 创建定长稀疏二进制文件：只写节点 + 分块 blob 元数据，chunks 表为空。
 * 逻辑大小为 byteSize，实占 0；缺席槽读时按零填充。
 */
export async function createSparseFile(params: {
  node: FilesNode
  byteSize: number
  /** 等分槽大小；默认 4MiB */
  chunkSize?: number
  metaBytes: number
  nameMode: FilesNodeNameMode
}): Promise<FilesNode> {
  const byteSize = Math.max(0, params.byteSize)
  const chunkSize = params.chunkSize ?? DEFAULT_STREAM_CHUNK_SIZE
  const chunkCount = byteSize === 0 ? 0 : Math.ceil(byteSize / chunkSize)
  const needed = params.metaBytes
  const total = await assertCapacity(needed)

  const node: FilesNode = {
    ...params.node,
    byteSize,
    contentRevisionId: newContentRevisionId(),
  }
  const blobId = node.id

  const db = await openFilesDb()
  const tx = beginIdbTransaction(
    db,
    [FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_META_STORE],
    'readwrite',
  )
  const resolved = await resolveNameInTx(tx, node, params.nameMode)
  if (resolved.existing) {
    await waitForTransaction(tx)
    throw new FilesPathExistsError('路径已存在', recordToNode(resolved.existing))
  }
  const finalNode = resolved.name === node.name ? node : { ...node, name: resolved.name }
  const finalMeta =
    params.metaBytes + (estimateNodeMetaBytes(finalNode) - estimateNodeMetaBytes(node))
  tx.objectStore(FILES_NODES_STORE).put(nodeToRecord(finalNode, blobId))
  if (byteSize > 0) {
    tx.objectStore(FILES_BLOBS_STORE).put({
      id: blobId,
      refCount: 1,
      chunked: true,
      byteSize,
      chunkCount,
      uniformChunkSize: chunkSize,
      storedByteSize: 0,
    } satisfies FilesBlobRecord)
  }
  tx.objectStore(FILES_META_STORE).put({
    key: 'byte-total',
    totalBytes: total + finalMeta,
  } satisfies FilesMetaRecord)
  await waitForTransaction(tx)
  emitFilesDataStorageChanged()
  return finalNode
}

/**
 * 复制文件节点并共享同一 blob（APFS clone 语义）。
 * 配额只增加目标节点元数据；不拷贝内容字节。
 */
export async function cloneFileNodeWithSharedBlob(params: {
  sourceNodeId: string
  node: FilesNode
  metaBytes: number
  nameMode: FilesNodeNameMode
}): Promise<FilesNode> {
  const total = await assertCapacity(params.metaBytes)

  const db = await openFilesDb()
  const readTx = beginIdbTransaction(db, [FILES_NODES_STORE, FILES_BLOBS_STORE], 'readonly')
  const source = await requestToPromise(
    readTx
      .objectStore(FILES_NODES_STORE)
      .get(params.sourceNodeId) as IDBRequest<FilesNodeRecord | undefined>,
  )
  if (!source || source.kind !== 'file') {
    await waitForTransaction(readTx)
    throw new Error('源文件不存在')
  }
  const blobId = resolveNodeBlobId(source)
  const blob = await requestToPromise(
    readTx.objectStore(FILES_BLOBS_STORE).get(blobId) as IDBRequest<FilesBlobRecord | undefined>,
  )
  await waitForTransaction(readTx)
  if (!blob) {
    throw new Error('源文件内容不存在')
  }

  const node: FilesNode = {
    ...params.node,
    kind: 'file',
    byteSize: source.byteSize,
    mimeType: params.node.mimeType ?? source.mimeType,
    contentRevisionId: source.contentRevisionId ?? newContentRevisionId(),
  }

  const writeTx = beginIdbTransaction(db, 
    [FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_META_STORE],
    'readwrite',
  )
  const resolved = await resolveNameInTx(writeTx, node, params.nameMode)
  if (resolved.existing) {
    await waitForTransaction(writeTx)
    return recordToNode(resolved.existing)
  }
  const finalNode = resolved.name === node.name ? node : { ...node, name: resolved.name }
  const finalMeta =
    params.metaBytes + (estimateNodeMetaBytes(finalNode) - estimateNodeMetaBytes(node))
  const nextRef = resolveBlobRefCount(blob) + 1
  writeTx.objectStore(FILES_BLOBS_STORE).put({
    ...blob,
    refCount: nextRef,
  } satisfies FilesBlobRecord)
  writeTx.objectStore(FILES_NODES_STORE).put(nodeToRecord(finalNode, blobId))
  writeTx.objectStore(FILES_META_STORE).put({
    key: 'byte-total',
    totalBytes: total + finalMeta,
  } satisfies FilesMetaRecord)
  await waitForTransaction(writeTx)
  emitFilesDataStorageChanged()
  return finalNode
}

export async function createFolderNode(params: {
  node: FilesNode
  metaBytes: number
  nameMode: FilesNodeNameMode
}): Promise<FilesNode> {
  const total = await assertCapacity(params.metaBytes)
  const db = await openFilesDb()
  const tx = beginIdbTransaction(db, [FILES_NODES_STORE, FILES_META_STORE], 'readwrite')
  const resolved = await resolveNameInTx(tx, params.node, params.nameMode)
  if (resolved.existing) {
    await waitForTransaction(tx)
    return recordToNode(resolved.existing)
  }
  const finalNode =
    resolved.name === params.node.name ? params.node : { ...params.node, name: resolved.name }
  const finalMeta =
    params.metaBytes + (estimateNodeMetaBytes(finalNode) - estimateNodeMetaBytes(params.node))
  tx.objectStore(FILES_NODES_STORE).put(nodeToRecord(finalNode))
  tx.objectStore(FILES_META_STORE).put({
    key: 'byte-total',
    totalBytes: total + finalMeta,
  } satisfies FilesMetaRecord)
  await waitForTransaction(tx)
  emitFilesDataStorageChanged()
  return finalNode
}

/** 创建符号链接节点（无 blob；target 存在节点元数据） */
export async function createSymlinkNode(params: {
  node: FilesNode
  metaBytes: number
  nameMode: FilesNodeNameMode
}): Promise<FilesNode> {
  if (params.node.kind !== 'symlink' || params.node.target === undefined) {
    throw new Error('createSymlinkNode 需要 kind=symlink 且带 target')
  }
  return createFolderNode(params)
}

export async function writeBlobText(params: {
  id: string
  text: string
  previousByteSize: number
  nameMetaDelta: number
}): Promise<FilesNode> {
  const textBytes = estimateTextBytes(params.text)
  const bytes = encodeTextToArrayBuffer(params.text)
  return writeFileContentCow({
    id: params.id,
    bytes,
    contentByteSize: textBytes,
    previousByteSize: params.previousByteSize,
    nameMetaDelta: params.nameMetaDelta,
  })
}

export async function writeBlobBytes(params: {
  id: string
  bytes: ArrayBuffer
  previousByteSize: number
  nameMetaDelta: number
}): Promise<FilesNode> {
  return writeFileContentCow({
    id: params.id,
    bytes: params.bytes,
    contentByteSize: params.bytes.byteLength,
    previousByteSize: params.previousByteSize,
    nameMetaDelta: params.nameMetaDelta,
  })
}

async function commitOpfsRangeWrite(params: {
  nodeRecord: FilesNodeRecord
  blob: FilesBlobRecord
  blobId: string
  offset: number
  bytes: Uint8Array
  shared: boolean
  newByteSize: number
  capacityDelta: number
  total: number
}): Promise<FilesNode> {
  const targetBlobId = params.shared ? newFilesBlobId() : params.blobId
  if (params.shared) {
    await copyOpfsBlob(params.blobId, targetBlobId)
  }
  await writeOpfsBlobRange(targetBlobId, params.offset, params.bytes)

  const db = await openFilesDb()
  const writeTx = beginIdbTransaction(
    db,
    [FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_CHUNKS_STORE, FILES_META_STORE],
    'readwrite',
  )
  const updated: FilesNodeRecord = {
    ...params.nodeRecord,
    blobId: targetBlobId,
    byteSize: params.newByteSize,
    updatedAt: osNowMs(),
    contentRevisionId: newContentRevisionId(),
    attributes: normalizeFilesNodeAttributes(
      params.nodeRecord.locationId,
      params.nodeRecord.attributes,
    ),
  }
  writeTx.objectStore(FILES_NODES_STORE).put(updated)
  let releasedOpfs: string | undefined
  if (params.shared) {
    writeTx
      .objectStore(FILES_BLOBS_STORE)
      .put(opfsBlobIndexRecord(targetBlobId, params.newByteSize))
    releasedOpfs = await releaseBlobRefInTx(writeTx, params.blobId, params.blob)
  } else {
    writeTx.objectStore(FILES_BLOBS_STORE).put({
      ...params.blob,
      byteSize: params.newByteSize,
    } satisfies FilesBlobRecord)
  }
  writeTx.objectStore(FILES_META_STORE).put({
    key: 'byte-total',
    totalBytes: Math.max(0, params.total + params.capacityDelta),
  } satisfies FilesMetaRecord)
  await waitForTransaction(writeTx)
  await deleteOpfsBlobs([releasedOpfs])
  emitFilesDataStorageChanged()
  return recordToNode(updated)
}

async function spillIdbRangeWriteToOpfs(params: {
  nodeRecord: FilesNodeRecord
  blob: FilesBlobRecord | undefined
  blobId: string
  offset: number
  bytes: Uint8Array
  shared: boolean
  newByteSize: number
  capacityDelta: number
  total: number
}): Promise<FilesNode> {
  const targetBlobId = params.shared ? newFilesBlobId() : params.blobId
  const writer = await openOpfsBlobWriter(targetBlobId)
  try {
    await copyIdbBlobToOpfsWriter(params.blobId, params.blob, writer)
    if (params.bytes.byteLength > 0) {
      await writer.writeAt(params.offset, params.bytes)
    }
    await writer.close()
  } catch (error) {
    await writer.abort()
    await deleteOpfsBlobs([targetBlobId])
    throw error
  }

  const db = await openFilesDb()
  const writeTx = beginIdbTransaction(
    db,
    [FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_CHUNKS_STORE, FILES_META_STORE],
    'readwrite',
  )
  const updated: FilesNodeRecord = {
    ...params.nodeRecord,
    blobId: targetBlobId,
    byteSize: params.newByteSize,
    updatedAt: osNowMs(),
    contentRevisionId: newContentRevisionId(),
    attributes: normalizeFilesNodeAttributes(
      params.nodeRecord.locationId,
      params.nodeRecord.attributes,
    ),
  }
  writeTx.objectStore(FILES_NODES_STORE).put(updated)
  writeTx
    .objectStore(FILES_BLOBS_STORE)
    .put(opfsBlobIndexRecord(targetBlobId, params.newByteSize, params.shared ? 1 : resolveBlobRefCount(params.blob ?? { id: params.blobId })))
  let releasedOpfs: string | undefined
  if (params.shared) {
    releasedOpfs = await releaseBlobRefInTx(writeTx, params.blobId, params.blob)
  } else if (params.blob?.chunked === true) {
    await deleteBlobChunksInTx(writeTx, params.blobId)
  }
  writeTx.objectStore(FILES_META_STORE).put({
    key: 'byte-total',
    totalBytes: Math.max(0, params.total + params.capacityDelta),
  } satisfies FilesMetaRecord)
  await waitForTransaction(writeTx)
  await deleteOpfsBlobs([releasedOpfs])
  emitFilesDataStorageChanged()
  return recordToNode(updated)
}

/**
 * 按偏移随机写：在文件 [offset, offset+bytes.length) 处覆盖写入。
 * 支持 chunk 拆分/合并、COW、配额增量；等长分块文件自动处理缺席槽 = 全零。
 * 当前限制：offset 不能超过当前文件末尾（不支持空洞扩展）。
 */
export async function writeBlobBytesRange(params: {
  nodeId: string
  offset: number
  bytes: ArrayBuffer | Uint8Array
}): Promise<FilesNode> {
  const { nodeId, offset } = params
  const bytes = params.bytes instanceof Uint8Array ? params.bytes : new Uint8Array(params.bytes)

  if (offset < 0) {
    throw new Error('offset 不能为负数')
  }
  if (bytes.byteLength === 0) {
    const node = await getNode(nodeId)
    if (!node || node.kind !== 'file') {
      throw new Error('文件不存在')
    }
    return node
  }

  const db = await openFilesDb()
  const readTx = beginIdbTransaction(db, [FILES_NODES_STORE, FILES_BLOBS_STORE], 'readonly')
  const nodeRecord = await requestToPromise(
    readTx.objectStore(FILES_NODES_STORE).get(nodeId) as IDBRequest<FilesNodeRecord | undefined>,
  )
  if (!nodeRecord || nodeRecord.kind !== 'file') {
    await waitForTransaction(readTx)
    throw new Error('文件不存在')
  }
  const blobId = resolveNodeBlobId(nodeRecord)
  const blob = await requestToPromise(
    readTx.objectStore(FILES_BLOBS_STORE).get(blobId) as IDBRequest<FilesBlobRecord | undefined>,
  )
  await waitForTransaction(readTx)

  const oldLogicalByteSize = nodeRecord.byteSize ?? blob?.byteSize ?? 0
  const oldStoredByteSize = blob ? blobPayloadBytes(blob) : 0
  if (offset > oldLogicalByteSize) {
    throw new Error('offset 超出文件末尾，当前不支持空洞扩展')
  }
  countSystemDebugHot('files', 'range-write', bytes.byteLength)

  const refCount = blob ? resolveBlobRefCount(blob) : 1
  const shared = refCount > 1
  const writeStart = offset
  const writeEnd = offset + bytes.byteLength
  const newLogicalByteSize = Math.max(oldLogicalByteSize, writeEnd)

  if (isOpfsBlob(blob)) {
    const capacityDelta = bytes.byteLength
    const total = await assertCapacity(capacityDelta)
    return commitOpfsRangeWrite({
      nodeRecord,
      blob,
      blobId,
      offset,
      bytes,
      shared,
      newByteSize: newLogicalByteSize,
      capacityDelta,
      total,
    })
  }

  // 有洞文件禁止卸到 OPFS，避免把洞物化；写入含零也可能打出新洞。
  const hasHolesNow = oldStoredByteSize < oldLogicalByteSize
  const writeHasZeros = isAllZeros(bytes) || bytes.some((b) => b === 0)
  const canSpillToOpfs = !hasHolesNow && !writeHasZeros && shouldSpillToOpfs(newLogicalByteSize)

  if (canSpillToOpfs) {
    const capacityDelta = shared ? newLogicalByteSize : Math.max(0, bytes.byteLength - (writeStart < oldLogicalByteSize ? Math.min(writeEnd, oldLogicalByteSize) - writeStart : 0))
    const total = await assertCapacity(capacityDelta)
    return spillIdbRangeWriteToOpfs({
      nodeRecord,
      blob,
      blobId,
      offset,
      bytes,
      shared,
      newByteSize: newLogicalByteSize,
      capacityDelta,
      total,
    })
  }

  const targetBlobId = shared ? newFilesBlobId() : blobId

  // 等长分槽文件：按槽读改写，全零槽不落库
  if (blob?.uniformChunkSize !== undefined && blob.chunked === true) {
    const slotSize = blob.uniformChunkSize
    const firstSlot = Math.floor(writeStart / slotSize)
    const lastSlot = Math.floor((writeEnd - 1) / slotSize)
    const oldSlots = shared
      ? await readAllChunkSlots(blobId)
      : await readChunkSlots(blobId, firstSlot, lastSlot)
    const patch = applySparseSlotPatch(
      slotSize,
      oldLogicalByteSize,
      oldStoredByteSize,
      oldSlots,
      writeStart,
      bytes,
    )
    const total = await assertCapacity(Math.max(0, patch.storedDelta))

    const writeTx = beginIdbTransaction(
      db,
      [FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_CHUNKS_STORE, FILES_META_STORE],
      'readwrite',
    )
    const blobs = writeTx.objectStore(FILES_BLOBS_STORE)
    const chunks = writeTx.objectStore(FILES_CHUNKS_STORE)

    if (shared) {
      await deleteBlobChunksInTx(writeTx, targetBlobId)
      const targetSlots = new Map<number, Uint8Array>(oldSlots)
      for (const slot of patch.chunksToDelete) targetSlots.delete(slot)
      for (const [slot, buf] of patch.chunksToPut) targetSlots.set(slot, buf)

      const chunkOffsets: number[] = []
      for (let i = 0; i < patch.newChunkCount; i++) {
        const slotBuf = targetSlots.get(i)
        if (slotBuf) {
          chunks.put({
            blobId: targetBlobId,
            chunkIndex: i,
            bytes: copyUint8ToArrayBuffer(slotBuf),
          } satisfies FilesChunkRecord)
        }
        chunkOffsets.push(i * slotSize)
      }
      blobs.put({
        id: targetBlobId,
        refCount: 1,
        chunked: true,
        byteSize: patch.newByteSize,
        chunkCount: patch.newChunkCount,
        uniformChunkSize: slotSize,
        storedByteSize: patch.newStoredByteSize,
      } satisfies FilesBlobRecord)

      const nextRef = refCount - 1
      if (nextRef <= 0) {
        blobs.delete(blobId)
        await deleteBlobChunksInTx(writeTx, blobId)
      } else {
        blobs.put({ ...blob, refCount: nextRef } satisfies FilesBlobRecord)
      }
    } else {
      for (const slot of patch.chunksToDelete) {
        chunks.delete([blobId, slot])
      }
      for (const [slot, buf] of patch.chunksToPut) {
        chunks.put({
          blobId,
          chunkIndex: slot,
          bytes: copyUint8ToArrayBuffer(buf),
        } satisfies FilesChunkRecord)
      }
      blobs.put({
        id: blobId,
        refCount: 1,
        chunked: true,
        byteSize: patch.newByteSize,
        chunkCount: patch.newChunkCount,
        uniformChunkSize: slotSize,
        storedByteSize: patch.newStoredByteSize,
      } satisfies FilesBlobRecord)
    }

    const updated: FilesNodeRecord = {
      ...nodeRecord,
      blobId: targetBlobId,
      byteSize: patch.newByteSize,
      updatedAt: osNowMs(),
      contentRevisionId: newContentRevisionId(),
      attributes: normalizeFilesNodeAttributes(nodeRecord.locationId, nodeRecord.attributes),
    }
    writeTx.objectStore(FILES_NODES_STORE).put(updated)
    writeTx.objectStore(FILES_META_STORE).put({
      key: 'byte-total',
      totalBytes: Math.max(0, total + patch.storedDelta),
    } satisfies FilesMetaRecord)

    await waitForTransaction(writeTx)
    emitFilesDataStorageChanged()
    return recordToNode(updated)
  }

  const oldChunks = blob ? await readBlobAsChunks(blobId, blob) : []

  if (shared) {
    // COW：复制全部内容到新 blob
    const newChunks = buildRangeWriteChunks(
      oldChunks,
      oldLogicalByteSize,
      writeStart,
      bytes,
      0,
      DEFAULT_STREAM_CHUNK_SIZE,
    )
    const newStoredByteSize = newChunks.reduce((sum, chunk) => sum + chunk.bytes.byteLength, 0)
    const capacityDelta = newStoredByteSize
    const total = await assertCapacity(capacityDelta)
    const writeTx = beginIdbTransaction(
      db,
      [FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_CHUNKS_STORE, FILES_META_STORE],
      'readwrite',
    )
    const blobs = writeTx.objectStore(FILES_BLOBS_STORE)

    await deleteBlobChunksInTx(writeTx, targetBlobId)
    putChunksInTx(writeTx, targetBlobId, newChunks, newLogicalByteSize)

    const updated: FilesNodeRecord = {
      ...nodeRecord,
      blobId: targetBlobId,
      byteSize: newLogicalByteSize,
      updatedAt: osNowMs(),
      contentRevisionId: newContentRevisionId(),
      attributes: normalizeFilesNodeAttributes(nodeRecord.locationId, nodeRecord.attributes),
    }
    writeTx.objectStore(FILES_NODES_STORE).put(updated)

    if (blob) {
      const nextRef = refCount - 1
      if (nextRef <= 0) {
        blobs.delete(blobId)
        if (blob.chunked === true) {
          await deleteBlobChunksInTx(writeTx, blobId)
        }
      } else {
        blobs.put({ ...blob, refCount: nextRef } satisfies FilesBlobRecord)
      }
    }

    writeTx.objectStore(FILES_META_STORE).put({
      key: 'byte-total',
      totalBytes: Math.max(0, total + capacityDelta),
    } satisfies FilesMetaRecord)

    await waitForTransaction(writeTx)
    emitFilesDataStorageChanged()
    return recordToNode(updated)
  }

  // 非共享：原地修改
  const existingOffsets = blob ? resolveChunkOffsets(blob) : undefined
  if (!blob || blob.chunked !== true || existingOffsets === undefined) {
    // 整块 blob：整体重建
    const newChunks = buildRangeWriteChunks(
      oldChunks,
      oldLogicalByteSize,
      writeStart,
      bytes,
      0,
      DEFAULT_STREAM_CHUNK_SIZE,
    )
    const newStoredByteSize = newChunks.reduce((sum, chunk) => sum + chunk.bytes.byteLength, 0)
    const capacityDelta = newStoredByteSize - oldStoredByteSize
    const total = await assertCapacity(capacityDelta)

    const writeTx = beginIdbTransaction(
      db,
      [FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_CHUNKS_STORE, FILES_META_STORE],
      'readwrite',
    )
    if (blob?.chunked === true) {
      await deleteBlobChunksInTx(writeTx, blobId)
    }
    putChunksInTx(writeTx, blobId, newChunks, newLogicalByteSize)

    const updated: FilesNodeRecord = {
      ...nodeRecord,
      byteSize: newLogicalByteSize,
      updatedAt: osNowMs(),
      contentRevisionId: newContentRevisionId(),
      attributes: normalizeFilesNodeAttributes(nodeRecord.locationId, nodeRecord.attributes),
    }
    writeTx.objectStore(FILES_NODES_STORE).put(updated)
    writeTx.objectStore(FILES_META_STORE).put({
      key: 'byte-total',
      totalBytes: Math.max(0, total + capacityDelta),
    } satisfies FilesMetaRecord)

    await waitForTransaction(writeTx)
    emitFilesDataStorageChanged()
    return recordToNode(updated)
  }

  // 分块 blob 原地修改：保留未受影响前缀，重写 firstIdx 及之后
  const chunkOffsets = existingOffsets
  const firstIdx = Math.max(0, upperBound(chunkOffsets, writeStart) - 1)
  const regionStart = chunkOffsets[firstIdx] ?? 0

  const chunkReadTx = beginIdbTransaction(db, FILES_CHUNKS_STORE, 'readonly')
  const chunkStore = chunkReadTx.objectStore(FILES_CHUNKS_STORE)
  const range = IDBKeyRange.bound([blobId, 0], [blobId, Number.MAX_SAFE_INTEGER])
  const records = await requestToPromise(chunkStore.getAll(range) as IDBRequest<FilesChunkRecord[]>)
  await waitForTransaction(chunkReadTx)
  const allChunksByIndex = new Map<number, Uint8Array>()
  for (const record of records ?? []) {
    allChunksByIndex.set(record.chunkIndex, new Uint8Array(record.bytes))
  }
  const oldChunksList: { offset: number; bytes: Uint8Array }[] = []
  for (let i = 0; i < chunkOffsets.length; i++) {
    const c = allChunksByIndex.get(i)
    if (c) {
      oldChunksList.push({ offset: chunkOffsets[i]!, bytes: c })
    }
  }
  const relevantOldChunks = oldChunksList.slice(firstIdx)
  const newChunks = buildRangeWriteChunks(
    relevantOldChunks,
    oldLogicalByteSize,
    writeStart,
    bytes,
    regionStart,
    DEFAULT_STREAM_CHUNK_SIZE,
  )
  const newStoredByteSizeFromRegion = newChunks.reduce((sum, chunk) => sum + chunk.bytes.byteLength, 0)
  const oldStoredByteSizeFromRegion = relevantOldChunks.reduce((sum, chunk) => sum + chunk.bytes.byteLength, 0)
  const capacityDelta = newStoredByteSizeFromRegion - oldStoredByteSizeFromRegion
  const total = await assertCapacity(capacityDelta)

  const writeTx = beginIdbTransaction(
    db,
    [FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_CHUNKS_STORE, FILES_META_STORE],
    'readwrite',
  )
  const blobs = writeTx.objectStore(FILES_BLOBS_STORE)
  const chunks = writeTx.objectStore(FILES_CHUNKS_STORE)

  if (newLogicalByteSize <= BYTES_TO_CHUNK_THRESHOLD) {
    // 结果较小：退化为单条 bytes，需要清掉所有旧 chunk
    await deleteBlobChunksInTx(writeTx, blobId)
    const full = new Uint8Array(newLogicalByteSize)
    for (let i = 0; i < firstIdx; i++) {
      const c = allChunksByIndex.get(i)
      if (!c) continue
      full.set(c, chunkOffsets[i]!)
    }
    for (const chunk of newChunks) {
      full.set(chunk.bytes, chunk.offset)
    }
    blobs.put({
      id: blobId,
      refCount: 1,
      bytes: full.buffer,
      storedByteSize: full.byteLength,
    } satisfies FilesBlobRecord)
  } else {
    // 保持分块：删除从 firstIdx 开始的旧 chunk，新 chunk 接在 firstIdx
    await requestToPromise(
      chunks.delete(
        IDBKeyRange.bound([blobId, firstIdx], [blobId, Number.MAX_SAFE_INTEGER]),
      ) as IDBRequest<undefined>,
    )
    const newChunkOffsets: number[] = []
    let newStoredByteSize = 0
    for (let i = 0; i < firstIdx; i++) {
      newChunkOffsets.push(chunkOffsets[i]!)
      const c = allChunksByIndex.get(i)
      if (c) newStoredByteSize += c.byteLength
    }
    for (let i = 0; i < newChunks.length; i++) {
      const chunk = newChunks[i]!
      chunks.put({
        blobId,
        chunkIndex: firstIdx + i,
        bytes: copyUint8ToArrayBuffer(chunk.bytes),
      } satisfies FilesChunkRecord)
      newChunkOffsets.push(chunk.offset)
      newStoredByteSize += chunk.bytes.byteLength
    }
    blobs.put({
      id: blobId,
      refCount: 1,
      chunked: true,
      byteSize: newLogicalByteSize,
      chunkCount: newChunkOffsets.length,
      chunkOffsets: newChunkOffsets,
      storedByteSize: newStoredByteSize,
    } satisfies FilesBlobRecord)
  }

  const updated: FilesNodeRecord = {
    ...nodeRecord,
    byteSize: newLogicalByteSize,
    updatedAt: osNowMs(),
    contentRevisionId: newContentRevisionId(),
    attributes: normalizeFilesNodeAttributes(nodeRecord.locationId, nodeRecord.attributes),
  }
  writeTx.objectStore(FILES_NODES_STORE).put(updated)
  writeTx.objectStore(FILES_META_STORE).put({
    key: 'byte-total',
    totalBytes: Math.max(0, total + capacityDelta),
  } satisfies FilesMetaRecord)

  await waitForTransaction(writeTx)
  emitFilesDataStorageChanged()
  return recordToNode(updated)
}

async function readIdbChunkBytes(
  blobId: string,
  chunkIndex: number,
): Promise<Uint8Array | undefined> {
  const db = await openFilesDb()
  const tx = beginIdbTransaction(db, FILES_CHUNKS_STORE, 'readonly')
  const record = await requestToPromise(
    tx.objectStore(FILES_CHUNKS_STORE).get([blobId, chunkIndex]) as IDBRequest<
      FilesChunkRecord | undefined
    >,
  )
  await waitForTransaction(tx)
  if (!record) return undefined
  return new Uint8Array(record.bytes)
}

async function listIdbChunkIndexes(blobId: string): Promise<number[]> {
  const db = await openFilesDb()
  const tx = beginIdbTransaction(db, FILES_CHUNKS_STORE, 'readonly')
  const store = tx.objectStore(FILES_CHUNKS_STORE)
  const range = IDBKeyRange.bound([blobId, 0], [blobId, Number.MAX_SAFE_INTEGER])
  const keys = await requestToPromise(store.getAllKeys(range) as IDBRequest<IDBValidKey[]>)
  await waitForTransaction(tx)
  const indexes: number[] = []
  for (const key of keys ?? []) {
    if (Array.isArray(key) && typeof key[1] === 'number') {
      indexes.push(key[1])
    }
  }
  indexes.sort((a, b) => a - b)
  return indexes
}

/** 把库内正文逐块搬到 OPFS，峰值约一块，不拼整份。 */
async function copyIdbBlobToOpfsWriter(
  blobId: string,
  blob: FilesBlobRecord | undefined,
  writer: OpfsBlobWriter,
): Promise<void> {
  if (!blob) return
  const copyStartAt = performance.now()
  let copiedBytes = 0
  const trackWrite = (bytes: number, written: Promise<unknown>) => {
    copiedBytes += bytes
    return written
  }
  if (blob.chunked === true) {
    const offsets = resolveChunkOffsets(blob)
    if (offsets !== undefined) {
      for (let i = 0; i < offsets.length; i++) {
        const bytes = await readIdbChunkBytes(blobId, i)
        if (!bytes || bytes.byteLength === 0) continue
        await trackWrite(bytes.byteLength, writer.writeAt(offsets[i]!, bytes))
      }
      return
    }
    let offset = 0
    for (const index of await listIdbChunkIndexes(blobId)) {
      const bytes = await readIdbChunkBytes(blobId, index)
      if (!bytes || bytes.byteLength === 0) continue
      await trackWrite(bytes.byteLength, writer.writeAt(offset, bytes))
      offset += bytes.byteLength
    }
    return
  }
  let source: Uint8Array | undefined
  if (blob.bytes !== undefined) {
    source = new Uint8Array(blob.bytes)
  } else if (blob.text !== undefined) {
    source = new Uint8Array(encodeTextToArrayBuffer(blob.text))
  }
  if (source && source.byteLength > 0) {
    trackWrite(source.byteLength, writer.writeAt(0, source))
  }
  const copyDurationMs = performance.now() - copyStartAt
  if (copiedBytes > 0) {
    // IDB→OPFS 全量逐块搬移：GB 级文件长时间占用，易被误判为开机卡死
    recordSystemDebugTimeline({
      layer: 'files',
      op: 'idb-spill-to-opfs-done',
      detail: `${copiedBytes}B`,
      durationMs: Math.round(copyDurationMs),
    })
  }
}

/** 将旧 blob 内容读取为按偏移排序的 chunk 列表（整块 blob 视为单一段） */
async function readBlobAsChunks(
  blobId: string,
  blob: FilesBlobRecord,
): Promise<{ offset: number; bytes: Uint8Array }[]> {
  if (isOpfsBlob(blob)) {
    const bytes = await readOpfsBlobBytes(blobId)
    if (!bytes || bytes.byteLength === 0) return []
    return [{ offset: 0, bytes: new Uint8Array(bytes) }]
  }
  const offsets = resolveChunkOffsets(blob)
  if (blob.chunked === true && offsets !== undefined) {
    const db = await openFilesDb()
    const tx = beginIdbTransaction(db, FILES_CHUNKS_STORE, 'readonly')
    const store = tx.objectStore(FILES_CHUNKS_STORE)
    const range = IDBKeyRange.bound([blobId, 0], [blobId, Number.MAX_SAFE_INTEGER])
    const records = await requestToPromise(store.getAll(range) as IDBRequest<FilesChunkRecord[]>)
    await waitForTransaction(tx)
    const byIndex = new Map<number, Uint8Array>()
    for (const record of records ?? []) {
      byIndex.set(record.chunkIndex, new Uint8Array(record.bytes))
    }
    const chunks: { offset: number; bytes: Uint8Array }[] = []
    for (let i = 0; i < offsets.length; i++) {
      const c = byIndex.get(i)
      if (c) {
        chunks.push({ offset: offsets[i]!, bytes: c })
      }
    }
    return chunks
  }

  let source: Uint8Array | undefined
  if (blob.bytes !== undefined) {
    source = new Uint8Array(blob.bytes)
  } else if (blob.text !== undefined) {
    source = new Uint8Array(encodeTextToArrayBuffer(blob.text))
  }
  if (!source || source.byteLength === 0) return []
  return [{ offset: 0, bytes: source }]
}

/** 流式 chunk 构造器：按 chunkSize 切割，避免中间大缓冲 */
class ChunkBuilder {
  private buffer: Uint8Array[] = []
  private size = 0
  private nextOffset: number
  private chunks: { offset: number; bytes: Uint8Array }[] = []
  private chunkSize: number

  constructor(startOffset: number, chunkSize: number) {
    this.nextOffset = startOffset
    this.chunkSize = chunkSize
  }

  append(bytes: Uint8Array): void {
    if (bytes.byteLength === 0) return
    this.buffer.push(bytes)
    this.size += bytes.byteLength
    while (this.size >= this.chunkSize) {
      this.flush(this.chunkSize)
    }
  }

  finish(): { offset: number; bytes: Uint8Array }[] {
    if (this.size > 0) {
      this.flush(this.size)
    }
    return this.chunks
  }

  private flush(take: number): void {
    const chunk = new Uint8Array(take)
    let written = 0
    while (written < take) {
      const head = this.buffer[0]!
      const need = take - written
      if (head.byteLength <= need) {
        chunk.set(head, written)
        written += head.byteLength
        this.buffer.shift()
      } else {
        chunk.set(head.subarray(0, need), written)
        this.buffer[0] = head.subarray(need)
        written += need
      }
    }
    this.size -= take
    this.chunks.push({ offset: this.nextOffset, bytes: chunk })
    this.nextOffset += take
  }
}

/** 在 [regionStart, oldByteSize) 范围内应用覆盖写，返回新 chunk 列表 */
function buildRangeWriteChunks(
  oldChunks: { offset: number; bytes: Uint8Array }[],
  oldByteSize: number,
  writeStart: number,
  writeBytes: Uint8Array,
  regionStart: number,
  chunkSize: number,
): { offset: number; bytes: Uint8Array }[] {
  const builder = new ChunkBuilder(regionStart, chunkSize)

  // 拷贝 [regionStart, writeStart) 的旧字节
  for (const chunk of oldChunks) {
    if (chunk.offset + chunk.bytes.byteLength <= regionStart) continue
    if (chunk.offset >= oldByteSize) break
    const from = Math.max(regionStart, chunk.offset)
    const to = Math.min(writeStart, chunk.offset + chunk.bytes.byteLength)
    if (to > from) {
      builder.append(chunk.bytes.subarray(from - chunk.offset, to - chunk.offset))
    }
  }

  // 写入新字节
  builder.append(writeBytes)

  // 拷贝 [writeEnd, oldByteSize) 的旧字节
  const writeEnd = writeStart + writeBytes.byteLength
  for (const chunk of oldChunks) {
    if (chunk.offset + chunk.bytes.byteLength <= writeEnd) continue
    if (chunk.offset >= oldByteSize) break
    const from = Math.max(writeEnd, chunk.offset)
    const to = Math.min(oldByteSize, chunk.offset + chunk.bytes.byteLength)
    if (to > from) {
      builder.append(chunk.bytes.subarray(from - chunk.offset, to - chunk.offset))
    }
  }

  return builder.finish()
}

/** 读取 blob 在 [firstSlot, lastSlot] 范围内的已有 chunk（按 slot index）。 */
async function readChunkSlots(
  blobId: string,
  firstSlot: number,
  lastSlot: number,
): Promise<Map<number, Uint8Array>> {
  const db = await openFilesDb()
  const tx = beginIdbTransaction(db, FILES_CHUNKS_STORE, 'readonly')
  const store = tx.objectStore(FILES_CHUNKS_STORE)
  const range = IDBKeyRange.bound([blobId, firstSlot], [blobId, lastSlot])
  const records = await requestToPromise(store.getAll(range) as IDBRequest<FilesChunkRecord[]>)
  await waitForTransaction(tx)
  const bySlot = new Map<number, Uint8Array>()
  for (const record of records ?? []) {
    bySlot.set(record.chunkIndex, new Uint8Array(record.bytes))
  }
  return bySlot
}

/** 读取 blob 全部已有 chunk（仅返回存在的 slot）。 */
async function readAllChunkSlots(blobId: string): Promise<Map<number, Uint8Array>> {
  const db = await openFilesDb()
  const tx = beginIdbTransaction(db, FILES_CHUNKS_STORE, 'readonly')
  const store = tx.objectStore(FILES_CHUNKS_STORE)
  const range = IDBKeyRange.bound([blobId, 0], [blobId, Number.MAX_SAFE_INTEGER])
  const records = await requestToPromise(store.getAll(range) as IDBRequest<FilesChunkRecord[]>)
  await waitForTransaction(tx)
  const bySlot = new Map<number, Uint8Array>()
  for (const record of records ?? []) {
    bySlot.set(record.chunkIndex, new Uint8Array(record.bytes))
  }
  return bySlot
}

type SparseSlotPatchResult = {
  newByteSize: number
  newChunkCount: number
  newStoredByteSize: number
  storedDelta: number
  /** 非共享原地修改时使用：要删除的 slot；要写入/覆盖的 slot */
  chunksToDelete: number[]
  chunksToPut: Map<number, Uint8Array>
}

/**
 * 对均匀分槽文件应用覆盖写。oldSlots 只需包含受影响的 slot（非共享）或全部 slot（共享 COW）。
 * 写回全零的 slot 会被移除（打洞）。
 */
function applySparseSlotPatch(
  slotSize: number,
  oldByteSize: number,
  oldStoredByteSize: number,
  oldSlots: Map<number, Uint8Array>,
  offset: number,
  bytes: Uint8Array,
): SparseSlotPatchResult {
  const writeEnd = offset + bytes.byteLength
  const newByteSize = Math.max(oldByteSize, writeEnd)
  const newChunkCount = Math.ceil(newByteSize / slotSize)
  const firstSlot = Math.floor(offset / slotSize)
  const lastSlot = Math.floor((writeEnd - 1) / slotSize)

  const chunksToPut = new Map<number, Uint8Array>()
  const chunksToDelete: number[] = []
  let newStoredByteSize = oldStoredByteSize

  for (let slot = firstSlot; slot <= lastSlot; slot++) {
    const slotStart = slot * slotSize
    const slotEnd = Math.min(slotStart + slotSize, newByteSize)
    const slotLen = slotEnd - slotStart

    const oldChunk = oldSlots.get(slot)
    const oldLen = oldChunk?.byteLength ?? 0
    const slotBuf = new Uint8Array(slotLen)
    if (oldChunk) {
      slotBuf.set(oldChunk.subarray(0, Math.min(oldLen, slotLen)))
    }

    const from = Math.max(offset, slotStart)
    const to = Math.min(writeEnd, slotEnd)
    if (to > from) {
      const srcStart = from - offset
      const srcEnd = to - offset
      slotBuf.set(bytes.subarray(srcStart, srcEnd), from - slotStart)
    }

    if (isAllZeros(slotBuf)) {
      if (oldChunk) {
        chunksToDelete.push(slot)
        newStoredByteSize -= oldLen
      }
    } else {
      chunksToPut.set(slot, slotBuf)
      newStoredByteSize += slotLen - oldLen
    }
  }

  return {
    newByteSize,
    newChunkCount,
    newStoredByteSize,
    storedDelta: newStoredByteSize - oldStoredByteSize,
    chunksToDelete,
    chunksToPut,
  }
}

/** 在事务内写入 chunk 列表；根据大小自动选择整块或分块格式 */
function putChunksInTx(
  tx: IDBTransaction,
  blobId: string,
  chunks: { offset: number; bytes: Uint8Array }[],
  byteSize: number,
): void {
  const blobs = tx.objectStore(FILES_BLOBS_STORE)
  const chunksStore = tx.objectStore(FILES_CHUNKS_STORE)
  let storedByteSize = 0

  if (byteSize <= BYTES_TO_CHUNK_THRESHOLD) {
    const full = new Uint8Array(byteSize)
    let pos = 0
    for (const chunk of chunks) {
      full.set(chunk.bytes, pos)
      pos += chunk.bytes.byteLength
    }
    storedByteSize = byteSize
    blobs.put({
      id: blobId,
      refCount: 1,
      bytes: full.buffer,
      storedByteSize,
    } satisfies FilesBlobRecord)
    return
  }

  const chunkOffsets: number[] = []
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!
    chunksStore.put({
      blobId,
      chunkIndex: i,
      bytes: copyUint8ToArrayBuffer(chunk.bytes),
    } satisfies FilesChunkRecord)
    chunkOffsets.push(chunk.offset)
    storedByteSize += chunk.bytes.byteLength
  }
  blobs.put({
    id: blobId,
    refCount: 1,
    chunked: true,
    byteSize,
    chunkCount: chunks.length,
    chunkOffsets,
    storedByteSize,
  } satisfies FilesBlobRecord)
}

async function writeFileContentCow(params: {
  id: string
  bytes: ArrayBuffer
  contentByteSize: number
  previousByteSize: number
  nameMetaDelta: number
}): Promise<FilesNode> {
  const db = await openFilesDb()
  const readTx = beginIdbTransaction(db, [FILES_NODES_STORE, FILES_BLOBS_STORE], 'readonly')
  const existing = await requestToPromise(
    readTx.objectStore(FILES_NODES_STORE).get(params.id) as IDBRequest<FilesNodeRecord | undefined>,
  )
  if (!existing || existing.kind !== 'file') {
    await waitForTransaction(readTx)
    throw new Error('文件不存在')
  }
  const oldBlobId = resolveNodeBlobId(existing)
  const oldBlob = await requestToPromise(
    readTx.objectStore(FILES_BLOBS_STORE).get(oldBlobId) as IDBRequest<FilesBlobRecord | undefined>,
  )
  await waitForTransaction(readTx)

  const refCount = oldBlob ? resolveBlobRefCount(oldBlob) : 1
  const shared = refCount > 1
  const needed = shared
    ? params.contentByteSize + params.nameMetaDelta
    : params.contentByteSize - params.previousByteSize + params.nameMetaDelta
  const total = await assertCapacity(needed)

  const stayOnOpfs = isOpfsBlob(oldBlob) && !shared
  const useOpfs = stayOnOpfs || shouldSpillToOpfs(params.bytes.byteLength)
  const targetBlobId = shared ? newFilesBlobId() : oldBlobId
  if (useOpfs) {
    await writeOpfsBlobBytes(targetBlobId, new Uint8Array(params.bytes))
  }

  const updated: FilesNodeRecord = {
    ...existing,
    byteSize: params.contentByteSize,
    updatedAt: osNowMs(),
    contentRevisionId: newContentRevisionId(),
    attributes: normalizeFilesNodeAttributes(existing.locationId, existing.attributes),
    blobId: targetBlobId,
  }

  const writeTx = beginIdbTransaction(
    db,
    [FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_CHUNKS_STORE, FILES_META_STORE],
    'readwrite',
  )
  const blobs = writeTx.objectStore(FILES_BLOBS_STORE)
  const exclusiveRef = shared ? 1 : resolveBlobRefCount(oldBlob ?? { id: oldBlobId })

  if (!shared && oldBlob?.chunked === true) {
    await deleteBlobChunksInTx(writeTx, oldBlobId)
  }

  if (useOpfs) {
    blobs.put(opfsBlobIndexRecord(targetBlobId, params.contentByteSize, exclusiveRef))
  } else {
    putBlobContentInTx(writeTx, targetBlobId, params.bytes, exclusiveRef)
  }

  let releasedOpfs: string | undefined
  if (shared) {
    releasedOpfs = await releaseBlobRefInTx(writeTx, oldBlobId, oldBlob)
  }

  writeTx.objectStore(FILES_NODES_STORE).put(updated)
  writeTx.objectStore(FILES_META_STORE).put({
    key: 'byte-total',
    totalBytes: Math.max(0, total + needed),
  } satisfies FilesMetaRecord)
  await waitForTransaction(writeTx)
  await deleteOpfsBlobs([releasedOpfs])
  emitFilesDataStorageChanged()
  return recordToNode(updated)
}

// ---------------------------------------------------------------------------
// 流式写（分块 blob）
//
// 语义：
// - 新建：open 即创建节点（byteSize 0）+ 空分块 blob，文件立刻可见、逐步长大；
//   close 定稿；abort 删除节点与全部 chunk 并回退配额。
// - 覆盖：open 只创建草稿分块 blob，节点仍指向旧内容；close 时切换节点 blobId
//   并按 COW 释放旧 blob 引用；abort 只删草稿，旧内容保持原样。
// - 每个 chunk 独立事务，内存 O(chunk)；配额随 chunk 增量预占/回退。
// - 写操作在同一 writer 内串行化，避免并发事务交错。
// ---------------------------------------------------------------------------

export type FilesStreamWriter = {
  /**
   * open 时确定的实际节点：新建时为事务内定名的占位节点（unique-suffix 撞名后
   * 是最终名；精确模式即请求名），覆盖时为既有节点快照。
   */
  node: FilesNode
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<FilesNode>
  abort(): Promise<void>
}

type FilesStreamWriteState = {
  id: string
  nodeId: string
  blobId: string
  isNew: boolean
  nodeRecord: FilesNodeRecord
  oldBlobId?: string
  oldRefCount: number
  previousByteSize: number
  chunkIndex: number
  writtenBytes: number
  /** 目标块大小（默认 DEFAULT_STREAM_CHUNK_SIZE）；写入缓冲达到 flushThreshold 时切块 */
  chunkSize: number
  /** 已落库块的起始偏移（新格式；未落库前的 pending 不算） */
  chunkOffsets: number[]
  /** 尚未落库的写入缓冲（close 时整体落库为最后一块） */
  pending: Uint8Array
  /** open 后累计计入 byte-total 的字节（abort 时回退；含新建节点元数据） */
  quotaCommitted: number
  /** 已落库块的实占字节（零块跳过） */
  storedByteSize: number
  terminal: 'open' | 'closed' | 'aborted'
  /** write/close/abort 串行化链 */
  queue: Promise<unknown>
  backend: 'idb' | 'opfs'
  opfsWriter?: OpfsBlobWriter
}

const streamWrites = new Map<string, FilesStreamWriteState>()

function emptyChunkedBlobRecord(blobId: string): FilesBlobRecord {
  return { id: blobId, refCount: 1, chunked: true, byteSize: 0, chunkCount: 0, storedByteSize: 0 }
}

function copyUint8ToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function enqueueStreamOp<T>(state: FilesStreamWriteState, op: () => Promise<T>): Promise<T> {
  const next = state.queue.then(op, op)
  state.queue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

function assertStreamOpen(state: FilesStreamWriteState): void {
  if (state.terminal !== 'open') {
    throw new Error(state.terminal === 'closed' ? '写入流已关闭' : '写入流已中止')
  }
}

/**
 * 打开分块 blob 流式写。
 * @param node 新建时为待创建节点（须含 id/locationId/parentId/name/attributes）；
 *             覆盖时为既有文件节点。
 * @param isNew 是否新建文件
 * @param metaBytes 新建时节点元数据字节（计入配额）；覆盖时传 0
 * @param previousByteSize 覆盖时原内容字节（close 释放配额用）；新建传 0
 * @param chunkSize 目标块大小（默认 4MiB）；中间块恒为 chunkSize，尾部块在
 *                  (0, chunkSize + MIN_TAIL] 内，close 时合并 < MIN_TAIL 的尾巴
 * @param expectedSize 已知最终大小时传入；超过约 25MB 则一开始就写 OPFS
 */
export async function openStreamWriteBlob(params: {
  node: FilesNode
  isNew: boolean
  metaBytes: number
  previousByteSize: number
  chunkSize?: number
  expectedSize?: number
  nameMode: FilesNodeNameMode
}): Promise<FilesStreamWriter> {
  const { node, isNew, metaBytes, previousByteSize } = params
  const chunkSize = params.chunkSize ?? DEFAULT_STREAM_CHUNK_SIZE
  const useOpfs = shouldSpillToOpfs(params.expectedSize ?? 0)
  const id = crypto.randomUUID()
  const blobId = newFilesBlobId()
  const db = await openFilesDb()

  let nodeRecord: FilesNodeRecord
  let oldBlobId: string | undefined
  let oldRefCount = 1
  let quotaCommitted: number

  if (isNew) {
    const total = await assertCapacity(metaBytes)
    const baseNode: FilesNode = {
      ...node,
      byteSize: 0,
      contentRevisionId: newContentRevisionId(),
    }
    const tx = beginIdbTransaction(
      db,
      [FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_META_STORE],
      'readwrite',
    )
    // 新建占位节点也走事务内查重，避免并发新建同名时插入重复记录
    const resolved = await resolveNameInTx(tx, baseNode, params.nameMode)
    if (resolved.existing) {
      await waitForTransaction(tx)
      throw new FilesPathExistsError('路径已存在', recordToNode(resolved.existing))
    }
    const finalNode = resolved.name === baseNode.name ? baseNode : { ...baseNode, name: resolved.name }
    const finalMeta =
      metaBytes + (estimateNodeMetaBytes(finalNode) - estimateNodeMetaBytes(baseNode))
    nodeRecord = nodeToRecord(finalNode, blobId)
    tx.objectStore(FILES_NODES_STORE).put(nodeRecord)
    tx.objectStore(FILES_BLOBS_STORE).put(
      useOpfs ? opfsBlobIndexRecord(blobId, 0) : emptyChunkedBlobRecord(blobId),
    )
    tx.objectStore(FILES_META_STORE).put({
      key: 'byte-total',
      totalBytes: total + finalMeta,
    } satisfies FilesMetaRecord)
    await waitForTransaction(tx)
    quotaCommitted = finalMeta
  } else {
    const readTx = beginIdbTransaction(db, [FILES_NODES_STORE, FILES_BLOBS_STORE], 'readonly')
    const existing = await requestToPromise(
      readTx
        .objectStore(FILES_NODES_STORE)
        .get(node.id) as IDBRequest<FilesNodeRecord | undefined>,
    )
    if (!existing || existing.kind !== 'file') {
      await waitForTransaction(readTx)
      throw new Error('文件不存在')
    }
    oldBlobId = resolveNodeBlobId(existing)
    const oldBlob = await requestToPromise(
      readTx.objectStore(FILES_BLOBS_STORE).get(oldBlobId) as IDBRequest<FilesBlobRecord | undefined>,
    )
    await waitForTransaction(readTx)
    oldRefCount = oldBlob ? resolveBlobRefCount(oldBlob) : 1
    nodeRecord = existing
    const tx = beginIdbTransaction(db, FILES_BLOBS_STORE, 'readwrite')
    tx.objectStore(FILES_BLOBS_STORE).put(
      useOpfs ? opfsBlobIndexRecord(blobId, 0) : emptyChunkedBlobRecord(blobId),
    )
    await waitForTransaction(tx)
    quotaCommitted = 0
  }

  let opfsWriter: OpfsBlobWriter | undefined
  if (useOpfs) {
    try {
      opfsWriter = await openOpfsBlobWriter(blobId)
    } catch (error) {
      const rollback = beginIdbTransaction(
        db,
        [FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_META_STORE],
        'readwrite',
      )
      rollback.objectStore(FILES_BLOBS_STORE).delete(blobId)
      if (isNew) {
        rollback.objectStore(FILES_NODES_STORE).delete(nodeRecord.id)
        await adjustByteTotal(rollback, -quotaCommitted)
      }
      await waitForTransaction(rollback)
      throw error
    }
  }

  const state: FilesStreamWriteState = {
    id,
    nodeId: node.id,
    blobId,
    isNew,
    nodeRecord,
    oldBlobId,
    oldRefCount,
    previousByteSize,
    chunkIndex: 0,
    writtenBytes: 0,
    chunkSize,
    chunkOffsets: [],
    pending: new Uint8Array(0),
    quotaCommitted,
    storedByteSize: 0,
    terminal: 'open',
    queue: Promise.resolve(),
    backend: useOpfs ? 'opfs' : 'idb',
    opfsWriter,
  }
  streamWrites.set(id, state)

  return {
    node: recordToNode(state.nodeRecord),
    write: (chunk) => enqueueStreamOp(state, () => writeStreamChunk(state, chunk)),
    close: () => enqueueStreamOp(state, () => closeStreamWrite(state)),
    abort: () => enqueueStreamOp(state, () => abortStreamWrite(state)),
  }
}

/** 推进一个空槽（全零），不落库。 */
function advanceChunkSlot(state: FilesStreamWriteState, size: number): void {
  state.chunkOffsets.push(state.writtenBytes)
  state.writtenBytes += size
  state.chunkIndex += 1
}

/** 在既有事务内落库一个非零分块；blob 元数据由 putStreamBlobMetaInTx 单独写一次。 */
function putChunkBytesInTx(
  tx: IDBTransaction,
  state: FilesStreamWriteState,
  data: Uint8Array,
): void {
  tx.objectStore(FILES_CHUNKS_STORE).put({
    blobId: state.blobId,
    chunkIndex: state.chunkIndex,
    bytes: copyUint8ToArrayBuffer(data),
  } satisfies FilesChunkRecord)
  state.chunkOffsets.push(state.writtenBytes)
  state.writtenBytes += data.byteLength
  state.storedByteSize += data.byteLength
  state.chunkIndex += 1
}

function putStreamBlobMetaInTx(tx: IDBTransaction, state: FilesStreamWriteState): void {
  tx.objectStore(FILES_BLOBS_STORE).put({
    id: state.blobId,
    refCount: 1,
    chunked: true,
    byteSize: state.writtenBytes,
    chunkCount: state.chunkIndex,
    uniformChunkSize: state.chunkSize,
    storedByteSize: state.storedByteSize,
  } satisfies FilesBlobRecord)
}

function putOpfsStreamMetaInTx(tx: IDBTransaction, state: FilesStreamWriteState): void {
  tx.objectStore(FILES_BLOBS_STORE).put(opfsBlobIndexRecord(state.blobId, state.writtenBytes))
}

async function updateOpfsStreamVisibleSize(state: FilesStreamWriteState): Promise<void> {
  const db = await openFilesDb()
  const blobTx = beginIdbTransaction(db, FILES_BLOBS_STORE, 'readwrite')
  putOpfsStreamMetaInTx(blobTx, state)
  await waitForTransaction(blobTx)
  if (state.isNew) {
    const next: FilesNodeRecord = { ...state.nodeRecord, byteSize: state.writtenBytes }
    state.nodeRecord = next
    const nodeTx = beginIdbTransaction(db, FILES_NODES_STORE, 'readwrite')
    nodeTx.objectStore(FILES_NODES_STORE).put(next)
    await waitForTransaction(nodeTx)
  }
}

async function spillStreamToOpfs(state: FilesStreamWriteState): Promise<void> {
  if (state.backend === 'opfs' || !isOpfsAvailable()) return

  const writer = await openOpfsBlobWriter(state.blobId)
  let offset = 0
  try {
    for (let i = 0; i < state.chunkIndex; i++) {
      const bytes = await readIdbChunkBytes(state.blobId, i)
      if (!bytes || bytes.byteLength === 0) continue
      const at = state.chunkOffsets[i] ?? offset
      await writer.writeAt(at, bytes)
      offset = at + bytes.byteLength
    }
    if (state.pending.byteLength > 0 && !isAllZeros(state.pending)) {
      await writer.writeAt(offset, state.pending)
      offset += state.pending.byteLength
    }

    const db = await openFilesDb()
    const tx = beginIdbTransaction(
      db,
      [FILES_BLOBS_STORE, FILES_CHUNKS_STORE],
      'readwrite',
    )
    await deleteBlobChunksInTx(tx, state.blobId)
    tx.objectStore(FILES_BLOBS_STORE).put(opfsBlobIndexRecord(state.blobId, offset))
    await waitForTransaction(tx)
  } catch (error) {
    await writer.abort()
    await deleteOpfsBlobs([state.blobId])
    throw error
  }

  state.writtenBytes = offset
  state.pending = new Uint8Array(0)
  state.chunkIndex = 0
  state.chunkOffsets = []
  state.opfsWriter = writer
  state.backend = 'opfs'
  if (state.isNew) {
    const next: FilesNodeRecord = { ...state.nodeRecord, byteSize: state.writtenBytes }
    state.nodeRecord = next
    const db = await openFilesDb()
    const nodeTx = beginIdbTransaction(db, FILES_NODES_STORE, 'readwrite')
    nodeTx.objectStore(FILES_NODES_STORE).put(next)
    await waitForTransaction(nodeTx)
  }
}

async function writeStreamChunk(state: FilesStreamWriteState, chunk: Uint8Array): Promise<void> {
  assertStreamOpen(state)
  if (chunk.byteLength === 0) return
  const n = chunk.byteLength
  await assertCapacity(n)

  if (state.backend === 'opfs') {
    if (!state.opfsWriter) {
      state.opfsWriter = await openOpfsBlobWriter(state.blobId)
    }
    await state.opfsWriter.writeAt(state.writtenBytes, chunk)
    state.writtenBytes += n
    state.quotaCommitted += n
    const db = await openFilesDb()
    const metaTx = beginIdbTransaction(db, FILES_META_STORE, 'readwrite')
    await adjustByteTotal(metaTx, n)
    await waitForTransaction(metaTx)
    await updateOpfsStreamVisibleSize(state)
    return
  }

  // 追加进缓冲；零块不落库，配额按实占结算
  const next = new Uint8Array(state.pending.byteLength + n)
  next.set(state.pending)
  next.set(chunk, state.pending.byteLength)
  state.pending = next

  const threshold = flushThreshold(state.chunkSize)

  // 先尝试切出完整的 chunkSize 块落库
  if (state.pending.byteLength >= threshold) {
    await flushStreamPendingChunks(state, false)
  }

  // 溢出判断用实占；有洞时不卸 OPFS，避免物化空洞
  const pendingNonZero = countNonZeroBytes(state.pending)
  const estimatedStored = state.storedByteSize + pendingNonZero
  const hasHoles =
    state.storedByteSize < state.writtenBytes || pendingNonZero < state.pending.byteLength
  if (!hasHoles && shouldSpillToOpfs(estimatedStored)) {
    // 把剩余 pending（此时不足 threshold，且全为非零）也刷出去再溢
    if (state.pending.byteLength > 0) {
      await flushStreamPendingChunks(state, true)
    }
    await spillStreamToOpfs(state)
  }
}

/**
 * 把 pending 中满 chunkSize 的块落库；force 时把尾部（可能不足 chunkSize）也落库。
 * 返回实占增量。
 */
async function flushStreamPendingChunks(
  state: FilesStreamWriteState,
  force: boolean,
): Promise<number> {
  const db = await openFilesDb()
  const threshold = flushThreshold(state.chunkSize)
  if (!force && state.pending.byteLength < threshold) return 0

  let storedDelta = 0
  const chunkTx = beginIdbTransaction(
    db,
    [FILES_BLOBS_STORE, FILES_CHUNKS_STORE],
    'readwrite',
  )
  const flushStartAt = performance.now()
  while (state.pending.byteLength >= threshold) {
    countSystemDebugHot('files', 'stream-chunk-flush')
    const slotBytes = state.pending.subarray(0, state.chunkSize)
    if (isAllZeros(slotBytes)) {
      advanceChunkSlot(state, state.chunkSize)
    } else {
      putChunkBytesInTx(chunkTx, state, slotBytes)
      storedDelta += state.chunkSize
    }
    const rest = state.pending.subarray(state.chunkSize)
    const remaining = new Uint8Array(rest.byteLength)
    remaining.set(rest)
    state.pending = remaining
  }
  if (force && state.pending.byteLength > 0) {
    if (isAllZeros(state.pending)) {
      advanceChunkSlot(state, state.pending.byteLength)
    } else {
      putChunkBytesInTx(chunkTx, state, state.pending)
      storedDelta += state.pending.byteLength
    }
    state.pending = new Uint8Array(0)
  }
  if (state.chunkIndex > 0 || state.pending.byteLength === 0) {
    putStreamBlobMetaInTx(chunkTx, state)
  }
  await waitForTransaction(chunkTx)

  if (storedDelta > 0) {
    const metaTx = beginIdbTransaction(db, FILES_META_STORE, 'readwrite')
    await adjustByteTotal(metaTx, storedDelta)
    await waitForTransaction(metaTx)
    state.quotaCommitted += storedDelta
  }

  if (state.isNew) {
    const nodeTx = beginIdbTransaction(db, FILES_NODES_STORE, 'readwrite')
    nodeTx.objectStore(FILES_NODES_STORE).put({
      ...state.nodeRecord,
      byteSize: state.writtenBytes,
    } satisfies FilesNodeRecord)
    await waitForTransaction(nodeTx)
  }

  const flushDurationMs = performance.now() - flushStartAt
  if (flushDurationMs > 100) {
    recordSystemDebugHot({
      layer: 'files',
      op: 'stream-flush-tx-slow',
      detail: `pending=${state.pending.byteLength}B delta=${storedDelta}B`,
      durationMs: flushDurationMs,
    })
  } else {
    countSystemDebugHot('files', 'stream-flush-tx', flushDurationMs)
  }

  return storedDelta
}

async function closeStreamWrite(state: FilesStreamWriteState): Promise<FilesNode> {
  assertStreamOpen(state)
  const db = await openFilesDb()

  const pendingNonZero = countNonZeroBytes(state.pending)
  const estimatedStored = state.storedByteSize + pendingNonZero
  const hasHoles =
    state.storedByteSize < state.writtenBytes || pendingNonZero < state.pending.byteLength
  if (
    state.backend === 'idb' &&
    !hasHoles &&
    shouldSpillToOpfs(estimatedStored)
  ) {
    if (state.pending.byteLength > 0) {
      await flushStreamPendingChunks(state, true)
    }
    await spillStreamToOpfs(state)
  }

  if (state.backend === 'opfs') {
    if (state.pending.byteLength > 0) {
      if (!state.opfsWriter) {
        state.opfsWriter = await openOpfsBlobWriter(state.blobId)
      }
      await state.opfsWriter.writeAt(state.writtenBytes, state.pending)
      state.writtenBytes += state.pending.byteLength
      state.pending = new Uint8Array(0)
    }
    await state.opfsWriter?.close()
    state.opfsWriter = undefined
    const blobTx = beginIdbTransaction(db, FILES_BLOBS_STORE, 'readwrite')
    putOpfsStreamMetaInTx(blobTx, state)
    await waitForTransaction(blobTx)
  } else if (state.pending.byteLength > 0) {
    const chunkTx = beginIdbTransaction(
      db,
      [FILES_BLOBS_STORE, FILES_CHUNKS_STORE],
      'readwrite',
    )
    let storedDelta = 0
    if (isAllZeros(state.pending)) {
      advanceChunkSlot(state, state.pending.byteLength)
    } else {
      putChunkBytesInTx(chunkTx, state, state.pending)
      storedDelta = state.pending.byteLength
    }
    state.pending = new Uint8Array(0)
    putStreamBlobMetaInTx(chunkTx, state)
    await waitForTransaction(chunkTx)

    if (storedDelta > 0) {
      const metaTx = beginIdbTransaction(db, FILES_META_STORE, 'readwrite')
      await adjustByteTotal(metaTx, storedDelta)
      await waitForTransaction(metaTx)
      state.quotaCommitted += storedDelta
    }
  }

  const updated: FilesNodeRecord = {
    ...state.nodeRecord,
    byteSize: state.writtenBytes,
    updatedAt: osNowMs(),
    ...(state.nodeRecord.kind === 'file'
      ? { blobId: state.blobId, contentRevisionId: newContentRevisionId() }
      : {}),
  }

  if (!state.isNew && state.oldBlobId !== undefined) {
    const tx = beginIdbTransaction(
      db,
      [FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_CHUNKS_STORE, FILES_META_STORE],
      'readwrite',
    )
    tx.objectStore(FILES_NODES_STORE).put(updated)
    const oldBlob = await requestToPromise(
      tx.objectStore(FILES_BLOBS_STORE).get(state.oldBlobId) as IDBRequest<
        FilesBlobRecord | undefined
      >,
    )
    const releasedOpfs = await releaseBlobRefInTx(tx, state.oldBlobId, oldBlob)
    if (oldBlob && resolveBlobRefCount(oldBlob) <= 1) {
      await adjustByteTotal(tx, -state.previousByteSize)
    }
    await waitForTransaction(tx)
    await deleteOpfsBlobs([releasedOpfs])
  } else {
    const nodeTx = beginIdbTransaction(db, FILES_NODES_STORE, 'readwrite')
    nodeTx.objectStore(FILES_NODES_STORE).put(updated)
    await waitForTransaction(nodeTx)
  }

  state.terminal = 'closed'
  streamWrites.delete(state.id)
  emitFilesDataStorageChanged()
  return recordToNode(updated)
}

async function abortStreamWrite(state: FilesStreamWriteState): Promise<void> {
  assertStreamOpen(state)
  await state.opfsWriter?.abort()
  state.opfsWriter = undefined
  const db = await openFilesDb()
  const tx = beginIdbTransaction(
    db,
    [FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_CHUNKS_STORE, FILES_META_STORE],
    'readwrite',
  )
  await deleteBlobChunksInTx(tx, state.blobId)
  tx.objectStore(FILES_BLOBS_STORE).delete(state.blobId)
  if (state.isNew) {
    tx.objectStore(FILES_NODES_STORE).delete(state.nodeId)
  }
  await adjustByteTotal(tx, -state.quotaCommitted)

  state.terminal = 'aborted'
  streamWrites.delete(state.id)
  await waitForTransaction(tx)
  await deleteOpfsBlobs([state.blobId])
  emitFilesDataStorageChanged()
}

export async function renameNodeRecord(params: {
  id: string
  name: string
  metaDelta: number
}): Promise<FilesNode> {
  const total = await assertCapacity(params.metaDelta)

  const db = await openFilesDb()
  const writeTx = beginIdbTransaction(db, [FILES_NODES_STORE, FILES_META_STORE], 'readwrite')
  const store = writeTx.objectStore(FILES_NODES_STORE)
  // 读写同处一笔写入事务：避免「先读后写」窗口内节点被删除 / 移动导致把过期快照写回
  const existing = await requestToPromise(
    store.get(params.id) as IDBRequest<FilesNodeRecord | undefined>,
  )
  if (!existing) {
    await waitForTransaction(writeTx)
    throw new Error('项目不存在')
  }

  // 目标名在写入事务内查重并自动加后缀（排除自身），避免并发改名撞名
  const resolved = await resolveNameInTx(
    writeTx,
    { locationId: existing.locationId, parentId: existing.parentId, name: params.name },
    'unique-suffix',
    existing.id,
  )
  const finalName = resolved.name
  const updated: FilesNodeRecord = {
    ...existing,
    name: finalName,
    nameKey: normalizeFilesNameKey(finalName),
    updatedAt: osNowMs(),
    attributes: normalizeFilesNodeAttributes(existing.locationId, existing.attributes),
  }
  writeTx.objectStore(FILES_NODES_STORE).put(updated)
  if (params.metaDelta !== 0) {
    // metaDelta 按目标名（params.name）计算；实际名可能因冲突加后缀，需按其校正
    const finalDelta =
      params.metaDelta +
      (estimateNodeMetaBytes(recordToNode({ ...existing, name: finalName })) -
        estimateNodeMetaBytes(recordToNode({ ...existing, name: params.name })))
    writeTx.objectStore(FILES_META_STORE).put({
      key: 'byte-total',
      totalBytes: Math.max(0, total + finalDelta),
    } satisfies FilesMetaRecord)
  }
  await waitForTransaction(writeTx)
  emitFilesDataStorageChanged()
  return recordToNode(updated)
}

/**
 * 元数据级移动节点（改所在卷 / 父目录 / 名），不复制 blob、不消耗内容容量。
 * 递归更新整棵子树的所在卷（by-parent 索引按卷查，子树必须一致）。
 * 供同卷移动、移入 / 恢复废纸篓使用；仅限 IndexedDB 本地卷节点。
 * 目标名在写入事务内查重并自动加后缀（排除自身）。
 */
export async function moveNodeRecord(params: {
  id: string
  locationId: FilesLocationId
  parentId: string | undefined
  name: string
  trashOrigin?: FilesNode['trashOrigin']
}): Promise<FilesNode> {
  const subtree = await collectSubtreeIds(params.id)

  const db = await openFilesDb()
  const writeTx = beginIdbTransaction(db, FILES_NODES_STORE, 'readwrite')
  const store = writeTx.objectStore(FILES_NODES_STORE)

  const rootExisting = await requestToPromise(
    store.get(params.id) as IDBRequest<FilesNodeRecord | undefined>,
  )
  if (!rootExisting) {
    await waitForTransaction(writeTx)
    throw new Error('项目不存在')
  }
  const resolved = await resolveNameInTx(
    writeTx,
    { locationId: params.locationId, parentId: params.parentId, name: params.name },
    'unique-suffix',
    params.id,
  )
  const finalName = resolved.name

  let rootNode: FilesNode | undefined
  for (const nodeId of subtree.nodeIds) {
    const existing = await requestToPromise(
      store.get(nodeId) as IDBRequest<FilesNodeRecord | undefined>,
    )
    if (!existing) continue
    const updated: FilesNodeRecord = {
      ...existing,
      locationId: params.locationId,
      nameKey: normalizeFilesNameKey(existing.name),
      attributes: normalizeFilesNodeAttributes(params.locationId, existing.attributes),
    }
    if (nodeId === params.id) {
      updated.parentId = parentKey(params.parentId)
      updated.name = finalName
      updated.nameKey = normalizeFilesNameKey(finalName)
      updated.updatedAt = osNowMs()
      if (params.trashOrigin !== undefined) {
        updated.trashOrigin = {
          locationId: params.trashOrigin.locationId,
          parentId: parentKey(params.trashOrigin.parentId),
          name: params.trashOrigin.name,
        }
      } else {
        delete updated.trashOrigin
      }
      rootNode = recordToNode(updated)
    }
    store.put(updated)
  }
  await waitForTransaction(writeTx)
  emitFilesDataStorageChanged()
  if (!rootNode) {
    throw new Error('项目不存在')
  }
  return rootNode
}

/** 系统层更新节点属性（不检查 writable） */
export async function updateNodeAttributes(
  id: string,
  attributes: FilesNodeAttributes,
): Promise<FilesNode> {
  const db = await openFilesDb()
  const readTx = beginIdbTransaction(db, FILES_NODES_STORE, 'readonly')
  const existing = await requestToPromise(
    readTx.objectStore(FILES_NODES_STORE).get(id) as IDBRequest<FilesNodeRecord | undefined>,
  )
  await waitForTransaction(readTx)
  if (!existing) {
    throw new Error('项目不存在')
  }

  const updated: FilesNodeRecord = {
    ...existing,
    updatedAt: osNowMs(),
    attributes: normalizeFilesNodeAttributes(existing.locationId, attributes),
  }

  const writeTx = beginIdbTransaction(db, FILES_NODES_STORE, 'readwrite')
  writeTx.objectStore(FILES_NODES_STORE).put(updated)
  await waitForTransaction(writeTx)
  emitFilesDataStorageChanged()
  return recordToNode(updated)
}

export async function collectSubtreeIds(rootId: string): Promise<{
  nodeIds: string[]
  fileIds: string[]
  reclaimBytes: number
}> {
  const db = await openFilesDb()
  const tx = beginIdbTransaction(db, [FILES_NODES_STORE, FILES_BLOBS_STORE], 'readonly')
  const store = tx.objectStore(FILES_NODES_STORE)
  const blobs = tx.objectStore(FILES_BLOBS_STORE)
  const index = store.index('by-parent')

  const nodeIds: string[] = []
  const fileIds: string[] = []
  const releaseByBlobId = new Map<string, number>()
  let reclaimBytes = 0

  const collectStartAt = performance.now()
  const visit = async (id: string): Promise<void> => {
    const record = await requestToPromise(store.get(id) as IDBRequest<FilesNodeRecord | undefined>)
    if (!record) return
    countSystemDebugHot('files', 'subtree-visit')
    nodeIds.push(record.id)
    reclaimBytes += estimateNodeMetaBytes(recordToNode(record))
    if (record.kind === 'file') {
      fileIds.push(record.id)
      const blobId = resolveNodeBlobId(record)
      releaseByBlobId.set(blobId, (releaseByBlobId.get(blobId) ?? 0) + 1)
    } else if (record.kind === 'folder') {
      const children = await requestToPromise(
        index.getAll([record.locationId, record.id]) as IDBRequest<FilesNodeRecord[]>,
      )
      for (const child of children ?? []) {
        await visit(child.id)
      }
    }
    // symlink：叶子，无 blob、不递归
  }

  await visit(rootId)

  for (const [blobId, releases] of releaseByBlobId) {
    const blob = await requestToPromise(
      blobs.get(blobId) as IDBRequest<FilesBlobRecord | undefined>,
    )
    if (!blob) continue
    if (releases >= resolveBlobRefCount(blob)) {
      reclaimBytes += blobPayloadBytes(blob)
    }
  }

  await waitForTransaction(tx)
  if (nodeIds.length > 500) {
    recordSystemDebugTimeline({
      layer: 'files',
      op: 'collect-subtree-done',
      detail: `${nodeIds.length} nodes ${reclaimBytes}B`,
      durationMs: Math.round(performance.now() - collectStartAt),
    })
  }
  return { nodeIds, fileIds, reclaimBytes }
}

export type MergedSubtreeCollection = {
  nodeIds: string[]
  fileIds: string[]
  reclaimBytes: number
  bytesByNodeId: Map<string, number>
}

/** 在单个只读事务内收集多棵子树；节点 id 去重，避免路径列表含父子重叠时重复删除。 */
export async function collectSubtreesBatch(
  rootIds: readonly string[],
): Promise<MergedSubtreeCollection> {
  if (rootIds.length === 0) {
    return { nodeIds: [], fileIds: [], reclaimBytes: 0, bytesByNodeId: new Map() }
  }

  const db = await openFilesDb()
  const tx = beginIdbTransaction(db, [FILES_NODES_STORE, FILES_BLOBS_STORE], 'readonly')
  const store = tx.objectStore(FILES_NODES_STORE)
  const blobs = tx.objectStore(FILES_BLOBS_STORE)
  const index = store.index('by-parent')

  const seenNodeIds = new Set<string>()
  const nodeIds: string[] = []
  const fileIds: string[] = []
  const bytesByNodeId = new Map<string, number>()
  const releaseByBlobId = new Map<string, number>()
  const fileBlobId = new Map<string, string>()
  let reclaimBytes = 0

  const visit = async (id: string): Promise<void> => {
    if (seenNodeIds.has(id)) return
    const record = await requestToPromise(store.get(id) as IDBRequest<FilesNodeRecord | undefined>)
    if (!record) return
    seenNodeIds.add(record.id)
    const metaBytes = estimateNodeMetaBytes(recordToNode(record))
    nodeIds.push(record.id)
    bytesByNodeId.set(record.id, metaBytes)
    reclaimBytes += metaBytes
    if (record.kind === 'file') {
      fileIds.push(record.id)
      const blobId = resolveNodeBlobId(record)
      fileBlobId.set(record.id, blobId)
      releaseByBlobId.set(blobId, (releaseByBlobId.get(blobId) ?? 0) + 1)
    }
    if (record.kind === 'folder') {
      const children = await requestToPromise(
        index.getAll([record.locationId, record.id]) as IDBRequest<FilesNodeRecord[]>,
      )
      for (const child of children ?? []) {
        await visit(child.id)
      }
    }
  }

  for (const rootId of rootIds) {
    await visit(rootId)
  }

  for (const [blobId, releases] of releaseByBlobId) {
    const blob = await requestToPromise(
      blobs.get(blobId) as IDBRequest<FilesBlobRecord | undefined>,
    )
    if (!blob) continue
    if (releases < resolveBlobRefCount(blob)) continue
    const content = blobPayloadBytes(blob)
    reclaimBytes += content
    // 将内容字节挂到该 blob 的第一个文件节点上，便于分块删除进度估算
    for (const [fileId, id] of fileBlobId) {
      if (id !== blobId) continue
      bytesByNodeId.set(fileId, (bytesByNodeId.get(fileId) ?? 0) + content)
      break
    }
  }

  await waitForTransaction(tx)
  return { nodeIds, fileIds, reclaimBytes, bytesByNodeId }
}

const LARGE_SUBTREE_DELETE_THRESHOLD = 2000

export async function deleteSubtreesMerged(
  merged: MergedSubtreeCollection,
  options?: { batchSize?: number },
): Promise<void> {
  if (merged.nodeIds.length === 0) return

  const batchSize = Math.max(1, options?.batchSize ?? FILES_BATCH_DEFAULT_SIZE)
  if (merged.nodeIds.length <= LARGE_SUBTREE_DELETE_THRESHOLD) {
    await deleteSubtree({
      nodeIds: merged.nodeIds,
      fileIds: merged.fileIds,
      reclaimBytes: merged.reclaimBytes,
    })
    return
  }

  for (let offset = 0; offset < merged.nodeIds.length; offset += batchSize) {
    const nodeChunk = merged.nodeIds.slice(offset, offset + batchSize)
    const nodeChunkSet = new Set(nodeChunk)
    const fileChunk = merged.fileIds.filter((id) => nodeChunkSet.has(id))
    // reclaimBytes 仅作进度提示；实际配额在 deleteSubtree 内按引用计数重算
    let reclaimChunk = 0
    for (const id of nodeChunk) {
      reclaimChunk += merged.bytesByNodeId.get(id) ?? 0
    }
    await deleteSubtree({
      nodeIds: nodeChunk,
      fileIds: fileChunk,
      reclaimBytes: reclaimChunk,
    })
  }
}

export async function deleteSubtree(params: {
  nodeIds: string[]
  fileIds: string[]
  reclaimBytes: number
}): Promise<void> {
  const deleteStartAt = performance.now()
  const total = await getFilesTotalBytes()
  const db = await openFilesDb()
  const tx = beginIdbTransaction(db, [FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_CHUNKS_STORE, FILES_META_STORE], 'readwrite')
  const nodes = tx.objectStore(FILES_NODES_STORE)
  const blobs = tx.objectStore(FILES_BLOBS_STORE)
  const meta = tx.objectStore(FILES_META_STORE)

  let reclaimBytes = 0
  const fileIdSet = new Set(params.fileIds)
  const releasedOpfs: string[] = []

  for (const id of params.fileIds) {
    const record = await requestToPromise(
      nodes.get(id) as IDBRequest<FilesNodeRecord | undefined>,
    )
    if (!record || record.kind !== 'file') continue
    reclaimBytes += estimateNodeMetaBytes(recordToNode(record))
    const blobId = resolveNodeBlobId(record)
    const blob = await requestToPromise(
      blobs.get(blobId) as IDBRequest<FilesBlobRecord | undefined>,
    )
    if (!blob) continue
    const released = await releaseBlobRefInTx(tx, blobId, blob)
    if (released !== undefined) {
      releasedOpfs.push(released)
      reclaimBytes += blobPayloadBytes(blob)
    }
  }

  for (const id of params.nodeIds) {
    if (fileIdSet.has(id)) {
      nodes.delete(id)
      continue
    }
    const record = await requestToPromise(
      nodes.get(id) as IDBRequest<FilesNodeRecord | undefined>,
    )
    if (record) {
      reclaimBytes += estimateNodeMetaBytes(recordToNode(record))
    }
    nodes.delete(id)
  }

  void params.reclaimBytes
  meta.put({
    key: 'byte-total',
    totalBytes: Math.max(0, total - reclaimBytes),
  } satisfies FilesMetaRecord)

  await waitForTransaction(tx)
  await deleteOpfsBlobs(releasedOpfs)
  emitFilesDataStorageChanged()
  if (params.nodeIds.length > 200) {
    recordSystemDebugTimeline({
      layer: 'files',
      op: 'delete-subtree-tx-done',
      detail: `${params.nodeIds.length} nodes`,
      durationMs: Math.round(performance.now() - deleteStartAt),
    })
  }
}

/** 单次批量提交建议条数（降低 IndexedDB 事务固定开销） */
export const FILES_BATCH_DEFAULT_SIZE = 64

/** 单次批量提交内容字节上限（与条数上限同时生效；单条超限则单独成批） */
export const FILES_BATCH_DEFAULT_MAX_BYTES = 4 * 1024 * 1024

export type FilesStorageBatchOp =
  | { kind: 'create-folder'; node: FilesNode; metaBytes: number }
  | { kind: 'create-text'; node: FilesNode; text: string; metaBytes: number }
  | { kind: 'create-bytes'; node: FilesNode; bytes: ArrayBuffer; metaBytes: number }
  | {
      kind: 'clone-shared'
      node: FilesNode
      sourceNodeId: string
      metaBytes: number
    }
  | {
      kind: 'write-text'
      id: string
      text: string
      previousByteSize: number
      nameMetaDelta: number
    }
  | {
      kind: 'write-bytes'
      id: string
      bytes: ArrayBuffer
      previousByteSize: number
      nameMetaDelta: number
    }

function batchCreateNeededBytes(op: FilesStorageBatchOp): number | undefined {
  switch (op.kind) {
    case 'create-folder':
      return op.metaBytes
    case 'create-text':
      return op.metaBytes + estimateTextBytes(op.text)
    case 'create-bytes':
      return op.metaBytes + op.bytes.byteLength
    case 'clone-shared':
      return op.metaBytes
    default:
      return undefined
  }
}

/**
 * 在同一 IndexedDB 事务内提交多条建写操作；写前按本批净增量做一次容量预检。
 * 返回与 ops 同序的结果节点（create/write 后的节点）。
 */
export async function commitFilesBatch(
  ops: readonly FilesStorageBatchOp[],
): Promise<FilesNode[]> {
  if (ops.length === 0) return []

  const db = await openFilesDb()

  // 预读 write / clone 目标的引用计数，以便正确估算配额
  const probeIds = new Set<string>()
  for (const op of ops) {
    if (op.kind === 'write-text' || op.kind === 'write-bytes') probeIds.add(op.id)
    if (op.kind === 'clone-shared') probeIds.add(op.sourceNodeId)
  }

  const refByNodeId = new Map<string, number>()
  const blobIdByNodeId = new Map<string, string>()
  const sourceRecordById = new Map<string, FilesNodeRecord>()
  const opfsBlobIds = new Set<string>()
  if (probeIds.size > 0) {
    const probeTx = beginIdbTransaction(db, [FILES_NODES_STORE, FILES_BLOBS_STORE], 'readonly')
    for (const id of probeIds) {
      const existing = await requestToPromise(
        probeTx.objectStore(FILES_NODES_STORE).get(id) as IDBRequest<FilesNodeRecord | undefined>,
      )
      if (!existing || existing.kind !== 'file') continue
      sourceRecordById.set(id, existing)
      const blobId = resolveNodeBlobId(existing)
      blobIdByNodeId.set(id, blobId)
      const blob = await requestToPromise(
        probeTx
          .objectStore(FILES_BLOBS_STORE)
          .get(blobId) as IDBRequest<FilesBlobRecord | undefined>,
      )
      refByNodeId.set(id, blob ? resolveBlobRefCount(blob) : 1)
      if (isOpfsBlob(blob)) opfsBlobIds.add(blobId)
    }
    await waitForTransaction(probeTx)
  }

  let needed = 0
  for (const op of ops) {
    const createNeeded = batchCreateNeededBytes(op)
    if (createNeeded !== undefined) {
      needed += createNeeded
      continue
    }
    if (op.kind === 'write-text') {
      const textBytes = estimateTextBytes(op.text)
      const ref = refByNodeId.get(op.id) ?? 1
      needed +=
        ref > 1
          ? textBytes + op.nameMetaDelta
          : textBytes - op.previousByteSize + op.nameMetaDelta
      continue
    }
    if (op.kind === 'write-bytes') {
      const ref = refByNodeId.get(op.id) ?? 1
      needed +=
        ref > 1
          ? op.bytes.byteLength + op.nameMetaDelta
          : op.bytes.byteLength - op.previousByteSize + op.nameMetaDelta
    }
  }
  const total = await assertCapacity(needed)

  const opfsTargetByOp: Array<string | undefined> = Array.from({ length: ops.length })
  const opfsCreated: string[] = []
  const releasedOpfs: string[] = []
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!
    if (op.kind === 'create-bytes' && shouldSpillToOpfs(op.bytes.byteLength)) {
      await writeOpfsBlobBytes(op.node.id, new Uint8Array(op.bytes))
      opfsTargetByOp[i] = op.node.id
      opfsCreated.push(op.node.id)
      continue
    }
    if (op.kind === 'create-text') {
      const bytes = encodeTextToArrayBuffer(op.text)
      if (shouldSpillToOpfs(bytes.byteLength)) {
        await writeOpfsBlobBytes(op.node.id, new Uint8Array(bytes))
        opfsTargetByOp[i] = op.node.id
        opfsCreated.push(op.node.id)
      }
      continue
    }
    if (op.kind !== 'write-bytes' && op.kind !== 'write-text') continue
    const bytes =
      op.kind === 'write-bytes' ? op.bytes : encodeTextToArrayBuffer(op.text)
    const oldBlobId = blobIdByNodeId.get(op.id)
    const ref = refByNodeId.get(op.id) ?? 1
    const stay = oldBlobId !== undefined && opfsBlobIds.has(oldBlobId) && ref <= 1
    if (!stay && !shouldSpillToOpfs(bytes.byteLength)) continue
    const targetId = ref > 1 ? newFilesBlobId() : (oldBlobId ?? newFilesBlobId())
    await writeOpfsBlobBytes(targetId, new Uint8Array(bytes))
    opfsTargetByOp[i] = targetId
    if (!stay) opfsCreated.push(targetId)
  }

  const tx = beginIdbTransaction(db, 
    [FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_CHUNKS_STORE, FILES_META_STORE],
    'readwrite',
  )
  const nodes = tx.objectStore(FILES_NODES_STORE)
  const blobs = tx.objectStore(FILES_BLOBS_STORE)
  const meta = tx.objectStore(FILES_META_STORE)
  const results: FilesNode[] = []
  /** 本事务内对 blob 引用的增量（clone / COW），避免重复读过期快照 */
  const liveRefDelta = new Map<string, number>()

  const liveRef = (blobId: string, base: number): number =>
    base + (liveRefDelta.get(blobId) ?? 0)

  try {
  for (let opIndex = 0; opIndex < ops.length; opIndex++) {
    const op = ops[opIndex]!
    const opfsTarget = opfsTargetByOp[opIndex]
    if (op.kind === 'create-folder') {
      // 事务内精确查重：同名冲突直接失败，避免整批被唯一索引打掉
      await resolveNameInTx(tx, op.node, 'exact')
      nodes.put(nodeToRecord(op.node))
      results.push(op.node)
      continue
    }
    if (op.kind === 'create-text') {
      await resolveNameInTx(tx, op.node, 'exact')
      const textBytes = estimateTextBytes(op.text)
      const node: FilesNode = {
        ...op.node,
        byteSize: textBytes,
        contentRevisionId: newContentRevisionId(),
      }
      const blobId = node.id
      nodes.put(nodeToRecord(node, blobId))
      if (opfsTarget !== undefined) {
        blobs.put(opfsBlobIndexRecord(blobId, textBytes))
      } else {
        putBlobContentInTx(tx, blobId, encodeTextToArrayBuffer(op.text))
      }
      results.push(node)
      continue
    }
    if (op.kind === 'create-bytes') {
      await resolveNameInTx(tx, op.node, 'exact')
      const contentBytes = op.bytes.byteLength
      const node: FilesNode = {
        ...op.node,
        byteSize: contentBytes,
        contentRevisionId: newContentRevisionId(),
      }
      const blobId = node.id
      nodes.put(nodeToRecord(node, blobId))
      if (opfsTarget !== undefined) {
        blobs.put(opfsBlobIndexRecord(blobId, contentBytes))
      } else {
        putBlobContentInTx(tx, blobId, op.bytes)
      }
      results.push(node)
      continue
    }
    if (op.kind === 'clone-shared') {
      await resolveNameInTx(tx, op.node, 'exact')
      const source = sourceRecordById.get(op.sourceNodeId)
      if (!source || source.kind !== 'file') {
        throw new Error('源文件不存在')
      }
      const blobId = blobIdByNodeId.get(op.sourceNodeId) ?? resolveNodeBlobId(source)
      const baseRef = refByNodeId.get(op.sourceNodeId) ?? 1
      const nextRef = liveRef(blobId, baseRef) + 1
      liveRefDelta.set(blobId, (liveRefDelta.get(blobId) ?? 0) + 1)
      const existingBlob = await requestToPromise(
        blobs.get(blobId) as IDBRequest<FilesBlobRecord | undefined>,
      )
      if (!existingBlob) {
        throw new Error('源文件内容不存在')
      }
      blobs.put({ ...existingBlob, refCount: nextRef } satisfies FilesBlobRecord)
      const node: FilesNode = {
        ...op.node,
        kind: 'file',
        byteSize: source.byteSize,
        mimeType: op.node.mimeType ?? source.mimeType,
        contentRevisionId: source.contentRevisionId ?? newContentRevisionId(),
      }
      nodes.put(nodeToRecord(node, blobId))
      results.push(node)
      continue
    }
    if (op.kind === 'write-text') {
      const existing = await requestToPromise(
        nodes.get(op.id) as IDBRequest<FilesNodeRecord | undefined>,
      )
      if (!existing) {
        throw new Error('文件不存在')
      }
      const textBytes = estimateTextBytes(op.text)
      const bytes = encodeTextToArrayBuffer(op.text)
      const oldBlobId = resolveNodeBlobId(existing)
      const baseRef = refByNodeId.get(op.id) ?? 1
      const refCount = liveRef(oldBlobId, baseRef)
      const updated: FilesNodeRecord = {
        ...existing,
        byteSize: textBytes,
        updatedAt: osNowMs(),
        contentRevisionId: newContentRevisionId(),
        attributes: normalizeFilesNodeAttributes(existing.locationId, existing.attributes),
      }
      if (refCount > 1) {
        const newBlobId = opfsTarget ?? newFilesBlobId()
        updated.blobId = newBlobId
        if (opfsTarget !== undefined) {
          blobs.put(opfsBlobIndexRecord(newBlobId, textBytes))
        } else {
          putBlobContentInTx(tx, newBlobId, bytes)
        }
        const oldBlob = await requestToPromise(
          blobs.get(oldBlobId) as IDBRequest<FilesBlobRecord | undefined>,
        )
        if (oldBlob) {
          const nextRef = refCount - 1
          liveRefDelta.set(oldBlobId, (liveRefDelta.get(oldBlobId) ?? 0) - 1)
          if (nextRef <= 0) {
            const released = await releaseBlobRefInTx(tx, oldBlobId, oldBlob)
            if (released !== undefined) releasedOpfs.push(released)
          } else {
            blobs.put({ ...oldBlob, refCount: nextRef } satisfies FilesBlobRecord)
          }
        }
      } else {
        updated.blobId = oldBlobId
        const oldBlob = await requestToPromise(
          blobs.get(oldBlobId) as IDBRequest<FilesBlobRecord | undefined>,
        )
        if (oldBlob?.chunked === true) {
          await deleteBlobChunksInTx(tx, oldBlobId)
        }
        if (opfsTarget !== undefined) {
          blobs.put(opfsBlobIndexRecord(oldBlobId, textBytes))
        } else {
          putBlobContentInTx(tx, oldBlobId, bytes)
        }
      }
      nodes.put(updated)
      results.push(recordToNode(updated))
      continue
    }

    const existing = await requestToPromise(
      nodes.get(op.id) as IDBRequest<FilesNodeRecord | undefined>,
    )
    if (!existing) {
      throw new Error('文件不存在')
    }
    const contentBytes = op.bytes.byteLength
    const oldBlobId = resolveNodeBlobId(existing)
    const baseRef = refByNodeId.get(op.id) ?? 1
    const refCount = liveRef(oldBlobId, baseRef)
    const updated: FilesNodeRecord = {
      ...existing,
      byteSize: contentBytes,
      updatedAt: osNowMs(),
      contentRevisionId: newContentRevisionId(),
      attributes: normalizeFilesNodeAttributes(existing.locationId, existing.attributes),
    }
    if (refCount > 1) {
      const newBlobId = opfsTarget ?? newFilesBlobId()
      updated.blobId = newBlobId
      if (opfsTarget !== undefined) {
        blobs.put(opfsBlobIndexRecord(newBlobId, contentBytes))
      } else {
        putBlobContentInTx(tx, newBlobId, op.bytes)
      }
      const oldBlob = await requestToPromise(
        blobs.get(oldBlobId) as IDBRequest<FilesBlobRecord | undefined>,
      )
      if (oldBlob) {
        const nextRef = refCount - 1
        liveRefDelta.set(oldBlobId, (liveRefDelta.get(oldBlobId) ?? 0) - 1)
        if (nextRef <= 0) {
          const released = await releaseBlobRefInTx(tx, oldBlobId, oldBlob)
          if (released !== undefined) releasedOpfs.push(released)
        } else {
          blobs.put({ ...oldBlob, refCount: nextRef } satisfies FilesBlobRecord)
        }
      }
    } else {
      updated.blobId = oldBlobId
      const oldBlob = await requestToPromise(
        blobs.get(oldBlobId) as IDBRequest<FilesBlobRecord | undefined>,
      )
      if (oldBlob?.chunked === true) {
        await deleteBlobChunksInTx(tx, oldBlobId)
      }
      if (opfsTarget !== undefined) {
        blobs.put(opfsBlobIndexRecord(oldBlobId, contentBytes))
      } else {
        putBlobContentInTx(tx, oldBlobId, op.bytes)
      }
    }
    nodes.put(updated)
    results.push(recordToNode(updated))
  }

  meta.put({
    key: 'byte-total',
    totalBytes: Math.max(0, total + needed),
  } satisfies FilesMetaRecord)

    await waitForTransaction(tx)
  } catch (error) {
    await deleteOpfsBlobs(opfsCreated)
    throw error
  }
  await deleteOpfsBlobs(releasedOpfs)
  emitFilesDataStorageChanged()
  return results
}

/** 子树内文件节点的扁平元数据（不含路径，由上层用 parentId 拼） */
export type LocalVolumeFileNodeMeta = {
  id: string
  parentId: string | undefined
  name: string
  byteSize: number
  contentRevisionId: string | undefined
  updatedAt: number
}

/**
 * 单只读事务：从 rootFolderId（undefined = 卷根）BFS 收集所有文件节点元数据。
 * 仅适用于 IndexedDB 本地卷（local / repo），不支持 mount。
 */
export async function listLocalVolumeFileNodes(
  locationId: FilesLocationId,
  rootFolderId: string | undefined,
): Promise<LocalVolumeFileNodeMeta[]> {
  const db = await openFilesDb()
  const tx = beginIdbTransaction(db, FILES_NODES_STORE, 'readonly')
  const store = tx.objectStore(FILES_NODES_STORE)
  const index = store.index('by-parent')

  const files: LocalVolumeFileNodeMeta[] = []
  const folderQueue: Array<string | undefined> = [rootFolderId]
  const scanStartAt = performance.now()

  while (folderQueue.length > 0) {
    const parentId = folderQueue.shift()
    const children = await requestToPromise(
      index.getAll([locationId, parentKey(parentId)]) as IDBRequest<FilesNodeRecord[]>,
    )
    for (const child of children ?? []) {
      if (child.kind === 'folder') {
        folderQueue.push(child.id)
      } else if (child.kind === 'file') {
        files.push({
          id: child.id,
          parentId: child.parentId === FILES_ROOT_PARENT_KEY ? undefined : child.parentId,
          name: child.name,
          byteSize: child.byteSize,
          contentRevisionId: child.contentRevisionId,
          updatedAt: child.updatedAt,
        })
      }
    }
  }

  await waitForTransaction(tx)
  recordSystemDebugTimeline({
    layer: 'files',
    op: 'list-volume-files-done',
    detail: `${locationId} → ${files.length} files`,
    durationMs: Math.round(performance.now() - scanStartAt),
  })
  return files
}

/**
 * 对子树内缺 contentRevisionId 的文件节点批量补 UUID（单 write 事务）。
 * 返回补齐数量。
 */
export async function backfillContentRevisionIds(
  locationId: FilesLocationId,
  rootFolderId: string | undefined,
): Promise<number> {
  const db = await openFilesDb()
  const tx = beginIdbTransaction(db, FILES_NODES_STORE, 'readwrite')
  const store = tx.objectStore(FILES_NODES_STORE)
  const index = store.index('by-parent')

  let written = 0
  const folderQueue: Array<string | undefined> = [rootFolderId]

  while (folderQueue.length > 0) {
    const parentId = folderQueue.shift()
    const children = await requestToPromise(
      index.getAll([locationId, parentKey(parentId)]) as IDBRequest<FilesNodeRecord[]>,
    )
    for (const child of children ?? []) {
      if (child.kind === 'folder') {
        folderQueue.push(child.id)
        continue
      }
      if (child.kind !== 'file') continue
      if (child.contentRevisionId !== undefined) continue
      const updated: FilesNodeRecord = {
        ...child,
        contentRevisionId: newContentRevisionId(),
      }
      store.put(updated)
      written += 1
    }
  }

  await waitForTransaction(tx)
  if (written > 0) {
    recordSystemDebugTimeline({
      layer: 'files',
      op: 'backfill-revision-ids',
      detail: `${locationId} wrote=${written}`,
    })
    emitFilesDataStorageChanged()
  }
  return written
}

/**
 * 单事务：收集子树内所有节点（含文件夹），供路径拼装用。
 * 返回 files + folders（folders 含 id→name/parentId）。
 */
export async function listLocalVolumeSubtreeNodes(
  locationId: FilesLocationId,
  rootFolderId: string | undefined,
): Promise<{
  files: LocalVolumeFileNodeMeta[]
  folders: Map<string, { parentId: string | undefined; name: string }>
}> {
  const db = await openFilesDb()
  const tx = beginIdbTransaction(db, FILES_NODES_STORE, 'readonly')
  const store = tx.objectStore(FILES_NODES_STORE)
  const index = store.index('by-parent')

  const files: LocalVolumeFileNodeMeta[] = []
  const folders = new Map<string, { parentId: string | undefined; name: string }>()
  const folderQueue: Array<string | undefined> = [rootFolderId]
  const scanStartAt = performance.now()

  while (folderQueue.length > 0) {
    const parentId = folderQueue.shift()
    const children = await requestToPromise(
      index.getAll([locationId, parentKey(parentId)]) as IDBRequest<FilesNodeRecord[]>,
    )
    for (const child of children ?? []) {
      if (child.kind === 'folder') {
        folders.set(child.id, {
          parentId: child.parentId === FILES_ROOT_PARENT_KEY ? undefined : child.parentId,
          name: child.name,
        })
        folderQueue.push(child.id)
      } else if (child.kind === 'file') {
        files.push({
          id: child.id,
          parentId: child.parentId === FILES_ROOT_PARENT_KEY ? undefined : child.parentId,
          name: child.name,
          byteSize: child.byteSize,
          contentRevisionId: child.contentRevisionId,
          updatedAt: child.updatedAt,
        })
      }
    }
  }

  await waitForTransaction(tx)
  if (files.length + folders.size > 500) {
    // 大子树 BFS：tsc 扫类型树 / 搜索 / 打包前的全量枚举
    recordSystemDebugTimeline({
      layer: 'files',
      op: 'list-volume-subtree-done',
      detail: `${locationId} → ${files.length} files ${folders.size} folders`,
      durationMs: Math.round(performance.now() - scanStartAt),
    })
  }
  return { files, folders }
}
