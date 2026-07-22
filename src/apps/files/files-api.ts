/**
 * 系统文件统一 API：一律以全局绝对路径为句柄。
 * 内置应用与第三方桥接共用此门面；底层仍走 files-vfs。
 *
 * 路径约定：
 * - `/` — 命名空间根（虚拟）：下列出各卷，不可写入
 * - `/user` · `/repo` · `/models` · `/system` · `/mount/{文件夹名}` — 各卷根
 */
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
  type FilesLocationId,
  type FilesNode,
} from './files-types.ts'
import {
  copyNodeTo,
  createBinaryFile,
  createTextFile,
  getFilesLocationLabel,
  listDirectory,
  listFilesLocations,
  listSubtreeFiles,
  backfillSubtreeContentRevisionIds,
  mkdir,
  readFileBlob,
  readTextFile,
  removeNode,
  removeNodesByPathsBatch,
  renameNode,
  resolveFilesAbsolutePath,
  resolveNodeByAbsolutePath,
  upsertFilesBatch,
  writeBinaryFile,
  writeTextFile,
  type FilesSubtreeFileEntry,
  type FilesUpsertBatchItem,
  type FilesRemoveBatchOptions,
} from './files-vfs.ts'

export type { FilesUpsertBatchItem, FilesSubtreeFileEntry, FilesRemoveBatchOptions }
import {
  subscribeFilesWatch,
  type FilesWatchChange,
  type FilesWatchListener,
  type FilesWatchOptions,
} from './files-watch.ts'

export type { FilesWatchChange, FilesWatchListener, FilesWatchOptions }

export type FilesApiEntry = {
  path: string
  name: string
  kind: 'file' | 'folder'
  mimeType?: string
  byteSize: number
  createdAt: number
  updatedAt: number
  /** 内容版本戳；仅文件有意义，旧记录可能缺省 */
  contentRevisionId?: string
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

async function toEntry(node: FilesNode): Promise<FilesApiEntry> {
  const entry: FilesApiEntry = {
    path: await resolveFilesAbsolutePath(node),
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

  const name = normalizeFilesNodeName(parsed.segments[parsed.segments.length - 1] ?? '')
  const parentSegments = parsed.segments.slice(0, -1)
  if (parentSegments.length === 0) {
    return { locationId: parsed.locationId, parentId: undefined, name }
  }

  const parentPath = joinFilesAbsolutePath(
    filesLocationPathRoot(parsed.locationId),
    ...parentSegments,
  )
  const parent = await resolveNodeByAbsolutePath(parentPath)
  if (!parent || parent.kind !== 'folder') {
    throw new Error('父文件夹不存在')
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

  const node = await resolveNodeByAbsolutePath(absolutePath)
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

/** 查询路径对应条目；命名空间根 `/` 与卷根均可查询 */
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

  const node = await resolveNodeByAbsolutePath(absolutePath)
  if (!node) return undefined
  return toEntry(node)
}

export async function filesReadText(path: string): Promise<string> {
  const absolutePath = assertAbsolutePath(path)
  if (isFilesNamespaceRoot(absolutePath)) {
    throw new Error('不能读取命名空间根')
  }
  const { text } = await readTextFile(absolutePath)
  return text
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
  const existing = await resolveNodeByAbsolutePath(absolutePath)
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
  const existing = await resolveNodeByAbsolutePath(absolutePath)
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
  const existing = await resolveNodeByAbsolutePath(absolutePath)
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
 * 底层按批提交 IndexedDB 事务（默认 64）。
 */
export async function filesUpsertBatch(
  items: readonly FilesUpsertBatchItem[],
  options?: { batchSize?: number },
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
  const node = await resolveNodeByAbsolutePath(absolutePath)
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
  const node = await resolveNodeByAbsolutePath(absolutePath)
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
