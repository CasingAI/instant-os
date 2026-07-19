import { osNowMs } from '../../os/os-clock.ts'
import { getMount } from './files-mount-store.ts'
import {
  FILES_TEXT_MIME,
  isMountNodeId,
  type FilesNode,
  type MountFilesLocationId,
} from './files-types.ts'

const WRITABLE_ATTRIBUTES = { writable: true } as const

function dirId(locationId: MountFilesLocationId, path: string): string {
  return `${locationId}:d:${path}`
}

function fileId(locationId: MountFilesLocationId, path: string): string {
  return `${locationId}:f:${path}`
}

function parseDirPath(id: string): { locationId: MountFilesLocationId; path: string } | undefined {
  const match = /^mount:([^:]+):d:(.*)$/.exec(id)
  if (!match) return undefined
  return { locationId: `mount:${match[1]}`, path: match[2] }
}

function parseFilePath(id: string): { locationId: MountFilesLocationId; path: string } | undefined {
  const match = /^mount:([^:]+):f:(.*)$/.exec(id)
  if (!match) return undefined
  return { locationId: `mount:${match[1]}`, path: match[2] }
}

function parentDirPath(path: string): string | undefined {
  const slash = path.lastIndexOf('/')
  if (slash < 0) return undefined
  return path.slice(0, slash)
}

function baseName(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(slash + 1) : path
}

function joinPath(parent: string | undefined, name: string): string {
  return parent ? `${parent}/${name}` : name
}

function guessMime(name: string): string {
  if (name.endsWith('.json')) return 'application/json'
  if (name.endsWith('.css')) return 'text/css'
  if (name.endsWith('.html')) return 'text/html'
  if (name.endsWith('.md')) return 'text/markdown'
  if (name.endsWith('.svg')) return 'image/svg+xml'
  if (name.endsWith('.ts') || name.endsWith('.tsx')) return 'text/typescript'
  if (name.endsWith('.js') || name.endsWith('.jsx')) return 'text/javascript'
  return FILES_TEXT_MIME
}

function makeDirNode(
  locationId: MountFilesLocationId,
  path: string,
  now = osNowMs(),
): FilesNode {
  const parent = parentDirPath(path)
  return {
    id: dirId(locationId, path),
    locationId,
    parentId: parent === undefined ? undefined : dirId(locationId, parent),
    name: baseName(path),
    kind: 'folder',
    mimeType: undefined,
    byteSize: 0,
    createdAt: now,
    updatedAt: now,
    attributes: WRITABLE_ATTRIBUTES,
  }
}

function makeFileNode(
  locationId: MountFilesLocationId,
  path: string,
  byteSize = 0,
  now = osNowMs(),
): FilesNode {
  const parent = parentDirPath(path)
  return {
    id: fileId(locationId, path),
    locationId,
    parentId: parent === undefined ? undefined : dirId(locationId, parent),
    name: baseName(path),
    kind: 'file',
    mimeType: guessMime(baseName(path)),
    byteSize,
    createdAt: now,
    updatedAt: now,
    attributes: WRITABLE_ATTRIBUTES,
  }
}

async function ensureReadWritePermission(handle: FileSystemDirectoryHandle): Promise<void> {
  if (typeof handle.queryPermission === 'function') {
    const status = await handle.queryPermission({ mode: 'readwrite' })
    if (status === 'granted') return
  }
  if (typeof handle.requestPermission === 'function') {
    const status = await handle.requestPermission({ mode: 'readwrite' })
    if (status === 'granted') return
    throw new Error('无法访问已挂载的文件夹，请重新挂载')
  }
}

async function getRootHandle(locationId: MountFilesLocationId): Promise<FileSystemDirectoryHandle> {
  const mount = await getMount(locationId)
  if (!mount) {
    throw new Error('挂载已不存在，请重新挂载')
  }
  await ensureReadWritePermission(mount.handle)
  return mount.handle
}

async function resolveDirectoryHandle(
  root: FileSystemDirectoryHandle,
  path: string | undefined,
): Promise<FileSystemDirectoryHandle> {
  if (!path) return root
  let current = root
  for (const segment of path.split('/')) {
    if (!segment) continue
    current = await current.getDirectoryHandle(segment)
  }
  return current
}

async function resolveParentAndName(
  locationId: MountFilesLocationId,
  path: string,
): Promise<{ parent: FileSystemDirectoryHandle; name: string }> {
  const root = await getRootHandle(locationId)
  const parentPath = parentDirPath(path)
  const parent = await resolveDirectoryHandle(root, parentPath)
  return { parent, name: baseName(path) }
}

export async function getMountNode(id: string): Promise<FilesNode | undefined> {
  if (!isMountNodeId(id)) return undefined

  const dir = parseDirPath(id)
  if (dir) {
    try {
      const root = await getRootHandle(dir.locationId)
      await resolveDirectoryHandle(root, dir.path)
      return makeDirNode(dir.locationId, dir.path)
    } catch {
      return undefined
    }
  }

  const file = parseFilePath(id)
  if (file) {
    try {
      const { parent, name } = await resolveParentAndName(file.locationId, file.path)
      const handle = await parent.getFileHandle(name)
      const blob = await handle.getFile()
      return makeFileNode(file.locationId, file.path, blob.size, blob.lastModified)
    } catch {
      return undefined
    }
  }

  return undefined
}

export async function listMountDirectory(
  locationId: MountFilesLocationId,
  folderId: string | undefined,
): Promise<FilesNode[]> {
  const root = await getRootHandle(locationId)
  const folderPath =
    folderId === undefined ? undefined : parseDirPath(folderId)?.path
  if (folderId !== undefined && folderPath === undefined) return []

  const directory = await resolveDirectoryHandle(root, folderPath)
  const dirs: FilesNode[] = []
  const files: FilesNode[] = []

  for await (const [name, handle] of directory.entries()) {
    const path = joinPath(folderPath, name)
    if (handle.kind === 'directory') {
      dirs.push(makeDirNode(locationId, path))
    } else {
      try {
        const blob = await handle.getFile()
        files.push(makeFileNode(locationId, path, blob.size, blob.lastModified))
      } catch {
        files.push(makeFileNode(locationId, path))
      }
    }
  }

  dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans'))
  files.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans'))
  return [...dirs, ...files]
}

export async function resolveMountPath(
  locationId: MountFilesLocationId,
  folderId: string | undefined,
): Promise<FilesNode[]> {
  if (folderId === undefined) return []
  const parsed = parseDirPath(folderId)
  if (!parsed || parsed.locationId !== locationId) return []

  const chain: FilesNode[] = []
  let current: string | undefined = parsed.path
  while (current !== undefined) {
    chain.unshift(makeDirNode(locationId, current))
    current = parentDirPath(current)
  }
  return chain
}

export async function readMountText(
  id: string,
): Promise<{ node: FilesNode; text: string }> {
  const parsed = parseFilePath(id)
  if (!parsed) {
    throw new Error('文件不存在')
  }
  const { parent, name } = await resolveParentAndName(parsed.locationId, parsed.path)
  const handle = await parent.getFileHandle(name)
  const blob = await handle.getFile()
  const text = await blob.text()
  return {
    node: makeFileNode(parsed.locationId, parsed.path, blob.size, blob.lastModified),
    text,
  }
}

export async function writeMountText(id: string, text: string): Promise<FilesNode> {
  const parsed = parseFilePath(id)
  if (!parsed) {
    throw new Error('文件不存在')
  }
  const { parent, name } = await resolveParentAndName(parsed.locationId, parsed.path)
  const handle = await parent.getFileHandle(name)
  const writable = await handle.createWritable()
  await writable.write(text)
  await writable.close()
  const blob = await handle.getFile()
  return makeFileNode(parsed.locationId, parsed.path, blob.size, blob.lastModified)
}

export async function mkdirMount(params: {
  locationId: MountFilesLocationId
  parentId: string | undefined
  name: string
}): Promise<FilesNode> {
  const root = await getRootHandle(params.locationId)
  const parentPath =
    params.parentId === undefined ? undefined : parseDirPath(params.parentId)?.path
  if (params.parentId !== undefined && parentPath === undefined) {
    throw new Error('父级不是文件夹')
  }
  const parent = await resolveDirectoryHandle(root, parentPath)
  await parent.getDirectoryHandle(params.name, { create: true })
  return makeDirNode(params.locationId, joinPath(parentPath, params.name))
}

export async function createMountTextFile(params: {
  locationId: MountFilesLocationId
  parentId: string | undefined
  name: string
  text: string
}): Promise<FilesNode> {
  const root = await getRootHandle(params.locationId)
  const parentPath =
    params.parentId === undefined ? undefined : parseDirPath(params.parentId)?.path
  if (params.parentId !== undefined && parentPath === undefined) {
    throw new Error('父级不是文件夹')
  }
  const parent = await resolveDirectoryHandle(root, parentPath)
  const handle = await parent.getFileHandle(params.name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(params.text)
  await writable.close()
  const path = joinPath(parentPath, params.name)
  const blob = await handle.getFile()
  return makeFileNode(params.locationId, path, blob.size, blob.lastModified)
}

export async function renameMountNode(id: string, nextName: string): Promise<FilesNode> {
  const dir = parseDirPath(id)
  if (dir) {
    const { parent, name } = await resolveParentAndName(dir.locationId, dir.path)
    const handle = await parent.getDirectoryHandle(name)
    if (typeof handle.move !== 'function') {
      throw new Error('当前浏览器不支持重命名挂载文件夹')
    }
    await handle.move(nextName)
    const nextPath = joinPath(parentDirPath(dir.path), nextName)
    return makeDirNode(dir.locationId, nextPath)
  }

  const file = parseFilePath(id)
  if (!file) {
    throw new Error('项目不存在')
  }

  const { parent, name } = await resolveParentAndName(file.locationId, file.path)
  const handle = await parent.getFileHandle(name)
  if (typeof handle.move === 'function') {
    await handle.move(nextName)
  } else {
    const blob = await handle.getFile()
    const text = await blob.text()
    const next = await parent.getFileHandle(nextName, { create: true })
    const writable = await next.createWritable()
    await writable.write(text)
    await writable.close()
    await parent.removeEntry(name)
  }

  const nextPath = joinPath(parentDirPath(file.path), nextName)
  const nextHandle = await parent.getFileHandle(nextName)
  const nextBlob = await nextHandle.getFile()
  return makeFileNode(file.locationId, nextPath, nextBlob.size, nextBlob.lastModified)
}

export async function removeMountNode(id: string): Promise<void> {
  const dir = parseDirPath(id)
  if (dir) {
    const { parent, name } = await resolveParentAndName(dir.locationId, dir.path)
    await parent.removeEntry(name, { recursive: true })
    return
  }

  const file = parseFilePath(id)
  if (!file) {
    throw new Error('项目不存在')
  }
  const { parent, name } = await resolveParentAndName(file.locationId, file.path)
  await parent.removeEntry(name)
}
