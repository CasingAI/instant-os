/**
 * 系统文件统一 API：一律以全局绝对路径为句柄。
 * 内置应用与第三方桥接共用此门面；底层仍走 files-vfs。
 *
 * 路径约定：
 * - `/` — 命名空间根（虚拟）：下列出各卷，不可写入
 * - `/user` · `/dev` · `/tmp` · `/models` · `/system` · `/mount/{文件夹名}` — 各卷根
 */
import { osNowMs } from '../../os/os-clock.ts'
import {
  filesLocationPathRoot,
  isFilesNamespaceRoot,
  joinFilesAbsolutePath,
  normalizeFilesNodeName,
  parseFilesAbsolutePath,
} from './files-path.ts'
import {
  filesVolumeRootAttributes,
  isFilesNodeWritable,
  defaultFilesNodeAttributes,
  isTrashLocationId,
  type FilesLocationId,
  type FilesNode,
} from './files-types.ts'
import { estimateNodeMetaBytes, newFilesNodeId } from './files-storage.ts'
import {
  copyNodeTo,
  createBinaryFile,
  createTextFile,
  emptyTrash,
  getFilesLocationLabel,
  listDirectory,
  listFilesLocations,
  listSubtreeFiles,
  backfillSubtreeContentRevisionIds,
  mkdir,
  openStreamWrite,
  readFileBlob,
  readTextFile,
  readlinkAtAbsolutePath,
  createSymlink,
  removeNode,
  removeNodesByPathsBatch,
  renameNode,
  restoreNode,
  resolveFilesAbsolutePath,
  resolveNodeByAbsolutePath,
  readTextFileIfSmall,
  trashNode,
  upsertFilesBatch,
  writeBinaryFile,
  writeTextFile,
  type FilesSubtreeFileEntry,
  type FilesUpsertBatchItem,
  type FilesRemoveBatchOptions,
  type FilesStreamWriter,
} from './files-vfs.ts'

export type { FilesStreamWriter }

export type { FilesUpsertBatchItem, FilesSubtreeFileEntry, FilesRemoveBatchOptions }
import {
  subscribeFilesWatch,
  type FilesWatchChange,
  type FilesWatchListener,
  type FilesWatchOptions,
} from './files-watch.ts'

export type { FilesWatchChange, FilesWatchListener, FilesWatchOptions }
import type { ArchiveCodecFormat } from '../../archive/archive-codec.ts'
import type { ArchiveMaterializeProgress } from '../../archive/archive-materialize.ts'

export type FilesApiEntry = {
  path: string
  name: string
  kind: 'file' | 'folder' | 'symlink'
  mimeType?: string
  byteSize: number
  createdAt: number
  updatedAt: number
  /** 内容版本戳；仅文件有意义，旧记录可能缺省 */
  contentRevisionId?: string
  /** 符号链接目标；仅 kind=symlink 时由 lstat 等暴露 */
  target?: string
  writable: boolean
}

export type FilesApiVolume = {
  path: string
  label: string
  writable: boolean
}

function assertAbsolutePath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed.startsWith('/')) {
    throw new Error('路径必须是以 / 开头的全局绝对路径')
  }
  return trimmed.replace(/\/+$/, '') || '/'
}

async function toEntry(node: FilesNode, pathOverride?: string): Promise<FilesApiEntry> {
  const entry: FilesApiEntry = {
    path: pathOverride ?? (await resolveFilesAbsolutePath(node)),
    name: node.name,
    kind: node.kind,
    mimeType: node.mimeType,
    byteSize: node.byteSize,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    writable: isFilesNodeWritable(node),
  }
  if (node.contentRevisionId !== undefined) {
    entry.contentRevisionId = node.contentRevisionId
  }
  if (node.kind === 'symlink' && node.target !== undefined) {
    entry.target = node.target
  }
  return entry
}

function namespaceRootEntry(): FilesApiEntry {
  return {
    path: '/',
    name: '/',
    kind: 'folder',
    mimeType: undefined,
    byteSize: 0,
    createdAt: 0,
    updatedAt: 0,
    writable: false,
  }
}

function volumeRootEntry(locationId: FilesLocationId): FilesApiEntry {
  const path = filesLocationPathRoot(locationId)
  const label = getFilesLocationLabel(locationId)
  const rootAttributes = filesVolumeRootAttributes(locationId)
  return {
    path,
    name: label,
    kind: 'folder',
    mimeType: undefined,
    byteSize: 0,
    createdAt: 0,
    updatedAt: 0,
    writable: rootAttributes.writable,
  }
}

/** 命名空间根下展示的卷条目：name 用路径去掉前导 /（如 user、mount/abcd1234） */
function volumeChildOfNamespaceRoot(volume: FilesApiVolume): FilesApiEntry {
  return {
    path: volume.path,
    name: volume.path.replace(/^\//, '') || volume.label,
    kind: 'folder',
    mimeType: undefined,
    byteSize: 0,
    createdAt: 0,
    updatedAt: 0,
    writable: volume.writable,
  }
}

async function resolveParentForCreate(absolutePath: string): Promise<{
  locationId: FilesLocationId
  parentId: string | undefined
  name: string
}> {
  if (isFilesNamespaceRoot(absolutePath)) {
    throw new Error('不能在命名空间根 / 上创建')
  }
  const parsed = parseFilesAbsolutePath(absolutePath)
  if (!parsed) {
    throw new Error('路径无效')
  }
  if (parsed.segments.length === 0) {
    throw new Error('不能在卷根路径上直接创建')
  }
  if (isTrashLocationId(parsed.locationId)) {
    throw new Error('废纸篓不接受新建或写入，请使用删除操作')
  }

  const name = normalizeFilesNodeName(parsed.segments[parsed.segments.length - 1] ?? '')
  const parentSegments = parsed.segments.slice(0, -1)
  if (parentSegments.length === 0) {
    return { locationId: parsed.locationId, parentId: undefined, name }
  }

  const parentPath = joinFilesAbsolutePath(
    filesLocationPathRoot(parsed.locationId),
    ...parentSegments,
  )
  const parent = await resolveNodeByAbsolutePath(parentPath, { follow: true })
  if (!parent || parent.kind !== 'folder') {
    throw new Error(`父文件夹不存在：${parentPath}`)
  }
  return { locationId: parsed.locationId, parentId: parent.id, name }
}

/** 列出已挂载/内置卷 */
export async function filesListVolumes(): Promise<FilesApiVolume[]> {
  const locations = await listFilesLocations()
  return locations.map((location) => ({
    path: filesLocationPathRoot(location.id),
    label: location.label,
    writable: location.writable,
  }))
}

/** 列出目录内容；`/` 为命名空间根（各卷），也可为卷根如 `/user` */
export async function filesList(dirPath: string): Promise<FilesApiEntry[]> {
  const absolutePath = assertAbsolutePath(dirPath)
  if (isFilesNamespaceRoot(absolutePath)) {
    const volumes = await filesListVolumes()
    return volumes.map(volumeChildOfNamespaceRoot)
  }

  const parsed = parseFilesAbsolutePath(absolutePath)
  if (!parsed) {
    throw new Error('路径无效')
  }

  if (parsed.segments.length === 0) {
    const children = await listDirectory(parsed.locationId, undefined)
    return Promise.all(children.map((child) => toEntry(child)))
  }

  const node = await resolveNodeByAbsolutePath(absolutePath, { follow: true })
  if (!node) {
    throw new Error('文件夹不存在')
  }
  if (node.kind !== 'folder') {
    throw new Error('不是文件夹')
  }
  const children = await listDirectory(node.locationId, node.id)
  return Promise.all(children.map((child) => toEntry(child)))
}

/**
 * 一次事务列出本地卷目录下全部文件元数据（含 contentRevisionId）。
 * 仅支持 IndexedDB 本地卷（local / repo）。
 */
export async function filesListSubtreeFiles(
  rootPath: string,
): Promise<FilesSubtreeFileEntry[]> {
  return listSubtreeFiles(assertAbsolutePath(rootPath))
}

/** 对本地卷子树内缺 contentRevisionId 的文件节点批量补齐 */
export async function filesBackfillSubtreeContentRevisionIds(
  rootPath: string,
): Promise<number> {
  return backfillSubtreeContentRevisionIds(assertAbsolutePath(rootPath))
}

/** 查询路径对应条目（跟随符号链接，对齐 Node `stat`） */
export async function filesStat(path: string): Promise<FilesApiEntry | undefined> {
  const absolutePath = assertAbsolutePath(path)
  if (isFilesNamespaceRoot(absolutePath)) {
    return namespaceRootEntry()
  }

  const parsed = parseFilesAbsolutePath(absolutePath)
  if (!parsed) return undefined

  if (parsed.segments.length === 0) {
    return volumeRootEntry(parsed.locationId)
  }

  const node = await resolveNodeByAbsolutePath(absolutePath, { follow: true })
  if (!node) return undefined
  return toEntry(node, absolutePath)
}

/** 不跟随符号链接的 stat（对齐 Node `lstat`） */
export async function filesLstat(path: string): Promise<FilesApiEntry | undefined> {
  const absolutePath = assertAbsolutePath(path)
  if (isFilesNamespaceRoot(absolutePath)) {
    return namespaceRootEntry()
  }

  const parsed = parseFilesAbsolutePath(absolutePath)
  if (!parsed) return undefined

  if (parsed.segments.length === 0) {
    return volumeRootEntry(parsed.locationId)
  }

  const node = await resolveNodeByAbsolutePath(absolutePath, { follow: false })
  if (!node) return undefined
  return toEntry(node, absolutePath)
}

/** 创建符号链接（第一期仅 `/user` / `/dev`） */
export async function filesSymlink(target: string, linkPath: string): Promise<FilesApiEntry> {
  const absolutePath = assertAbsolutePath(linkPath)
  const existing = await resolveNodeByAbsolutePath(absolutePath, { follow: false })
  if (existing) {
    throw new Error('路径已存在')
  }
  const parent = await resolveParentForCreate(absolutePath)
  const node = await createSymlink({
    locationId: parent.locationId,
    parentId: parent.parentId,
    name: parent.name,
    target,
  })
  return toEntry(node, absolutePath)
}

/** 读取符号链接目标字符串 */
export async function filesReadlink(path: string): Promise<string> {
  const absolutePath = assertAbsolutePath(path)
  return readlinkAtAbsolutePath(absolutePath)
}

export async function filesReadText(path: string): Promise<string> {
  const absolutePath = assertAbsolutePath(path)
  if (isFilesNamespaceRoot(absolutePath)) {
    throw new Error('不能读取命名空间根')
  }
  const { text } = await readTextFile(absolutePath)
  return text
}

/**
 * 读取文本，但仅当文件大小不超过 maxBytes；超出（或不可读）返回 undefined。
 * 供搜索等场景先探大小再读，避免大文件整读进内存。
 */
export async function filesReadTextIfSmall(
  path: string,
  maxBytes: number,
): Promise<string | undefined> {
  const absolutePath = assertAbsolutePath(path)
  if (isFilesNamespaceRoot(absolutePath)) {
    throw new Error('不能读取命名空间根')
  }
  return readTextFileIfSmall(absolutePath, maxBytes)
}

/** 读取文件二进制内容 */
export async function filesReadBlob(path: string): Promise<Blob> {
  const absolutePath = assertAbsolutePath(path)
  if (isFilesNamespaceRoot(absolutePath)) {
    throw new Error('不能读取命名空间根')
  }
  const { blob } = await readFileBlob(absolutePath)
  return blob
}

/** 覆写已存在的文本文件 */
export async function filesWriteText(path: string, text: string): Promise<FilesApiEntry> {
  const absolutePath = assertAbsolutePath(path)
  if (isFilesNamespaceRoot(absolutePath)) {
    throw new Error('不能写入命名空间根')
  }
  const node = await writeTextFile(absolutePath, text)
  return toEntry(node)
}

/** 创建文件夹（父目录须已存在；路径为新文件夹的完整路径） */
export async function filesMkdir(path: string): Promise<FilesApiEntry> {
  const absolutePath = assertAbsolutePath(path)
  const existing = await resolveNodeByAbsolutePath(absolutePath, { follow: false })
  if (existing) {
    throw new Error('路径已存在')
  }
  const target = await resolveParentForCreate(absolutePath)
  const node = await mkdir({
    locationId: target.locationId,
    parentId: target.parentId,
    name: target.name,
  })
  return toEntry(node)
}

/** 创建新文本文件（不可覆盖已有路径） */
export async function filesCreateText(path: string, text = ''): Promise<FilesApiEntry> {
  const absolutePath = assertAbsolutePath(path)
  const existing = await resolveNodeByAbsolutePath(absolutePath, { follow: false })
  if (existing) {
    throw new Error('路径已存在')
  }
  const target = await resolveParentForCreate(absolutePath)
  const node = await createTextFile({
    locationId: target.locationId,
    parentId: target.parentId,
    name: target.name,
    text,
  })
  return toEntry(node)
}

/** 创建新二进制文件（不可覆盖已有路径） */
export async function filesCreateBinary(
  path: string,
  bytes: ArrayBuffer,
  mimeType?: string,
): Promise<FilesApiEntry> {
  const absolutePath = assertAbsolutePath(path)
  const existing = await resolveNodeByAbsolutePath(absolutePath, { follow: false })
  if (existing) {
    throw new Error('路径已存在')
  }
  const target = await resolveParentForCreate(absolutePath)
  const node = await createBinaryFile({
    locationId: target.locationId,
    parentId: target.parentId,
    name: target.name,
    bytes,
    mimeType,
  })
  return toEntry(node)
}

/**
 * 打开流式写（新建 / 覆盖）：`write(chunk)` 逐块落盘（内存 O(chunk)），
 * `close()` 定稿、`abort()` 回滚。新建时文件立刻可见（byteSize 0）并逐步长大。
 */
export async function filesOpenStreamWrite(path: string): Promise<FilesStreamWriter> {
  const absolutePath = assertAbsolutePath(path)
  if (isFilesNamespaceRoot(absolutePath)) {
    throw new Error('不能写入命名空间根')
  }
  const parsed = parseFilesAbsolutePath(absolutePath)
  if (!parsed || parsed.segments.length === 0) {
    throw new Error('不能写入卷根')
  }

  const existing = await resolveNodeByAbsolutePath(absolutePath, { follow: true })
  if (existing) {
    if (existing.kind !== 'file') {
      throw new Error(existing.kind === 'folder' ? '不能写入文件夹' : '不能写入符号链接')
    }
    if (!isFilesNodeWritable(existing)) {
      throw new Error('此文件为只读，无法修改')
    }
    return openStreamWrite({
      node: existing,
      isNew: false,
      metaBytes: 0,
      previousByteSize: existing.byteSize,
    })
  }

  const target = await resolveParentForCreate(absolutePath)
  const now = osNowMs()
  const node: FilesNode = {
    id: newFilesNodeId(),
    locationId: target.locationId,
    parentId: target.parentId,
    name: target.name,
    kind: 'file',
    mimeType: undefined,
    byteSize: 0,
    createdAt: now,
    updatedAt: now,
    attributes: defaultFilesNodeAttributes(target.locationId),
  }
  return openStreamWrite({
    node,
    isNew: true,
    metaBytes: estimateNodeMetaBytes(node),
    previousByteSize: 0,
  })
}

/** 覆写已存在的二进制文件 */
export async function filesWriteBinary(path: string, bytes: ArrayBuffer): Promise<FilesApiEntry> {
  const absolutePath = assertAbsolutePath(path)
  if (isFilesNamespaceRoot(absolutePath)) {
    throw new Error('不能写入命名空间根')
  }
  const node = await writeBinaryFile(absolutePath, bytes)
  return toEntry(node)
}

/**
 * 批量 upsert 本地卷文件：路径不存在则创建、存在则覆写；自动创建缺失父目录。
 * 底层按批提交 IndexedDB 事务（默认最多 64 条，且内容合计不超过约 4 MiB）。
 */
export async function filesUpsertBatch(
  items: readonly FilesUpsertBatchItem[],
  options?: { batchSize?: number; maxBatchBytes?: number },
): Promise<FilesApiEntry[]> {
  const normalized = items.map((item) => {
    const path = assertAbsolutePath(item.path)
    if (isFilesNamespaceRoot(path)) {
      throw new Error('不能写入命名空间根')
    }
    if ('text' in item) return { path, text: item.text }
    return { path, bytes: item.bytes }
  })
  const nodes = await upsertFilesBatch(normalized, options)
  return Promise.all(nodes.map((node) => toEntry(node)))
}

/**
 * 批量删除本地卷路径；不存在时 skipMissing 为 true 则跳过。
 * 底层合并子树收集与 IndexedDB 删除事务（默认按 64 分块）。
 */
export async function filesRemoveBatch(
  paths: readonly string[],
  options?: FilesRemoveBatchOptions,
): Promise<void> {
  const normalized = paths.map((path) => {
    const absolutePath = assertAbsolutePath(path)
    if (isFilesNamespaceRoot(absolutePath)) {
      throw new Error('不能删除命名空间根')
    }
    const parsed = parseFilesAbsolutePath(absolutePath)
    if (!parsed || parsed.segments.length === 0) {
      throw new Error('不能删除卷根')
    }
    return absolutePath
  })
  await removeNodesByPathsBatch(normalized, options)
}

export async function filesRename(path: string, nextName: string): Promise<FilesApiEntry> {
  const absolutePath = assertAbsolutePath(path)
  if (isFilesNamespaceRoot(absolutePath)) {
    throw new Error('不能重命名命名空间根')
  }
  const parsed = parseFilesAbsolutePath(absolutePath)
  if (!parsed || parsed.segments.length === 0) {
    throw new Error('不能重命名卷根')
  }
  const node = await resolveNodeByAbsolutePath(absolutePath, { follow: false })
  if (!node) {
    throw new Error('项目不存在')
  }
  const renamed = await renameNode(node.id, nextName)
  return toEntry(renamed)
}

export async function filesRemove(path: string): Promise<void> {
  const absolutePath = assertAbsolutePath(path)
  if (isFilesNamespaceRoot(absolutePath)) {
    throw new Error('不能删除命名空间根')
  }
  const parsed = parseFilesAbsolutePath(absolutePath)
  if (!parsed || parsed.segments.length === 0) {
    throw new Error('不能删除卷根')
  }
  const node = await resolveNodeByAbsolutePath(absolutePath, { follow: false })
  if (!node) {
    throw new Error('项目不存在')
  }
  await removeNode(node.id)
}

/**
 * 将源文件/文件夹复制到目标目录（同名自动加后缀）。
 * `destDirPath` 须为已存在的文件夹或卷根。
 */
export async function filesCopy(sourcePath: string, destDirPath: string): Promise<FilesApiEntry> {
  const sourceAbs = assertAbsolutePath(sourcePath)
  const destAbs = assertAbsolutePath(destDirPath)

  if (isFilesNamespaceRoot(sourceAbs)) {
    throw new Error('不能复制命名空间根')
  }
  if (isFilesNamespaceRoot(destAbs)) {
    throw new Error('不能复制到命名空间根；请指定卷路径如 /user')
  }

  const sourceParsed = parseFilesAbsolutePath(sourceAbs)
  if (!sourceParsed || sourceParsed.segments.length === 0) {
    throw new Error('不能复制卷根')
  }
  const sourceNode = await resolveNodeByAbsolutePath(sourceAbs)
  if (!sourceNode) {
    throw new Error('源路径不存在')
  }

  const destParsed = parseFilesAbsolutePath(destAbs)
  if (!destParsed) {
    throw new Error('目标路径无效')
  }

  let destLocationId: FilesLocationId
  let destParentId: string | undefined

  if (destParsed.segments.length === 0) {
    destLocationId = destParsed.locationId
    destParentId = undefined
  } else {
    const destNode = await resolveNodeByAbsolutePath(destAbs)
    if (!destNode) {
      throw new Error('目标文件夹不存在')
    }
    if (destNode.kind !== 'folder') {
      throw new Error('目标不是文件夹')
    }
    destLocationId = destNode.locationId
    destParentId = destNode.id
  }

  const copied = await copyNodeTo({
    sourceId: sourceNode.id,
    destLocationId,
    destParentId,
  })
  return toEntry(copied)
}

/**
 * 移动：同目录改名用 rename；跨目录则复制到目标目录后删除源。
 * `destDirPath` 须为已存在的文件夹或卷根（保留源名称）。
 */
export async function filesMove(sourcePath: string, destDirPath: string): Promise<FilesApiEntry> {
  const sourceAbs = assertAbsolutePath(sourcePath)
  const destAbs = assertAbsolutePath(destDirPath)

  if (isFilesNamespaceRoot(sourceAbs)) {
    throw new Error('不能移动命名空间根')
  }
  if (isFilesNamespaceRoot(destAbs)) {
    throw new Error('不能移动到命名空间根；请指定卷路径如 /user')
  }

  const sourceParsed = parseFilesAbsolutePath(sourceAbs)
  if (!sourceParsed || sourceParsed.segments.length === 0) {
    throw new Error('不能移动卷根')
  }
  const sourceNode = await resolveNodeByAbsolutePath(sourceAbs)
  if (!sourceNode) {
    throw new Error('源路径不存在')
  }

  const destParsed = parseFilesAbsolutePath(destAbs)
  if (!destParsed) {
    throw new Error('目标路径无效')
  }

  const sourceParentPath =
    sourceParsed.segments.length <= 1
      ? filesLocationPathRoot(sourceParsed.locationId)
      : joinFilesAbsolutePath(
          filesLocationPathRoot(sourceParsed.locationId),
          ...sourceParsed.segments.slice(0, -1),
        )

  if (assertAbsolutePath(sourceParentPath) === destAbs) {
    return toEntry(sourceNode)
  }

  const copied = await filesCopy(sourceAbs, destAbs)
  await filesRemove(sourceAbs)
  return copied
}

/**
 * 订阅某绝对路径（文件或目录）的 VFS 变更。
 * 仅覆盖经本系统文件 API / VFS 的同源写入；默认递归匹配子孙。
 */
export function filesWatch(
  path: string,
  listener: FilesWatchListener,
  options?: FilesWatchOptions,
): () => void {
  return subscribeFilesWatch(assertAbsolutePath(path), listener, options)
}

/**
 * 将节点移入废纸篓（可恢复）。
 * 返回废纸篓中的新节点；内部卷为零拷贝移动，挂载卷为复制进废纸篓。
 */
export async function filesTrash(sourcePath: string): Promise<FilesApiEntry> {
  const sourceAbs = assertAbsolutePath(sourcePath)
  const node = await resolveNodeByAbsolutePath(sourceAbs)
  if (!node) {
    throw new Error('源路径不存在')
  }
  if (isFilesNamespaceRoot(sourceAbs)) {
    throw new Error('不能将命名空间根移入废纸篓')
  }
  if (parseFilesAbsolutePath(sourceAbs)?.segments.length === 0) {
    throw new Error('不能将卷根移入废纸篓')
  }
  const trashed = await trashNode(node.id)
  return toEntry(trashed)
}

/** 将废纸篓中的节点恢复到原位置（原位置缺失时恢复至原卷根） */
export async function filesRestore(path: string): Promise<FilesApiEntry> {
  const absolutePath = assertAbsolutePath(path)
  const node = await resolveNodeByAbsolutePath(absolutePath)
  if (!node) {
    throw new Error('路径不存在')
  }
  const restored = await restoreNode(node.id)
  return toEntry(restored)
}

/** 清空废纸篓：永久删除其中全部内容（释放容量） */
export async function filesEmptyTrash(): Promise<void> {
  await emptyTrash()
}

// ---- 压缩包解压 / 创建（编解码在独立 Archive Worker 线程，主线程只做 VFS 读写） ----

export type FilesArchiveFormat = 'auto' | ArchiveCodecFormat

export type FilesExtractArchiveProgress = ArchiveMaterializeProgress

export type FilesCreateArchiveProgress = {
  /** 已读取的文件数（主线程读 VFS 阶段） */
  readCount: number
  totalCount: number
  currentPath?: string
}

function parentAbsolutePathOf(path: string): string {
  const trimmed = path.replace(/\/+$/, '') || '/'
  const slash = trimmed.lastIndexOf('/')
  return slash <= 0 ? '/' : trimmed.slice(0, slash)
}

/** 把 Worker 侧的解码错误映射为与解压工具一致的友好文案；abort 原样透传。 */
function toFriendlyArchiveError(format: FilesArchiveFormat, error: unknown): Error {
  if (error instanceof Error && error.message === 'aborted') return error
  switch (format) {
    case 'zip':
      return new Error('无法解析 ZIP（文件可能已损坏）')
    case 'gzip-tar':
      return new Error('无法解析该 tar.gz 压缩包（文件可能已损坏）')
    case 'tar':
      return new Error('无法解析该 tar 归档（文件可能已损坏）')
    case 'gzip-file':
      return new Error('无法解压该 gzip 文件（文件可能已损坏）')
    default:
      return error instanceof Error ? error : new Error('无法解析压缩包（文件可能已损坏或格式不受支持）')
  }
}

/**
 * 在独立 Worker 线程中解码压缩包字节（zip / tar / gzip-tar / 单文件 gzip）。
 * 返回相对路径 → 字节；zip 默认剥公共根（stripRoot: false 保留归档内路径）。
 * 入参 bytes 会被复制后转移给 Worker，调用方持有的视图不受影响。
 */
export async function filesDecodeArchive(params: {
  bytes: Uint8Array
  format?: FilesArchiveFormat
  stripRoot?: boolean
  signal?: AbortSignal
}): Promise<Map<string, Uint8Array>> {
  const format = params.format ?? 'auto'
  // 动态 import：worker 客户端含 Vite 专用 `?worker` 静态导入，node 测试
  // 加载本模块时不可解析；浏览器调用时才执行到这里
  const { decodeArchiveInWorker } = await import('../../archive/archive-worker-client.ts')
  try {
    return await decodeArchiveInWorker({
      bytes: params.bytes,
      format,
      stripRoot: params.stripRoot,
      signal: params.signal,
    })
  } catch (error) {
    throw toFriendlyArchiveError(format, error)
  }
}

/**
 * 解压压缩包到目录：主线程读归档 + Worker 解码 + 分批落盘（进度回调）。
 * 目标目录须已存在；`transformEntries` 可在落盘前改写条目（如冲突重命名）。
 */
export async function filesExtractArchive(params: {
  archivePath: string
  destDirPath: string
  format?: FilesArchiveFormat
  stripRoot?: boolean
  transformEntries?: (
    entries: Map<string, Uint8Array>,
  ) => Map<string, Uint8Array> | Promise<Map<string, Uint8Array>>
  signal?: AbortSignal
  onProgress?: (progress: FilesExtractArchiveProgress) => void
}): Promise<{ fileCount: number; bytesWritten: number }> {
  const absolutePath = assertAbsolutePath(params.archivePath)
  const destRoot = assertAbsolutePath(params.destDirPath)
  if (isFilesNamespaceRoot(absolutePath)) {
    throw new Error('不能读取命名空间根')
  }

  const node = await resolveNodeByAbsolutePath(absolutePath, { follow: true })
  if (!node || node.kind !== 'file') {
    throw new Error('找不到压缩包')
  }
  if (node.byteSize === 0) {
    throw new Error('文件是空的，不是有效的压缩包')
  }
  const dest = await resolveNodeByAbsolutePath(destRoot, { follow: true })
  if (!dest || dest.kind !== 'folder') {
    throw new Error('目标文件夹不存在')
  }

  const format = params.format ?? 'auto'
  const { blob } = await readFileBlob(absolutePath)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  params.signal?.throwIfAborted?.()
  if (params.signal?.aborted) throw new Error('aborted')

  let entries: Map<string, Uint8Array>
  try {
    const { decodeArchiveInWorker } = await import('../../archive/archive-worker-client.ts')
    entries = await decodeArchiveInWorker({
      bytes,
      format,
      stripRoot: params.stripRoot,
      signal: params.signal,
    })
  } catch (error) {
    throw toFriendlyArchiveError(format, error)
  }

  // 与解压工具原行为一致：显式 zip 解出 0 个文件且大于空包 → 判损坏
  if (format === 'zip' && entries.size === 0 && bytes.byteLength > 64) {
    throw new Error('无法从 ZIP 中读出文件（可能已损坏或未按二进制保存）')
  }

  if (params.transformEntries) {
    entries = await params.transformEntries(entries)
  }

  // 动态 import：archive-materialize 静态依赖本模块，静态引入会成环
  const { materializeArchiveEntries } = await import('../../archive/archive-materialize.ts')
  return materializeArchiveEntries({
    destRoot,
    entries: [...entries.entries()].map(([relativePath, bytes]) => ({
      relativePath,
      bytes,
    })),
    signal: params.signal,
    onProgress: params.onProgress,
  })
}

/**
 * 打包目录为压缩包（zip / tar.gz）：主线程遍历读文件 + Worker 压缩 + 流式写。
 * 仅支持 IndexedDB 本地卷（local / repo）目录（同 filesListSubtreeFiles 限制）。
 */
export async function filesCreateArchive(params: {
  sourceDirPath: string
  archivePath: string
  format?: 'zip' | 'gzip-tar'
  signal?: AbortSignal
  onProgress?: (progress: FilesCreateArchiveProgress) => void
}): Promise<FilesApiEntry> {
  const sourceAbs = assertAbsolutePath(params.sourceDirPath)
  const archiveAbs = assertAbsolutePath(params.archivePath)
  const format = params.format ?? 'zip'

  const source = await resolveNodeByAbsolutePath(sourceAbs, { follow: true })
  if (!source || source.kind !== 'folder') {
    throw new Error('源目录不存在')
  }
  if (isFilesNamespaceRoot(archiveAbs)) {
    throw new Error('不能在命名空间根创建压缩包')
  }
  const parent = await resolveNodeByAbsolutePath(parentAbsolutePathOf(archiveAbs), {
    follow: true,
  })
  if (!parent || parent.kind !== 'folder') {
    throw new Error('无法写入压缩包所在目录')
  }
  if (!isFilesNodeWritable(parent)) {
    throw new Error('压缩包所在目录不可写')
  }

  const subtree = await listSubtreeFiles(sourceAbs)
  const entries: { path: string; bytes: ArrayBuffer }[] = []
  let readCount = 0
  for (const file of subtree) {
    params.signal?.throwIfAborted?.()
    if (params.signal?.aborted) throw new Error('aborted')
    const { blob } = await readFileBlob(file.absolutePath)
    entries.push({ path: file.path, bytes: await blob.arrayBuffer() })
    readCount += 1
    params.onProgress?.({ readCount, totalCount: subtree.length, currentPath: file.path })
  }

  const { encodeArchiveInWorker } = await import('../../archive/archive-worker-client.ts')
  const outBytes = await encodeArchiveInWorker({
    entries,
    format,
    signal: params.signal,
  })

  // 流式写，避免单次 IndexedDB 事务过大
  const writer = await filesOpenStreamWrite(archiveAbs)
  const CHUNK_BYTES = 256 * 1024
  try {
    for (let offset = 0; offset < outBytes.byteLength; offset += CHUNK_BYTES) {
      await writer.write(outBytes.subarray(offset, offset + CHUNK_BYTES))
    }
    await writer.close()
  } catch (error) {
    await writer.abort().catch(() => {})
    throw error
  }

  const entry = await filesStat(archiveAbs)
  if (!entry) {
    throw new Error('压缩包写入失败')
  }
  return entry
}
