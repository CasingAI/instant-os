import { osNowMs } from '../../os/os-clock.ts'
import {
  collectSubtreeIds,
  createFileWithBlob,
  createFolderNode,
  deleteSubtree,
  estimateNodeMetaBytes,
  getNode,
  listChildNodes,
  newFilesNodeId,
  readBlobText,
  renameNodeRecord,
  writeBlobText,
} from './files-storage.ts'
import {
  createMountTextFile,
  getMountNode,
  listMountDirectory,
  mkdirMount,
  readMountText,
  removeMountNode,
  renameMountNode,
  resolveMountPath,
  writeMountText,
} from './files-location-mount.ts'
import {
  getModels3dNode,
  listModels3dDirectory,
  readModels3dText,
  resolveModels3dPath,
} from './files-location-models3d.ts'
import {
  getSourceNode,
  listSourceDirectory,
  readSourceText,
  resolveSourcePath,
} from './files-location-source.ts'
import { getCachedMount, listMounts } from './files-mount-store.ts'
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
  const trimmed = params.name.trim()
  if (!trimmed) {
    throw new Error('文件夹名称不能为空')
  }

  const names = await siblingNames(params.locationId, params.parentId)
  const name = uniqueName(names, trimmed)

  if (isMountLocationId(params.locationId)) {
    return mkdirMount({
      locationId: params.locationId,
      parentId: params.parentId,
      name,
    })
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
  return createFolderNode({
    node,
    metaBytes: estimateNodeMetaBytes(node),
  })
}

export async function createTextFile(params: {
  locationId: FilesLocationId
  parentId: string | undefined
  name?: string
  text?: string
}): Promise<FilesNode> {
  await assertCanCreateIn(params.locationId, params.parentId)
  const names = await siblingNames(params.locationId, params.parentId)
  const name = uniqueName(names, (params.name ?? '未命名.txt').trim() || '未命名.txt')
  const text = params.text ?? ''

  if (isMountLocationId(params.locationId)) {
    return createMountTextFile({
      locationId: params.locationId,
      parentId: params.parentId,
      name,
      text,
    })
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
  return createFileWithBlob({
    node,
    text,
    metaBytes: estimateNodeMetaBytes(node),
  })
}

export async function readTextFile(id: string): Promise<{ node: FilesNode; text: string }> {
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

export async function writeTextFile(id: string, text: string): Promise<FilesNode> {
  if (isMountNodeId(id)) {
    const node = await getNodeOrThrow(id)
    assertNodeWritable(node)
    return writeMountText(id, text)
  }
  const node = await getNodeOrThrow(id)
  if (node.kind !== 'file') {
    throw new Error('文件不存在')
  }
  assertNodeWritable(node)
  return writeBlobText({
    id,
    text,
    previousByteSize: node.byteSize,
    nameMetaDelta: 0,
  })
}

export async function renameNode(id: string, nextName: string): Promise<FilesNode> {
  const trimmed = nextName.trim()
  if (!trimmed) {
    throw new Error('名称不能为空')
  }
  const node = await getNodeOrThrow(id)
  assertNodeWritable(node)
  const names = await siblingNames(node.locationId, node.parentId, node.id)
  const name = uniqueName(names, trimmed)

  if (isMountNodeId(id)) {
    return renameMountNode(id, name)
  }

  const before = estimateNodeMetaBytes(node)
  const after = estimateNodeMetaBytes({ ...node, name })
  return renameNodeRecord({
    id,
    name,
    metaDelta: after - before,
  })
}

export async function removeNode(id: string): Promise<void> {
  const node = await getNodeOrThrow(id)
  assertNodeWritable(node)
  if (isMountNodeId(id)) {
    await removeMountNode(id)
    return
  }
  const subtree = await collectSubtreeIds(id)
  await deleteSubtree(subtree)
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
