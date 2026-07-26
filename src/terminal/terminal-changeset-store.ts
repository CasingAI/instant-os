/**
 * 终端受控模式私有仓：改前副本与 session 元数据。
 * 走 files-storage 系统层；不进 guest fsReadRoots。
 */
import { osNowMs } from '../os/os-clock.ts'
import {
  filesLocationPathRoot,
  joinFilesAbsolutePath,
  parseFilesAbsolutePath,
} from '../apps/files/files-path.ts'
import {
  cloneFileNodeWithSharedBlob,
  createFileWithBytes,
  estimateNodeMetaBytes,
  newFilesNodeId,
  readBlobBytes,
  writeBlobBytes,
} from '../apps/files/files-storage.ts'
import type { FilesLocationId, FilesNode, FilesNodeAttributes } from '../apps/files/files-types.ts'
import {
  deleteDevSystemSubtree,
  emitSystemVfsChange,
  ensureDevSystemFolder,
} from '../apps/files/files-system-vfs.ts'
import { resolveNodeByAbsolutePath } from '../apps/files/files-vfs.ts'
import { filesReadBlob } from '../apps/files/files-api.ts'
import type { TerminalChangeSet } from './terminal-changeset.ts'

const DEV_FILES_ROOT = filesLocationPathRoot('dev')
export const TERMINAL_DEV_ROOT = joinFilesAbsolutePath(DEV_FILES_ROOT, 'terminal')
export const TERMINAL_OBJECTS_ROOT = joinFilesAbsolutePath(TERMINAL_DEV_ROOT, '.objects')
export const TERMINAL_SESSIONS_ROOT = joinFilesAbsolutePath(TERMINAL_DEV_ROOT, 'sessions')

const SYSTEM_ATTRIBUTES: FilesNodeAttributes = { readable: true, writable: false }

function isIndexedDbLocation(locationId: FilesLocationId): boolean {
  return locationId === 'local' || locationId === 'dev'
}

export async function ensureTerminalChangesetRoots(): Promise<void> {
  await ensureDevSystemFolder(TERMINAL_DEV_ROOT)
  await ensureDevSystemFolder(TERMINAL_OBJECTS_ROOT)
  await ensureDevSystemFolder(TERMINAL_SESSIONS_ROOT)
}

function newBeforeBlobId(): string {
  return crypto.randomUUID().replaceAll('-', '')
}

async function objectPathForId(blobId: string): Promise<string> {
  await ensureTerminalChangesetRoots()
  const shardPath = joinFilesAbsolutePath(TERMINAL_OBJECTS_ROOT, blobId.slice(0, 2))
  await ensureDevSystemFolder(shardPath)
  return joinFilesAbsolutePath(shardPath, blobId)
}

async function deleteNodeSubtree(node: FilesNode): Promise<void> {
  await deleteDevSystemSubtree(node)
}

/**
 * 将工作区文件的改前内容写入私有仓。
 * IndexedDB 本地卷优先 COW clone；其它卷整份拷贝字节。
 */
export async function putBeforeBlobFromPath(
  absolutePath: string,
): Promise<{ blobId: string; byteSize: number } | undefined> {
  const source = await resolveNodeByAbsolutePath(absolutePath, { follow: false })
  if (!source || source.kind !== 'file') {
    return undefined
  }

  const blobId = newBeforeBlobId()
  const path = await objectPathForId(blobId)
  const parsed = parseFilesAbsolutePath(path)
  if (!parsed) throw new Error(`无效的对象路径：${path}`)
  const parentSegments = parsed.segments.slice(0, -1)
  const name = parsed.segments[parsed.segments.length - 1]
  if (!name) throw new Error(`无效的对象路径：${path}`)
  const parentPath = joinFilesAbsolutePath(DEV_FILES_ROOT, ...parentSegments)
  const parent = await ensureDevSystemFolder(parentPath)

  const now = osNowMs()
  const destNode: FilesNode = {
    id: newFilesNodeId(),
    locationId: 'dev',
    parentId: parent.id,
    name,
    kind: 'file',
    mimeType: source.mimeType ?? 'application/octet-stream',
    byteSize: source.byteSize,
    createdAt: now,
    updatedAt: now,
    attributes: SYSTEM_ATTRIBUTES,
  }

  if (isIndexedDbLocation(source.locationId)) {
    await cloneFileNodeWithSharedBlob({
      sourceNodeId: source.id,
      node: destNode,
      metaBytes: estimateNodeMetaBytes(destNode),
    })
    emitSystemVfsChange(path, 'created')
    return { blobId, byteSize: source.byteSize }
  }

  const blob = await filesReadBlob(absolutePath)
  const bytes = await blob.arrayBuffer()
  destNode.byteSize = bytes.byteLength
  await createFileWithBytes({
    node: destNode,
    bytes,
    metaBytes: estimateNodeMetaBytes(destNode),
  })
  emitSystemVfsChange(path, 'created')
  return { blobId, byteSize: bytes.byteLength }
}

export async function readBeforeBlobBytes(blobId: string): Promise<Uint8Array | undefined> {
  const path = joinFilesAbsolutePath(TERMINAL_OBJECTS_ROOT, blobId.slice(0, 2), blobId)
  const node = await resolveNodeByAbsolutePath(path)
  if (!node || node.kind !== 'file') return undefined
  const bytes = await readBlobBytes(node.id)
  return bytes ? new Uint8Array(bytes) : undefined
}

export async function removeBeforeBlob(blobId: string): Promise<void> {
  const path = joinFilesAbsolutePath(TERMINAL_OBJECTS_ROOT, blobId.slice(0, 2), blobId)
  const node = await resolveNodeByAbsolutePath(path)
  if (!node) return
  await deleteNodeSubtree(node)
}

function sessionPath(sessionId: string): string {
  return joinFilesAbsolutePath(TERMINAL_SESSIONS_ROOT, `${sessionId}.json`)
}

export async function saveTerminalChangeSession(changeSet: TerminalChangeSet): Promise<void> {
  await ensureTerminalChangesetRoots()
  const path = sessionPath(changeSet.sessionId)
  const text = `${JSON.stringify(changeSet, null, 2)}\n`
  const bytes = new TextEncoder().encode(text)
  const existing = await resolveNodeByAbsolutePath(path)
  if (existing?.kind === 'file') {
    await writeBlobBytes({
      id: existing.id,
      bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      previousByteSize: existing.byteSize,
      nameMetaDelta: 0,
    })
    emitSystemVfsChange(path, 'modified')
    return
  }

  const parsed = parseFilesAbsolutePath(path)
  if (!parsed) throw new Error(`无效的 session 路径：${path}`)
  const name = parsed.segments[parsed.segments.length - 1]
  if (!name) throw new Error(`无效的 session 路径：${path}`)
  const parent = await ensureDevSystemFolder(TERMINAL_SESSIONS_ROOT)
  const now = osNowMs()
  const node: FilesNode = {
    id: newFilesNodeId(),
    locationId: 'dev',
    parentId: parent.id,
    name,
    kind: 'file',
    mimeType: 'application/json',
    byteSize: bytes.byteLength,
    createdAt: now,
    updatedAt: now,
    attributes: SYSTEM_ATTRIBUTES,
  }
  await createFileWithBytes({
    node,
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    metaBytes: estimateNodeMetaBytes(node),
  })
  emitSystemVfsChange(path, 'created')
}

export async function loadTerminalChangeSession(
  sessionId: string,
): Promise<TerminalChangeSet | undefined> {
  const path = sessionPath(sessionId)
  const node = await resolveNodeByAbsolutePath(path)
  if (!node || node.kind !== 'file') return undefined
  const bytes = await readBlobBytes(node.id)
  if (!bytes) return undefined
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as TerminalChangeSet
    if (!parsed || typeof parsed.sessionId !== 'string' || !Array.isArray(parsed.changes)) {
      return undefined
    }
    return parsed
  } catch {
    return undefined
  }
}

export async function deleteTerminalChangeSession(sessionId: string): Promise<void> {
  const changeSet = await loadTerminalChangeSession(sessionId)
  if (changeSet) {
    const seen = new Set<string>()
    for (const entry of changeSet.changes) {
      const id = entry.beforeBlobId
      if (!id || seen.has(id)) continue
      seen.add(id)
      await removeBeforeBlob(id)
    }
  }
  const path = sessionPath(sessionId)
  const node = await resolveNodeByAbsolutePath(path)
  if (node) {
    await deleteNodeSubtree(node)
  }
}
