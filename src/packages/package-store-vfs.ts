/**
 * NPM CAS store 在 /dev 下的命名空间：走系统层 ensure，绕过卷根「不可直接新建」，
 * 并同步 VFS 缓存，供后续普通 files API 建子树。
 */
import { collectSubtreeIds, updateNodeAttributes } from '../apps/files/files-storage.ts'
import type { FilesNodeAttributes } from '../apps/files/files-types.ts'
import { ensureDevSystemFolder } from '../apps/files/files-system-vfs.ts'
import {
  invalidateFilesVfsPathCaches,
  removeNodeForced,
  resolveNodeByAbsolutePath,
} from '../apps/files/files-vfs.ts'
import { DEFAULT_PACKAGE_STORE_ROOT } from './package-store-paths.ts'

const WORKSPACE_ATTRIBUTES: FilesNodeAttributes = { readable: true, writable: true }

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
  // attributes 经 storage 直写，需清路径缓存，否则仍可能读到旧的 writable
  invalidateFilesVfsPathCaches()
}

/** PackageService 专用：删除 store 子树（含只读节点）。 */
export async function removeStoreTreeForced(absolutePath: string): Promise<void> {
  const node = await resolveNodeByAbsolutePath(absolutePath, { follow: false })
  if (!node) return
  await removeNodeForced(node.id)
}
