import { osNowMs } from '../../os/os-clock.ts'
import {
  fatBaseName,
  fatParentRelativePath,
  joinFatRelativePath,
} from './files-image-fat-volume.ts'
import {
  getCachedImageMount,
  getImageVolume,
} from './files-image-mount-store.ts'
import type { FilesStreamWriter } from './files-storage.ts'
import {
  FILES_TEXT_MIME,
  isImageLocationId,
  isImageNodeId,
  type FilesNode,
  type ImageFilesLocationId,
} from './files-types.ts'

const WRITABLE_ATTRIBUTES = { readable: true, writable: true } as const

function encodeRelative(path: string): string {
  return path
}

function dirId(locationId: ImageFilesLocationId, path: string): string {
  return `${locationId}:d:${encodeRelative(path)}`
}

function fileId(locationId: ImageFilesLocationId, path: string): string {
  return `${locationId}:f:${encodeRelative(path)}`
}

function parseImageDirId(id: string): { locationId: ImageFilesLocationId; path: string } | undefined {
  const match = /^image:([^:]+):d:(.*)$/.exec(id)
  if (!match) return undefined
  return { locationId: `image:${match[1]}`, path: match[2] ?? '' }
}

function parseImageFileId(id: string): { locationId: ImageFilesLocationId; path: string } | undefined {
  const match = /^image:([^:]+):f:(.*)$/.exec(id)
  if (!match) return undefined
  return { locationId: `image:${match[1]}`, path: match[2] ?? '' }
}

function guessMime(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.txt') || lower.endsWith('.md')) return FILES_TEXT_MIME
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  return 'application/octet-stream'
}

function makeDirNode(
  locationId: ImageFilesLocationId,
  path: string,
  now = osNowMs(),
): FilesNode {
  const parent = fatParentRelativePath(path)
  return {
    id: dirId(locationId, path),
    locationId,
    parentId: parent ? dirId(locationId, parent) : undefined,
    name: path ? fatBaseName(path) : getCachedImageMount(locationId)?.label ?? '磁盘镜像',
    kind: 'folder',
    mimeType: undefined,
    byteSize: 0,
    createdAt: now,
    updatedAt: now,
    attributes: WRITABLE_ATTRIBUTES,
  }
}

function makeFileNode(
  locationId: ImageFilesLocationId,
  path: string,
  byteSize = 0,
  now = osNowMs(),
): FilesNode {
  const parent = fatParentRelativePath(path)
  return {
    id: fileId(locationId, path),
    locationId,
    parentId: parent ? dirId(locationId, parent) : undefined,
    name: fatBaseName(path),
    kind: 'file',
    mimeType: guessMime(fatBaseName(path)),
    byteSize,
    createdAt: now,
    updatedAt: now,
    attributes: WRITABLE_ATTRIBUTES,
  }
}

function requireLocation(id: string): ImageFilesLocationId {
  if (!isImageLocationId(id)) {
    throw new Error('不是磁盘镜像卷')
  }
  return id
}

function dirPathFromParent(parentId: string | undefined): string {
  if (!parentId) return ''
  const parsed = parseImageDirId(parentId)
  if (!parsed) {
    throw new Error('父级不是文件夹')
  }
  return parsed.path
}

export async function getImageNode(id: string): Promise<FilesNode | undefined> {
  if (!isImageNodeId(id)) return undefined
  const dir = parseImageDirId(id)
  if (dir) {
    if (!dir.path) return makeDirNode(dir.locationId, '')
    const stat = await getImageVolume(dir.locationId).stat(dir.path)
    if (!stat || stat.kind !== 'folder') return undefined
    return makeDirNode(dir.locationId, dir.path, stat.updatedAt)
  }
  const file = parseImageFileId(id)
  if (!file || !file.path) return undefined
  const stat = await getImageVolume(file.locationId).stat(file.path)
  if (!stat || stat.kind !== 'file') return undefined
  return makeFileNode(file.locationId, file.path, stat.byteSize, stat.updatedAt)
}

export async function listImageDirectory(
  locationId: ImageFilesLocationId,
  folderId: string | undefined,
): Promise<FilesNode[]> {
  const relative = folderId ? parseImageDirId(folderId)?.path : ''
  if (folderId && relative === undefined) return []
  const volume = getImageVolume(locationId)
  const entries = await volume.list(relative ?? '')
  return entries.map((entry) => {
    const path = joinFatRelativePath(relative ?? '', entry.name)
    return entry.kind === 'folder'
      ? makeDirNode(locationId, path, entry.updatedAt)
      : makeFileNode(locationId, path, entry.byteSize, entry.updatedAt)
  })
}

export async function resolveImagePath(
  locationId: ImageFilesLocationId,
  folderId: string | undefined,
): Promise<FilesNode[]> {
  if (!folderId) return []
  const parsed = parseImageDirId(folderId)
  if (!parsed || parsed.locationId !== locationId) return []
  if (!parsed.path) return []
  const segments = parsed.path.split('/').filter(Boolean)
  const chain: FilesNode[] = []
  let cursor = ''
  for (const segment of segments) {
    cursor = joinFatRelativePath(cursor, segment)
    chain.push(makeDirNode(locationId, cursor))
  }
  return chain
}

export async function resolveImageRelativePath(
  locationId: ImageFilesLocationId,
  relativePath: string,
): Promise<FilesNode | undefined> {
  const trimmed = relativePath.replace(/^\/+|\/+$/g, '')
  if (!trimmed) return undefined
  const stat = await getImageVolume(locationId).stat(trimmed)
  if (!stat) return undefined
  return stat.kind === 'folder'
    ? makeDirNode(locationId, trimmed, stat.updatedAt)
    : makeFileNode(locationId, trimmed, stat.byteSize, stat.updatedAt)
}

export async function mkdirImage(params: {
  locationId: ImageFilesLocationId
  parentId: string | undefined
  name: string
}): Promise<FilesNode> {
  const parentPath = dirPathFromParent(params.parentId)
  const path = joinFatRelativePath(parentPath, params.name)
  const entry = await getImageVolume(params.locationId).mkdir(path)
  return makeDirNode(params.locationId, path, entry.updatedAt)
}

export async function createImageTextFile(params: {
  locationId: ImageFilesLocationId
  parentId: string | undefined
  name: string
  text: string
}): Promise<FilesNode> {
  const bytes = new TextEncoder().encode(params.text)
  return createImageBinaryFile({
    locationId: params.locationId,
    parentId: params.parentId,
    name: params.name,
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  })
}

export async function createImageBinaryFile(params: {
  locationId: ImageFilesLocationId
  parentId: string | undefined
  name: string
  bytes: ArrayBuffer
}): Promise<FilesNode> {
  const parentPath = dirPathFromParent(params.parentId)
  const path = joinFatRelativePath(parentPath, params.name)
  const entry = await getImageVolume(params.locationId).writeFile(path, new Uint8Array(params.bytes))
  return makeFileNode(params.locationId, path, entry.byteSize, entry.updatedAt)
}

export async function readImageBlob(id: string): Promise<{ node: FilesNode; blob: Blob }> {
  const parsed = parseImageFileId(id)
  if (!parsed?.path) {
    throw new Error('文件不存在')
  }
  const bytes = await getImageVolume(parsed.locationId).readFile(parsed.path)
  const node = makeFileNode(parsed.locationId, parsed.path, bytes.byteLength)
  return { node, blob: new Blob([new Uint8Array(bytes)], { type: node.mimeType ?? 'application/octet-stream' }) }
}

export async function readImageText(id: string): Promise<{ node: FilesNode; text: string }> {
  const { node, blob } = await readImageBlob(id)
  return { node, text: await blob.text() }
}

export async function readImageTextIfSmall(id: string, maxBytes: number): Promise<string | undefined> {
  const parsed = parseImageFileId(id)
  if (!parsed?.path) return undefined
  const stat = await getImageVolume(parsed.locationId).stat(parsed.path)
  if (!stat || stat.kind !== 'file' || stat.byteSize > maxBytes) return undefined
  const { text } = await readImageText(id)
  return text
}

export async function writeImageText(id: string, text: string): Promise<FilesNode> {
  const bytes = new TextEncoder().encode(text)
  return writeImageBlob(id, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}

export async function writeImageBlob(id: string, bytes: ArrayBuffer): Promise<FilesNode> {
  const parsed = parseImageFileId(id)
  if (!parsed?.path) {
    throw new Error('文件不存在')
  }
  const entry = await getImageVolume(parsed.locationId).writeFile(parsed.path, new Uint8Array(bytes))
  return makeFileNode(parsed.locationId, parsed.path, entry.byteSize, entry.updatedAt)
}

export async function writeImageBytesRange(
  id: string,
  offset: number,
  bytes: ArrayBuffer | Uint8Array,
): Promise<FilesNode> {
  const parsed = parseImageFileId(id)
  if (!parsed?.path) {
    throw new Error('文件不存在')
  }
  const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const entry = await getImageVolume(parsed.locationId).writeFileRange(parsed.path, offset, payload)
  return makeFileNode(parsed.locationId, parsed.path, entry.byteSize, entry.updatedAt)
}

export async function readImageBlobRange(
  id: string,
  offset: number,
  length: number,
): Promise<{ node: FilesNode; blob: Blob }> {
  const parsed = parseImageFileId(id)
  if (!parsed?.path) {
    throw new Error('文件不存在')
  }
  const stat = await getImageVolume(parsed.locationId).stat(parsed.path)
  if (!stat || stat.kind !== 'file') {
    throw new Error('文件不存在')
  }
  const bytes = await getImageVolume(parsed.locationId).readFileRange(parsed.path, offset, length)
  const node = makeFileNode(parsed.locationId, parsed.path, stat.byteSize, stat.updatedAt)
  return { node, blob: new Blob([new Uint8Array(bytes)], { type: node.mimeType ?? 'application/octet-stream' }) }
}

export async function openImageStreamWrite(params: {
  locationId: ImageFilesLocationId
  parentId: string | undefined
  name: string
  isNew: boolean
  expectedSize?: number
}): Promise<FilesStreamWriter> {
  const parentPath = dirPathFromParent(params.parentId)
  const path = joinFatRelativePath(parentPath, params.name)
  const locationId = requireLocation(params.locationId)
  const volume = getImageVolume(locationId)
  const writer = await volume.streamWriteFile(path, {
    isNew: params.isNew,
    expectedSize: params.expectedSize,
  })
  let aborted = false
  let closed = false
  return {
    node: makeFileNode(locationId, path),
    async write(chunk) {
      if (closed || aborted) return
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
      await writer.write(bytes)
    },
    async close() {
      if (closed || aborted) return makeFileNode(locationId, path)
      closed = true
      const entry = await writer.close()
      return makeFileNode(locationId, path, entry.byteSize, entry.updatedAt)
    },
    async abort() {
      if (closed) return
      aborted = true
      await writer.abort()
    },
  }
}

export async function renameImageNode(id: string, nextName: string): Promise<FilesNode> {
  const dir = parseImageDirId(id)
  const file = parseImageFileId(id)
  const parsed = dir ?? file
  if (!parsed?.path) {
    throw new Error('项目不存在')
  }
  const dest = joinFatRelativePath(fatParentRelativePath(parsed.path), nextName)
  const entry = await getImageVolume(parsed.locationId).rename(parsed.path, dest)
  return entry.kind === 'folder'
    ? makeDirNode(parsed.locationId, dest, entry.updatedAt)
    : makeFileNode(parsed.locationId, dest, entry.byteSize, entry.updatedAt)
}

export async function removeImageNode(id: string): Promise<void> {
  const dir = parseImageDirId(id)
  const file = parseImageFileId(id)
  const parsed = dir ?? file
  if (!parsed?.path) {
    throw new Error('不能删除卷根')
  }
  await getImageVolume(parsed.locationId).remove(parsed.path)
}
