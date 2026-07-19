/**
 * 系统文件统一 API：一律以全局绝对路径为句柄。
 * 内置应用与第三方桥接共用此门面；底层仍走 files-vfs。
 *
 * 路径约定：`/user` · `/models` · `/system` · `/mount/{8位键}`
 */
import {
  filesLocationPathRoot,
  joinFilesAbsolutePath,
  normalizeFilesNodeName,
  parseFilesAbsolutePath,
} from './files-path.ts'
import {
  isFilesLocationWritable,
  isFilesNodeWritable,
  type FilesLocationId,
  type FilesNode,
} from './files-types.ts'
import {
  createTextFile,
  getFilesLocationLabel,
  listDirectory,
  listFilesLocations,
  mkdir,
  readTextFile,
  removeNode,
  renameNode,
  resolveFilesAbsolutePath,
  resolveNodeByAbsolutePath,
  writeTextFile,
} from './files-vfs.ts'

export type FilesApiEntry = {
  path: string
  name: string
  kind: 'file' | 'folder'
  mimeType?: string
  byteSize: number
  createdAt: number
  updatedAt: number
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
  return {
    path: await resolveFilesAbsolutePath(node),
    name: node.name,
    kind: node.kind,
    mimeType: node.mimeType,
    byteSize: node.byteSize,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    writable: isFilesNodeWritable(node),
  }
}

function volumeRootEntry(locationId: FilesLocationId): FilesApiEntry {
  const path = filesLocationPathRoot(locationId)
  const label = getFilesLocationLabel(locationId)
  return {
    path,
    name: label,
    kind: 'folder',
    mimeType: undefined,
    byteSize: 0,
    createdAt: 0,
    updatedAt: 0,
    writable: isFilesLocationWritable(locationId),
  }
}

async function resolveParentForCreate(absolutePath: string): Promise<{
  locationId: FilesLocationId
  parentId: string | undefined
  name: string
}> {
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

/** 列出目录内容；`path` 可为卷根如 `/user` */
export async function filesList(dirPath: string): Promise<FilesApiEntry[]> {
  const absolutePath = assertAbsolutePath(dirPath)
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

/** 查询路径对应条目；卷根本身也可查询 */
export async function filesStat(path: string): Promise<FilesApiEntry | undefined> {
  const absolutePath = assertAbsolutePath(path)
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
  const { text } = await readTextFile(absolutePath)
  return text
}

/** 覆写已存在的文本文件 */
export async function filesWriteText(path: string, text: string): Promise<FilesApiEntry> {
  const absolutePath = assertAbsolutePath(path)
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

export async function filesRename(path: string, nextName: string): Promise<FilesApiEntry> {
  const absolutePath = assertAbsolutePath(path)
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
