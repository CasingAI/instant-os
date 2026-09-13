/**
 * VFS 文件名搜索：对给定目录子树做大小写不敏感的「包含」匹配。
 * - 本地卷：一次事务拉全子树（files-vfs listSubtreeNodes）
 * - 挂载 / 镜像卷（以及 models3d / source / applications）：按目录逐层 listDirectory BFS
 * 扫描（scan）与过滤（filter）分离：扫描产物 VfsNameSearchIndex 进模块级缓存，
 * 按键时只做内存过滤即时出结果，过期由后台重扫自愈。
 * 产物统一为 VfsNameSearchHit；本地卷命中带 absolutePath 供点击时解析完整节点，
 * 挂载 / 镜像卷命中直接携带 listDirectory 返回的节点。
 */
import { joinFilesAbsolutePath, filesLocationPathRoot } from './files-path.ts'
import {
  isImageLocationId,
  isMountLocationId,
  defaultFilesNodeAttributes,
  type FilesLocationId,
  type FilesNode,
} from './files-types.ts'
import {
  FILES_VFS_CHANGED_EVENT,
  listDirectory,
  listSubtreeNodes,
  type FilesSubtreeNodeEntry,
} from './files-vfs.ts'
import { FILES_MOUNTS_CHANGED_EVENT } from './files-mount-store.ts'
import { FILES_IMAGE_MOUNTS_CHANGED_EVENT } from './files-image-mount-store.ts'

export const DEFAULT_VFS_NAME_SEARCH_LIMIT = 500

export type VfsNameSearchHit = {
  kind: 'file' | 'folder'
  name: string
  /** 所在父目录相对搜索根的路径（'' = 搜索根的直接子项） */
  parentPath: string
  byteSize: number | undefined
  updatedAt: number | undefined
  /** 结果行图标用的节点表示；本地卷为合成节点（仅展示用，打开走 absolutePath） */
  node: FilesNode
  /** 本地卷命中的全局绝对路径；挂载 / 镜像卷为 undefined（直接用 node） */
  absolutePath: string | undefined
}

export type VfsNameSearchResult = {
  hits: VfsNameSearchHit[]
  /** 命中数超过 limit 被截断 */
  truncated: boolean
  /** 逐目录容错：单个目录列举失败不中断整次搜索 */
  errors: string[]
}

export type VfsNameSearchOptions = {
  signal?: AbortSignal
  limit?: number
}

export type VfsNameSearchRoot = {
  locationId: FilesLocationId
  /** 搜索根目录的 folder id（卷根为 undefined） */
  folderId: string | undefined
}

/** 扫描产物条目：与命中同构但未做匹配，node 仅 lister 卷携带（本地卷过滤期现造展示节点） */
export type VfsNameSearchIndexEntry = {
  kind: 'file' | 'folder'
  name: string
  parentPath: string
  byteSize: number | undefined
  updatedAt: number | undefined
  node: FilesNode | undefined
}

export type VfsNameSearchIndex = {
  entries: VfsNameSearchIndexEntry[]
  /** 扫描期逐目录容错错误，随过滤结果透出 */
  errors: string[]
  /** 扫描完成时刻，供缓存新鲜度判断 */
  scannedAt: number
}

function abortError(): Error {
  return new DOMException('搜索已取消', 'AbortError')
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function compareHits(a: VfsNameSearchHit, b: VfsNameSearchHit): number {
  if (a.kind !== b.kind) {
    return a.kind === 'folder' ? -1 : 1
  }
  const byName = a.name.localeCompare(b.name, 'zh-Hans')
  if (byName !== 0) return byName
  return a.parentPath.localeCompare(b.parentPath, 'zh-Hans')
}

function makeDisplayNode(locationId: FilesLocationId, entry: VfsNameSearchIndexEntry): FilesNode {
  return {
    id: `name-search:${entry.parentPath}/${entry.name}`,
    locationId,
    parentId: undefined,
    name: entry.name,
    kind: entry.kind,
    mimeType: undefined,
    byteSize: entry.byteSize ?? 0,
    createdAt: entry.updatedAt ?? 0,
    updatedAt: entry.updatedAt ?? 0,
    attributes: defaultFilesNodeAttributes(locationId),
  }
}

/** 按目录逐层列举的全量 BFS 扫描（不按查询早停，limit 在过滤期生效）。生产上 lister 即 listDirectory 绑定卷；测试注入内存树。 */
export async function scanNamesViaLister(
  lister: (folderId: string | undefined) => Promise<FilesNode[]>,
  rootFolderId: string | undefined,
  options: VfsNameSearchOptions = {},
): Promise<VfsNameSearchIndex> {
  const errors: string[] = []
  const entries: VfsNameSearchIndexEntry[] = []
  const queue: Array<{ folderId: string | undefined; parentPath: string }> = [
    { folderId: rootFolderId, parentPath: '' },
  ]
  while (queue.length > 0) {
    if (options.signal?.aborted) {
      throw abortError()
    }
    const current = queue.shift() as { folderId: string | undefined; parentPath: string }
    let children: FilesNode[]
    try {
      children = await lister(current.folderId)
    } catch (err) {
      errors.push(`${current.parentPath || '/'}: ${errorText(err)}`)
      continue
    }
    for (const child of children) {
      if (child.kind !== 'file' && child.kind !== 'folder') continue
      entries.push({
        kind: child.kind,
        name: child.name,
        parentPath: current.parentPath,
        byteSize: child.kind === 'file' ? child.byteSize : undefined,
        updatedAt: child.updatedAt,
        node: child,
      })
      if (child.kind === 'folder') {
        queue.push({
          folderId: child.id,
          parentPath: current.parentPath ? `${current.parentPath}/${child.name}` : child.name,
        })
      }
    }
  }
  return { entries, errors, scannedAt: Date.now() }
}

/** 内存过滤索引条目：同步、零 IO。命中构造 / 排序 / 截断与 searchVfsNames 语义一致。 */
export function filterVfsNameSearchIndex(
  index: VfsNameSearchIndex,
  root: VfsNameSearchRoot,
  query: string,
  options: VfsNameSearchOptions = {},
): VfsNameSearchResult {
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return { hits: [], truncated: false, errors: [] }
  }
  const limit = options.limit ?? DEFAULT_VFS_NAME_SEARCH_LIMIT
  const pathRoot = filesLocationPathRoot(root.locationId)
  const hits: VfsNameSearchHit[] = []
  let truncated = false
  for (const entry of index.entries) {
    if (!entry.name.toLowerCase().includes(normalized)) continue
    if (hits.length >= limit) {
      truncated = true
      break
    }
    if (entry.node) {
      hits.push({
        kind: entry.kind,
        name: entry.name,
        parentPath: entry.parentPath,
        byteSize: entry.byteSize,
        updatedAt: entry.updatedAt,
        node: entry.node,
        absolutePath: undefined,
      })
    } else {
      const relativeSegments = entry.parentPath ? entry.parentPath.split('/') : []
      hits.push({
        kind: entry.kind,
        name: entry.name,
        parentPath: entry.parentPath,
        byteSize: entry.byteSize,
        updatedAt: entry.updatedAt,
        node: makeDisplayNode(root.locationId, entry),
        absolutePath: joinFilesAbsolutePath(pathRoot, ...relativeSegments, entry.name),
      })
    }
  }
  hits.sort(compareHits)
  return { hits, truncated, errors: index.errors }
}

export async function searchNamesViaLister(
  lister: (folderId: string | undefined) => Promise<FilesNode[]>,
  rootFolderId: string | undefined,
  query: string,
  options: VfsNameSearchOptions = {},
): Promise<VfsNameSearchResult> {
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return { hits: [], truncated: false, errors: [] }
  }
  const index = await scanNamesViaLister(lister, rootFolderId, options)
  // root 的 locationId 只参与本地卷展示节点/绝对路径构造；lister 扫描条目恒带真实 node，走不到那条分支
  return filterVfsNameSearchIndex(index, { locationId: 'local', folderId: rootFolderId }, normalized, options)
}

/** models3d / source / applications 走逐层列举而非本地卷子树事务 */
const LISTER_ONLY_LOCATIONS: ReadonlySet<string> = new Set(['models3d', 'source', 'applications'])

export async function scanVfsNameSearchIndex(
  root: VfsNameSearchRoot,
  options: VfsNameSearchOptions = {},
): Promise<VfsNameSearchIndex> {
  if (
    isMountLocationId(root.locationId) ||
    isImageLocationId(root.locationId) ||
    LISTER_ONLY_LOCATIONS.has(root.locationId)
  ) {
    return scanNamesViaLister(
      (folderId) => listDirectory(root.locationId, folderId),
      root.folderId,
      options,
    )
  }

  if (options.signal?.aborted) {
    throw abortError()
  }
  // 本地卷：单事务拉全子树，无法中途取消，前后各检查一次信号。
  // 附加（主文件下的内部数据，如虚拟机硬盘缓存）不进搜索索引——路径带 .attach
  // 保留段，点开也解析不回节点；挂载/镜像卷走 listDirectory，本来就看不到附加。
  const entries = (await listSubtreeNodes(root.locationId, root.folderId)).filter(
    (entry) => !(entry.kind === 'file' && entry.attachment),
  )
  if (options.signal?.aborted) {
    throw abortError()
  }
  return {
    entries: entries.map((entry: FilesSubtreeNodeEntry) => ({
      kind: entry.kind,
      name: entry.name,
      parentPath: entry.parentPath,
      byteSize: entry.byteSize,
      updatedAt: entry.updatedAt,
      node: undefined,
    })),
    errors: [],
    scannedAt: Date.now(),
  }
}

export async function searchVfsNames(
  root: VfsNameSearchRoot,
  query: string,
  options: VfsNameSearchOptions = {},
): Promise<VfsNameSearchResult> {
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return { hits: [], truncated: false, errors: [] }
  }
  const index = await scanVfsNameSearchIndex(root, options)
  return filterVfsNameSearchIndex(index, root, query, options)
}

/** 子树索引缓存：同目录第二次搜索起按键即时过滤，不必重扫。任何 VFS / 挂载变更只标 stale，由后台重扫自愈。 */
type CachedVfsNameSearchIndex = {
  index: VfsNameSearchIndex
  stale: boolean
}

/** 全子树条目可能上万条（lister 卷还存完整节点），容量收紧控制内存量级 */
const NAME_SEARCH_INDEX_CACHE_CAPACITY = 2

const nameSearchIndexCache = new Map<string, CachedVfsNameSearchIndex>()

function nameSearchCacheKey(root: VfsNameSearchRoot): string {
  return `${root.locationId}\0${root.folderId ?? ''}`
}

function rememberNameSearchIndex(root: VfsNameSearchRoot, index: VfsNameSearchIndex): void {
  const key = nameSearchCacheKey(root)
  nameSearchIndexCache.delete(key)
  while (nameSearchIndexCache.size >= NAME_SEARCH_INDEX_CACHE_CAPACITY) {
    const oldest = nameSearchIndexCache.keys().next().value
    if (oldest === undefined) break
    nameSearchIndexCache.delete(oldest)
  }
  nameSearchIndexCache.set(key, { index, stale: false })
}

export function getCachedVfsNameSearchIndex(root: VfsNameSearchRoot): VfsNameSearchIndex | undefined {
  return nameSearchIndexCache.get(nameSearchCacheKey(root))?.index
}

export function isVfsNameSearchIndexStale(root: VfsNameSearchRoot): boolean {
  return nameSearchIndexCache.get(nameSearchCacheKey(root))?.stale ?? true
}

export async function scanAndCacheVfsNameSearchIndex(
  root: VfsNameSearchRoot,
  options: VfsNameSearchOptions = {},
): Promise<VfsNameSearchIndex> {
  const index = await scanVfsNameSearchIndex(root, options)
  rememberNameSearchIndex(root, index)
  return index
}

export function markVfsNameSearchIndexStale(): void {
  for (const cached of nameSearchIndexCache.values()) {
    cached.stale = true
  }
}

export function invalidateVfsNameSearchIndexCache(): void {
  nameSearchIndexCache.clear()
}

if (typeof window !== 'undefined') {
  for (const eventName of [
    FILES_VFS_CHANGED_EVENT,
    FILES_MOUNTS_CHANGED_EVENT,
    FILES_IMAGE_MOUNTS_CHANGED_EVENT,
  ]) {
    window.addEventListener(eventName, markVfsNameSearchIndexStale)
  }
}
