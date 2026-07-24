/**
 * NPM CAS store 在 /dev 下的命名空间：走 files-storage 系统层，绕过卷根「不可直接新建」。
 */
import { osNowMs } from '../os/os-clock.ts'
import { filesLocationPathRoot, joinFilesAbsolutePath, parseFilesAbsolutePath } from '../apps/files/files-path.ts'
import {
  createFolderNode,
  collectSubtreeIds,
  estimateNodeMetaBytes,
  newFilesNodeId,
  updateNodeAttributes,
} from '../apps/files/files-storage.ts'
import type { FilesNode, FilesNodeAttributes } from '../apps/files/files-types.ts'
import { removeNodeForced, resolveNodeByAbsolutePath } from '../apps/files/files-vfs.ts'
import { DEFAULT_PACKAGE_STORE_ROOT } from './package-store-paths.ts'

const DEV_FILES_ROOT = filesLocationPathRoot('dev')
const WORKSPACE_ATTRIBUTES: FilesNodeAttributes = { readable: true, writable: true }

function attributesMatch(a: FilesNodeAttributes, b: FilesNodeAttributes): boolean {
  return a.readable === b.readable && a.writable === b.writable
}

async function ensureDevSystemFolder(
  absolutePath: string,
  attributes: FilesNodeAttributes,
): Promise<FilesNode> {
  const parsed = parseFilesAbsolutePath(absolutePath)
  if (!parsed || parsed.locationId !== 'dev') {
    throw new Error(`无效的系统路径：${absolutePath}`)
  }
  if (parsed.segments.length === 0) {
    throw new Error(`不能 ensure 卷根：${absolutePath}`)
  }

  const existing = await resolveNodeByAbsolutePath(absolutePath)
  if (existing) {
    if (existing.kind !== 'folder') {
      throw new Error(`路径冲突：${absolutePath} 不是文件夹`)
    }
    if (!attributesMatch(existing.attributes, attributes)) {
      return updateNodeAttributes(existing.id, attributes)
    }
    return existing
  }

  const parentSegments = parsed.segments.slice(0, -1)
  const name = parsed.segments[parsed.segments.length - 1]
  if (!name) throw new Error(`无效的系统路径：${absolutePath}`)

  let parentId: string | undefined
  if (parentSegments.length > 0) {
    const parentPath = joinFilesAbsolutePath(DEV_FILES_ROOT, ...parentSegments)
    const parent = await ensureDevSystemFolder(parentPath, { readable: true, writable: false })
    parentId = parent.id
  }

  const now = osNowMs()
  const node: FilesNode = {
    id: newFilesNodeId(),
    locationId: 'dev',
    parentId,
    name,
    kind: 'folder',
    mimeType: undefined,
    byteSize: 0,
    createdAt: now,
    updatedAt: now,
    attributes,
  }
  await createFolderNode({ node, metaBytes: estimateNodeMetaBytes(node) })
  return node
}

/** 确保 `/dev/npm` 存在且可写，供普通 files API 继续建子树 */
export async function ensureNpmStoreNamespace(): Promise<void> {
  await ensureDevSystemFolder(DEFAULT_PACKAGE_STORE_ROOT, WORKSPACE_ATTRIBUTES)
}

const STORE_PACKAGE_READONLY: FilesNodeAttributes = { readable: true, writable: false }

/** 将已提交的版本目录整树标为只读（幂等）。 */
export async function freezeStorePackageTree(storePath: string): Promise<void> {
  const node = await resolveNodeByAbsolutePath(storePath)
  if (!node || node.kind !== 'folder') return
  const subtree = await collectSubtreeIds(node.id)
  for (const id of subtree.nodeIds) {
    await updateNodeAttributes(id, STORE_PACKAGE_READONLY)
  }
}

/** PackageService 专用：删除 store 子树（含只读节点）。 */
export async function removeStoreTreeForced(absolutePath: string): Promise<void> {
  const node = await resolveNodeByAbsolutePath(absolutePath, { follow: false })
  if (!node) return
  await removeNodeForced(node.id)
}
