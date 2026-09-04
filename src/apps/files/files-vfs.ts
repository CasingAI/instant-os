import { recordFilesIoByteEvent } from '../../os/files-io-metrics.ts'
import {
  countSystemDebugHot,
  recordSystemDebugHot,
  recordSystemDebugTimeline,
  recordSlowVfsResolve,
} from '../../os/system-debug-log.ts'
import { osNowMs } from '../../os/os-clock.ts'
import {
  assertAdditionalBytesAvailable,
  backfillContentRevisionIds,
  collectSubtreeIds,
  collectSubtreesBatch,
  commitFilesBatch,
  cloneFileNodeWithSharedBlob,
  createFileWithBlob,
  createFileWithBytes,
  createFolderNode,
  createSparseFile,
  createSymlinkNode,
  deleteSubtree,
  deleteSubtreesMerged,
  estimateNodeMetaBytes,
  estimateTextBytes,
  FILES_BATCH_DEFAULT_MAX_BYTES,
  FILES_BATCH_DEFAULT_SIZE,
  FilesContentRevisionMismatchError,
  getNode,
  getNodeBlobStoredBytes,
  listChildNodes,
  listLocalVolumeSubtreeNodes,
  newFilesNodeId,
  openStreamWriteBlob,
  readBlobBytes,
  readBlobBytesRange,
  readBlobText,
  renameNodeRecord,
  moveNodeRecord,
  normalizeFilesNameKey,
  uniqueNameAmong,
  writeBlobBytes,
  writeBlobBytesRange,
  writeBlobText,
  type FilesNodeNameMode,
  type FilesStorageBatchOp,
  type FilesStreamWriter,
} from './files-storage.ts'

export type { FilesStreamWriter }
import {
  createMountTextFile,
  getMountNode,
  listMountDirectory,
  mkdirMount,
  createMountBinaryFile,
  openMountStreamWrite,
  readMountBlob,
  readMountText,
  readMountTextIfSmall,
  removeMountNode,
  renameMountNode,
  resolveMountPath,
  resolveMountRelativePath,
  writeMountBlob,
  writeMountBytesRange,
  writeMountText,
} from './files-location-mount.ts'
import {
  createImageBinaryFile,
  createImageTextFile,
  getImageNode,
  listImageDirectory,
  mkdirImage,
  openImageStreamWrite,
  readImageBlob,
  readImageBlobRange,
  readImageText,
  readImageTextIfSmall,
  removeImageNode,
  renameImageNode,
  resolveImagePath,
  resolveImageRelativePath,
  writeImageBlob,
  writeImageBytesRange,
  writeImageText,
} from './files-location-image.ts'
import {
  getCachedImageMount,
  listImageMounts,
  FILES_IMAGE_MOUNTS_CHANGED_EVENT,
} from './files-image-mount-store.ts'
import {
  diskImageOccupiedForFileOpError,
  findOccupiedDiskImagePathUnder,
} from './files-disk-image-occupancy.ts'
import {
  getModels3dNode,
  listModels3dDirectory,
  readModels3dBlob,
  readModels3dText,
  resolveModels3dPath,
} from './files-location-models3d.ts'
import {
  getSourceNode,
  listSourceDirectory,
  readSourceBlob,
  readSourceText,
  resolveSourcePath,
} from './files-location-source.ts'
import {
  getApplicationsNode,
  listApplicationsDirectory,
  readApplicationsBlob,
  readApplicationsText,
  resolveApplicationsPath,
} from './files-location-applications.ts'
import { getCachedMount, listMounts, FILES_MOUNTS_CHANGED_EVENT } from './files-mount-store.ts'
import {
  filesLocationPathRoot,
  isFilesAbsolutePath,
  isFilesNamespaceRoot,
  joinFilesAbsolutePath,
  normalizeFilesNodeName,
  parseFilesAbsolutePath,
} from './files-path.ts'
import {
  FILES_LOCATIONS,
  FILES_TEXT_MIME,
  defaultFilesNodeAttributes,
  canCreateSymlinkOnLocation,
  isFilesLocationWritable,
  isFilesNodeWritable,
  isImageLocationId,
  isImageNodeId,
  isMountLocationId,
  isMountNodeId,
  isTrashLocationId,
  locationSupportsTrash,
  type FilesLocation,
  type FilesLocationId,
  type FilesNode,
  type FilesNodeAttributes,
  type ImageFilesLocationId,
  type MountFilesLocationId,
} from './files-types.ts'
import { filesWorkloadUnits } from './files-op-progress-policy.ts'
import {
  registerFilesWriteProgress,
  removeFilesWriteProgress,
  updateFilesWriteProgress,
} from './files-write-progress.ts'
import { isBinaryFile } from './is-binary-file.ts'
import {
  ensureUserSpecialFolders,
  isUserSpecialFolderNode,
  isUserSpecialFolderPath,
} from './files-user-special.ts'
import {
  notifyFilesWatch,
  type FilesWatchChange,
} from './files-watch.ts'

const USER_SPECIAL_FOLDER_PROTECTED_MESSAGE = '此文件夹受保护，无法重命名或删除'

/** 虚拟文件系统内容变更（新建 / 写入 / 重命名 / 删除等），供文件管理器等订阅刷新 */
export const FILES_VFS_CHANGED_EVENT = 'instant-os-files-vfs-changed'

/**
 * listDirectory / resolveNode 内存缓存。
 * tsc 等工具会反复解析同目录下大量文件；无缓存时每段路径都打 IndexedDB，主线程会被微任务链打满。
 */
const listDirectoryCache = new Map<string, FilesNode[]>()
const resolveNodeCache = new Map<string, FilesNode | undefined>()

function listDirectoryCacheKey(
  locationId: FilesLocationId,
  folderId: string | undefined,
): string {
  return `${locationId}\0${folderId ?? ''}`
}

function resolveNodeCacheKey(absolutePath: string, follow: boolean): string {
  return `${follow ? '1' : '0'}\0${absolutePath}`
}

export function invalidateFilesVfsPathCaches(): void {
  listDirectoryCache.clear()
  resolveNodeCache.clear()
}

// 挂载增删/重挂载/权限吊销后目录与节点缓存会指向陈旧内容，订阅变更事件统一失效。
// worker / Node 环境无 window，事件不会派发，跳过订阅（这些环境也不发生挂载变更）。
if (typeof window !== 'undefined') {
  window.addEventListener(FILES_MOUNTS_CHANGED_EVENT, () => {
    invalidateFilesVfsPathCaches()
  })
  window.addEventListener(FILES_IMAGE_MOUNTS_CHANGED_EVENT, () => {
    invalidateFilesVfsPathCaches()
  })
}

/** 读取 listDirectory 内存缓存（不触发 ensure / IndexedDB） */
export function getCachedListDirectory(
  locationId: FilesLocationId,
  folderId: string | undefined,
): FilesNode[] | undefined {
  return listDirectoryCache.get(listDirectoryCacheKey(locationId, folderId))
}

/** 批量写入时合并变更通知，避免解压等场景每文件打断 UI debounce */
let vfsChangeBatchDepth = 0
const vfsChangeBatchPending: FilesWatchChange[] = []

export function beginFilesVfsChangeBatch(): void {
  vfsChangeBatchDepth += 1
}

export function endFilesVfsChangeBatch(): void {
  if (vfsChangeBatchDepth <= 0) return
  vfsChangeBatchDepth -= 1
  if (vfsChangeBatchDepth > 0) return
  if (vfsChangeBatchPending.length === 0) return
  const pending = vfsChangeBatchPending.splice(0, vfsChangeBatchPending.length)
  flushFilesVfsChanged(pending)
}

export async function runWithFilesVfsChangeBatch<T>(fn: () => Promise<T>): Promise<T> {
  beginFilesVfsChangeBatch()
  try {
    return await fn()
  } finally {
    endFilesVfsChangeBatch()
  }
}

function flushFilesVfsChanged(change: FilesWatchChange | readonly FilesWatchChange[]): void {
  invalidateFilesVfsPathCaches()
  notifyFilesWatch(change)
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(FILES_VFS_CHANGED_EVENT))
}

function emitFilesVfsChanged(change: FilesWatchChange | readonly FilesWatchChange[]): void {
  // 批量期间也立刻清缓存，避免半写入状态被 resolve 命中旧目录列表
  invalidateFilesVfsPathCaches()
  if (vfsChangeBatchDepth > 0) {
    if (Array.isArray(change)) {
      vfsChangeBatchPending.push(...change)
    } else {
      vfsChangeBatchPending.push(change as FilesWatchChange)
    }
    return
  }
  flushFilesVfsChanged(change)
}

async function emitNodeCreated(node: FilesNode): Promise<void> {
  const path = await resolveFilesAbsolutePath(node)
  emitFilesVfsChanged({ kind: 'created', path })
}

/**
 * 立刻广播 created（绕过批量合并）。
 * 粘贴 / 导入把整个操作包在一次变更合并里，目标根文件夹的 created 若跟着排队，
 * 列表要等整次操作结束才出现它；这里立即 flush，让「正在填充的目标文件夹」马上可见。
 */
export async function emitNodeCreatedImmediately(node: FilesNode): Promise<void> {
  const path = await resolveFilesAbsolutePath(node)
  flushFilesVfsChanged({ kind: 'created', path })
}

async function emitNodeModified(node: FilesNode): Promise<void> {
  const path = await resolveFilesAbsolutePath(node)
  emitFilesVfsChanged({ kind: 'modified', path })
}

/** 按绝对路径派发 modified；安静写入关闭等不经过整文件保存的路径使用。 */
export function emitFilesVfsPathModified(path: string): void {
  emitFilesVfsChanged({ kind: 'modified', path })
}

/** 记录数据读（路径异步解析，不阻塞返回；含 0 字节以统计次数） */
function recordFilesIoRead(
  node: FilesNode,
  bytes: number,
  op: string | undefined,
  durationMs: number,
): void {
  const safeBytes = Math.max(0, bytes)
  void resolveFilesAbsolutePath(node)
    .then((path) => {
      recordFilesIoByteEvent({
        locationId: node.locationId,
        direction: 'read',
        bytes: safeBytes,
        path,
        op,
        durationMs,
      })
    })
    .catch(() => {
      recordFilesIoByteEvent({
        locationId: node.locationId,
        direction: 'read',
        bytes: safeBytes,
        op,
        durationMs,
      })
    })
}

/** 记录数据写（路径异步解析，不阻塞返回；含 0 字节以统计次数） */
function recordFilesIoWrite(
  node: FilesNode,
  bytes: number,
  op: string | undefined,
  durationMs: number,
): void {
  const safeBytes = Math.max(0, bytes)
  void resolveFilesAbsolutePath(node)
    .then((path) => {
      recordFilesIoByteEvent({
        locationId: node.locationId,
        direction: 'write',
        bytes: safeBytes,
        path,
        op,
        durationMs,
      })
    })
    .catch(() => {
      recordFilesIoByteEvent({
        locationId: node.locationId,
        direction: 'write',
        bytes: safeBytes,
        op,
        durationMs,
      })
    })
}

export async function listFilesLocations(): Promise<readonly FilesLocation[]> {
  const { restorePersistedImageMounts } = await import('./files-image-actions.ts')
  await restorePersistedImageMounts()
  const mounts = await listMounts()
  const images = listImageMounts()
  return [
    ...FILES_LOCATIONS,
    ...mounts.map((item) => ({
      id: item.id,
      label: item.label,
      writable: true as const,
    })),
    ...images
      .filter((item) => !item.isPartitionAnchor)
      .map((item) => ({
        id: item.id,
        label: item.label,
        writable: true as const,
        unreadableReason: item.unreadableReason,
      })),
  ]
}

export function getFilesLocationLabel(locationId: FilesLocationId): string {
  const builtin = FILES_LOCATIONS.find((item) => item.id === locationId)
  if (builtin) return builtin.label
  const mount = getCachedMount(locationId)
  if (mount) return mount.label
  const image = listImageMounts().find((item) => item.id === locationId)
  return image?.label ?? locationId
}

function assertLocationAllowsCreate(locationId: FilesLocationId): void {
  if (!isFilesLocationWritable(locationId)) {
    throw new Error('此位置为只读，无法修改')
  }
}

function assertNodeWritable(node: FilesNode): void {
  if (!isFilesNodeWritable(node)) {
    throw new Error('此文件为只读，无法修改')
  }
}

/** 写入时可带「期望内容版本」做并发检查：与节点当前版本不等即拒，类似比较并交换 */
export type FilesWriteExpectedRevisionOptions = {
  /** 上次读到的 contentRevisionId；缺省表示盲写（与旧行为一致） */
  expectedContentRevisionId?: string
}

function assertExpectedContentRevision(
  path: string,
  target: FilesNode,
  expected: string | undefined,
): void {
  if (expected === undefined || target.kind !== 'file') return
  const current = target.contentRevisionId
  if (current === expected) return
  throw new FilesContentRevisionMismatchError(
    `文件 ${path} 已被外部修改（expected=${expected}, current=${current}），请重读后重试`,
    path,
    expected,
    current,
  )
}

async function assertCanCreateIn(
  locationId: FilesLocationId,
  parentId: string | undefined,
): Promise<void> {
  // 应用程序卷：卷级只读，但包内草稿子树（Versions/Draft）真实节点可写——
  // 创建权限交给父节点属性判定；卷根与包内只读目录仍一律拒绝。
  if (locationId !== 'applications') {
    assertLocationAllowsCreate(locationId)
  } else if (parentId === undefined) {
    throw new Error('此位置为只读，无法修改')
  }
  if (locationId === 'dev') {
    const { reconcileGithubRepoAttributes } = await import(
      '../github-desktop/github-repo-attributes.ts'
    )
    await reconcileGithubRepoAttributes().catch(() => undefined)
  }
  // /dev 卷根不可新建（命名空间与系统目录由内置应用维护）
  if (parentId === undefined && locationId === 'dev') {
    throw new Error('此位置受保护，无法在此新建或粘贴')
  }
  // 废纸篓不接受面向用户的新建/粘贴（copyNodeTo / moveNodeTo / files-api 层另行拒绝）；
  // 移入废纸篓是内部卷上的元数据级移动，不经过面向用户的创建检查，故不在此拦截。
  if (parentId === undefined) return
  const parent = await getNodeOrThrow(parentId)
  if (parent.kind !== 'folder') {
    throw new Error('父级不是文件夹')
  }
  if (parent.locationId !== locationId) {
    throw new Error('父级位置不匹配')
  }
  assertNodeWritable(parent)
}

/** applications 卷内新建节点继承父节点属性（草稿子树可写；其余路径到不了创建这一步） */
async function inheritParentAttributes(
  locationId: FilesLocationId,
  parentId: string | undefined,
): Promise<FilesNodeAttributes> {
  if (locationId !== 'applications' || parentId === undefined) {
    return defaultFilesNodeAttributes(locationId)
  }
  try {
    const parent = await getNodeOrThrow(parentId)
    return parent.attributes
  } catch {
    return defaultFilesNodeAttributes(locationId)
  }
}

async function siblingNames(
  locationId: FilesLocationId,
  parentId: string | undefined,
  excludeId?: string,
): Promise<Set<string>> {
  const siblings = await listDirectory(locationId, parentId)
  const names = new Set<string>()
  for (const sibling of siblings) {
    if (excludeId !== undefined && sibling.id === excludeId) continue
    names.add(sibling.name)
  }
  return names
}

/** 计算目标目录下不冲突的节点名（同名自动加「 2」「 3」后缀） */
export async function uniqueNodeName(
  locationId: FilesLocationId,
  parentId: string | undefined,
  desired: string,
  excludeId?: string,
): Promise<string> {
  const names = await siblingNames(locationId, parentId, excludeId)
  return uniqueNameAmong(names, desired)
}

/** 在目标目录下按名查找兄弟节点（与存储层一致的大小写/Unicode 规范化比较） */
export async function findSiblingNode(
  locationId: FilesLocationId,
  parentId: string | undefined,
  desiredName: string,
  excludeId?: string,
): Promise<FilesNode | undefined> {
  const siblings = await listDirectory(locationId, parentId)
  const key = normalizeFilesNameKey(desiredName)
  return siblings.find(
    (sibling) => sibling.id !== excludeId && normalizeFilesNameKey(sibling.name) === key,
  )
}

export async function listDirectory(
  locationId: FilesLocationId,
  folderId: string | undefined,
): Promise<FilesNode[]> {
  const cacheKey = listDirectoryCacheKey(locationId, folderId)
  const cached = listDirectoryCache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }

  // `/user` 根：缓存未命中时补齐固定特殊文件夹
  if (locationId === 'local' && folderId === undefined) {
    await ensureUserSpecialFolders()
  }

  let listed: FilesNode[]
  if (isMountLocationId(locationId)) {
    listed = await listMountDirectory(locationId, folderId)
  } else if (isImageLocationId(locationId)) {
    listed = await listImageDirectory(locationId, folderId)
  } else if (locationId === 'models3d') {
    listed = await listModels3dDirectory(folderId)
  } else if (locationId === 'source') {
    listed = await listSourceDirectory(folderId)
  } else if (locationId === 'applications') {
    listed = await listApplicationsDirectory(folderId)
    return listed
  } else {
    listed = await listChildNodes(locationId, folderId)
  }
  listDirectoryCache.set(cacheKey, listed)
  return listed
}

export async function resolvePathNodes(
  locationId: FilesLocationId,
  folderId: string | undefined,
): Promise<FilesNode[]> {
  if (isMountLocationId(locationId)) {
    return resolveMountPath(locationId, folderId)
  }
  if (isImageLocationId(locationId)) {
    return resolveImagePath(locationId, folderId)
  }
  if (locationId === 'models3d') {
    return resolveModels3dPath(folderId)
  }
  if (locationId === 'source') {
    return resolveSourcePath(folderId)
  }
  if (locationId === 'applications') {
    return resolveApplicationsPath(folderId)
  }
  if (folderId === undefined) return []

  const chain: FilesNode[] = []
  let currentId: string | undefined = folderId
  while (currentId !== undefined) {
    const node = await getNode(currentId)
    if (!node || node.locationId !== locationId || node.kind !== 'folder') {
      break
    }
    chain.unshift(node)
    currentId = node.parentId
  }
  return chain
}

export async function mkdir(params: {
  locationId: FilesLocationId
  parentId: string | undefined
  name: string
  /** 冲突处理：默认自动加后缀；files-api 精确创建时传 'exact' */
  nameMode?: FilesNodeNameMode
}): Promise<FilesNode> {
  await assertCanCreateIn(params.locationId, params.parentId)
  const trimmed = normalizeFilesNodeName(params.name)

  if (isMountLocationId(params.locationId)) {
    // 挂载卷无唯一索引与事务内取名；沿用读列表后加后缀
    const names = await siblingNames(params.locationId, params.parentId)
    const name = uniqueNameAmong(names, trimmed)
    const created = await mkdirMount({
      locationId: params.locationId,
      parentId: params.parentId,
      name,
    })
    await emitNodeCreated(created)
    return created
  }

  if (isImageLocationId(params.locationId)) {
    const names = await siblingNames(params.locationId, params.parentId)
    const name = uniqueNameAmong(names, trimmed)
    const created = await mkdirImage({
      locationId: params.locationId,
      parentId: params.parentId,
      name,
    })
    await emitNodeCreated(created)
    return created
  }

  const now = osNowMs()
  const node: FilesNode = {
    id: newFilesNodeId(),
    locationId: params.locationId,
    parentId: params.parentId,
    name: trimmed,
    kind: 'folder',
    mimeType: undefined,
    byteSize: 0,
    createdAt: now,
    updatedAt: now,
    attributes: await inheritParentAttributes(params.locationId, params.parentId),
  }
  const created = await createFolderNode({
    node,
    metaBytes: estimateNodeMetaBytes(node),
    nameMode: params.nameMode ?? 'unique-suffix',
  })
  await emitNodeCreated(created)
  return created
}

export async function createTextFile(params: {
  locationId: FilesLocationId
  parentId: string | undefined
  name?: string
  text?: string
  /** 冲突处理：默认自动加后缀；files-api 精确创建时传 'exact' */
  nameMode?: FilesNodeNameMode
}): Promise<FilesNode> {
  await assertCanCreateIn(params.locationId, params.parentId)
  const desired = normalizeFilesNodeName((params.name ?? '未命名.txt').trim() || '未命名.txt')
  const text = params.text ?? ''
  const startedAt = performance.now()

  if (isMountLocationId(params.locationId)) {
    // 挂载卷无唯一索引与事务内取名；沿用读列表后加后缀
    const names = await siblingNames(params.locationId, params.parentId)
    const name = uniqueNameAmong(names, desired)
    const created = await createMountTextFile({
      locationId: params.locationId,
      parentId: params.parentId,
      name,
      text,
    })
    await emitNodeCreated(created)
    recordFilesIoWrite(
      created,
      estimateTextBytes(text),
      'createText',
      performance.now() - startedAt,
    )
    return created
  }

  if (isImageLocationId(params.locationId)) {
    const names = await siblingNames(params.locationId, params.parentId)
    const name = uniqueNameAmong(names, desired)
    const created = await createImageTextFile({
      locationId: params.locationId,
      parentId: params.parentId,
      name,
      text,
    })
    await emitNodeCreated(created)
    recordFilesIoWrite(
      created,
      estimateTextBytes(text),
      'createText',
      performance.now() - startedAt,
    )
    return created
  }

  const now = osNowMs()
  const node: FilesNode = {
    id: newFilesNodeId(),
    locationId: params.locationId,
    parentId: params.parentId,
    name: desired,
    kind: 'file',
    mimeType: FILES_TEXT_MIME,
    byteSize: 0,
    createdAt: now,
    updatedAt: now,
    attributes: await inheritParentAttributes(params.locationId, params.parentId),
  }
  const created = await createFileWithBlob({
    node,
    text,
    metaBytes: estimateNodeMetaBytes(node),
    nameMode: params.nameMode ?? 'unique-suffix',
  })
  await emitNodeCreated(created)
  recordFilesIoWrite(
    created,
    estimateTextBytes(text),
    'createText',
    performance.now() - startedAt,
  )
  return created
}

export async function createBinaryFile(params: {
  locationId: FilesLocationId
  parentId: string | undefined
  name: string
  bytes: ArrayBuffer
  mimeType?: string
  /** 冲突处理：默认自动加后缀；files-api 精确创建时传 'exact' */
  nameMode?: FilesNodeNameMode
}): Promise<FilesNode> {
  await assertCanCreateIn(params.locationId, params.parentId)
  const desired = normalizeFilesNodeName(params.name.trim() || '未命名.bin')
  const startedAt = performance.now()

  if (isMountLocationId(params.locationId)) {
    // 挂载卷无唯一索引与事务内取名；沿用读列表后加后缀
    const names = await siblingNames(params.locationId, params.parentId)
    const name = uniqueNameAmong(names, desired)
    const created = await createMountBinaryFile({
      locationId: params.locationId,
      parentId: params.parentId,
      name,
      bytes: params.bytes,
    })
    await emitNodeCreated(created)
    recordFilesIoWrite(
      created,
      params.bytes.byteLength,
      'createBinary',
      performance.now() - startedAt,
    )
    return created
  }

  if (isImageLocationId(params.locationId)) {
    const names = await siblingNames(params.locationId, params.parentId)
    const name = uniqueNameAmong(names, desired)
    const created = await createImageBinaryFile({
      locationId: params.locationId,
      parentId: params.parentId,
      name,
      bytes: params.bytes,
    })
    await emitNodeCreated(created)
    recordFilesIoWrite(
      created,
      params.bytes.byteLength,
      'createBinary',
      performance.now() - startedAt,
    )
    return created
  }

  const now = osNowMs()
  const node: FilesNode = {
    id: newFilesNodeId(),
    locationId: params.locationId,
    parentId: params.parentId,
    name: desired,
    kind: 'file',
    mimeType: params.mimeType ?? 'application/octet-stream',
    byteSize: 0,
    createdAt: now,
    updatedAt: now,
    attributes: await inheritParentAttributes(params.locationId, params.parentId),
  }
  const created = await createFileWithBytes({
    node,
    bytes: params.bytes,
    metaBytes: estimateNodeMetaBytes(node),
    nameMode: params.nameMode ?? 'unique-suffix',
  })
  await emitNodeCreated(created)
  recordFilesIoWrite(
    created,
    params.bytes.byteLength,
    'createBinary',
    performance.now() - startedAt,
  )
  return created
}

export async function createSparseBinaryFile(params: {
  locationId: FilesLocationId
  parentId: string | undefined
  name: string
  byteSize: number
  chunkSize?: number
  mimeType?: string
  /** 冲突处理：默认自动加后缀；files-api 精确创建时传 'exact' */
  nameMode?: FilesNodeNameMode
}): Promise<FilesNode> {
  await assertCanCreateIn(params.locationId, params.parentId)
  const desired = normalizeFilesNodeName(params.name.trim() || '未命名.bin')
  const startedAt = performance.now()

  const now = osNowMs()
  const node: FilesNode = {
    id: newFilesNodeId(),
    locationId: params.locationId,
    parentId: params.parentId,
    name: desired,
    kind: 'file',
    mimeType: params.mimeType ?? 'application/octet-stream',
    byteSize: 0,
    createdAt: now,
    updatedAt: now,
    attributes: defaultFilesNodeAttributes(params.locationId),
  }
  const created = await createSparseFile({
    node,
    byteSize: params.byteSize,
    chunkSize: params.chunkSize,
    metaBytes: estimateNodeMetaBytes(node),
    nameMode: params.nameMode ?? 'unique-suffix',
  })
  await emitNodeCreated(created)
  recordFilesIoWrite(created, 0, 'createSparse', performance.now() - startedAt)
  return created
}

/**
 * 解析节点的全局绝对路径（POSIX 风格，以卷根开头）。
 * 例：`/user/笔记/草稿.txt`、`/mount/instant-app/src/main.ts`
 */
export async function resolveFilesAbsolutePath(node: FilesNode): Promise<string> {
  const root = filesLocationPathRoot(node.locationId)
  if (node.kind === 'folder') {
    const chain = await resolvePathNodes(node.locationId, node.id)
    return joinFilesAbsolutePath(root, ...chain.map((item) => item.name))
  }

  const parentChain =
    node.parentId === undefined
      ? []
      : await resolvePathNodes(node.locationId, node.parentId)
  return joinFilesAbsolutePath(root, ...parentChain.map((item) => item.name), node.name)
}

export const FILES_SYMLINK_MAX_DEPTH = 40

export type ResolveNodeByAbsolutePathOptions = {
  /** 默认 true（stat / 读内容）；false 时末段返回链接节点本身（lstat / readlink） */
  follow?: boolean
}

function dirnameAbsolute(absolutePath: string): string {
  const trimmed = absolutePath.replace(/\/+$/, '') || '/'
  if (trimmed === '/') return '/'
  const idx = trimmed.lastIndexOf('/')
  if (idx <= 0) return '/'
  return trimmed.slice(0, idx) || '/'
}

function resolveSymlinkTargetPath(linkAbsolutePath: string, target: string): string {
  const trimmed = target.trim()
  if (!trimmed) {
    throw new Error('符号链接目标为空')
  }
  if (trimmed.startsWith('/')) {
    return trimmed.replace(/\/+$/, '') || '/'
  }
  const base = dirnameAbsolute(linkAbsolutePath)
  const parts = trimmed.split('/').filter((p) => p.length > 0 && p !== '.')
  const stack =
    base === '/'
      ? []
      : base
          .split('/')
          .filter((p) => p.length > 0)
  for (const part of parts) {
    if (part === '..') {
      stack.pop()
    } else {
      stack.push(part)
    }
  }
  return stack.length === 0 ? '/' : `/${stack.join('/')}`
}

/** 按全局绝对路径解析节点（文件、文件夹或符号链接） */
export async function resolveNodeByAbsolutePath(
  absolutePath: string,
  options?: ResolveNodeByAbsolutePathOptions,
): Promise<FilesNode | undefined> {
  const follow = options?.follow !== false
  const cacheKey = resolveNodeCacheKey(absolutePath, follow)
  if (resolveNodeCache.has(cacheKey)) {
    return resolveNodeCache.get(cacheKey)
  }

  const t0 = performance.now()
  const parsed = parseFilesAbsolutePath(absolutePath)
  const segmentCount = parsed?.segments.length ?? 0
  try {
    const node = await resolveNodeByAbsolutePathInner(absolutePath, options)
    resolveNodeCache.set(cacheKey, node)
    return node
  } finally {
    recordSlowVfsResolve(absolutePath, segmentCount, performance.now() - t0)
  }
}

async function resolveNodeByAbsolutePathInner(
  absolutePath: string,
  options?: ResolveNodeByAbsolutePathOptions,
): Promise<FilesNode | undefined> {
  const follow = options?.follow !== false
  const parsed = parseFilesAbsolutePath(absolutePath)
  if (!parsed) return undefined
  if (parsed.segments.length === 0) return undefined

  // 挂载卷：直接走 FSA handle，禁止逐层 list；第一期不支持 symlink
  if (isMountLocationId(parsed.locationId)) {
    return resolveMountRelativePath(parsed.locationId, parsed.segments.join('/'))
  }
  if (isImageLocationId(parsed.locationId)) {
    return resolveImageRelativePath(parsed.locationId, parsed.segments.join('/'))
  }

  let cursorPath = filesLocationPathRoot(parsed.locationId)
  let parentId: string | undefined
  let depth = 0

  for (let index = 0; index < parsed.segments.length; index += 1) {
    const name = parsed.segments[index]
    if (!name) return undefined
    const children = await listDirectory(parsed.locationId, parentId)
    const hit = children.find((child) => child.name === name)
    if (!hit) return undefined

    const isLast = index === parsed.segments.length - 1
    cursorPath = joinFilesAbsolutePath(cursorPath, name)

    if (hit.kind === 'symlink') {
      if (isLast && !follow) {
        return hit
      }
      depth += 1
      if (depth > FILES_SYMLINK_MAX_DEPTH) {
        throw new Error('符号链接层级过深（可能存在循环）')
      }
      const target = hit.target
      if (target === undefined) return undefined
      const nextAbsolute = resolveSymlinkTargetPath(cursorPath, target)
      // 重新从根解析目标路径（跟随）
      const redirected = await resolveNodeByAbsolutePath(nextAbsolute, { follow: true })
      if (!redirected) return undefined
      if (isLast) return redirected
      if (redirected.kind !== 'folder') return undefined
      parentId = redirected.id
      cursorPath = await resolveFilesAbsolutePath(redirected)
      // 继续用剩余 segments：需把剩余段接到已解析文件夹之后
      const rest = parsed.segments.slice(index + 1)
      if (rest.length === 0) return redirected
      const continued = joinFilesAbsolutePath(cursorPath, ...rest)
      return resolveNodeByAbsolutePath(continued, { follow })
    }

    if (isLast) return hit
    if (hit.kind !== 'folder') return undefined
    parentId = hit.id
  }

  return undefined
}

export async function resolveFileNodeByAbsolutePath(
  absolutePath: string,
): Promise<FilesNode | undefined> {
  const node = await resolveNodeByAbsolutePath(absolutePath, { follow: true })
  if (!node || node.kind !== 'file') return undefined
  return node
}

/** 在 linkPath 创建符号链接，目标为 target（相对或绝对字符串，原样存储） */
export async function createSymlink(params: {
  locationId: FilesLocationId
  parentId: string | undefined
  name: string
  target: string
  /** 冲突处理：默认精确失败；复制路径传 'unique-suffix' */
  nameMode?: FilesNodeNameMode
}): Promise<FilesNode> {
  if (!canCreateSymlinkOnLocation(params.locationId)) {
    throw new Error('当前卷不支持创建符号链接')
  }
  await assertCanCreateIn(params.locationId, params.parentId)
  const trimmedName = normalizeFilesNodeName(params.name)
  const target = params.target.trim()
  if (!target) {
    throw new Error('符号链接目标不能为空')
  }

  const now = osNowMs()
  const node: FilesNode = {
    id: newFilesNodeId(),
    locationId: params.locationId,
    parentId: params.parentId,
    name: trimmedName,
    kind: 'symlink',
    mimeType: undefined,
    byteSize: estimateTextBytes(target),
    createdAt: now,
    updatedAt: now,
    target,
    attributes: defaultFilesNodeAttributes(params.locationId),
  }
  const created = await createSymlinkNode({
    node,
    metaBytes: estimateNodeMetaBytes(node) + estimateTextBytes(target),
    nameMode: params.nameMode ?? 'exact',
  })
  await emitNodeCreated(created)
  return created
}

export async function readlinkAtAbsolutePath(absolutePath: string): Promise<string> {
  const node = await resolveNodeByAbsolutePath(absolutePath, { follow: false })
  if (!node) {
    throw new Error('路径不存在')
  }
  if (node.kind !== 'symlink' || node.target === undefined) {
    throw new Error('不是符号链接')
  }
  return node.target
}

export type FilesSubtreeFileEntry = {
  /** 相对 rootAbsolutePath 的路径 */
  path: string
  absolutePath: string
  byteSize: number
  contentRevisionId: string | undefined
  updatedAt: number
}

/**
 * 一次事务拉出本地卷（local / repo）某目录下全部文件元数据。
 * 不支持 mount / models3d / source。
 */
export async function listSubtreeFiles(
  rootAbsolutePath: string,
): Promise<FilesSubtreeFileEntry[]> {
  const absolutePath = rootAbsolutePath.replace(/\/+$/, '') || '/'
  const parsed = parseFilesAbsolutePath(absolutePath)
  if (!parsed) {
    throw new Error('路径无效')
  }
  if (isMountLocationId(parsed.locationId) || isImageLocationId(parsed.locationId)) {
    throw new Error('挂载卷不支持子树枚举')
  }
  if (parsed.locationId === 'models3d' || parsed.locationId === 'source' || parsed.locationId === 'applications') {
    throw new Error('该卷不支持子树枚举')
  }

  let rootFolderId: string | undefined
  if (parsed.segments.length === 0) {
    rootFolderId = undefined
  } else {
    const rootNode = await resolveNodeByAbsolutePath(absolutePath)
    if (!rootNode || rootNode.kind !== 'folder') {
      throw new Error('文件夹不存在')
    }
    rootFolderId = rootNode.id
  }

  const subtreeStartAt = performance.now()
  const { files, folders } = await listLocalVolumeSubtreeNodes(
    parsed.locationId,
    rootFolderId,
  )
  // BFS 全子树枚举：搜索 / 打包 / npm store 统计共用入口
  recordSystemDebugTimeline({
    layer: 'files',
    op: 'list-subtree-files',
    detail: `${absolutePath} → ${files.length} files`,
    durationMs: Math.round(performance.now() - subtreeStartAt),
  })

  const buildRelativeSegments = (fileParentId: string | undefined, fileName: string): string[] => {
    const segments: string[] = [fileName]
    let current = fileParentId
    while (current !== undefined && current !== rootFolderId) {
      const folder = folders.get(current)
      if (!folder) break
      segments.unshift(folder.name)
      current = folder.parentId
    }
    return segments
  }

  return files.map((file) => {
    const relativeSegments = buildRelativeSegments(file.parentId, file.name)
    const relativePath = relativeSegments.join('/')
    return {
      path: relativePath,
      absolutePath: joinFilesAbsolutePath(absolutePath, ...relativeSegments),
      byteSize: file.byteSize,
      contentRevisionId: file.contentRevisionId,
      updatedAt: file.updatedAt,
    }
  })
}

/** 对本地卷子树内缺 contentRevisionId 的文件节点批量补齐 */
export async function backfillSubtreeContentRevisionIds(
  rootAbsolutePath: string,
): Promise<number> {
  const absolutePath = rootAbsolutePath.replace(/\/+$/, '') || '/'
  const parsed = parseFilesAbsolutePath(absolutePath)
  if (!parsed) {
    throw new Error('路径无效')
  }
  if (isMountLocationId(parsed.locationId) || isImageLocationId(parsed.locationId)) {
    throw new Error('挂载卷不支持 revision 补齐')
  }
  if (parsed.locationId === 'models3d' || parsed.locationId === 'source' || parsed.locationId === 'applications') {
    throw new Error('该卷不支持 revision 补齐')
  }

  let rootFolderId: string | undefined
  if (parsed.segments.length === 0) {
    rootFolderId = undefined
  } else {
    const rootNode = await resolveNodeByAbsolutePath(absolutePath)
    if (!rootNode || rootNode.kind !== 'folder') {
      throw new Error('文件夹不存在')
    }
    rootFolderId = rootNode.id
  }

  return backfillContentRevisionIds(parsed.locationId, rootFolderId)
}

async function resolveFileRef(ref: string): Promise<FilesNode> {
  if (isFilesAbsolutePath(ref)) {
    const node = await resolveFileNodeByAbsolutePath(ref)
    if (!node) throw new Error('文件不存在')
    return node
  }
  return getNodeOrThrow(ref)
}

export async function readTextFile(ref: string): Promise<{ node: FilesNode; text: string }> {
  if (isFilesAbsolutePath(ref)) {
    const node = await resolveFileRef(ref)
    return readTextFileByNodeId(node.id)
  }
  return readTextFileByNodeId(ref)
}

async function readTextFileByNodeId(id: string): Promise<{ node: FilesNode; text: string }> {
  const startedAt = performance.now()
  const result = await readTextFileByNodeIdUnmetered(id)
  recordFilesIoRead(
    result.node,
    estimateTextBytes(result.text),
    'readText',
    performance.now() - startedAt,
  )
  return result
}

async function readTextFileByNodeIdUnmetered(
  id: string,
): Promise<{ node: FilesNode; text: string }> {
  if (isMountNodeId(id)) {
    return readMountText(id)
  }
  if (isImageNodeId(id)) {
    return readImageText(id)
  }
  if (id.startsWith('models3d:')) {
    return readModels3dText(id)
  }
  if (id.startsWith('source:')) {
    return readSourceText(id)
  }
  if (id.startsWith('applications:')) {
    return readApplicationsText(id)
  }
  const node = await getNode(id)
  if (!node || node.kind !== 'file') {
    throw new Error('文件不存在')
  }
  const text = await readBlobText(id)
  return { node, text }
}

/**
 * 读取文本，但仅当文件大小不超过 maxBytes；超出或不可读时返回 undefined。
 * 挂载卷先探测 getFile().size 再决定是否读内容，避免大文件整读进内存；
 * 本地卷用节点已有 byteSize 预筛。
 */
export async function readTextFileIfSmall(
  ref: string,
  maxBytes: number,
): Promise<string | undefined> {
  let node: FilesNode | undefined
  if (isFilesAbsolutePath(ref)) {
    try {
      node = await resolveFileRef(ref)
    } catch {
      return undefined
    }
  } else {
    node = await getNode(ref)
  }
  if (!node) return undefined

  if (isMountNodeId(node.id)) {
    return readMountTextIfSmall(node.id, maxBytes)
  }
  if (isImageNodeId(node.id)) {
    return readImageTextIfSmall(node.id, maxBytes)
  }
  if (
    node.id.startsWith('models3d:') ||
    node.id.startsWith('source:') ||
    node.id.startsWith('applications:')
  ) {
    // 小体积精选卷：无大小顾虑，整读
    return (await readTextFileByNodeIdUnmetered(node.id)).text
  }
  if (node.kind !== 'file' || node.byteSize > maxBytes) {
    return undefined
  }
  const startedAt = performance.now()
  const text = await readBlobText(node.id)
  recordFilesIoRead(node, estimateTextBytes(text), 'readText', performance.now() - startedAt)
  return text
}

/** 读取文件二进制内容（挂载卷 File，或本地卷已存的 bytes） */
export async function readFileBlob(ref: string): Promise<{ node: FilesNode; blob: Blob }> {
  if (isFilesAbsolutePath(ref)) {
    const node = await resolveFileRef(ref)
    return readFileBlobByNodeId(node.id)
  }
  return readFileBlobByNodeId(ref)
}

async function readFileBlobByNodeId(id: string): Promise<{ node: FilesNode; blob: Blob }> {
  const startedAt = performance.now()
  const result = await readFileBlobByNodeIdUnmetered(id)
  recordFilesIoRead(result.node, result.blob.size, 'readBlob', performance.now() - startedAt)
  return result
}

async function readFileBlobByNodeIdUnmetered(
  id: string,
): Promise<{ node: FilesNode; blob: Blob }> {
  if (isMountNodeId(id)) {
    return readMountBlob(id)
  }
  if (isImageNodeId(id)) {
    return readImageBlob(id)
  }
  if (id.startsWith('models3d:')) {
    return readModels3dBlob(id)
  }
  if (id.startsWith('source:')) {
    return readSourceBlob(id)
  }
  if (id.startsWith('applications:')) {
    return readApplicationsBlob(id)
  }
  const node = await getNode(id)
  if (!node || node.kind !== 'file') {
    throw new Error('文件不存在')
  }
  const bytes = await readBlobBytes(id)
  if (bytes) {
    const type = node.mimeType ?? 'application/octet-stream'
    return { node, blob: new Blob([new Uint8Array(bytes)], { type }) }
  }
  return {
    node,
    blob: new Blob([], { type: node.mimeType ?? 'application/octet-stream' }),
  }
}

/**
 * 按 [offset, offset+length) 读取文件二进制范围。
 * 挂载卷 / 精选卷走 Blob 原生 slice（零成本局部读）；本地卷按偏移索引只取覆盖块
 * （旧格式整读后裁切）。返回的 Blob 只含请求区间，越界按实际可用内容截断。
 */
export async function readFileBlobRange(
  ref: string,
  offset: number,
  length: number,
): Promise<{ node: FilesNode; blob: Blob }> {
  if (isFilesAbsolutePath(ref)) {
    const node = await resolveFileRef(ref)
    return readFileBlobRangeByNodeId(node.id, offset, length)
  }
  return readFileBlobRangeByNodeId(ref, offset, length)
}

async function readFileBlobRangeByNodeId(
  id: string,
  offset: number,
  length: number,
): Promise<{ node: FilesNode; blob: Blob }> {
  const startedAt = performance.now()
  const result = await readFileBlobRangeByNodeIdUnmetered(id, offset, length)
  recordFilesIoRead(result.node, result.blob.size, 'readBlobRange', performance.now() - startedAt)
  return result
}

async function readFileBlobRangeByNodeIdUnmetered(
  id: string,
  offset: number,
  length: number,
): Promise<{ node: FilesNode; blob: Blob }> {
  const start = Math.max(0, offset)
  const want = Math.max(0, length)
  if (isImageNodeId(id)) {
    return readImageBlobRange(id, start, want)
  }
  if (
    isMountNodeId(id) ||
    id.startsWith('models3d:') ||
    id.startsWith('source:') ||
    id.startsWith('applications:')
  ) {
    const { node, blob } = await readFileBlobByNodeIdUnmetered(id)
    return { node, blob: blob.slice(start, start + want) }
  }
  const node = await getNode(id)
  if (!node || node.kind !== 'file') {
    throw new Error('文件不存在')
  }
  const type = node.mimeType ?? 'application/octet-stream'
  const bytes = await readBlobBytesRange(id, start, want)
  if (bytes !== undefined) {
    return { node, blob: new Blob([new Uint8Array(bytes)], { type }) }
  }
  return { node, blob: new Blob([], { type }) }
}

export async function writeTextFile(
  ref: string,
  text: string,
  options?: FilesWriteExpectedRevisionOptions,
): Promise<FilesNode> {
  const target = isFilesAbsolutePath(ref) ? await resolveFileRef(ref) : await getNodeOrThrow(ref)
  if (target.kind !== 'file') {
    throw new Error('文件不存在')
  }
  assertNodeWritable(target)
  if (options?.expectedContentRevisionId !== undefined) {
    const path = isFilesAbsolutePath(ref) ? ref : await resolveFilesAbsolutePath(target)
    assertExpectedContentRevision(path, target, options.expectedContentRevisionId)
  }
  const startedAt = performance.now()

  if (isMountNodeId(target.id)) {
    const written = await writeMountText(target.id, text)
    await emitNodeModified(written)
    recordFilesIoWrite(
      written,
      estimateTextBytes(text),
      'writeText',
      performance.now() - startedAt,
    )
    return written
  }
  if (isImageNodeId(target.id)) {
    const written = await writeImageText(target.id, text)
    await emitNodeModified(written)
    recordFilesIoWrite(
      written,
      estimateTextBytes(text),
      'writeText',
      performance.now() - startedAt,
    )
    return written
  }
  const written = await writeBlobText({
    id: target.id,
    text,
    previousByteSize: target.byteSize,
    nameMetaDelta: 0,
  })
  await emitNodeModified(written)
  recordFilesIoWrite(
    written,
    estimateTextBytes(text),
    'writeText',
    performance.now() - startedAt,
  )
  return written
}

export async function writeBinaryFile(
  ref: string,
  bytes: ArrayBuffer,
  options?: FilesWriteExpectedRevisionOptions,
): Promise<FilesNode> {
  const target = isFilesAbsolutePath(ref) ? await resolveFileRef(ref) : await getNodeOrThrow(ref)
  if (target.kind !== 'file') {
    throw new Error('文件不存在')
  }
  assertNodeWritable(target)
  if (options?.expectedContentRevisionId !== undefined) {
    const path = isFilesAbsolutePath(ref) ? ref : await resolveFilesAbsolutePath(target)
    assertExpectedContentRevision(path, target, options.expectedContentRevisionId)
  }

  const startedAt = performance.now()
  if (isMountNodeId(target.id)) {
    const written = await writeMountBlob(target.id, bytes)
    await emitNodeModified(written)
    recordFilesIoWrite(written, bytes.byteLength, 'writeBinary', performance.now() - startedAt)
    return written
  }
  if (isImageNodeId(target.id)) {
    const written = await writeImageBlob(target.id, bytes)
    await emitNodeModified(written)
    recordFilesIoWrite(written, bytes.byteLength, 'writeBinary', performance.now() - startedAt)
    return written
  }
  const written = await writeBlobBytes({
    id: target.id,
    bytes,
    previousByteSize: target.byteSize,
    nameMetaDelta: 0,
  })
  await emitNodeModified(written)
  recordFilesIoWrite(written, bytes.byteLength, 'writeBinary', performance.now() - startedAt)
  return written
}

/**
 * 按偏移随机写：在文件 [offset, offset+bytes.byteLength) 处覆盖写入。
 * 挂载卷使用 FSA seek + write；IndexedDB 本地卷使用 chunk 拆分/合并。
 * offset 不能超过当前文件末尾（不支持空洞扩展）。
 */
export async function writeFileBytesRange(
  ref: string,
  offset: number,
  bytes: ArrayBuffer | Uint8Array,
  options?: FilesWriteExpectedRevisionOptions,
): Promise<FilesNode> {
  const target = isFilesAbsolutePath(ref) ? await resolveFileRef(ref) : await getNodeOrThrow(ref)
  if (target.kind !== 'file') {
    throw new Error('文件不存在')
  }
  assertNodeWritable(target)
  if (options?.expectedContentRevisionId !== undefined) {
    const path = isFilesAbsolutePath(ref) ? ref : await resolveFilesAbsolutePath(target)
    assertExpectedContentRevision(path, target, options.expectedContentRevisionId)
  }

  const startedAt = performance.now()
  if (isMountNodeId(target.id)) {
    const written = await writeMountBytesRange(target.id, offset, bytes)
    await emitNodeModified(written)
    recordFilesIoWrite(written, bytes.byteLength, 'writeBytesRange', performance.now() - startedAt)
    return written
  }
  if (isImageNodeId(target.id)) {
    const written = await writeImageBytesRange(target.id, offset, bytes)
    await emitNodeModified(written)
    recordFilesIoWrite(written, bytes.byteLength, 'writeBytesRange', performance.now() - startedAt)
    return written
  }

  const written = await writeBlobBytesRange({
    nodeId: target.id,
    offset,
    bytes,
  })
  await emitNodeModified(written)
  recordFilesIoWrite(written, bytes.byteLength, 'writeBytesRange', performance.now() - startedAt)
  return written
}

/**
 * 打开流式写（新建 / 覆盖）。挂载卷走 FSA 原生增量写；内部卷走分块 blob。
 * 新建时 open 即创建节点（byteSize 0），close 定稿、abort 回滚删除。
 * 覆盖时 abort 不影响旧内容，close 按 COW 切换。
 */
export async function openStreamWrite(params: {
  node: FilesNode
  isNew: boolean
  metaBytes: number
  previousByteSize: number
  chunkSize?: number
  expectedSize?: number
  /** 新建时的冲突处理：内部卷透传给 openStreamWriteBlob；挂载/镜像卷读列表算不冲突名 */
  nameMode?: FilesNodeNameMode
}): Promise<FilesStreamWriter> {
  const { node, isNew, metaBytes, previousByteSize, chunkSize, expectedSize, nameMode } = params
  let writer: FilesStreamWriter
  // 按卷类型分发（新建占位节点 id 非 mount 前缀，须看 locationId）
  if (isMountLocationId(node.locationId)) {
    writer = await openMountStreamWrite({
      locationId: node.locationId as MountFilesLocationId,
      parentId: node.parentId,
      name: node.name,
      isNew,
    })
  } else if (isImageLocationId(node.locationId)) {
    // 镜像卷同挂载卷无事务内取名：unique-suffix 时读目录列表算不冲突名，
    // 否则 FAT 会按原名返回已有条目并从头覆写（静默丢数据）
    let imageName = node.name
    if (isNew && nameMode === 'unique-suffix') {
      const names = await siblingNames(node.locationId, node.parentId)
      imageName = uniqueNameAmong(names, node.name)
    }
    writer = await openImageStreamWrite({
      locationId: node.locationId as ImageFilesLocationId,
      parentId: node.parentId,
      name: imageName,
      isNew,
      expectedSize,
    })
  } else {
    writer = await openStreamWriteBlob({
      node,
      isNew,
      metaBytes,
      previousByteSize,
      chunkSize,
      expectedSize,
      // 存储层必选；VFS 层缺省精确失败（files-api 新建默认路径）
      nameMode: nameMode ?? 'exact',
    })
  }
  if (isNew) {
    // 新建文件立刻可见（byteSize 0），随 chunk 逐步长大；同时失效路径缓存，
    // 避免 open 前的「不存在」缓存残留导致流中/流后解析失败。
    // 用 writer.node（实际占位节点）：unique-suffix 撞名后名称已变，须按最终名通知
    await emitNodeCreated(writer.node)
  }
  // 写入中登记（行内小圆圈数据源）：新建与覆盖都算；close/abort 无论成败都要移除
  registerFilesWriteProgress(writer.node.id, expectedSize)
  let registryWritten = 0
  return {
    node: writer.node,
    write: async (chunk) => {
      const startedAt = performance.now()
      await writer.write(chunk)
      registryWritten += chunk.byteLength
      updateFilesWriteProgress(writer.node.id, registryWritten)
      recordFilesIoWrite(writer.node, chunk.byteLength, 'streamWrite', performance.now() - startedAt)
    },
    close: async () => {
      try {
        const startedAt = performance.now()
        let written
        try {
          written = await writer.close()
        } catch (error) {
          await writer.abort().catch(() => undefined)
          throw error
        }
        await emitNodeModified(written)
        recordFilesIoWrite(
          written,
          written.byteSize,
          'streamWrite',
          performance.now() - startedAt,
        )
        return written
      } finally {
        removeFilesWriteProgress(writer.node.id)
      }
    },
    abort: async () => {
      try {
        await writer.abort()
        if (isNew) {
          // 新建文件回滚删除：通知 watch / 清路径缓存（按实际占位节点路径）
          const path = await resolveFilesAbsolutePath(writer.node)
          emitFilesVfsChanged({ kind: 'deleted', path })
        }
      } finally {
        removeFilesWriteProgress(writer.node.id)
      }
    },
  }
}

/**
 * 被占用声明（文件 App 挂载 / 虚拟机使用）的磁盘镜像不能被删除、改名或移动：
 * 挂载会话与虚拟机按路径读写底层镜像，路径一变即失联变砖。
 */
function assertDiskImagesNotOccupied(paths: readonly string[], action: string): void {
  for (const path of paths) {
    const hit = findOccupiedDiskImagePathUnder(path)
    if (hit) {
      throw new Error(diskImageOccupiedForFileOpError(hit.path, hit.occupant, action))
    }
  }
}

export async function renameNode(id: string, nextName: string): Promise<FilesNode> {
  const trimmed = normalizeFilesNodeName(nextName)
  const node = await getNodeOrThrow(id)
  if (isUserSpecialFolderNode(node)) {
    throw new Error(USER_SPECIAL_FOLDER_PROTECTED_MESSAGE)
  }
  assertNodeWritable(node)
  const previousPath = await resolveFilesAbsolutePath(node)
  assertDiskImagesNotOccupied([previousPath], '重命名')

  if (isMountNodeId(id)) {
    // 挂载卷无唯一索引与事务内取名；沿用读列表后加后缀
    const names = await siblingNames(node.locationId, node.parentId, node.id)
    const name = uniqueNameAmong(names, trimmed)
    const renamed = await renameMountNode(id, name)
    const path = await resolveFilesAbsolutePath(renamed)
    emitFilesVfsChanged({ kind: 'renamed', path, previousPath })
    return renamed
  }

  if (isImageNodeId(id)) {
    const names = await siblingNames(node.locationId, node.parentId, node.id)
    const name = uniqueNameAmong(names, trimmed)
    const renamed = await renameImageNode(id, name)
    const path = await resolveFilesAbsolutePath(renamed)
    emitFilesVfsChanged({ kind: 'renamed', path, previousPath })
    return renamed
  }

  const before = estimateNodeMetaBytes(node)
  const after = estimateNodeMetaBytes({ ...node, name: trimmed })
  const renamed = await renameNodeRecord({
    id,
    name: trimmed,
    metaDelta: after - before,
  })
  const path = await resolveFilesAbsolutePath(renamed)
  emitFilesVfsChanged({ kind: 'renamed', path, previousPath })
  return renamed
}

export type FilesRemoveBatchOptions = {
  skipMissing?: boolean
  batchSize?: number
}

export type FilesVfsOpProgress = {
  done: number
  total: number
  /** 当前正在处理的名字（路径末段），进度窗展示用 */
  currentName?: string
  /** 树内真实进度：已处理 / 总节点数（不是顶层选中项数） */
  items?: { done: number; total: number }
  /** 树内真实进度：已处理 / 总字节数 */
  bytes?: { done: number; total: number }
}

export type FilesCopyWorkload = {
  nodeCount: number
  byteSize: number
  totalUnits: number
}

export type FilesDeleteWorkload = {
  nodeCount: number
  byteSize: number
  totalUnits: number
}

const LARGE_SUBTREE_DELETE_THRESHOLD = 2000

function nodeWorkloadUnits(node: FilesNode): number {
  return filesWorkloadUnits(1, node.byteSize)
}

export async function estimateCopyWorkload(sourceId: string): Promise<FilesCopyWorkload> {
  const source = await getNodeOrThrow(sourceId)
  const stats = await estimateCopyWorkloadForNode(source)
  return {
    ...stats,
    totalUnits: filesWorkloadUnits(stats.nodeCount, stats.byteSize),
  }
}

async function estimateCopyWorkloadForNode(
  node: FilesNode,
): Promise<{ nodeCount: number; byteSize: number }> {
  if (node.kind === 'file' || node.kind === 'symlink') {
    return { nodeCount: 1, byteSize: node.byteSize }
  }
  let nodeCount = 1
  let byteSize = node.byteSize
  const children = await listDirectory(node.locationId, node.id)
  for (const child of children) {
    countSystemDebugHot('files', 'estimate-walk')
    const sub = await estimateCopyWorkloadForNode(child)
    nodeCount += sub.nodeCount
    byteSize += sub.byteSize
  }
  return { nodeCount, byteSize }
}

export async function estimateDeleteWorkload(nodeId: string): Promise<FilesDeleteWorkload> {
  const node = await getNodeOrThrow(nodeId)
  const estimateStartAt = performance.now()
  const stats = await estimateDeleteWorkloadForNode(node)
  recordSystemDebugTimeline({
    layer: 'files',
    op: 'estimate-delete-workload',
    detail: `${stats.nodeCount} nodes ${stats.byteSize}B`,
    durationMs: Math.round(performance.now() - estimateStartAt),
  })
  return {
    nodeCount: stats.nodeCount,
    byteSize: stats.byteSize,
    totalUnits: filesWorkloadUnits(stats.nodeCount, stats.byteSize),
  }
}

/**
 * 删除工作量遍历：所有卷（含镜像 / 挂载）都按真实子树统计，不再把整棵目录
 * 当成 1 单位——否则进度窗只能显示「1 / 1 项」且条不动。
 * 镜像 / 挂载卷的目录遍历会排在卷任务队列后，调用方需先把统计放进
 * estimate 钩子（「正在统计…」期间执行），不要同步阻塞在操作入口。
 */
async function estimateDeleteWorkloadForNode(
  node: FilesNode,
): Promise<{ nodeCount: number; byteSize: number }> {
  if (node.kind === 'file' || node.kind === 'symlink') {
    return { nodeCount: 1, byteSize: node.byteSize }
  }
  let nodeCount = 1
  let byteSize = node.byteSize
  const children = await listDirectory(node.locationId, node.id)
  for (const child of children) {
    countSystemDebugHot('files', 'estimate-walk')
    const sub = await estimateDeleteWorkloadForNode(child)
    nodeCount += sub.nodeCount
    byteSize += sub.byteSize
  }
  return { nodeCount, byteSize }
}

async function deleteLocalSubtreeWithProgress(
  subtree: Awaited<ReturnType<typeof collectSubtreeIds>>,
  onProgress?: (progress: FilesVfsOpProgress) => void,
  signal?: AbortSignal,
  currentName?: string,
): Promise<void> {
  const deleteStartAt = performance.now()
  const total = filesWorkloadUnits(subtree.nodeIds.length, subtree.reclaimBytes)
  const meta = {
    ...(currentName !== undefined ? { currentName } : {}),
    items: { done: 0, total: subtree.nodeIds.length },
    bytes: { done: 0, total: subtree.reclaimBytes },
  }
  onProgress?.({ done: 0, total, ...meta })

  if (subtree.nodeIds.length <= LARGE_SUBTREE_DELETE_THRESHOLD) {
    await deleteSubtree(subtree)
    onProgress?.({
      done: total,
      total,
      ...meta,
      items: { done: subtree.nodeIds.length, total: subtree.nodeIds.length },
      bytes: { done: subtree.reclaimBytes, total: subtree.reclaimBytes },
    })
    recordSystemDebugTimeline({
      layer: 'files',
      op: 'delete-subtree-done',
      detail: `${subtree.nodeIds.length} nodes ${subtree.reclaimBytes}B`,
      durationMs: Math.round(performance.now() - deleteStartAt),
    })
    return
  }

  const batchSize = FILES_BATCH_DEFAULT_SIZE
  let deletedNodes = 0
  let reclaimAssigned = 0
  for (let offset = 0; offset < subtree.nodeIds.length; offset += batchSize) {
    const nodeChunk = subtree.nodeIds.slice(offset, offset + batchSize)
    const nodeChunkSet = new Set(nodeChunk)
    const fileChunk = subtree.fileIds.filter((id) => nodeChunkSet.has(id))
    const isLast = offset + nodeChunk.length >= subtree.nodeIds.length
    const reclaimChunk = isLast
      ? subtree.reclaimBytes - reclaimAssigned
      : Math.round((subtree.reclaimBytes * nodeChunk.length) / subtree.nodeIds.length)
    reclaimAssigned += reclaimChunk
    deletedNodes += nodeChunk.length
    const done = Math.min(
      total,
      Math.round((deletedNodes / subtree.nodeIds.length) * total),
    )
    // 破坏性删除按批为取消粒度：已删的批不回滚，剩余批在此停下
    signal?.throwIfAborted?.()
    await deleteSubtree({
      nodeIds: nodeChunk,
      fileIds: fileChunk,
      reclaimBytes: reclaimChunk,
    })
    onProgress?.({
      done,
      total,
      ...meta,
      items: { done: deletedNodes, total: subtree.nodeIds.length },
      bytes: { done: reclaimAssigned, total: subtree.reclaimBytes },
    })
  }
  onProgress?.({
    done: total,
    total,
    ...meta,
    items: { done: subtree.nodeIds.length, total: subtree.nodeIds.length },
    bytes: { done: subtree.reclaimBytes, total: subtree.reclaimBytes },
  })
  recordSystemDebugTimeline({
    layer: 'files',
    op: 'delete-subtree-batched-done',
    detail: `${subtree.nodeIds.length} nodes ${subtree.reclaimBytes}B`,
    durationMs: Math.round(performance.now() - deleteStartAt),
  })
}

export async function removeNode(
  id: string,
  options?: FilesRemoveSubtreeOptions,
): Promise<void> {
  const node = await getNodeOrThrow(id)
  if (isUserSpecialFolderNode(node)) {
    throw new Error(USER_SPECIAL_FOLDER_PROTECTED_MESSAGE)
  }
  assertNodeWritable(node)
  await removeNodeInner(node, options)
}

/** 系统层删除（绕过节点 writable 检查），供 PackageService 清理只读 store 等。 */
export async function removeNodeForced(
  id: string,
  options?: FilesRemoveSubtreeOptions,
): Promise<void> {
  const node = await getNodeOrThrow(id)
  await removeNodeInner(node, options)
}

/**
 * 元数据级移动是否可行：源与目标均为 IndexedDB 本地卷（不涉及挂载）。
 */
function canMoveNodeMetadataOnly(source: FilesNode, destLocationId: FilesLocationId): boolean {
  if (isMountNodeId(source.id) || isImageNodeId(source.id)) return false
  if (isMountLocationId(destLocationId) || isImageLocationId(destLocationId)) return false
  return source.locationId === destLocationId
}

export type FilesMoveNodeToOptions = {
  onProgress?: (progress: FilesVfsOpProgress) => void
  /** 协作取消：跨卷移动的复制阶段透传；复制一旦完成，配对的删除源必做（条目间粒度） */
  signal?: AbortSignal
}

/**
 * 移动节点到目标目录（同名自动加后缀）。
 * 同卷（IndexedDB 本地卷）走元数据级移动（零拷贝零容量）；
 * 涉及挂载卷时为复制 + 删除（带进度，与 filesMove 语义一致）。
 * 废纸篓卷为非法目标（请使用 trashNode / 删除操作）。
 */
export async function moveNodeTo(
  sourceId: string,
  destLocationId: FilesLocationId,
  destParentId: string | undefined,
  options?: FilesMoveNodeToOptions,
): Promise<FilesNode> {
  const source = await getNodeOrThrow(sourceId)
  if (isTrashLocationId(destLocationId)) {
    throw new Error('不能移动到废纸篓，请使用删除操作')
  }
  await assertCanCreateIn(destLocationId, destParentId)
  assertNodeWritable(source)

  if (source.kind === 'folder') {
    const inside = await isFolderAncestorOf(source.id, destParentId, source.locationId)
    if (inside) {
      throw new Error('不能将文件夹移动到自身或其子文件夹中')
    }
  }

  if (source.locationId === destLocationId && source.parentId === destParentId) {
    return source
  }

  const sourcePath = await resolveFilesAbsolutePath(source)
  assertDiskImagesNotOccupied([sourcePath], '移动')

  if (canMoveNodeMetadataOnly(source, destLocationId)) {
    const previousPath = await resolveFilesAbsolutePath(source)
    const moved = await moveNodeRecord({
      id: source.id,
      locationId: destLocationId,
      parentId: destParentId,
      name: source.name,
    })
    const path = await resolveFilesAbsolutePath(moved)
    emitFilesVfsChanged({ kind: 'renamed', path, previousPath })
    return moved
  }

  const copied = await copyNodeTo({
    sourceId,
    destLocationId,
    destParentId,
    onProgress: options?.onProgress,
    signal: options?.signal,
  })
  // 复制已完整提交：无论 signal 是否已触发都先删源，避免「拷完未移走」的重复状态
  await removeNode(sourceId)
  return copied
}

/**
 * 将节点移入废纸篓（可恢复，记录原位置）。
 * 仅内部卷支持：元数据级移动（零拷贝零容量）。
 * 磁盘镜像 / 挂载文件夹等外接卷没有系统盘废纸篓可回退，须走永久删除（removeNode）。
 */
export async function trashNode(id: string): Promise<FilesNode> {
  const node = await getNodeOrThrow(id)
  if (isTrashLocationId(node.locationId)) {
    throw new Error('该节点已在废纸篓中')
  }
  if (!locationSupportsTrash(node.locationId)) {
    throw new Error('外部存储不支持移入废纸篓，请使用永久删除')
  }
  if (isUserSpecialFolderNode(node)) {
    throw new Error(USER_SPECIAL_FOLDER_PROTECTED_MESSAGE)
  }
  assertNodeWritable(node)

  const trashOrigin = {
    locationId: node.locationId,
    parentId: node.parentId,
    name: node.name,
  }
  const previousPath = await resolveFilesAbsolutePath(node)
  assertDiskImagesNotOccupied([previousPath], '移入废纸篓')
  const moved = await moveNodeRecord({
    id,
    locationId: 'trash',
    parentId: undefined,
    name: node.name,
    trashOrigin,
  })
  const path = await resolveFilesAbsolutePath(moved)
  emitFilesVfsChanged({ kind: 'renamed', path, previousPath })
  return moved
}

/**
 * 将废纸篓中的节点恢复到原位置。
 * 原父目录已不存在时恢复到原卷根；原挂载卷已卸载时报错。
 */
export async function restoreNode(id: string): Promise<FilesNode> {
  const restoreStartAt = performance.now()
  const node = await getNodeOrThrow(id)
  if (!isTrashLocationId(node.locationId) || !node.trashOrigin) {
    throw new Error('该节点不在废纸篓中，无法恢复')
  }
  const origin = node.trashOrigin

  let destParentId = origin.parentId
  if (destParentId !== undefined) {
    const parent = await getNode(destParentId).catch(() => undefined)
    // 父目录需仍位于原卷（移入废纸篓等换卷后视为缺失）
    if (!parent || parent.kind !== 'folder' || parent.locationId !== origin.locationId) {
      destParentId = undefined
    }
  }

  if (isMountLocationId(origin.locationId)) {
    if (!getCachedMount(origin.locationId)) {
      throw new Error('原位置所在挂载已被移除，无法恢复')
    }
  }
  if (isImageLocationId(origin.locationId)) {
    if (!getCachedImageMount(origin.locationId)) {
      throw new Error('原位置所在磁盘镜像已推出，无法恢复')
    }
  }

  if (isMountLocationId(origin.locationId) || isImageLocationId(origin.locationId)) {
    // 目标为挂载卷：复制到挂载卷后删除废纸篓原件
    const copied = await copyNodeTree(node, origin.locationId, destParentId, () => undefined)
    await removeNode(id)
    emitFilesVfsChanged([
      { kind: 'created', path: await resolveFilesAbsolutePath(copied) },
      { kind: 'deleted', path: await resolveFilesAbsolutePath(node) },
    ])
    return copied
  }

  const previousPath = await resolveFilesAbsolutePath(node)
  const restored = await moveNodeRecord({
    id,
    locationId: origin.locationId,
    parentId: destParentId,
    name: origin.name,
  })
  const path = await resolveFilesAbsolutePath(restored)
  emitFilesVfsChanged({ kind: 'renamed', path, previousPath })
  recordSystemDebugTimeline({
    layer: 'files',
    op: 'restore-node-done',
    durationMs: Math.round(performance.now() - restoreStartAt),
  })
  return restored
}

type TrashRootWorkload = {
  node: FilesNode
  nodeCount: number
  byteSize: number
  units: number
}

/** 统计废纸篓各根节点删除工作量：所有卷统一按整棵子树（节点数 + 字节）折算 */
async function collectTrashRootWorkloads(): Promise<TrashRootWorkload[]> {
  const roots = await listDirectory('trash', undefined)
  return Promise.all(
    roots.map(async (node) => {
      const workload = await estimateDeleteWorkload(node.id)
      return { node, nodeCount: workload.nodeCount, byteSize: workload.byteSize, units: workload.totalUnits }
    }),
  )
}

/** 估算清空废纸篓的总工作量（与 estimateDeleteWorkload 同口径；空废纸篓为 0） */
export async function estimateEmptyTrashWorkload(): Promise<FilesDeleteWorkload> {
  const workloads = await collectTrashRootWorkloads()
  return {
    nodeCount: workloads.reduce((sum, w) => sum + w.nodeCount, 0),
    byteSize: workloads.reduce((sum, w) => sum + w.byteSize, 0),
    totalUnits: workloads.reduce((sum, w) => sum + w.units, 0),
  }
}

/** 清空废纸篓：永久删除其中全部内容（释放容量，带进度；按工作量单位上报，大子树内部平滑推进） */
export async function emptyTrash(
  options?: { onProgress?: (progress: FilesVfsOpProgress) => void; signal?: AbortSignal },
): Promise<void> {
  const trashStartAt = performance.now()
  const workloads = await collectTrashRootWorkloads()
  const total = Math.max(1, workloads.reduce((sum, w) => sum + w.units, 0))
  const totalItems = workloads.reduce((sum, w) => sum + w.nodeCount, 0)
  const totalBytes = workloads.reduce((sum, w) => sum + w.byteSize, 0)
  let done = 0
  let itemsDone = 0
  let bytesDone = 0
  options?.onProgress?.({
    done: 0,
    total,
    items: { done: 0, total: totalItems },
    bytes: { done: 0, total: totalBytes },
  })
  for (const { node, units, nodeCount, byteSize } of workloads) {
    options?.signal?.throwIfAborted?.()
    await removeNodeForced(node.id, {
      signal: options?.signal,
      workload: { nodeCount, byteSize, totalUnits: units },
      onProgress: (progress) =>
        options?.onProgress?.({
          done: done + progress.done,
          total,
          ...(progress.currentName !== undefined ? { currentName: progress.currentName } : {}),
          items: { done: itemsDone + (progress.items?.done ?? 0), total: totalItems },
          bytes: { done: bytesDone + (progress.bytes?.done ?? 0), total: totalBytes },
        }),
    })
    done += units
    itemsDone += nodeCount
    bytesDone += byteSize
    options?.onProgress?.({
      done,
      total,
      currentName: node.name,
      items: { done: itemsDone, total: totalItems },
      bytes: { done: bytesDone, total: totalBytes },
    })
  }
  options?.onProgress?.({
    done: total,
    total,
    items: { done: totalItems, total: totalItems },
    bytes: { done: totalBytes, total: totalBytes },
  })
  recordSystemDebugTimeline({
    layer: 'files',
    op: 'empty-trash-done',
    detail: `${workloads.length} roots`,
    durationMs: Math.round(performance.now() - trashStartAt),
  })
}

/** 逐子项删除的共享选项：onProgress 上报 + 协作取消 + 调用方预算好的工作量 */
export type FilesRemoveSubtreeOptions = {
  onProgress?: (progress: FilesVfsOpProgress) => void
  signal?: AbortSignal
  /** 调用方已算好的删除工作量（estimate 钩子结果），避免整树二次遍历 */
  workload?: FilesDeleteWorkload
}

async function removeNodeInner(
  node: FilesNode,
  options?: FilesRemoveSubtreeOptions,
): Promise<void> {
  const id = node.id
  const path = await resolveFilesAbsolutePath(node)
  assertDiskImagesNotOccupied([path], '删除')
  if (isMountNodeId(id)) {
    // 逐子项删除并上报：整树一次性 remove 不回调，进度窗整段停在 0
    await removeMountSubtreeWithProgress(node, options)
    emitFilesVfsChanged({ kind: 'deleted', path })
    return
  }
  if (isImageNodeId(id)) {
    await removeImageSubtreeWithProgress(node, options)
    emitFilesVfsChanged({ kind: 'deleted', path })
    return
  }
  const subtree = await collectSubtreeIds(id)
  await deleteLocalSubtreeWithProgress(subtree, options?.onProgress, options?.signal, node.name)
  emitFilesVfsChanged({ kind: 'deleted', path })
}

/**
 * 挂载卷逐子项删除：文件逐个 removeEntry，文件夹自底向上删空的，逐步上报。
 * 不依赖底层 removeEntry(recursive) 的内部实现，进度与取消粒度都在子项上。
 */
async function removeMountSubtreeWithProgress(
  node: FilesNode,
  options?: FilesRemoveSubtreeOptions,
): Promise<void> {
  const workload = options?.workload ?? (await estimateDeleteWorkload(node.id))
  const total = workload.totalUnits
  const state = { done: 0, items: 0, bytes: 0, currentName: node.name }
  const report = (): void => {
    options?.onProgress?.({
      done: Math.min(total, state.done),
      total,
      currentName: state.currentName,
      items: { done: Math.min(workload.nodeCount, state.items), total: workload.nodeCount },
      bytes: { done: Math.min(workload.byteSize, state.bytes), total: workload.byteSize },
    })
  }
  const visit = async (current: FilesNode): Promise<void> => {
    options?.signal?.throwIfAborted?.()
    state.currentName = current.name
    report()
    if (current.kind === 'folder') {
      const children = await listDirectory(current.locationId, current.id)
      for (const child of children) await visit(child)
    }
    await removeMountNode(current.id)
    state.done += filesWorkloadUnits(1, current.byteSize)
    state.items += 1
    state.bytes += current.byteSize
    report()
  }
  await visit(node)
}

/**
 * 镜像卷逐子项删除：文件逐个删，目录自底向上删空的（exFAT 空目录才能删），
 * 逐步上报。替换原先整树一次的 volume.remove：那样既不回调进度，也无法取消。
 */
async function removeImageSubtreeWithProgress(
  node: FilesNode,
  options?: FilesRemoveSubtreeOptions,
): Promise<void> {
  const workload = options?.workload ?? (await estimateDeleteWorkload(node.id))
  const total = workload.totalUnits
  const state = { done: 0, items: 0, bytes: 0, currentName: node.name }
  const report = (): void => {
    options?.onProgress?.({
      done: Math.min(total, state.done),
      total,
      currentName: state.currentName,
      items: { done: Math.min(workload.nodeCount, state.items), total: workload.nodeCount },
      bytes: { done: Math.min(workload.byteSize, state.bytes), total: workload.byteSize },
    })
  }
  const visit = async (current: FilesNode): Promise<void> => {
    options?.signal?.throwIfAborted?.()
    state.currentName = current.name
    report()
    if (current.kind === 'folder') {
      const children = await listDirectory(current.locationId, current.id)
      for (const child of children) await visit(child)
    }
    await removeImageNode(current.id)
    state.done += filesWorkloadUnits(1, current.byteSize)
    state.items += 1
    state.bytes += current.byteSize
    report()
  }
  await visit(node)
}

/**
 * 按绝对路径批量删除本地卷节点；挂载路径单独走 removeMountNode。
 * 合并子树收集与 IndexedDB 删除事务；默认 skipMissing 为 false。
 */
export async function removeNodesByPathsBatch(
  paths: readonly string[],
  options?: FilesRemoveBatchOptions,
): Promise<void> {
  const batchStartAt = performance.now()
  if (paths.length === 0) return
  const skipMissing = options?.skipMissing ?? false
  const batchSize = options?.batchSize

  const mountDeletes: { id: string; path: string }[] = []
  const localRootIds: string[] = []
  const deletedPaths: string[] = []

  for (const rawPath of paths) {
    const absolutePath = rawPath.trim().replace(/\/+$/, '') || '/'
    if (!isFilesAbsolutePath(absolutePath)) {
      throw new Error('路径必须是以 / 开头的全局绝对路径')
    }
    if (isFilesNamespaceRoot(absolutePath)) {
      throw new Error('不能删除命名空间根')
    }
    assertDiskImagesNotOccupied([absolutePath], '删除')
    const parsed = parseFilesAbsolutePath(absolutePath)
    if (!parsed || parsed.segments.length === 0) {
      throw new Error('不能删除卷根')
    }
    if (isMountLocationId(parsed.locationId) || isImageLocationId(parsed.locationId)) {
      const node = await resolveNodeByAbsolutePath(absolutePath)
      if (!node) {
        if (skipMissing) continue
        throw new Error('项目不存在')
      }
      assertNodeWritable(node)
      mountDeletes.push({ id: node.id, path: absolutePath })
      deletedPaths.push(absolutePath)
      continue
    }
    if (parsed.locationId === 'models3d' || parsed.locationId === 'source' || parsed.locationId === 'applications') {
      throw new Error('此位置不支持批量删除')
    }
    if (isUserSpecialFolderPath(absolutePath)) {
      throw new Error(USER_SPECIAL_FOLDER_PROTECTED_MESSAGE)
    }

    const node = await resolveNodeByAbsolutePath(absolutePath)
    if (!node) {
      if (skipMissing) continue
      throw new Error('项目不存在')
    }
    if (isUserSpecialFolderNode(node)) {
      throw new Error(USER_SPECIAL_FOLDER_PROTECTED_MESSAGE)
    }
    assertNodeWritable(node)
    localRootIds.push(node.id)
    deletedPaths.push(absolutePath)
  }

  for (const mount of mountDeletes) {
    if (isImageNodeId(mount.id)) {
      await removeImageNode(mount.id)
    } else {
      await removeMountNode(mount.id)
    }
  }

  if (localRootIds.length > 0) {
    const merged = await collectSubtreesBatch(localRootIds)
    await deleteSubtreesMerged(merged, { batchSize })
  }

  if (deletedPaths.length > 0) {
    emitFilesVfsChanged(deletedPaths.map((path) => ({ kind: 'deleted' as const, path })))
  }
  recordSystemDebugTimeline({
    layer: 'files',
    op: 'remove-paths-batch-done',
    detail: `${paths.length} paths`,
    durationMs: Math.round(performance.now() - batchStartAt),
  })
}

export async function getNodeOrThrow(id: string): Promise<FilesNode> {
  if (isMountNodeId(id)) {
    const node = await getMountNode(id)
    if (!node) throw new Error('项目不存在')
    return node
  }
  if (isImageNodeId(id)) {
    const node = await getImageNode(id)
    if (!node) throw new Error('项目不存在')
    return node
  }
  if (id.startsWith('models3d:')) {
    const node = getModels3dNode(id)
    if (!node) throw new Error('项目不存在')
    return node
  }
  if (id.startsWith('source:')) {
    const node = await getSourceNode(id)
    if (!node) throw new Error('项目不存在')
    return node
  }
  if (id.startsWith('applications:')) {
    const node = await getApplicationsNode(id)
    if (!node) throw new Error('项目不存在')
    return node
  }
  const node = await getNode(id)
  if (!node) {
    throw new Error('项目不存在')
  }
  return node
}

/** 列表可视区是否需异步补齐大小/修改时间（目前仅挂载卷文件） */
export function filesNodeNeedsViewportMeta(node: FilesNode): boolean {
  return node.kind === 'file' && isMountNodeId(node.id)
}

/**
 * 为可视行补齐元数据。无需补齐或失败时返回 undefined，调用方保持原节点。
 */
export async function enrichFilesNodeMeta(nodeId: string): Promise<FilesNode | undefined> {
  if (!isMountNodeId(nodeId)) return undefined
  try {
    const node = await getMountNode(nodeId)
    if (!node || node.kind !== 'file') return undefined
    return node
  } catch {
    return undefined
  }
}

/** 估算复制整棵子树到本地存储时需要的额外字节（内容 + 元数据；可共享 blob 时仅元数据） */
export async function estimateCopyBytes(
  sourceId: string,
  destLocationId: FilesLocationId = 'local',
): Promise<number> {
  const source = await getNodeOrThrow(sourceId)
  return estimateCopyBytesForNode(source, destLocationId)
}

async function estimateCopyBytesForNode(
  node: FilesNode,
  destLocationId: FilesLocationId,
): Promise<number> {
  if (node.kind === 'file') {
    if (canShareBlobOnCopy(node, destLocationId)) {
      return estimateNodeMetaBytes(node)
    }
    const storedBytes = await getNodeBlobStoredBytes(node.id)
    return estimateNodeMetaBytes(node) + storedBytes
  }
  if (node.kind === 'symlink') {
    return estimateNodeMetaBytes(node) + estimateTextBytes(node.target ?? '')
  }

  let total = estimateNodeMetaBytes(node)
  const children = await listDirectory(node.locationId, node.id)
  for (const child of children) {
    total += await estimateCopyBytesForNode(child, destLocationId)
  }
  return total
}

async function isFolderAncestorOf(
  ancestorId: string,
  candidateParentId: string | undefined,
  locationId: FilesLocationId,
): Promise<boolean> {
  let currentId = candidateParentId
  while (currentId !== undefined) {
    if (currentId === ancestorId) return true
    const current = await getNodeOrThrow(currentId)
    if (current.locationId !== locationId) return false
    currentId = current.parentId
  }
  return false
}

/**
 * 将源节点复制到目标目录（同名自动加后缀）。
 * 写入本地卷前会先预检数据空间是否够用。
 */
export async function copyNodeTo(params: {
  sourceId: string
  destLocationId: FilesLocationId
  destParentId: string | undefined
  onProgress?: (progress: FilesVfsOpProgress) => void
  /** 协作取消：树内文件之间为检查点；取消时 best-effort 清掉已建的目的子树 */
  signal?: AbortSignal
  /** 调用方已算好的复制工作量（estimate 钩子结果）；镜像卷上遍历目录要排卷队列，
   *  省掉内部二次遍历就省掉一半的「正在统计…」等待。缺省时仍内部估算。 */
  workload?: { nodeCount: number; byteSize: number }
}): Promise<FilesNode> {
  const source = await getNodeOrThrow(params.sourceId)
  if (isTrashLocationId(params.destLocationId)) {
    throw new Error('不能复制或粘贴到废纸篓，请使用删除操作')
  }
  await assertCanCreateIn(params.destLocationId, params.destParentId)

  if (
    source.kind === 'folder' &&
    source.locationId === params.destLocationId &&
    (params.destParentId === source.id ||
      (await isFolderAncestorOf(source.id, params.destParentId, params.destLocationId)))
  ) {
    throw new Error('不能将文件夹粘贴到自身或其子文件夹中')
  }

  const usesLocalQuota = !isMountLocationId(params.destLocationId) && !isImageLocationId(params.destLocationId)
  if (usesLocalQuota) {
    const needed = await estimateCopyBytesForNode(source, params.destLocationId)
    await assertAdditionalBytesAvailable(needed)
  }

  const workload = params.workload ?? (await estimateCopyWorkloadForNode(source))
  const total = filesWorkloadUnits(workload.nodeCount, workload.byteSize)
  const progressState = { done: 0, items: 0, bytes: 0 }
  params.onProgress?.({
    done: 0,
    total,
    currentName: source.name,
    items: { done: 0, total: workload.nodeCount },
    bytes: { done: 0, total: workload.byteSize },
  })

  const reportNodeDone = (node: FilesNode) => {
    progressState.done = Math.min(total, progressState.done + nodeWorkloadUnits(node))
    progressState.items += 1
    progressState.bytes += node.byteSize
    params.onProgress?.({
      done: progressState.done,
      total,
      currentName: node.name,
      items: { done: progressState.items, total: workload.nodeCount },
      bytes: { done: progressState.bytes, total: workload.byteSize },
    })
  }

  // 文件夹源：目标根文件夹先建出来并登记写入进度（列表里图标叠圆饼），
  // 再逐个往里拷子项；子项的变更仍按调用方的批量合并排队，但根文件夹
  // 的 created 立即广播，当前目录列表马上出现「正在填充」的它。
  if (source.kind === 'folder') {
    const root = await mkdir({
      locationId: params.destLocationId,
      parentId: params.destParentId,
      name: source.name,
    })
    reportNodeDone(source)
    // 空树没有可填充的字节，登记只会闪一帧旋转弧；直接不登记
    if (workload.byteSize > 0) registerFilesWriteProgress(root.id, workload.byteSize)
    try {
      await emitNodeCreatedImmediately(root)
      const children = await listDirectory(source.locationId, source.id)
      for (const child of children) {
        params.signal?.throwIfAborted?.()
        await copyNodeTree(child, params.destLocationId, root.id, reportNodeDone, params.signal)
        if (workload.byteSize > 0) updateFilesWriteProgress(root.id, progressState.bytes)
      }
    } catch (err) {
      if (workload.byteSize > 0) removeFilesWriteProgress(root.id)
      if (params.signal?.aborted) {
        // 取消：内层 copyNodeTree 已逐层清掉各自建的目录，这里清根
        await removeNodeForced(root.id).catch(() => undefined)
      }
      throw err
    }
    if (workload.byteSize > 0) removeFilesWriteProgress(root.id)
    params.onProgress?.({
      done: total,
      total,
      currentName: source.name,
      items: { done: workload.nodeCount, total: workload.nodeCount },
      bytes: { done: workload.byteSize, total: workload.byteSize },
    })
    return root
  }

  const result = await copyNodeTree(source, params.destLocationId, params.destParentId, reportNodeDone, params.signal)
  params.onProgress?.({
    done: total,
    total,
    currentName: source.name,
    items: { done: workload.nodeCount, total: workload.nodeCount },
    bytes: { done: workload.byteSize, total: workload.byteSize },
  })
  return result
}

/** IndexedDB 本地卷之间复制文件时可共享 blob（写时复制） */
function canShareBlobOnCopy(source: FilesNode, destLocationId: FilesLocationId): boolean {
  if (isMountLocationId(destLocationId) || isImageLocationId(destLocationId)) return false
  if (isMountNodeId(source.id) || isImageNodeId(source.id)) return false
  if (source.id.startsWith('models3d:') || source.id.startsWith('source:') || source.id.startsWith('applications:')) {
    return false
  }
  return (
    (source.locationId === 'local' || source.locationId === 'dev' || source.locationId === 'tmp') &&
    (destLocationId === 'local' || destLocationId === 'dev' || destLocationId === 'tmp')
  )
}

async function cloneSharedLocalFile(
  source: FilesNode,
  destLocationId: FilesLocationId,
  destParentId: string | undefined,
): Promise<FilesNode> {
  await assertCanCreateIn(destLocationId, destParentId)
  const desired = normalizeFilesNodeName(source.name.trim() || '未命名')
  const now = osNowMs()
  const node: FilesNode = {
    id: newFilesNodeId(),
    locationId: destLocationId,
    parentId: destParentId,
    name: desired,
    kind: 'file',
    mimeType: source.mimeType ?? FILES_TEXT_MIME,
    byteSize: source.byteSize,
    createdAt: now,
    updatedAt: now,
    attributes: defaultFilesNodeAttributes(destLocationId),
  }
  const created = await cloneFileNodeWithSharedBlob({
    sourceNodeId: source.id,
    node,
    metaBytes: estimateNodeMetaBytes(node),
    nameMode: 'unique-suffix',
  })
  await emitNodeCreated(created)
  return created
}

async function copyNodeTree(
  source: FilesNode,
  destLocationId: FilesLocationId,
  destParentId: string | undefined,
  reportNodeDone: (node: FilesNode) => void,
  signal?: AbortSignal,
): Promise<FilesNode> {
  // 取消粒度=文件之间：当前节点保持原子提交，下一个节点开工前才检查
  signal?.throwIfAborted?.()
  if (source.kind === 'file') {
    if (canShareBlobOnCopy(source, destLocationId)) {
      const created = await cloneSharedLocalFile(source, destLocationId, destParentId)
      reportNodeDone(source)
      return created
    }

    // 跨卷/不可共享 blob：整读进主线程再写回
    const readStartAt = performance.now()
    const { node, blob } = await readFileBlobByNodeId(source.id)
    const bytes = await blob.arrayBuffer()
    const readDurationMs = performance.now() - readStartAt
    if (readDurationMs > 32) {
      recordSystemDebugHot({
        layer: 'files',
        op: 'copy-file-fullread',
        detail: `${source.name} ${bytes.byteLength}B`,
        durationMs: readDurationMs,
      })
    } else {
      countSystemDebugHot('files', 'copy-file-fullread', readDurationMs)
    }
    const asBinary = isBinaryFile({
      fileName: source.name,
      mimeType: node.mimeType ?? source.mimeType ?? blob.type,
      bytes,
    })
    let created: FilesNode
    if (asBinary) {
      created = await createBinaryFile({
        locationId: destLocationId,
        parentId: destParentId,
        name: source.name,
        bytes,
        mimeType: node.mimeType ?? source.mimeType ?? 'application/octet-stream',
      })
    } else {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes))
      created = await createTextFile({
        locationId: destLocationId,
        parentId: destParentId,
        name: source.name,
        text,
      })
    }
    reportNodeDone(source)
    return created
  }

  if (source.kind === 'symlink') {
    const created = await createSymlink({
      locationId: destLocationId,
      parentId: destParentId,
      name: source.name,
      target: source.target ?? '',
      nameMode: 'unique-suffix',
    })
    reportNodeDone(source)
    return created
  }

  const folder = await mkdir({
    locationId: destLocationId,
    parentId: destParentId,
    name: source.name,
  })
  reportNodeDone(source)
  const children = await listDirectory(source.locationId, source.id)
  try {
    for (const child of children) {
      countSystemDebugHot('files', 'copy-node')
      await copyNodeTree(child, destLocationId, folder.id, reportNodeDone, signal)
    }
  } catch (err) {
    if (signal?.aborted) {
      // 取消：best-effort 清掉本层已建的目的目录；逐层上抛时整棵半成品子树被清空
      await removeNodeForced(folder.id).catch(() => undefined)
    }
    throw err
  }
  return folder
}

/**
 * 单文件覆盖事务：以源文件内容事务式覆盖目标文件。
 * 打开目标文件的覆盖流（各后端保证提交前旧内容原样：内部卷 close 切换 blob 指针、
 * 镜像卷补丁目录项、FAT/挂载卷临时名 + 改名交换），分块泵入源内容后 close 提交；
 * 中途任何失败都 abort 回滚——目标保持旧内容，不出现「删了旧的、新的没进去」的中间态。
 */
export async function overwriteNodeWithSource(params: {
  targetId: string
  sourceId: string
  signal?: AbortSignal
  onProgress?: (bytesWritten: number, totalBytes: number) => void
}): Promise<FilesNode> {
  const [target, source] = await Promise.all([
    getNodeOrThrow(params.targetId),
    getNodeOrThrow(params.sourceId),
  ])
  if (target.kind !== 'file') throw new Error('目标不是文件')
  if (source.kind !== 'file') throw new Error('源不是文件')
  assertNodeWritable(target)
  params.signal?.throwIfAborted?.()
  const writer = await openStreamWrite({
    node: target,
    isNew: false,
    metaBytes: 0,
    previousByteSize: target.byteSize,
    expectedSize: source.byteSize,
  })
  try {
    const chunkSize = 1024 * 1024
    let offset = 0
    while (offset < source.byteSize) {
      params.signal?.throwIfAborted?.()
      const { blob } = await readFileBlobRange(
        source.id,
        offset,
        Math.min(chunkSize, source.byteSize - offset),
      )
      await writer.write(new Uint8Array(await blob.arrayBuffer()))
      offset += blob.size
      params.onProgress?.(offset, source.byteSize)
    }
    return await writer.close()
  } catch (err) {
    await writer.abort().catch(() => undefined)
    throw err
  }
}

export type FilesUpsertBatchItem =
  | { path: string; text: string; expectedContentRevisionId?: string }
  | { path: string; bytes: ArrayBuffer; expectedContentRevisionId?: string }

type PreparedUpsert = {
  absolutePath: string
  watchKind: 'created' | 'modified'
  op: FilesStorageBatchOp
}

/**
 * 按绝对路径批量 upsert 本地卷文件（存在则覆写、不存在则精确名创建）。
 * 自动补齐缺失父目录；挂载卷不支持。默认每批 FILES_BATCH_DEFAULT_SIZE 条，
 * 且内容合计不超过 FILES_BATCH_DEFAULT_MAX_BYTES。
 */
export async function upsertFilesBatch(
  items: readonly FilesUpsertBatchItem[],
  options?: { batchSize?: number; maxBatchBytes?: number },
): Promise<FilesNode[]> {
  const upsertStartAt = performance.now()
  if (items.length === 0) return []
  const batchSize = Math.max(1, options?.batchSize ?? FILES_BATCH_DEFAULT_SIZE)
  const maxBatchBytes = Math.max(1, options?.maxBatchBytes ?? FILES_BATCH_DEFAULT_MAX_BYTES)

  type ParsedItem = {
    absolutePath: string
    locationId: FilesLocationId
    parentSegments: string[]
    fileName: string
    item: FilesUpsertBatchItem
  }

  const parsedItems: ParsedItem[] = []
  const folderPaths = new Set<string>()

  for (const item of items) {
    const absolutePath = item.path.trim().replace(/\/+$/, '') || '/'
    if (!isFilesAbsolutePath(absolutePath)) {
      throw new Error('路径必须是以 / 开头的全局绝对路径')
    }
    const parsed = parseFilesAbsolutePath(absolutePath)
    if (!parsed || parsed.segments.length === 0) {
      throw new Error('路径无效')
    }
    if (isMountLocationId(parsed.locationId) || isImageLocationId(parsed.locationId)) {
      throw new Error('挂载卷暂不支持批量写入')
    }
    if (parsed.locationId === 'models3d' || parsed.locationId === 'source' || parsed.locationId === 'applications') {
      throw new Error('此位置不支持批量写入')
    }

    const fileName = normalizeFilesNodeName(parsed.segments[parsed.segments.length - 1] ?? '')
    const parentSegments = parsed.segments.slice(0, -1).map((seg) => normalizeFilesNodeName(seg))
    const root = filesLocationPathRoot(parsed.locationId)
    let prefix = root
    for (const seg of parentSegments) {
      prefix = joinFilesAbsolutePath(prefix, seg)
      folderPaths.add(`${parsed.locationId}\n${prefix}`)
    }
    parsedItems.push({
      absolutePath,
      locationId: parsed.locationId,
      parentSegments,
      fileName,
      item,
    })
  }

  const childrenCache = new Map<string, FilesNode[]>()
  const folderIdByPath = new Map<string, string | undefined>()

  const cacheKey = (locationId: FilesLocationId, parentId: string | undefined) =>
    `${locationId}\0${parentId ?? ''}`

  const listCached = async (
    locationId: FilesLocationId,
    parentId: string | undefined,
  ): Promise<FilesNode[]> => {
    const key = cacheKey(locationId, parentId)
    const hit = childrenCache.get(key)
    if (hit) return hit
    const listed = await listDirectory(locationId, parentId)
    childrenCache.set(key, listed)
    return listed
  }

  const rememberChild = (
    locationId: FilesLocationId,
    parentId: string | undefined,
    node: FilesNode,
  ) => {
    const key = cacheKey(locationId, parentId)
    const current = childrenCache.get(key)
    // 缓存未热时不要用「单节点」污染，否则会掩盖已存在的同级目录/文件
    if (!current) return
    childrenCache.set(key, [...current.filter((child) => child.name !== node.name), node])
  }

  // 按深度排序后批量创建缺失目录；每一层 flush 后再处理下一层，避免父目录尚未落盘
  const sortedFolderEntries = [...folderPaths]
    .map((entry) => {
      const sep = entry.indexOf('\n')
      const locationId = entry.slice(0, sep) as FilesLocationId
      const path = entry.slice(sep + 1)
      const root = filesLocationPathRoot(locationId)
      const relative = path === root ? '' : path.slice(root.length).replace(/^\//, '')
      const segments = relative ? relative.split('/') : []
      return { locationId, path, segments, depth: segments.length }
    })
    .sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path))

  for (const locationId of new Set(sortedFolderEntries.map((entry) => entry.locationId))) {
    folderIdByPath.set(filesLocationPathRoot(locationId), undefined)
  }

  let pendingFolderOps: {
    path: string
    locationId: FilesLocationId
    parentId: string | undefined
    op: FilesStorageBatchOp
  }[] = []

  const flushFolders = async () => {
    if (pendingFolderOps.length === 0) return
    for (let offset = 0; offset < pendingFolderOps.length; offset += batchSize) {
      const slice = pendingFolderOps.slice(offset, offset + batchSize)
      const created = await commitFilesBatch(slice.map((item) => item.op))
      for (let i = 0; i < slice.length; i += 1) {
        const folder = created[i]
        const meta = slice[i]
        if (!folder || !meta) continue
        folderIdByPath.set(meta.path, folder.id)
        rememberChild(meta.locationId, meta.parentId, folder)
        emitFilesVfsChanged({ kind: 'created', path: meta.path })
      }
    }
    pendingFolderOps = []
  }

  let currentDepth = -1
  for (const entry of sortedFolderEntries) {
    if (entry.depth !== currentDepth) {
      await flushFolders()
      currentDepth = entry.depth
    }
    if (folderIdByPath.has(entry.path)) continue
    let parentId: string | undefined
    let currentPath = filesLocationPathRoot(entry.locationId)
    for (let i = 0; i < entry.segments.length; i += 1) {
      const name = entry.segments[i]!
      const nextPath = joinFilesAbsolutePath(currentPath, name)
      if (folderIdByPath.has(nextPath)) {
        parentId = folderIdByPath.get(nextPath)
        currentPath = nextPath
        continue
      }
      // 仅处理到 entry 自身这一层；祖先应已在更浅 depth 处理完
      if (i < entry.segments.length - 1) {
        throw new Error(`父目录缺失：${nextPath}`)
      }
      const siblings = await listCached(entry.locationId, parentId)
      const existing = siblings.find((child) => child.name === name)
      if (existing) {
        if (existing.kind !== 'folder') {
          throw new Error(`路径冲突：${nextPath} 不是文件夹`)
        }
        folderIdByPath.set(nextPath, existing.id)
        parentId = existing.id
        currentPath = nextPath
        continue
      }
      await assertCanCreateIn(entry.locationId, parentId)
      const now = osNowMs()
      const node: FilesNode = {
        id: newFilesNodeId(),
        locationId: entry.locationId,
        parentId,
        name,
        kind: 'folder',
        mimeType: undefined,
        byteSize: 0,
        createdAt: now,
        updatedAt: now,
        attributes: defaultFilesNodeAttributes(entry.locationId),
      }
      pendingFolderOps.push({
        path: nextPath,
        locationId: entry.locationId,
        parentId,
        op: { kind: 'create-folder', node, metaBytes: estimateNodeMetaBytes(node) },
      })
      // 先占位，避免同层后续条目重复创建；flush 后 id 不变
      folderIdByPath.set(nextPath, node.id)
      rememberChild(entry.locationId, parentId, node)
      parentId = node.id
      currentPath = nextPath
    }
    if (pendingFolderOps.length >= batchSize) {
      await flushFolders()
    }
  }
  await flushFolders()

  const prepared: PreparedUpsert[] = []
  const assertedParents = new Set<string>()
  const assertParentOnce = async (
    locationId: FilesLocationId,
    parentId: string | undefined,
  ) => {
    const key = `${locationId}\0${parentId ?? ''}`
    if (assertedParents.has(key)) return
    await assertCanCreateIn(locationId, parentId)
    assertedParents.add(key)
  }

  for (const parsed of parsedItems) {
    const root = filesLocationPathRoot(parsed.locationId)
    const parentPath =
      parsed.parentSegments.length === 0
        ? root
        : joinFilesAbsolutePath(root, ...parsed.parentSegments)
    const parentId = folderIdByPath.has(parentPath)
      ? folderIdByPath.get(parentPath)
      : undefined
    if (parsed.parentSegments.length > 0 && !folderIdByPath.has(parentPath)) {
      throw new Error(`父文件夹不存在：${parentPath}`)
    }
    await assertParentOnce(parsed.locationId, parentId)

    const siblings = await listCached(parsed.locationId, parentId)
    const existing = siblings.find((child) => child.name === parsed.fileName)
    if (existing && existing.kind !== 'file') {
      throw new Error(`路径冲突：${parsed.absolutePath}`)
    }

    if (
      existing === undefined &&
      parsed.item.expectedContentRevisionId !== undefined
    ) {
      const expected = parsed.item.expectedContentRevisionId
      throw new FilesContentRevisionMismatchError(
        `文件 ${parsed.absolutePath} 已被外部修改（expected=${expected}, current=无），请重读后重试`,
        parsed.absolutePath,
        expected,
        undefined,
      )
    }
    if (existing) {
      assertNodeWritable(existing)
      if (parsed.item.expectedContentRevisionId !== undefined) {
        assertExpectedContentRevision(
          parsed.absolutePath,
          existing,
          parsed.item.expectedContentRevisionId,
        )
      }
      if ('text' in parsed.item) {
        prepared.push({
          absolutePath: parsed.absolutePath,
          watchKind: 'modified',
          op: {
            kind: 'write-text',
            id: existing.id,
            text: parsed.item.text,
            previousByteSize: existing.byteSize,
            nameMetaDelta: 0,
          },
        })
      } else {
        prepared.push({
          absolutePath: parsed.absolutePath,
          watchKind: 'modified',
          op: {
            kind: 'write-bytes',
            id: existing.id,
            bytes: parsed.item.bytes,
            previousByteSize: existing.byteSize,
            nameMetaDelta: 0,
          },
        })
      }
      continue
    }

    const now = osNowMs()
    if ('text' in parsed.item) {
      const node: FilesNode = {
        id: newFilesNodeId(),
        locationId: parsed.locationId,
        parentId,
        name: parsed.fileName,
        kind: 'file',
        mimeType: FILES_TEXT_MIME,
        byteSize: 0,
        createdAt: now,
        updatedAt: now,
        attributes: defaultFilesNodeAttributes(parsed.locationId),
      }
      prepared.push({
        absolutePath: parsed.absolutePath,
        watchKind: 'created',
        op: {
          kind: 'create-text',
          node,
          text: parsed.item.text,
          metaBytes: estimateNodeMetaBytes(node),
        },
      })
      rememberChild(parsed.locationId, parentId, node)
    } else {
      const node: FilesNode = {
        id: newFilesNodeId(),
        locationId: parsed.locationId,
        parentId,
        name: parsed.fileName,
        kind: 'file',
        mimeType: 'application/octet-stream',
        byteSize: 0,
        createdAt: now,
        updatedAt: now,
        attributes: defaultFilesNodeAttributes(parsed.locationId),
      }
      prepared.push({
        absolutePath: parsed.absolutePath,
        watchKind: 'created',
        op: {
          kind: 'create-bytes',
          node,
          bytes: parsed.item.bytes,
          metaBytes: estimateNodeMetaBytes(node),
        },
      })
      rememberChild(parsed.locationId, parentId, node)
    }
  }

  const results: FilesNode[] = []
  const preparedBytes = (item: PreparedUpsert): number => {
    const op = item.op
    if (op.kind === 'create-text' || op.kind === 'write-text') {
      return estimateTextBytes(op.text)
    }
    if (op.kind === 'create-bytes' || op.kind === 'write-bytes') {
      return op.bytes.byteLength
    }
    return 0
  }

  let offset = 0
  while (offset < prepared.length) {
    const first = prepared[offset]!
    let end = offset + 1
    let batchBytes = preparedBytes(first)
    while (end < prepared.length && end - offset < batchSize) {
      const nextBytes = preparedBytes(prepared[end]!)
      if (batchBytes + nextBytes > maxBatchBytes) break
      batchBytes += nextBytes
      end += 1
    }
    const slice = prepared.slice(offset, end)
    offset = end
    const startedAt = performance.now()
    const committed = await commitFilesBatch(slice.map((item) => item.op))
    const durationMs = performance.now() - startedAt
    const perItemMs = slice.length > 0 ? durationMs / slice.length : durationMs
    results.push(...committed)
    emitFilesVfsChanged(
      slice.map((item) => ({ kind: item.watchKind, path: item.absolutePath })),
    )
    for (let i = 0; i < slice.length; i += 1) {
      const item = slice[i]
      const node = committed[i]
      if (!item || !node) continue
      const op = item.op
      if (op.kind === 'write-text' || op.kind === 'create-text') {
        recordFilesIoByteEvent({
          locationId: node.locationId,
          direction: 'write',
          bytes: estimateTextBytes(op.text),
          path: item.absolutePath,
          op: 'upsertBatch',
          durationMs: perItemMs,
        })
      } else if (op.kind === 'write-bytes' || op.kind === 'create-bytes') {
        recordFilesIoByteEvent({
          locationId: node.locationId,
          direction: 'write',
          bytes: op.bytes.byteLength,
          path: item.absolutePath,
          op: 'upsertBatch',
          durationMs: perItemMs,
        })
      }
    }
  }
  recordSystemDebugTimeline({
    layer: 'files',
    op: 'upsert-batch-done',
    detail: `${items.length} items`,
    durationMs: Math.round(performance.now() - upsertStartAt),
  })
  return results
}

export { isFilesAbsolutePath } from './files-path.ts'
export { FILES_BATCH_DEFAULT_MAX_BYTES, FILES_BATCH_DEFAULT_SIZE } from './files-storage.ts'
