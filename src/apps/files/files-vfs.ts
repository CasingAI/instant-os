import { recordFilesIoByteEvent } from '../../os/files-io-metrics.ts'
import { recordSlowVfsResolve } from '../../os/system-debug-log.ts'
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
  createSymlinkNode,
  deleteSubtree,
  deleteSubtreesMerged,
  estimateNodeMetaBytes,
  estimateTextBytes,
  FILES_BATCH_DEFAULT_MAX_BYTES,
  FILES_BATCH_DEFAULT_SIZE,
  getNode,
  listChildNodes,
  listLocalVolumeSubtreeNodes,
  newFilesNodeId,
  openStreamWriteBlob,
  readBlobBytes,
  readBlobText,
  renameNodeRecord,
  moveNodeRecord,
  FilesStorageFullError,
  writeBlobBytes,
  writeBlobText,
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
  writeMountText,
} from './files-location-mount.ts'
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
  isMountLocationId,
  isMountNodeId,
  isTrashLocationId,
  type FilesLocation,
  type FilesLocationId,
  type FilesNode,
  type MountFilesLocationId,
} from './files-types.ts'
import { filesWorkloadUnits } from './files-op-progress-policy.ts'
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

async function emitNodeModified(node: FilesNode): Promise<void> {
  const path = await resolveFilesAbsolutePath(node)
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
  const mounts = await listMounts()
  return [
    ...FILES_LOCATIONS,
    ...mounts.map((item) => ({
      id: item.id,
      label: item.label,
      writable: true as const,
    })),
  ]
}

export function getFilesLocationLabel(locationId: FilesLocationId): string {
  const builtin = FILES_LOCATIONS.find((item) => item.id === locationId)
  if (builtin) return builtin.label
  const mount = getCachedMount(locationId)
  return mount?.label ?? locationId
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

async function assertCanCreateIn(
  locationId: FilesLocationId,
  parentId: string | undefined,
): Promise<void> {
  assertLocationAllowsCreate(locationId)
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
  // 移入废纸篓的内部复制路径需经本检查创建节点，故不在此拦截。
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

function uniqueName(existingNames: ReadonlySet<string>, desired: string): string {
  if (!existingNames.has(desired)) return desired

  const lastDot = desired.lastIndexOf('.')
  const hasExt = lastDot > 0 && lastDot < desired.length - 1 && !desired.slice(lastDot + 1).includes(' ')
  const stem = hasExt ? desired.slice(0, lastDot) : desired
  const ext = hasExt ? desired.slice(lastDot) : ''

  let n = 2
  while (existingNames.has(`${stem} ${n}${ext}`)) {
    n += 1
  }
  return `${stem} ${n}${ext}`
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
}): Promise<FilesNode> {
  await assertCanCreateIn(params.locationId, params.parentId)
  const trimmed = normalizeFilesNodeName(params.name)

  const names = await siblingNames(params.locationId, params.parentId)
  const name = uniqueName(names, trimmed)

  if (isMountLocationId(params.locationId)) {
    const created = await mkdirMount({
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
    name,
    kind: 'folder',
    mimeType: undefined,
    byteSize: 0,
    createdAt: now,
    updatedAt: now,
    attributes: defaultFilesNodeAttributes(params.locationId),
  }
  const created = await createFolderNode({
    node,
    metaBytes: estimateNodeMetaBytes(node),
  })
  await emitNodeCreated(created)
  return created
}

export async function createTextFile(params: {
  locationId: FilesLocationId
  parentId: string | undefined
  name?: string
  text?: string
}): Promise<FilesNode> {
  await assertCanCreateIn(params.locationId, params.parentId)
  const desired = normalizeFilesNodeName((params.name ?? '未命名.txt').trim() || '未命名.txt')
  const names = await siblingNames(params.locationId, params.parentId)
  const name = uniqueName(names, desired)
  const text = params.text ?? ''
  const startedAt = performance.now()

  if (isMountLocationId(params.locationId)) {
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

  const now = osNowMs()
  const node: FilesNode = {
    id: newFilesNodeId(),
    locationId: params.locationId,
    parentId: params.parentId,
    name,
    kind: 'file',
    mimeType: FILES_TEXT_MIME,
    byteSize: 0,
    createdAt: now,
    updatedAt: now,
    attributes: defaultFilesNodeAttributes(params.locationId),
  }
  const created = await createFileWithBlob({
    node,
    text,
    metaBytes: estimateNodeMetaBytes(node),
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
}): Promise<FilesNode> {
  await assertCanCreateIn(params.locationId, params.parentId)
  const desired = normalizeFilesNodeName(params.name.trim() || '未命名.bin')
  const names = await siblingNames(params.locationId, params.parentId)
  const name = uniqueName(names, desired)
  const startedAt = performance.now()

  if (isMountLocationId(params.locationId)) {
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

  const now = osNowMs()
  const node: FilesNode = {
    id: newFilesNodeId(),
    locationId: params.locationId,
    parentId: params.parentId,
    name,
    kind: 'file',
    mimeType: params.mimeType ?? 'application/octet-stream',
    byteSize: 0,
    createdAt: now,
    updatedAt: now,
    attributes: defaultFilesNodeAttributes(params.locationId),
  }
  const created = await createFileWithBytes({
    node,
    bytes: params.bytes,
    metaBytes: estimateNodeMetaBytes(node),
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

  const names = await siblingNames(params.locationId, params.parentId)
  if (names.has(trimmedName)) {
    throw new Error('路径已存在')
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
  if (isMountLocationId(parsed.locationId)) {
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

  const { files, folders } = await listLocalVolumeSubtreeNodes(
    parsed.locationId,
    rootFolderId,
  )

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
  if (isMountLocationId(parsed.locationId)) {
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

export async function writeTextFile(ref: string, text: string): Promise<FilesNode> {
  const target = isFilesAbsolutePath(ref) ? await resolveFileRef(ref) : await getNodeOrThrow(ref)
  if (target.kind !== 'file') {
    throw new Error('文件不存在')
  }
  assertNodeWritable(target)
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

export async function writeBinaryFile(ref: string, bytes: ArrayBuffer): Promise<FilesNode> {
  const target = isFilesAbsolutePath(ref) ? await resolveFileRef(ref) : await getNodeOrThrow(ref)
  if (target.kind !== 'file') {
    throw new Error('文件不存在')
  }
  assertNodeWritable(target)

  const startedAt = performance.now()
  if (isMountNodeId(target.id)) {
    const written = await writeMountBlob(target.id, bytes)
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
 * 打开流式写（新建 / 覆盖）。挂载卷走 FSA 原生增量写；内部卷走分块 blob。
 * 新建时 open 即创建节点（byteSize 0），close 定稿、abort 回滚删除。
 * 覆盖时 abort 不影响旧内容，close 按 COW 切换。
 */
export async function openStreamWrite(params: {
  node: FilesNode
  isNew: boolean
  metaBytes: number
  previousByteSize: number
}): Promise<FilesStreamWriter> {
  const { node, isNew, metaBytes, previousByteSize } = params
  let writer: FilesStreamWriter
  // 按卷类型分发（新建占位节点 id 非 mount 前缀，须看 locationId）
  if (isMountLocationId(node.locationId)) {
    writer = await openMountStreamWrite({
      locationId: node.locationId as MountFilesLocationId,
      parentId: node.parentId,
      name: node.name,
      isNew,
    })
  } else {
    writer = await openStreamWriteBlob({ node, isNew, metaBytes, previousByteSize })
  }
  if (isNew) {
    // 新建文件立刻可见（byteSize 0），随 chunk 逐步长大；同时失效路径缓存，
    // 避免 open 前的「不存在」缓存残留导致流中/流后解析失败
    await emitNodeCreated(node)
  }
  return {
    write: (chunk) => writer.write(chunk),
    close: async () => {
      const startedAt = performance.now()
      const written = await writer.close()
      await emitNodeModified(written)
      recordFilesIoWrite(
        written,
        written.byteSize,
        'streamWrite',
        performance.now() - startedAt,
      )
      return written
    },
    abort: async () => {
      await writer.abort()
      if (isNew) {
        // 新建文件回滚删除：通知 watch / 清路径缓存
        const path = await resolveFilesAbsolutePath(node)
        emitFilesVfsChanged({ kind: 'deleted', path })
      }
    },
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
  const names = await siblingNames(node.locationId, node.parentId, node.id)
  const name = uniqueName(names, trimmed)

  if (isMountNodeId(id)) {
    const renamed = await renameMountNode(id, name)
    const path = await resolveFilesAbsolutePath(renamed)
    emitFilesVfsChanged({ kind: 'renamed', path, previousPath })
    return renamed
  }

  const before = estimateNodeMetaBytes(node)
  const after = estimateNodeMetaBytes({ ...node, name })
  const renamed = await renameNodeRecord({
    id,
    name,
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
    const sub = await estimateCopyWorkloadForNode(child)
    nodeCount += sub.nodeCount
    byteSize += sub.byteSize
  }
  return { nodeCount, byteSize }
}

export async function estimateDeleteWorkload(nodeId: string): Promise<FilesDeleteWorkload> {
  if (isMountNodeId(nodeId)) {
    return { nodeCount: 1, byteSize: 0, totalUnits: 1 }
  }
  const subtree = await collectSubtreeIds(nodeId)
  return {
    nodeCount: subtree.nodeIds.length,
    byteSize: subtree.reclaimBytes,
    totalUnits: filesWorkloadUnits(subtree.nodeIds.length, subtree.reclaimBytes),
  }
}

async function deleteLocalSubtreeWithProgress(
  subtree: Awaited<ReturnType<typeof collectSubtreeIds>>,
  onProgress?: (progress: FilesVfsOpProgress) => void,
): Promise<void> {
  const total = filesWorkloadUnits(subtree.nodeIds.length, subtree.reclaimBytes)
  onProgress?.({ done: 0, total })

  if (subtree.nodeIds.length <= LARGE_SUBTREE_DELETE_THRESHOLD) {
    await deleteSubtree(subtree)
    onProgress?.({ done: total, total })
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
    await deleteSubtree({
      nodeIds: nodeChunk,
      fileIds: fileChunk,
      reclaimBytes: reclaimChunk,
    })
    onProgress?.({ done, total })
  }
  onProgress?.({ done: total, total })
}

export async function removeNode(
  id: string,
  options?: { onProgress?: (progress: FilesVfsOpProgress) => void },
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
  options?: { onProgress?: (progress: FilesVfsOpProgress) => void },
): Promise<void> {
  const node = await getNodeOrThrow(id)
  await removeNodeInner(node, options)
}

/**
 * 元数据级移动是否可行：源与目标均为 IndexedDB 本地卷（不涉及挂载）。
 */
function canMoveNodeMetadataOnly(source: FilesNode, destLocationId: FilesLocationId): boolean {
  if (isMountNodeId(source.id)) return false
  if (isMountLocationId(destLocationId)) return false
  return source.locationId === destLocationId
}

export type FilesMoveNodeToOptions = {
  onProgress?: (progress: FilesVfsOpProgress) => void
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

  if (canMoveNodeMetadataOnly(source, destLocationId)) {
    const previousPath = await resolveFilesAbsolutePath(source)
    const names = await siblingNames(destLocationId, destParentId, source.id)
    const name = uniqueName(names, source.name)
    const moved = await moveNodeRecord({
      id: source.id,
      locationId: destLocationId,
      parentId: destParentId,
      name,
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
  })
  await removeNode(sourceId)
  return copied
}

/**
 * 将节点移入废纸篓（可恢复，记录原位置）。
 * 内部卷为元数据级移动（零拷贝零容量）；挂载卷复制进废纸篓后删除原文件
 * （占 IDB 配额，容量不足时抛错并建议用永久删除）。
 */
export async function trashNode(
  id: string,
  options?: FilesMoveNodeToOptions,
): Promise<FilesNode> {
  const node = await getNodeOrThrow(id)
  if (isTrashLocationId(node.locationId)) {
    throw new Error('该节点已在废纸篓中')
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

  if (isMountNodeId(id)) {
    // 跨存储：复制进废纸篓（预检配额），成功后删除挂载原件
    const previousPath = await resolveFilesAbsolutePath(node)
    const needed = await estimateCopyBytesForNode(node, 'trash')
    await assertAdditionalBytesAvailable(needed)
    const workload = await estimateCopyWorkloadForNode(node)
    const total = filesWorkloadUnits(workload.nodeCount, workload.byteSize)
    const progressState = { done: 0 }
    options?.onProgress?.({ done: 0, total })
    let copied: FilesNode
    try {
      copied = await copyNodeTree(node, 'trash', undefined, (copyNode) => {
        progressState.done = Math.min(total, progressState.done + nodeWorkloadUnits(copyNode))
        options?.onProgress?.({ done: progressState.done, total })
      })
    } catch (err) {
      if (err instanceof FilesStorageFullError) {
        throw new Error('数据空间不足，无法移入废纸篓。按住 ⌥ 键删除可直接永久删除')
      }
      throw err
    }
    const withOrigin = await moveNodeRecord({
      id: copied.id,
      locationId: 'trash',
      parentId: undefined,
      name: copied.name,
      trashOrigin,
    })
    await removeMountNode(id)
    options?.onProgress?.({ done: total, total })
    emitFilesVfsChanged([
      { kind: 'deleted', path: previousPath },
      { kind: 'created', path: await resolveFilesAbsolutePath(withOrigin) },
    ])
    return withOrigin
  }

  const previousPath = await resolveFilesAbsolutePath(node)
  const names = await siblingNames('trash', undefined)
  const name = uniqueName(names, node.name)
  const moved = await moveNodeRecord({
    id,
    locationId: 'trash',
    parentId: undefined,
    name,
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

  const names = await siblingNames(origin.locationId, destParentId, id)
  const name = uniqueName(names, origin.name)

  if (isMountLocationId(origin.locationId)) {
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
    name,
  })
  const path = await resolveFilesAbsolutePath(restored)
  emitFilesVfsChanged({ kind: 'renamed', path, previousPath })
  return restored
}

/** 清空废纸篓：永久删除其中全部内容（释放容量，带进度） */
export async function emptyTrash(
  options?: { onProgress?: (progress: FilesVfsOpProgress) => void },
): Promise<void> {
  const roots = await listDirectory('trash', undefined)
  let done = 0
  const total = roots.length
  options?.onProgress?.({ done: 0, total })
  for (const root of roots) {
    await removeNodeForced(root.id)
    done += 1
    options?.onProgress?.({ done, total })
  }
  options?.onProgress?.({ done: total, total })
}

async function removeNodeInner(
  node: FilesNode,
  options?: { onProgress?: (progress: FilesVfsOpProgress) => void },
): Promise<void> {
  const id = node.id
  const path = await resolveFilesAbsolutePath(node)
  if (isMountNodeId(id)) {
    options?.onProgress?.({ done: 0, total: 1 })
    await removeMountNode(id)
    options?.onProgress?.({ done: 1, total: 1 })
    emitFilesVfsChanged({ kind: 'deleted', path })
    return
  }
  const subtree = await collectSubtreeIds(id)
  await deleteLocalSubtreeWithProgress(subtree, options?.onProgress)
  emitFilesVfsChanged({ kind: 'deleted', path })
}

/**
 * 按绝对路径批量删除本地卷节点；挂载路径单独走 removeMountNode。
 * 合并子树收集与 IndexedDB 删除事务；默认 skipMissing 为 false。
 */
export async function removeNodesByPathsBatch(
  paths: readonly string[],
  options?: FilesRemoveBatchOptions,
): Promise<void> {
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
    const parsed = parseFilesAbsolutePath(absolutePath)
    if (!parsed || parsed.segments.length === 0) {
      throw new Error('不能删除卷根')
    }
    if (isMountLocationId(parsed.locationId)) {
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
    await removeMountNode(mount.id)
  }

  if (localRootIds.length > 0) {
    const merged = await collectSubtreesBatch(localRootIds)
    await deleteSubtreesMerged(merged, { batchSize })
  }

  if (deletedPaths.length > 0) {
    emitFilesVfsChanged(deletedPaths.map((path) => ({ kind: 'deleted' as const, path })))
  }
}

export async function getNodeOrThrow(id: string): Promise<FilesNode> {
  if (isMountNodeId(id)) {
    const node = await getMountNode(id)
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
    const { blob } = await readFileBlobByNodeIdUnmetered(node.id)
    return estimateNodeMetaBytes(node) + blob.size
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

  const usesLocalQuota = !isMountLocationId(params.destLocationId)
  if (usesLocalQuota) {
    const needed = await estimateCopyBytesForNode(source, params.destLocationId)
    await assertAdditionalBytesAvailable(needed)
  }

  const workload = await estimateCopyWorkloadForNode(source)
  const total = filesWorkloadUnits(workload.nodeCount, workload.byteSize)
  const progressState = { done: 0 }
  params.onProgress?.({ done: 0, total })

  const reportNodeDone = (node: FilesNode) => {
    progressState.done = Math.min(total, progressState.done + nodeWorkloadUnits(node))
    params.onProgress?.({ done: progressState.done, total })
  }

  const result = await copyNodeTree(source, params.destLocationId, params.destParentId, reportNodeDone)
  params.onProgress?.({ done: total, total })
  return result
}

/** IndexedDB 本地卷之间复制文件时可共享 blob（写时复制） */
function canShareBlobOnCopy(source: FilesNode, destLocationId: FilesLocationId): boolean {
  if (isMountLocationId(destLocationId)) return false
  if (isMountNodeId(source.id)) return false
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
  const names = await siblingNames(destLocationId, destParentId)
  const name = uniqueName(names, desired)
  const now = osNowMs()
  const node: FilesNode = {
    id: newFilesNodeId(),
    locationId: destLocationId,
    parentId: destParentId,
    name,
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
  })
  await emitNodeCreated(created)
  return created
}

async function copyNodeTree(
  source: FilesNode,
  destLocationId: FilesLocationId,
  destParentId: string | undefined,
  reportNodeDone: (node: FilesNode) => void,
): Promise<FilesNode> {
  if (source.kind === 'file') {
    if (canShareBlobOnCopy(source, destLocationId)) {
      const created = await cloneSharedLocalFile(source, destLocationId, destParentId)
      reportNodeDone(source)
      return created
    }

    const { node, blob } = await readFileBlobByNodeId(source.id)
    const bytes = await blob.arrayBuffer()
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
  for (const child of children) {
    await copyNodeTree(child, destLocationId, folder.id, reportNodeDone)
  }
  return folder
}

export type FilesUpsertBatchItem =
  | { path: string; text: string }
  | { path: string; bytes: ArrayBuffer }

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
    if (isMountLocationId(parsed.locationId)) {
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

    if (existing) {
      assertNodeWritable(existing)
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
  return results
}

export { isFilesAbsolutePath } from './files-path.ts'
export { FILES_BATCH_DEFAULT_MAX_BYTES, FILES_BATCH_DEFAULT_SIZE } from './files-storage.ts'
