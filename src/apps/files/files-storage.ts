/**
 * 文件存储底层（系统 / root 层）。
 * 不检查节点 `writable`；内置应用维护受保护数据时应使用本模块或专用 internal 模块，
 * 面向用户的读写请走 files-vfs / files-api。
 */
import { osNowMs } from '../../os/os-clock.ts'
import {
  DATA_CAPACITY_BYTES,
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

export const FILES_DB_NAME = 'instant-os-files'
export const FILES_DB_VERSION = 1
export const FILES_NODES_STORE = 'nodes'
export const FILES_BLOBS_STORE = 'blobs'
export const FILES_META_STORE = 'meta'

/** IndexedDB 复合索引用空字符串表示根目录父级 */
export const FILES_ROOT_PARENT_KEY = ''

type FilesNodeRecord = {
  id: string
  locationId: FilesLocationId
  parentId: string
  name: string
  kind: FilesNodeKind
  mimeType?: string
  byteSize: number
  createdAt: number
  updatedAt: number
  /** 内容版本戳；旧记录 / 文件夹可能缺失 */
  contentRevisionId?: string
  /** 旧数据可能缺失；读取时按位置默认补齐 */
  attributes?: FilesNodeAttributes
}

type FilesBlobRecord = {
  id: string
  /** 文本内容；与 bytes 可并存，读取方按用途择一 */
  text?: string
  /** 二进制内容（图片等）；无则不可当作二进制文件读取 */
  bytes?: ArrayBuffer
}

type FilesMetaRecord = {
  key: 'byte-total'
  totalBytes: number
}

export class FilesStorageFullError extends Error {
  constructor() {
    super(`数据空间已满（${formatStorageSize(DATA_CAPACITY_BYTES)} 上限）`)
    this.name = 'FilesStorageFullError'
  }
}

let dbPromise: Promise<IDBDatabase> | undefined

function openFilesDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(FILES_DB_NAME, FILES_DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(FILES_NODES_STORE)) {
        const store = db.createObjectStore(FILES_NODES_STORE, { keyPath: 'id' })
        store.createIndex('by-parent', ['locationId', 'parentId'], { unique: false })
        store.createIndex('by-location', 'locationId', { unique: false })
      }
      if (!db.objectStoreNames.contains(FILES_BLOBS_STORE)) {
        db.createObjectStore(FILES_BLOBS_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(FILES_META_STORE)) {
        db.createObjectStore(FILES_META_STORE, { keyPath: 'key' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      dbPromise = undefined
      reject(request.error ?? new Error('无法打开文件 IndexedDB'))
    }
  })

  return dbPromise
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
  return node
}

function nodeToRecord(node: FilesNode): FilesNodeRecord {
  const record: FilesNodeRecord = {
    id: node.id,
    locationId: node.locationId,
    parentId: parentKey(node.parentId),
    name: node.name,
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
  return record
}

export function estimateTextBytes(text: string): number {
  return new TextEncoder().encode(text).length
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
  const tx = db.transaction(FILES_META_STORE, 'readonly')
  const meta = await requestToPromise(
    tx.objectStore(FILES_META_STORE).get('byte-total') as IDBRequest<FilesMetaRecord | undefined>,
  )
  await waitForTransaction(tx)
  return meta?.totalBytes ?? 0
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
  if (additionalBytes > 0 && filesTotal + dataTotal + additionalBytes > DATA_CAPACITY_BYTES) {
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
  const tx = db.transaction(FILES_NODES_STORE, 'readonly')
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
  const tx = db.transaction(FILES_NODES_STORE, 'readonly')
  const record = await requestToPromise(
    tx.objectStore(FILES_NODES_STORE).get(id) as IDBRequest<FilesNodeRecord | undefined>,
  )
  await waitForTransaction(tx)
  return record ? recordToNode(record) : undefined
}

export async function readBlobText(id: string): Promise<string> {
  const db = await openFilesDb()
  const tx = db.transaction(FILES_BLOBS_STORE, 'readonly')
  const record = await requestToPromise(
    tx.objectStore(FILES_BLOBS_STORE).get(id) as IDBRequest<FilesBlobRecord | undefined>,
  )
  await waitForTransaction(tx)
  return record?.text ?? ''
}

/** 读取本地卷二进制内容；无 bytes 时返回 undefined（不把文本当二进制） */
export async function readBlobBytes(id: string): Promise<ArrayBuffer | undefined> {
  const db = await openFilesDb()
  const tx = db.transaction(FILES_BLOBS_STORE, 'readonly')
  const record = await requestToPromise(
    tx.objectStore(FILES_BLOBS_STORE).get(id) as IDBRequest<FilesBlobRecord | undefined>,
  )
  await waitForTransaction(tx)
  return record?.bytes
}

export async function createFileWithBlob(params: {
  node: FilesNode
  text: string
  metaBytes: number
}): Promise<FilesNode> {
  const textBytes = estimateTextBytes(params.text)
  const needed = params.metaBytes + textBytes
  const total = await assertCapacity(needed)
  const node: FilesNode = {
    ...params.node,
    byteSize: textBytes,
    contentRevisionId: newContentRevisionId(),
  }

  const db = await openFilesDb()
  const tx = db.transaction([FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_META_STORE], 'readwrite')
  tx.objectStore(FILES_NODES_STORE).put(nodeToRecord(node))
  tx.objectStore(FILES_BLOBS_STORE).put({ id: node.id, text: params.text } satisfies FilesBlobRecord)
  tx.objectStore(FILES_META_STORE).put({
    key: 'byte-total',
    totalBytes: total + needed,
  } satisfies FilesMetaRecord)
  await waitForTransaction(tx)
  emitFilesDataStorageChanged()
  return node
}

export async function createFileWithBytes(params: {
  node: FilesNode
  bytes: ArrayBuffer
  metaBytes: number
}): Promise<FilesNode> {
  const contentBytes = params.bytes.byteLength
  const needed = params.metaBytes + contentBytes
  const total = await assertCapacity(needed)
  const node: FilesNode = {
    ...params.node,
    byteSize: contentBytes,
    contentRevisionId: newContentRevisionId(),
  }

  const db = await openFilesDb()
  const tx = db.transaction([FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_META_STORE], 'readwrite')
  tx.objectStore(FILES_NODES_STORE).put(nodeToRecord(node))
  tx.objectStore(FILES_BLOBS_STORE).put({
    id: node.id,
    bytes: params.bytes,
  } satisfies FilesBlobRecord)
  tx.objectStore(FILES_META_STORE).put({
    key: 'byte-total',
    totalBytes: total + needed,
  } satisfies FilesMetaRecord)
  await waitForTransaction(tx)
  emitFilesDataStorageChanged()
  return node
}

export async function createFolderNode(params: {
  node: FilesNode
  metaBytes: number
}): Promise<FilesNode> {
  const total = await assertCapacity(params.metaBytes)
  const db = await openFilesDb()
  const tx = db.transaction([FILES_NODES_STORE, FILES_META_STORE], 'readwrite')
  tx.objectStore(FILES_NODES_STORE).put(nodeToRecord(params.node))
  tx.objectStore(FILES_META_STORE).put({
    key: 'byte-total',
    totalBytes: total + params.metaBytes,
  } satisfies FilesMetaRecord)
  await waitForTransaction(tx)
  emitFilesDataStorageChanged()
  return params.node
}

export async function writeBlobText(params: {
  id: string
  text: string
  previousByteSize: number
  nameMetaDelta: number
}): Promise<FilesNode> {
  const textBytes = estimateTextBytes(params.text)
  const needed = textBytes - params.previousByteSize + params.nameMetaDelta
  const total = await assertCapacity(needed)

  const db = await openFilesDb()
  const readTx = db.transaction(FILES_NODES_STORE, 'readonly')
  const existing = await requestToPromise(
    readTx.objectStore(FILES_NODES_STORE).get(params.id) as IDBRequest<FilesNodeRecord | undefined>,
  )
  await waitForTransaction(readTx)
  if (!existing) {
    throw new Error('文件不存在')
  }

  const updated: FilesNodeRecord = {
    ...existing,
    byteSize: textBytes,
    updatedAt: osNowMs(),
    contentRevisionId: newContentRevisionId(),
    attributes: normalizeFilesNodeAttributes(existing.locationId, existing.attributes),
  }

  const writeTx = db.transaction([FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_META_STORE], 'readwrite')
  writeTx.objectStore(FILES_NODES_STORE).put(updated)
  writeTx.objectStore(FILES_BLOBS_STORE).put({ id: params.id, text: params.text } satisfies FilesBlobRecord)
  writeTx.objectStore(FILES_META_STORE).put({
    key: 'byte-total',
    totalBytes: Math.max(0, total + needed),
  } satisfies FilesMetaRecord)
  await waitForTransaction(writeTx)
  emitFilesDataStorageChanged()
  return recordToNode(updated)
}

export async function writeBlobBytes(params: {
  id: string
  bytes: ArrayBuffer
  previousByteSize: number
  nameMetaDelta: number
}): Promise<FilesNode> {
  const contentBytes = params.bytes.byteLength
  const needed = contentBytes - params.previousByteSize + params.nameMetaDelta
  const total = await assertCapacity(needed)

  const db = await openFilesDb()
  const readTx = db.transaction(FILES_NODES_STORE, 'readonly')
  const existing = await requestToPromise(
    readTx.objectStore(FILES_NODES_STORE).get(params.id) as IDBRequest<FilesNodeRecord | undefined>,
  )
  await waitForTransaction(readTx)
  if (!existing) {
    throw new Error('文件不存在')
  }

  const updated: FilesNodeRecord = {
    ...existing,
    byteSize: contentBytes,
    updatedAt: osNowMs(),
    contentRevisionId: newContentRevisionId(),
    attributes: normalizeFilesNodeAttributes(existing.locationId, existing.attributes),
  }

  const writeTx = db.transaction([FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_META_STORE], 'readwrite')
  writeTx.objectStore(FILES_NODES_STORE).put(updated)
  writeTx.objectStore(FILES_BLOBS_STORE).put({
    id: params.id,
    bytes: params.bytes,
  } satisfies FilesBlobRecord)
  writeTx.objectStore(FILES_META_STORE).put({
    key: 'byte-total',
    totalBytes: Math.max(0, total + needed),
  } satisfies FilesMetaRecord)
  await waitForTransaction(writeTx)
  emitFilesDataStorageChanged()
  return recordToNode(updated)
}

export async function renameNodeRecord(params: {
  id: string
  name: string
  metaDelta: number
}): Promise<FilesNode> {
  const total = await assertCapacity(params.metaDelta)

  const db = await openFilesDb()
  const readTx = db.transaction(FILES_NODES_STORE, 'readonly')
  const existing = await requestToPromise(
    readTx.objectStore(FILES_NODES_STORE).get(params.id) as IDBRequest<FilesNodeRecord | undefined>,
  )
  await waitForTransaction(readTx)
  if (!existing) {
    throw new Error('项目不存在')
  }

  const updated: FilesNodeRecord = {
    ...existing,
    name: params.name,
    updatedAt: osNowMs(),
    attributes: normalizeFilesNodeAttributes(existing.locationId, existing.attributes),
  }

  const writeTx = db.transaction([FILES_NODES_STORE, FILES_META_STORE], 'readwrite')
  writeTx.objectStore(FILES_NODES_STORE).put(updated)
  if (params.metaDelta !== 0) {
    writeTx.objectStore(FILES_META_STORE).put({
      key: 'byte-total',
      totalBytes: Math.max(0, total + params.metaDelta),
    } satisfies FilesMetaRecord)
  }
  await waitForTransaction(writeTx)
  emitFilesDataStorageChanged()
  return recordToNode(updated)
}

/** 系统层更新节点属性（不检查 writable） */
export async function updateNodeAttributes(
  id: string,
  attributes: FilesNodeAttributes,
): Promise<FilesNode> {
  const db = await openFilesDb()
  const readTx = db.transaction(FILES_NODES_STORE, 'readonly')
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

  const writeTx = db.transaction(FILES_NODES_STORE, 'readwrite')
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
  const tx = db.transaction(FILES_NODES_STORE, 'readonly')
  const store = tx.objectStore(FILES_NODES_STORE)
  const index = store.index('by-parent')

  const nodeIds: string[] = []
  const fileIds: string[] = []
  let reclaimBytes = 0

  const visit = async (id: string): Promise<void> => {
    const record = await requestToPromise(store.get(id) as IDBRequest<FilesNodeRecord | undefined>)
    if (!record) return
    nodeIds.push(record.id)
    reclaimBytes += estimateNodeMetaBytes(recordToNode(record))
    if (record.kind === 'file') {
      fileIds.push(record.id)
      reclaimBytes += record.byteSize
    } else {
      const children = await requestToPromise(
        index.getAll([record.locationId, record.id]) as IDBRequest<FilesNodeRecord[]>,
      )
      for (const child of children ?? []) {
        await visit(child.id)
      }
    }
  }

  await visit(rootId)
  await waitForTransaction(tx)
  return { nodeIds, fileIds, reclaimBytes }
}

export async function deleteSubtree(params: {
  nodeIds: string[]
  fileIds: string[]
  reclaimBytes: number
}): Promise<void> {
  const total = await getFilesTotalBytes()
  const db = await openFilesDb()
  const tx = db.transaction([FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_META_STORE], 'readwrite')
  const nodes = tx.objectStore(FILES_NODES_STORE)
  const blobs = tx.objectStore(FILES_BLOBS_STORE)
  const meta = tx.objectStore(FILES_META_STORE)

  for (const id of params.fileIds) {
    blobs.delete(id)
  }
  for (const id of params.nodeIds) {
    nodes.delete(id)
  }
  meta.put({
    key: 'byte-total',
    totalBytes: Math.max(0, total - params.reclaimBytes),
  } satisfies FilesMetaRecord)

  await waitForTransaction(tx)
  emitFilesDataStorageChanged()
}

/** 单次批量提交建议条数（降低 IndexedDB 事务固定开销） */
export const FILES_BATCH_DEFAULT_SIZE = 64

export type FilesStorageBatchOp =
  | { kind: 'create-folder'; node: FilesNode; metaBytes: number }
  | { kind: 'create-text'; node: FilesNode; text: string; metaBytes: number }
  | { kind: 'create-bytes'; node: FilesNode; bytes: ArrayBuffer; metaBytes: number }
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

function batchOpNeededBytes(op: FilesStorageBatchOp): number {
  switch (op.kind) {
    case 'create-folder':
      return op.metaBytes
    case 'create-text':
      return op.metaBytes + estimateTextBytes(op.text)
    case 'create-bytes':
      return op.metaBytes + op.bytes.byteLength
    case 'write-text':
      return estimateTextBytes(op.text) - op.previousByteSize + op.nameMetaDelta
    case 'write-bytes':
      return op.bytes.byteLength - op.previousByteSize + op.nameMetaDelta
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

  let needed = 0
  for (const op of ops) {
    needed += batchOpNeededBytes(op)
  }
  const total = await assertCapacity(needed)

  const db = await openFilesDb()
  const tx = db.transaction(
    [FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_META_STORE],
    'readwrite',
  )
  const nodes = tx.objectStore(FILES_NODES_STORE)
  const blobs = tx.objectStore(FILES_BLOBS_STORE)
  const meta = tx.objectStore(FILES_META_STORE)
  const results: FilesNode[] = []

  for (const op of ops) {
    if (op.kind === 'create-folder') {
      nodes.put(nodeToRecord(op.node))
      results.push(op.node)
      continue
    }
    if (op.kind === 'create-text') {
      const textBytes = estimateTextBytes(op.text)
      const node: FilesNode = {
        ...op.node,
        byteSize: textBytes,
        contentRevisionId: newContentRevisionId(),
      }
      nodes.put(nodeToRecord(node))
      blobs.put({ id: node.id, text: op.text } satisfies FilesBlobRecord)
      results.push(node)
      continue
    }
    if (op.kind === 'create-bytes') {
      const contentBytes = op.bytes.byteLength
      const node: FilesNode = {
        ...op.node,
        byteSize: contentBytes,
        contentRevisionId: newContentRevisionId(),
      }
      nodes.put(nodeToRecord(node))
      blobs.put({ id: node.id, bytes: op.bytes } satisfies FilesBlobRecord)
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
      const updated: FilesNodeRecord = {
        ...existing,
        byteSize: textBytes,
        updatedAt: osNowMs(),
        contentRevisionId: newContentRevisionId(),
        attributes: normalizeFilesNodeAttributes(existing.locationId, existing.attributes),
      }
      nodes.put(updated)
      blobs.put({ id: op.id, text: op.text } satisfies FilesBlobRecord)
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
    const updated: FilesNodeRecord = {
      ...existing,
      byteSize: contentBytes,
      updatedAt: osNowMs(),
      contentRevisionId: newContentRevisionId(),
      attributes: normalizeFilesNodeAttributes(existing.locationId, existing.attributes),
    }
    nodes.put(updated)
    blobs.put({ id: op.id, bytes: op.bytes } satisfies FilesBlobRecord)
    results.push(recordToNode(updated))
  }

  meta.put({
    key: 'byte-total',
    totalBytes: Math.max(0, total + needed),
  } satisfies FilesMetaRecord)

  await waitForTransaction(tx)
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
  const tx = db.transaction(FILES_NODES_STORE, 'readonly')
  const store = tx.objectStore(FILES_NODES_STORE)
  const index = store.index('by-parent')

  const files: LocalVolumeFileNodeMeta[] = []
  const folderQueue: Array<string | undefined> = [rootFolderId]

  while (folderQueue.length > 0) {
    const parentId = folderQueue.shift()
    const children = await requestToPromise(
      index.getAll([locationId, parentKey(parentId)]) as IDBRequest<FilesNodeRecord[]>,
    )
    for (const child of children ?? []) {
      if (child.kind === 'folder') {
        folderQueue.push(child.id)
      } else {
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
  const tx = db.transaction(FILES_NODES_STORE, 'readwrite')
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
  if (written > 0) emitFilesDataStorageChanged()
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
  const tx = db.transaction(FILES_NODES_STORE, 'readonly')
  const store = tx.objectStore(FILES_NODES_STORE)
  const index = store.index('by-parent')

  const files: LocalVolumeFileNodeMeta[] = []
  const folders = new Map<string, { parentId: string | undefined; name: string }>()
  const folderQueue: Array<string | undefined> = [rootFolderId]

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
      } else {
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
  return { files, folders }
}
