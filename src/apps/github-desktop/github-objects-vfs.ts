/**
 * GitHub 基线对象库与受保护目录专用存储。
 * 走 files-storage（系统 / root 层），不检查节点 writable。
 */
import { osNowMs } from '../../os/os-clock.ts'
import {
  filesLocationPathRoot,
  joinFilesAbsolutePath,
  parseFilesAbsolutePath,
} from '../files/files-path.ts'
import {
  createFileWithBytes,
  estimateNodeMetaBytes,
  newFilesNodeId,
  readBlobBytes,
  writeBlobBytes,
} from '../files/files-storage.ts'
import type { FilesNode, FilesNodeAttributes } from '../files/files-types.ts'
import {
  deleteDevSystemSubtree,
  emitSystemVfsChange,
  ensureDevSystemFolder,
} from '../files/files-system-vfs.ts'
import { resolveNodeByAbsolutePath } from '../files/files-vfs.ts'
import {
  GITHUB_OBJECTS_ROOT,
  githubRepoRootPath,
  githubUserRootPath,
} from './github-repo-paths.ts'

const DEV_FILES_ROOT = filesLocationPathRoot('dev')
const SYSTEM_ATTRIBUTES: FilesNodeAttributes = { readable: true, writable: false }
const WORKSPACE_ATTRIBUTES: FilesNodeAttributes = { readable: true, writable: true }

export async function ensureGithubObjectsRoot(): Promise<void> {
  await ensureDevSystemFolder(githubUserRootPath())
  await ensureDevSystemFolder(GITHUB_OBJECTS_ROOT)
}

export async function ensureGithubUserRootFolder(): Promise<void> {
  await ensureDevSystemFolder(githubUserRootPath())
}

export async function ensureGithubRepoRootFolder(owner: string, repo: string): Promise<string> {
  await ensureGithubUserRootFolder()
  await ensureDevSystemFolder(joinFilesAbsolutePath(githubUserRootPath(), owner))
  const repoPath = githubRepoRootPath(owner, repo)
  await ensureDevSystemFolder(repoPath, WORKSPACE_ATTRIBUTES)
  return repoPath
}

/** 系统层删除节点子树（绕过 writable），并通知文件监视 */
export async function deleteGithubNodeSubtree(node: FilesNode): Promise<void> {
  await deleteDevSystemSubtree(node)
}

async function objectPathForHash(hash: string): Promise<string> {
  await ensureGithubObjectsRoot()
  const shardPath = joinFilesAbsolutePath(GITHUB_OBJECTS_ROOT, hash.slice(0, 2))
  await ensureDevSystemFolder(shardPath)
  return joinFilesAbsolutePath(shardPath, hash)
}

export async function githubObjectStat(hash: string): Promise<FilesNode | undefined> {
  const path = joinFilesAbsolutePath(GITHUB_OBJECTS_ROOT, hash.slice(0, 2), hash)
  const node = await resolveNodeByAbsolutePath(path)
  return node?.kind === 'file' ? node : undefined
}

export async function writeGithubObjectBlob(
  hash: string,
  bytes: ArrayBuffer,
  overwrite: boolean,
): Promise<void> {
  const path = await objectPathForHash(hash)
  const existing = await resolveNodeByAbsolutePath(path)
  if (existing?.kind === 'file') {
    if (!overwrite) return
    await writeBlobBytes({
      id: existing.id,
      bytes,
      previousByteSize: existing.byteSize,
      nameMetaDelta: 0,
    })
    emitSystemVfsChange(path, 'modified')
    return
  }

  const parsed = parseFilesAbsolutePath(path)
  if (!parsed) throw new Error(`无效的对象路径：${path}`)
  const parentSegments = parsed.segments.slice(0, -1)
  const name = parsed.segments[parsed.segments.length - 1]
  if (!name) throw new Error(`无效的对象路径：${path}`)
  const parentPath = joinFilesAbsolutePath(DEV_FILES_ROOT, ...parentSegments)
  const parent = await ensureDevSystemFolder(parentPath)

  const now = osNowMs()
  const node: FilesNode = {
    id: newFilesNodeId(),
    locationId: 'dev',
    parentId: parent.id,
    name,
    kind: 'file',
    mimeType: 'application/octet-stream',
    byteSize: bytes.byteLength,
    createdAt: now,
    updatedAt: now,
    attributes: SYSTEM_ATTRIBUTES,
  }
  await createFileWithBytes({
    node,
    bytes,
    metaBytes: estimateNodeMetaBytes(node),
  })
  emitSystemVfsChange(path, 'created')
}

export async function readGithubObjectBytes(hash: string): Promise<Uint8Array | undefined> {
  const node = await githubObjectStat(hash)
  if (!node) return undefined
  const bytes = await readBlobBytes(node.id)
  return bytes ? new Uint8Array(bytes) : undefined
}

export async function removeGithubObjectBlob(hash: string): Promise<void> {
  const node = await githubObjectStat(hash)
  if (!node) return
  await deleteGithubNodeSubtree(node)
}
