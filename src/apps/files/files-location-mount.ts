import { osNowMs } from '../../os/os-clock.ts'
import { ensureMountPermission } from './files-mount-permission-gate.ts'
import { getMount } from './files-mount-store.ts'
import type { FilesStreamWriter } from './files-storage.ts'
import {
  FILES_TEXT_MIME,
  isMountNodeId,
  type FilesNode,
  type MountFilesLocationId,
} from './files-types.ts'

const WRITABLE_ATTRIBUTES = { readable: true, writable: true } as const

/** 中间 DirectoryHandle 缓存上限 */
const DIR_HANDLE_CACHE_MAX = 256
/** 权限 granted 后跳过 queryPermission 的窗口 */
const PERMISSION_GRANTED_TTL_MS = 60_000

type DirHandleCacheEntry = {
  handle: FileSystemDirectoryHandle
  lastUsed: number
}

const dirHandleCache = new Map<string, DirHandleCacheEntry>()
const permissionGrantedUntil = new Map<MountFilesLocationId, number>()

function dirCacheKey(locationId: MountFilesLocationId, path: string | undefined): string {
  return `${locationId}\0${path ?? ''}`
}

function touchDirCache(
  locationId: MountFilesLocationId,
  path: string | undefined,
  handle: FileSystemDirectoryHandle,
): void {
  const key = dirCacheKey(locationId, path)
  dirHandleCache.set(key, { handle, lastUsed: osNowMs() })
  if (dirHandleCache.size <= DIR_HANDLE_CACHE_MAX) return
  let oldestKey: string | undefined
  let oldestAt = Number.POSITIVE_INFINITY
  for (const [k, entry] of dirHandleCache) {
    if (entry.lastUsed < oldestAt) {
      oldestAt = entry.lastUsed
      oldestKey = k
    }
  }
  if (oldestKey) dirHandleCache.delete(oldestKey)
}

/** rename / remove 后按前缀清掉失效的 DirectoryHandle */
export function invalidateMountDirHandleCache(
  locationId: MountFilesLocationId,
  pathPrefix?: string,
): void {
  const prefix = `${locationId}\0`
  for (const key of [...dirHandleCache.keys()]) {
    if (!key.startsWith(prefix)) continue
    if (pathPrefix === undefined) {
      dirHandleCache.delete(key)
      continue
    }
    const cachedPath = key.slice(prefix.length)
    if (
      cachedPath === pathPrefix ||
      cachedPath.startsWith(`${pathPrefix}/`) ||
      pathPrefix.startsWith(`${cachedPath}/`)
    ) {
      dirHandleCache.delete(key)
    }
  }
}

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

async function getRootHandle(locationId: MountFilesLocationId): Promise<FileSystemDirectoryHandle> {
  const mount = await getMount(locationId)
  if (!mount) {
    throw new Error('挂载已不存在，请重新挂载')
  }
  const grantedUntil = permissionGrantedUntil.get(locationId) ?? 0
  if (osNowMs() >= grantedUntil) {
    await ensureMountPermission(mount.id, mount.label, mount.handle)
    permissionGrantedUntil.set(locationId, osNowMs() + PERMISSION_GRANTED_TTL_MS)
  }
  touchDirCache(locationId, undefined, mount.handle)
  return mount.handle
}

async function resolveDirectoryHandle(
  locationId: MountFilesLocationId,
  root: FileSystemDirectoryHandle,
  path: string | undefined,
): Promise<FileSystemDirectoryHandle> {
  if (!path) return root

  const cached = dirHandleCache.get(dirCacheKey(locationId, path))
  if (cached) {
    cached.lastUsed = osNowMs()
    return cached.handle
  }

  // 尽量从最长已缓存前缀继续走，避免每次从根重走
  const segments = path.split('/').filter(Boolean)
  let start = 0
  let current = root
  let currentPath: string | undefined
  for (let i = segments.length - 1; i >= 1; i -= 1) {
    const prefix = segments.slice(0, i).join('/')
    const hit = dirHandleCache.get(dirCacheKey(locationId, prefix))
    if (hit) {
      hit.lastUsed = osNowMs()
      current = hit.handle
      currentPath = prefix
      start = i
      break
    }
  }

  for (let i = start; i < segments.length; i += 1) {
    const segment = segments[i]
    if (!segment) continue
    current = await current.getDirectoryHandle(segment)
    currentPath = currentPath ? `${currentPath}/${segment}` : segment
    touchDirCache(locationId, currentPath, current)
  }
  return current
}

async function resolveParentAndName(
  locationId: MountFilesLocationId,
  path: string,
): Promise<{ parent: FileSystemDirectoryHandle; name: string }> {
  const root = await getRootHandle(locationId)
  const parentPath = parentDirPath(path)
  const parent = await resolveDirectoryHandle(locationId, root, parentPath)
  return { parent, name: baseName(path) }
}

/**
 * 挂载卷绝对相对路径快路径：直接 getDirectoryHandle / getFileHandle，不 list 全目录。
 * `relativePath` 为卷根下路径（不含 mount key），空字符串表示卷根本身不返回节点。
 */
export async function resolveMountRelativePath(
  locationId: MountFilesLocationId,
  relativePath: string,
): Promise<FilesNode | undefined> {
  const trimmed = relativePath.replace(/^\/+|\/+$/g, '')
  if (!trimmed) return undefined

  try {
    const root = await getRootHandle(locationId)
    const parentPath = parentDirPath(trimmed)
    const name = baseName(trimmed)
    const parent = await resolveDirectoryHandle(locationId, root, parentPath)

    try {
      const dirHandle = await parent.getDirectoryHandle(name)
      touchDirCache(locationId, trimmed, dirHandle)
      return makeDirNode(locationId, trimmed)
    } catch {
      // not a directory
    }

    try {
      const handle = await parent.getFileHandle(name)
      let byteSize = 0
      let updatedAt = osNowMs()
      try {
        const blob = await handle.getFile()
        byteSize = blob.size
        updatedAt = blob.lastModified
      } catch {
        // 元数据可选
      }
      return makeFileNode(locationId, trimmed, byteSize, updatedAt)
    } catch {
      return undefined
    }
  } catch {
    return undefined
  }
}

export async function getMountNode(id: string): Promise<FilesNode | undefined> {
  if (!isMountNodeId(id)) return undefined

  const dir = parseDirPath(id)
  if (dir) {
    try {
      const root = await getRootHandle(dir.locationId)
      await resolveDirectoryHandle(dir.locationId, root, dir.path)
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

  const directory = await resolveDirectoryHandle(locationId, root, folderPath)
  const dirs: FilesNode[] = []
  const files: FilesNode[] = []

  for await (const [name, handle] of directory.entries()) {
    const path = joinPath(folderPath, name)
    if (handle.kind === 'directory') {
      touchDirCache(locationId, path, handle)
      dirs.push(makeDirNode(locationId, path))
    } else {
      // 列举保持轻量；大小/修改时间由可视区懒加载补齐
      files.push(makeFileNode(locationId, path))
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

/**
 * 读取挂载文本，但仅当文件大小不超过 maxBytes。
 * 先取 getFile().size 探测（元数据，不读内容），超出直接返回 undefined，避免大文件整读进内存。
 * 同一 handle 只做一次 getFile()，探测与读取合并。
 */
export async function readMountTextIfSmall(
  id: string,
  maxBytes: number,
): Promise<string | undefined> {
  const parsed = parseFilePath(id)
  if (!parsed) {
    return undefined
  }
  const { parent, name } = await resolveParentAndName(parsed.locationId, parsed.path)
  const handle = await parent.getFileHandle(name)
  const blob = await handle.getFile()
  if (blob.size > maxBytes) {
    return undefined
  }
  return blob.text()
}

export async function readMountBlob(
  id: string,
): Promise<{ node: FilesNode; blob: Blob }> {
  const parsed = parseFilePath(id)
  if (!parsed) {
    throw new Error('文件不存在')
  }
  const { parent, name } = await resolveParentAndName(parsed.locationId, parsed.path)
  const handle = await parent.getFileHandle(name)
  const blob = await handle.getFile()
  return {
    node: makeFileNode(parsed.locationId, parsed.path, blob.size, blob.lastModified),
    blob,
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

export async function writeMountBlob(id: string, bytes: ArrayBuffer): Promise<FilesNode> {
  const parsed = parseFilePath(id)
  if (!parsed) {
    throw new Error('文件不存在')
  }
  const { parent, name } = await resolveParentAndName(parsed.locationId, parsed.path)
  const handle = await parent.getFileHandle(name)
  const writable = await handle.createWritable()
  await writable.write(bytes)
  await writable.close()
  const blob = await handle.getFile()
  return makeFileNode(parsed.locationId, parsed.path, blob.size, blob.lastModified)
}

/**
 * 挂载卷按偏移随机写：open + seek + write。
 * 若 offset 超过当前文件大小，中间空洞用 0 填充。
 */
export async function writeMountBytesRange(
  id: string,
  offset: number,
  bytes: ArrayBuffer | Uint8Array,
): Promise<FilesNode> {
  if (offset < 0) {
    throw new Error('offset 不能为负数')
  }
  const parsed = parseFilePath(id)
  if (!parsed) {
    throw new Error('文件不存在')
  }
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const { parent, name } = await resolveParentAndName(parsed.locationId, parsed.path)
  const handle = await parent.getFileHandle(name)

  const before = await handle.getFile().catch(() => new File([], name))
  const writable = await handle.createWritable({ keepExistingData: true })
  try {
    if (offset > before.size) {
      // offset 超出原文件大小：先补零扩展，避免 seek 越界行为不一致
      const pad = new Uint8Array(offset - before.size)
      await writable.seek(before.size)
      await writable.write(pad)
    }
    if (offset > 0) {
      await writable.seek(offset)
    }
    await writable.write(data)
    await writable.close()
  } catch (error) {
    try {
      await writable.abort()
    } catch {
      // ignore
    }
    throw error
  }

  const blob = await handle.getFile()
  invalidateMountDirHandleCache(parsed.locationId, parentDirPath(parsed.path) ?? '')
  return makeFileNode(parsed.locationId, parsed.path, blob.size, blob.lastModified)
}

/**
 * 挂载卷流式写：复用 FileSystemWritableFileStream 原生增量写（逐 chunk 落盘）。
 * `createWritable()` 默认清空既有文件，与 writeMountBlob 语义一致；
 * 因此 abort 无法恢复被覆盖文件的旧内容（与真实 curl 覆盖行为类似）。
 * isNew 时 abort 会移除刚创建的空文件。
 */
export async function openMountStreamWrite(params: {
  locationId: MountFilesLocationId
  parentId: string | undefined
  name: string
  isNew: boolean
}): Promise<FilesStreamWriter> {
  const { locationId, parentId, name, isNew } = params
  const root = await getRootHandle(locationId)
  const parentPath = parentId === undefined ? undefined : parseDirPath(parentId)?.path
  if (parentId !== undefined && parentPath === undefined) {
    throw new Error('父级不是文件夹')
  }
  const parent = await resolveDirectoryHandle(locationId, root, parentPath)
  const handle = await parent.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  const path = joinPath(parentPath, name)

  return {
    node: makeFileNode(locationId, path),
    async write(chunk) {
      // FSA write 要求 ArrayBuffer 背板；拷贝后写入（写路径本就拷贝）
      const copy = new Uint8Array(chunk.byteLength)
      copy.set(chunk)
      await writable.write(copy)
    },
    async close() {
      await writable.close()
      const blob = await handle.getFile()
      invalidateMountDirHandleCache(locationId, parentPath)
      return makeFileNode(locationId, path, blob.size, blob.lastModified)
    },
    async abort() {
      try {
        await writable.abort()
      } catch {
        // 已关闭 / 未写入等：忽略
      }
      if (isNew) {
        try {
          await parent.removeEntry(name)
        } catch {
          // 文件可能已被外部改动 / 删除
        }
      }
      invalidateMountDirHandleCache(locationId, parentPath)
    },
  }
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
  const parent = await resolveDirectoryHandle(params.locationId, root, parentPath)
  await parent.getDirectoryHandle(params.name, { create: true })
  const createdPath = joinPath(parentPath, params.name)
  invalidateMountDirHandleCache(params.locationId, parentPath)
  return makeDirNode(params.locationId, createdPath)
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
  const parent = await resolveDirectoryHandle(params.locationId, root, parentPath)
  const handle = await parent.getFileHandle(params.name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(params.text)
  await writable.close()
  const path = joinPath(parentPath, params.name)
  const blob = await handle.getFile()
  return makeFileNode(params.locationId, path, blob.size, blob.lastModified)
}

export async function createMountBinaryFile(params: {
  locationId: MountFilesLocationId
  parentId: string | undefined
  name: string
  bytes: ArrayBuffer
}): Promise<FilesNode> {
  const root = await getRootHandle(params.locationId)
  const parentPath =
    params.parentId === undefined ? undefined : parseDirPath(params.parentId)?.path
  if (params.parentId !== undefined && parentPath === undefined) {
    throw new Error('父级不是文件夹')
  }
  const parent = await resolveDirectoryHandle(params.locationId, root, parentPath)
  const handle = await parent.getFileHandle(params.name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(params.bytes)
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
    invalidateMountDirHandleCache(dir.locationId, parentDirPath(dir.path) ?? '')
    invalidateMountDirHandleCache(dir.locationId, dir.path)
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
    const buffer = await blob.arrayBuffer()
    const next = await parent.getFileHandle(nextName, { create: true })
    const writable = await next.createWritable()
    await writable.write(buffer)
    await writable.close()
    await parent.removeEntry(name)
  }

  const nextPath = joinPath(parentDirPath(file.path), nextName)
  const nextHandle = await parent.getFileHandle(nextName)
  const nextBlob = await nextHandle.getFile()
  invalidateMountDirHandleCache(file.locationId, parentDirPath(file.path) ?? '')
  return makeFileNode(file.locationId, nextPath, nextBlob.size, nextBlob.lastModified)
}

export async function removeMountNode(id: string): Promise<void> {
  const dir = parseDirPath(id)
  if (dir) {
    const { parent, name } = await resolveParentAndName(dir.locationId, dir.path)
    await parent.removeEntry(name, { recursive: true })
    invalidateMountDirHandleCache(dir.locationId, dir.path)
    invalidateMountDirHandleCache(dir.locationId, parentDirPath(dir.path))
    return
  }

  const file = parseFilePath(id)
  if (!file) {
    throw new Error('项目不存在')
  }
  const { parent, name } = await resolveParentAndName(file.locationId, file.path)
  await parent.removeEntry(name)
}
