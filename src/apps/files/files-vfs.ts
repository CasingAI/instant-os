import { osNowMs } from '../../os/os-clock.ts'
import {
  assertAdditionalBytesAvailable,
  collectSubtreeIds,
  createFileWithBlob,
  createFolderNode,
  deleteSubtree,
  estimateNodeMetaBytes,
  estimateTextBytes,
  getNode,
  listChildNodes,
  newFilesNodeId,
  readBlobBytes,
  readBlobText,
  renameNodeRecord,
  writeBlobText,
} from './files-storage.ts'
import {
  createMountTextFile,
  getMountNode,
  listMountDirectory,
  mkdirMount,
  readMountBlob,
  readMountText,
  removeMountNode,
  renameMountNode,
  resolveMountPath,
  resolveMountRelativePath,
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
import { getCachedMount, listMounts } from './files-mount-store.ts'
import {
  filesLocationPathRoot,
  isFilesAbsolutePath,
  joinFilesAbsolutePath,
  normalizeFilesNodeName,
  parseFilesAbsolutePath,
} from './files-path.ts'
import {
  FILES_LOCATIONS,
  FILES_TEXT_MIME,
  defaultFilesNodeAttributes,
  isFilesLocationWritable,
  isFilesNodeWritable,
  isMountLocationId,
  isMountNodeId,
  type FilesLocation,
  type FilesLocationId,
  type FilesNode,
} from './files-types.ts'

/** 虚拟文件系统内容变更（新建 / 写入 / 重命名 / 删除等），供文件管理器等订阅刷新 */
export const FILES_VFS_CHANGED_EVENT = 'instant-os-files-vfs-changed'

function emitFilesVfsChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(FILES_VFS_CHANGED_EVENT))
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
  if (isMountLocationId(locationId)) {
    return listMountDirectory(locationId, folderId)
  }
  if (locationId === 'models3d') {
    return listModels3dDirectory(folderId)
  }
  if (locationId === 'source') {
    return listSourceDirectory(folderId)
  }
  return listChildNodes(locationId, folderId)
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
    emitFilesVfsChanged()
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
  emitFilesVfsChanged()
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

  if (isMountLocationId(params.locationId)) {
    const created = await createMountTextFile({
      locationId: params.locationId,
      parentId: params.parentId,
      name,
      text,
    })
    emitFilesVfsChanged()
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
  emitFilesVfsChanged()
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

/** 按全局绝对路径解析节点（文件或文件夹） */
export async function resolveNodeByAbsolutePath(
  absolutePath: string,
): Promise<FilesNode | undefined> {
  const parsed = parseFilesAbsolutePath(absolutePath)
  if (!parsed) return undefined
  if (parsed.segments.length === 0) return undefined

  // 挂载卷：直接走 FSA handle，禁止逐层 list
  if (isMountLocationId(parsed.locationId)) {
    return resolveMountRelativePath(parsed.locationId, parsed.segments.join('/'))
  }

  let parentId: string | undefined
  for (let index = 0; index < parsed.segments.length; index += 1) {
    const name = parsed.segments[index]
    if (!name) return undefined
    const children = await listDirectory(parsed.locationId, parentId)
    const hit = children.find((child) => child.name === name)
    if (!hit) return undefined
    if (index === parsed.segments.length - 1) return hit
    if (hit.kind !== 'folder') return undefined
    parentId = hit.id
  }

  return undefined
}

export async function resolveFileNodeByAbsolutePath(
  absolutePath: string,
): Promise<FilesNode | undefined> {
  const node = await resolveNodeByAbsolutePath(absolutePath)
  if (!node || node.kind !== 'file') return undefined
  return node
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
  if (isMountNodeId(id)) {
    return readMountText(id)
  }
  if (id.startsWith('models3d:')) {
    return readModels3dText(id)
  }
  if (id.startsWith('source:')) {
    return readSourceText(id)
  }
  const node = await getNode(id)
  if (!node || node.kind !== 'file') {
    throw new Error('文件不存在')
  }
  const text = await readBlobText(id)
  return { node, text }
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
  if (isMountNodeId(id)) {
    return readMountBlob(id)
  }
  if (id.startsWith('models3d:')) {
    return readModels3dBlob(id)
  }
  if (id.startsWith('source:')) {
    return readSourceBlob(id)
  }
  const node = await getNode(id)
  if (!node || node.kind !== 'file') {
    throw new Error('文件不存在')
  }
  const bytes = await readBlobBytes(id)
  if (!bytes) {
    throw new Error('此文件没有可预览的二进制内容')
  }
  const type = node.mimeType ?? 'application/octet-stream'
  return { node, blob: new Blob([new Uint8Array(bytes)], { type }) }
}

export async function writeTextFile(ref: string, text: string): Promise<FilesNode> {
  const target = isFilesAbsolutePath(ref) ? await resolveFileRef(ref) : await getNodeOrThrow(ref)
  if (target.kind !== 'file') {
    throw new Error('文件不存在')
  }
  assertNodeWritable(target)

  if (isMountNodeId(target.id)) {
    const written = await writeMountText(target.id, text)
    emitFilesVfsChanged()
    return written
  }
  const written = await writeBlobText({
    id: target.id,
    text,
    previousByteSize: target.byteSize,
    nameMetaDelta: 0,
  })
  emitFilesVfsChanged()
  return written
}

export async function renameNode(id: string, nextName: string): Promise<FilesNode> {
  const trimmed = normalizeFilesNodeName(nextName)
  const node = await getNodeOrThrow(id)
  assertNodeWritable(node)
  const names = await siblingNames(node.locationId, node.parentId, node.id)
  const name = uniqueName(names, trimmed)

  if (isMountNodeId(id)) {
    const renamed = await renameMountNode(id, name)
    emitFilesVfsChanged()
    return renamed
  }

  const before = estimateNodeMetaBytes(node)
  const after = estimateNodeMetaBytes({ ...node, name })
  const renamed = await renameNodeRecord({
    id,
    name,
    metaDelta: after - before,
  })
  emitFilesVfsChanged()
  return renamed
}

export async function removeNode(id: string): Promise<void> {
  const node = await getNodeOrThrow(id)
  assertNodeWritable(node)
  if (isMountNodeId(id)) {
    await removeMountNode(id)
    emitFilesVfsChanged()
    return
  }
  const subtree = await collectSubtreeIds(id)
  await deleteSubtree(subtree)
  emitFilesVfsChanged()
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

/** 估算复制整棵子树到本地存储时需要的额外字节（内容 + 元数据） */
export async function estimateCopyBytes(sourceId: string): Promise<number> {
  const source = await getNodeOrThrow(sourceId)
  return estimateCopyBytesForNode(source)
}

async function estimateCopyBytesForNode(node: FilesNode): Promise<number> {
  if (node.kind === 'file') {
    const { text } = await readTextFileByNodeId(node.id)
    return estimateNodeMetaBytes(node) + estimateTextBytes(text)
  }

  let total = estimateNodeMetaBytes(node)
  const children = await listDirectory(node.locationId, node.id)
  for (const child of children) {
    total += await estimateCopyBytesForNode(child)
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
}): Promise<FilesNode> {
  const source = await getNodeOrThrow(params.sourceId)
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
    const needed = await estimateCopyBytesForNode(source)
    await assertAdditionalBytesAvailable(needed)
  }

  return copyNodeTree(source, params.destLocationId, params.destParentId)
}

async function copyNodeTree(
  source: FilesNode,
  destLocationId: FilesLocationId,
  destParentId: string | undefined,
): Promise<FilesNode> {
  if (source.kind === 'file') {
    const { text } = await readTextFileByNodeId(source.id)
    return createTextFile({
      locationId: destLocationId,
      parentId: destParentId,
      name: source.name,
      text,
    })
  }

  const folder = await mkdir({
    locationId: destLocationId,
    parentId: destParentId,
    name: source.name,
  })
  const children = await listDirectory(source.locationId, source.id)
  for (const child of children) {
    await copyNodeTree(child, destLocationId, folder.id)
  }
  return folder
}

export { isFilesAbsolutePath } from './files-path.ts'
