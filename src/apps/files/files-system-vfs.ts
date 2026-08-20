/**
 * dev 卷系统层目录 ensure / 删除。
 * 内置应用绕过 guest writable 直接写 IndexedDB 时使用；须同步 VFS 读缓存与 UI 通知。
 */
import { osNowMs } from '../../os/os-clock.ts'
import { filesLocationPathRoot, joinFilesAbsolutePath, parseFilesAbsolutePath } from './files-path.ts'
import {
  collectSubtreeIds,
  createFolderNode,
  deleteSubtree,
  estimateNodeMetaBytes,
  listChildNodes,
  newFilesNodeId,
  updateNodeAttributes,
} from './files-storage.ts'
import type { FilesNode, FilesNodeAttributes } from './files-types.ts'
import {
  FILES_VFS_CHANGED_EVENT,
  invalidateFilesVfsPathCaches,
  resolveFilesAbsolutePath,
  resolveNodeByAbsolutePath,
} from './files-vfs.ts'
import { notifyFilesWatch, type FilesWatchChangeKind } from './files-watch.ts'

const DEV_FILES_ROOT = filesLocationPathRoot('dev')

export const DEV_SYSTEM_FOLDER_ATTRIBUTES: FilesNodeAttributes = {
  readable: true,
  writable: false,
}

function attributesMatch(a: FilesNodeAttributes, b: FilesNodeAttributes): boolean {
  return a.readable === b.readable && a.writable === b.writable
}

async function patchFolderAttributes(
  node: FilesNode,
  attributes: FilesNodeAttributes,
  absolutePath: string,
): Promise<FilesNode> {
  if (attributesMatch(node.attributes, attributes)) return node
  const updated = await updateNodeAttributes(node.id, attributes)
  emitSystemVfsChange(absolutePath, 'modified')
  return updated
}

/** 系统层写入后通知 VFS 与文件管理器刷新 */
export function emitSystemVfsChange(path: string, kind: FilesWatchChangeKind): void {
  invalidateFilesVfsPathCaches()
  notifyFilesWatch({ kind, path })
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(FILES_VFS_CHANGED_EVENT))
  }
}

/** 系统层删除子树（绕过 writable），并同步 VFS */
export async function deleteDevSystemSubtree(node: FilesNode): Promise<void> {
  const path = await resolveFilesAbsolutePath(node)
  const subtree = await collectSubtreeIds(node.id)
  await deleteSubtree(subtree)
  emitSystemVfsChange(path, 'deleted')
}

/**
 * 确保 dev 卷下系统文件夹存在；不重复创建同名同级目录。
 * 父级链使用 DEV_SYSTEM_FOLDER_ATTRIBUTES；目标节点可使用自定义 attributes。
 */
export async function ensureDevSystemFolder(
  absolutePath: string,
  attributes: FilesNodeAttributes = DEV_SYSTEM_FOLDER_ATTRIBUTES,
): Promise<FilesNode> {
  const parsed = parseFilesAbsolutePath(absolutePath)
  if (!parsed || parsed.locationId !== 'dev') {
    throw new Error(`无效的系统路径：${absolutePath}`)
  }
  if (parsed.segments.length === 0) {
    throw new Error(`不能 ensure 卷根：${absolutePath}`)
  }

  const parentSegments = parsed.segments.slice(0, -1)
  const name = parsed.segments[parsed.segments.length - 1]
  if (!name) throw new Error(`无效的系统路径：${absolutePath}`)

  let parentId: string | undefined
  if (parentSegments.length > 0) {
    const parentPath = joinFilesAbsolutePath(DEV_FILES_ROOT, ...parentSegments)
    const parent = await ensureDevSystemFolder(parentPath, DEV_SYSTEM_FOLDER_ATTRIBUTES)
    parentId = parent.id
  }

  invalidateFilesVfsPathCaches()
  const byPath = await resolveNodeByAbsolutePath(absolutePath)
  if (byPath) {
    if (byPath.kind !== 'folder') {
      throw new Error(`路径冲突：${absolutePath} 不是文件夹`)
    }
    return patchFolderAttributes(byPath, attributes, absolutePath)
  }

  const siblings = await listChildNodes('dev', parentId)
  const byName = siblings.find((child) => child.name === name)
  if (byName) {
    if (byName.kind !== 'folder') {
      throw new Error(`路径冲突：${absolutePath} 不是文件夹`)
    }
    return patchFolderAttributes(byName, attributes, absolutePath)
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
  const created = await createFolderNode({
    node,
    metaBytes: estimateNodeMetaBytes(node),
    // 并发 ensure 撞上同名同类文件夹时视为已存在，直接复用库中已有节点
    nameMode: 'folder-return',
  })
  if (created.id === node.id) {
    emitSystemVfsChange(absolutePath, 'created')
    return created
  }
  // 并发窗口内撞上已有同名文件夹：复用已有节点（补属性）
  return patchFolderAttributes(created, attributes, absolutePath)
}
