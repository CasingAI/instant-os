/**
 * 应用数据系统层目录 ensure / 写入（绕过 applications 卷只读，直接操作 IndexedDB）。
 * 文件管理器 / 终端对 /Applications 卷保持只读；应用内部 API 通过本模块在
 * applications 卷下创建 `{bundlePath}/Data` 真实目录并写文件。
 */
import { osNowMs } from '../../os/os-clock.ts'
import { APP_DATA_DIR_NAME } from './files-app-data-root.ts'
import { appBundleDirName } from './files-app-id.ts'
import {
  createFolderNode,
  createFileWithBlob,
  estimateNodeMetaBytes,
  estimateTextBytes,
  listChildNodes,
  newFilesNodeId,
  writeBlobText,
} from './files-storage.ts'
import type { FilesNode, FilesNodeAttributes } from './files-types.ts'
import {
  FILES_VFS_CHANGED_EVENT,
  invalidateFilesVfsPathCaches,
} from './files-vfs.ts'
import { notifyFilesWatch, type FilesWatchChangeKind } from './files-watch.ts'

const LOCATION_ID = 'applications' as const
/** 包内系统目录（bundle 根、Data 根）只读 */
const SYSTEM_FOLDER_ATTRIBUTES: FilesNodeAttributes = { readable: true, writable: false }

function emitSystemVfsChange(path: string, kind: FilesWatchChangeKind): void {
  invalidateFilesVfsPathCaches()
  notifyFilesWatch({ kind, path })
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(FILES_VFS_CHANGED_EVENT))
  }
}

/**
 * 按路径段逐层确保 applications 卷下真实文件夹存在（系统层，绕过只读）。
 * 返回最后一个（叶子）文件夹节点。
 */
async function ensureFolderBySegments(
  segments: readonly string[],
  attributes: FilesNodeAttributes,
): Promise<FilesNode> {
  let parentId: string | undefined
  let leaf: FilesNode | undefined
  for (let index = 0; index < segments.length; index += 1) {
    const name = segments[index]
    if (!name) throw new Error('无效的应用数据路径')
    const children = await listChildNodes(LOCATION_ID, parentId)
    const existing = children.find((child) => child.name === name)
    if (existing) {
      if (existing.kind !== 'folder') {
        throw new Error(`路径冲突：${name} 不是文件夹`)
      }
      parentId = existing.id
      leaf = existing
      continue
    }
    const now = osNowMs()
    const node: FilesNode = {
      id: newFilesNodeId(),
      locationId: LOCATION_ID,
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
      nameMode: 'folder-return',
    })
    parentId = created.id
    leaf = created
  }
  if (!leaf) throw new Error('无效的应用数据路径')
  return leaf
}

/** `{bundlePath}/Data` 在 applications 卷下的路径段 */
function dataRootSegments(appId: string): string[] {
  return [appBundleDirName(appId), APP_DATA_DIR_NAME]
}

/** 确保 `{bundlePath}/Data` 真身目录存在（幂等），返回 Data 根真实节点 */
export async function ensureApplicationsDataRoot(appId: string): Promise<FilesNode> {
  const segments = dataRootSegments(appId)
  const dataRoot = await ensureFolderBySegments(segments, SYSTEM_FOLDER_ATTRIBUTES)
  return dataRoot
}

/** 写应用数据文件：先确保 Data 根，再在 applications 卷真身写文件。 */
export async function writeAppDataSystemFile(params: {
  appId: string
  relativePath: string
  text: string
}): Promise<FilesNode> {
  await ensureApplicationsDataRoot(params.appId)
  const rel = params.relativePath.trim().replace(/^\/+|\/+$/g, '')
  if (!rel) throw new Error('应用数据文件路径不能为空')

  const segments = [...dataRootSegments(params.appId), ...rel.split('/')]
  const fileName = segments[segments.length - 1]!
  const parentSegments = segments.slice(0, -1)

  const parent = await ensureFolderBySegments(parentSegments, SYSTEM_FOLDER_ATTRIBUTES)
  const siblings = await listChildNodes(LOCATION_ID, parent.id)
  const existing = siblings.find((child) => child.name === fileName)

  const now = osNowMs()
  const textBytes = estimateTextBytes(params.text)
  if (existing && existing.kind === 'file') {
    const updated = await writeBlobText({
      id: existing.id,
      text: params.text,
      previousByteSize: existing.byteSize,
      nameMetaDelta: 0,
    })
    emitSystemVfsChange(`/Applications/${segments.join('/')}`, 'modified')
    return updated
  }

  const node: FilesNode = {
    id: newFilesNodeId(),
    locationId: LOCATION_ID,
    parentId: parent.id,
    name: fileName,
    kind: 'file',
    mimeType: 'application/json',
    byteSize: textBytes,
    createdAt: now,
    updatedAt: now,
    attributes: SYSTEM_FOLDER_ATTRIBUTES,
  }
  const created = await createFileWithBlob({
    node,
    text: params.text,
    metaBytes: estimateNodeMetaBytes(node),
    nameMode: 'exact',
  })
  const path = `/Applications/${segments.join('/')}`
  emitSystemVfsChange(path, 'created')
  return created
}
