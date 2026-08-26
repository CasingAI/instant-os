/**
 * iCode 管理生成应用的版本文件夹布局（第一期）。
 *
 * `/Applications/{appBundleDirName(appId)}/`
 *   Versions/            版本树
 *     1/ 2/ 3/ …         正式版（正整数文件夹名，只读）
 *       app.json         该版本清单（名字、图标、颜色、能力等——「这一版是谁」）
 *       index.html       约定入口；其余文件与子目录构成该版本网站根
 *     Draft/             草稿（保留名，可写；不参与「最大正式号」扫描）
 *   Data/                运行时用户数据，跨版本共用（沿用现有应用数据目录）
 *   Developer/           开发附属（聊天等）；不是网站根，运行时不得当资源提供
 *   Contents/manifest.json  极轻包级索引（应用 id、iCode 管理标记、出生占位身份）
 *
 * 系统层直写（绕过 /Applications 投影的只读限制）；正式版子树节点属性只读，
 * Draft 子树节点属性可写（文件管理器 / 终端允许改草稿，删不掉正式版）。
 */
import { osNowMs } from './os-clock.ts'
import {
  appBundleDirName,
  APP_DEVELOPER_DIR_NAME,
  APP_DIST_DIR_NAME,
  APP_DRAFT_DIR_NAME,
  APP_VERSIONS_DIR_NAME,
} from '../apps/files/files-app-id.ts'
import type { AppCapabilityTag } from '../apps/appstore/app-capability-tags.ts'
import {
  collectSubtreeIds,
  createFileWithBlob,
  createFileWithBytes,
  createFolderNode,
  deleteSubtree,
  estimateNodeMetaBytes,
  estimateTextBytes,
  listChildNodes,
  newFilesNodeId,
  readBlobBytes,
  readBlobText,
  updateNodeAttributes,
  writeBlobBytes,
  writeBlobText,
} from '../apps/files/files-storage.ts'
import type { FilesNode, FilesNodeAttributes } from '../apps/files/files-types.ts'
import {
  FILES_VFS_CHANGED_EVENT,
  invalidateFilesVfsPathCaches,
} from '../apps/files/files-vfs.ts'
import { notifyFilesWatch, type FilesWatchChangeKind } from '../apps/files/files-watch.ts'

const LOCATION_ID = 'applications' as const

const APP_VERSIONS_DIR = APP_VERSIONS_DIR_NAME
const APP_DEVELOPER_DIR = APP_DEVELOPER_DIR_NAME
/** 第四期约定产物目录（保留名：源码不得占用、模块解析不得走进去） */
const APP_DIST_DIR = APP_DIST_DIR_NAME
export { APP_VERSIONS_DIR, APP_DEVELOPER_DIR, APP_DIST_DIR, APP_DRAFT_DIR_NAME }
/** 每版本清单文件名 */
export const VERSION_MANIFEST_FILE = 'app.json'
/** 约定入口文件名 */
export const SITE_ENTRY_FILE = 'index.html'

const READONLY_ATTRIBUTES: FilesNodeAttributes = { readable: true, writable: false }
const WRITABLE_ATTRIBUTES: FilesNodeAttributes = { readable: true, writable: true }

/** 每个版本文件夹自己的清单：名字、图标、颜色、能力等（「这一版是谁」） */
export type GeneratedAppVersionManifest = {
  format: 'instant-os-generated-app-version'
  name: string
  description: string
  category: string
  iconEmoji: string
  themeColor: string
  tags?: AppCapabilityTag[]
  /** 可选入口路径覆盖（第四期工程入口；缺省用约定名） */
  entry?: string
  savedAt?: number
}

/** 包级极轻索引（旧 Contents 位置）：只有身份与 iCode 管理标记 + 出生占位身份 */
export type GeneratedAppVersionsPackageIndex = {
  format: 'instant-os-generated-app'
  id: string
  layout: 'versions'
  icodeProjectId?: string
  /** 出生占位身份：仅在尚无任何正式版时用于桌面占位显示，永不随草稿更新 */
  placeholder?: {
    name: string
    description: string
    category: string
    iconEmoji: string
    themeColor: string
    createdAt: number
  }
}

/** 版本选择器：正式版号或草稿 */
export type AppVersionSelector = number | typeof APP_DRAFT_DIR_NAME

export function isAppVersionSelector(value: string): boolean {
  return value === APP_DRAFT_DIR_NAME || isFormalVersionDirName(value)
}

/** 只承认正整数文件夹名（`1`、`2`、`3`…；`Draft` 是保留名） */
export function isFormalVersionDirName(name: string): boolean {
  return /^[1-9][0-9]*$/.test(name)
}

export function appVersionsRootPath(appId: string): string {
  return `/Applications/${appBundleDirName(appId)}/${APP_VERSIONS_DIR}`
}

export function appVersionDirPath(appId: string, selector: AppVersionSelector): string {
  return `${appVersionsRootPath(appId)}/${String(selector)}`
}

export function appDeveloperRootPath(appId: string): string {
  return `/Applications/${appBundleDirName(appId)}/${APP_DEVELOPER_DIR}`
}

export function appChatFilePath(appId: string): string {
  return `${appDeveloperRootPath(appId)}/chat.json`
}

/** 第十二期：AI 面板会话文件（Developer/ai-sessions.json） */
export function appAiSessionsFilePath(appId: string): string {
  return `${appDeveloperRootPath(appId)}/ai-sessions.json`
}

/** 第十二期：AI 模型偏好文件（Developer/ai-prefs.json） */
export function appAiPrefsFilePath(appId: string): string {
  return `${appDeveloperRootPath(appId)}/ai-prefs.json`
}

function emitSystemVfsChange(path: string, kind: FilesWatchChangeKind): void {
  invalidateFilesVfsPathCaches()
  notifyFilesWatch({ kind, path })
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(FILES_VFS_CHANGED_EVENT))
  }
}

// ---- 真实节点解析（系统层，applications 卷） ----

function bundleSegments(appId: string, relativePath: string): string[] {
  const rel = relativePath.trim().replace(/^\/+|\/+$/g, '')
  if (!rel) throw new Error('应用包内路径不能为空')
  return [...appBundleDirName(appId).split('/'), ...rel.split('/')]
}

async function resolveRealNodeBySegments(
  segments: readonly string[],
): Promise<FilesNode | undefined> {
  let parentId: string | undefined
  for (let index = 0; index < segments.length; index += 1) {
    const name = segments[index]
    if (!name) return undefined
    const children = await listChildNodes(LOCATION_ID, parentId)
    const hit = children.find((child) => child.name === name)
    if (!hit) return undefined
    if (index === segments.length - 1) return hit
    if (hit.kind !== 'folder') return undefined
    parentId = hit.id
  }
  return undefined
}

async function resolveVersionNode(
  appId: string,
  selector: AppVersionSelector,
  relativePath: string,
): Promise<FilesNode | undefined> {
  return resolveRealNodeBySegments(
    bundleSegments(appId, `${APP_VERSIONS_DIR}/${String(selector)}${
      relativePath ? `/${relativePath.replace(/^\/+|\/+$/g, '')}` : ''
    }`),
  )
}

/** 逐层确保包内目录存在（系统层，绕过只读）。attributes 作用于新建的每一层。 */
async function ensureFolderBySegments(
  segments: readonly string[],
  attributes: FilesNodeAttributes,
): Promise<FilesNode> {
  let parentId: string | undefined
  let leaf: FilesNode | undefined
  for (let index = 0; index < segments.length; index += 1) {
    const name = segments[index]
    if (!name) throw new Error('无效的应用包路径')
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
  if (!leaf) throw new Error('无效的应用包路径')
  return leaf
}

async function removeRealSubtree(node: FilesNode, notifyPath: string): Promise<void> {
  const subtree = await collectSubtreeIds(node.id)
  await deleteSubtree(subtree)
  emitSystemVfsChange(notifyPath, 'deleted')
}

// ---- 版本扫描 ----

/** 包是否已使用版本文件夹布局（Versions 目录存在即算） */
export async function hasVersionsLayout(appId: string): Promise<boolean> {
  const bundle = appBundleDirName(appId)
  const bundles = await listChildNodes(LOCATION_ID, undefined)
  const bundleNode = bundles.find((node) => node.kind === 'folder' && node.name === bundle)
  if (!bundleNode) return false
  const children = await listChildNodes(LOCATION_ID, bundleNode.id)
  return children.some((node) => node.kind === 'folder' && node.name === APP_VERSIONS_DIR)
}

/** 列出全部正式版号（升序）。扫描最大正式号时排除 `Draft`。 */
export async function listFormalVersionNumbers(appId: string): Promise<number[]> {
  const versionsDir = await resolveRealNodeBySegments([
    appBundleDirName(appId),
    APP_VERSIONS_DIR,
  ])
  if (!versionsDir || versionsDir.kind !== 'folder') return []
  const children = await listChildNodes(LOCATION_ID, versionsDir.id)
  const numbers = children
    .filter((node) => node.kind === 'folder' && isFormalVersionDirName(node.name))
    .map((node) => Number(node.name))
  return numbers.sort((a, b) => a - b)
}

/** 当前最大正式号；没有正式版返回 undefined */
export async function getMaxFormalVersionNumber(appId: string): Promise<number | undefined> {
  const versions = await listFormalVersionNumbers(appId)
  return versions.length > 0 ? versions[versions.length - 1] : undefined
}

/** 草稿树是否存在（存在但缺 app.json 视为损坏，由 ensureDraftTree 处理） */
export async function hasDraftTree(appId: string): Promise<boolean> {
  const draftManifest = await resolveVersionNode(appId, APP_DRAFT_DIR_NAME, VERSION_MANIFEST_FILE)
  return draftManifest !== undefined && draftManifest.kind === 'file'
}

// ---- 每版本清单 ----

export function isGeneratedAppVersionManifest(
  value: unknown,
): value is GeneratedAppVersionManifest {
  if (typeof value !== 'object' || value === undefined) return false
  const manifest = value as Record<string, unknown>
  return (
    manifest.format === 'instant-os-generated-app-version' &&
    typeof manifest.name === 'string' &&
    typeof manifest.description === 'string' &&
    typeof manifest.category === 'string' &&
    typeof manifest.iconEmoji === 'string' &&
    typeof manifest.themeColor === 'string'
  )
}

export async function readVersionManifest(
  appId: string,
  selector: AppVersionSelector,
): Promise<GeneratedAppVersionManifest | undefined> {
  const node = await resolveVersionNode(appId, selector, VERSION_MANIFEST_FILE)
  if (!node || node.kind !== 'file') return undefined
  try {
    const parsed: unknown = JSON.parse(await readBlobText(node.id))
    return isGeneratedAppVersionManifest(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

async function writeVersionTreeTextFile(params: {
  appId: string
  dirName: string
  relativePath: string
  text: string
  mimeType: string
  writable: boolean
}): Promise<FilesNode> {
  const { appId, dirName, relativePath, text, mimeType, writable } = params
  const attributes = writable ? WRITABLE_ATTRIBUTES : READONLY_ATTRIBUTES
  const rel = relativePath.trim().replace(/^\/+|\/+$/g, '')
  if (!rel) throw new Error('版本内文件路径不能为空')
  const segments = bundleSegments(appId, `${APP_VERSIONS_DIR}/${dirName}/${rel}`)
  const parent = await ensureFolderBySegments(segments.slice(0, -1), attributes)
  const fileName = segments[segments.length - 1]!
  const siblings = await listChildNodes(LOCATION_ID, parent.id)
  const existing = siblings.find((child) => child.name === fileName)

  const now = osNowMs()
  if (existing && existing.kind === 'file') {
    const updated = await writeBlobText({
      id: existing.id,
      text,
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
    mimeType,
    byteSize: estimateTextBytes(text),
    createdAt: now,
    updatedAt: now,
    attributes,
  }
  const created = await createFileWithBlob({
    node,
    text,
    metaBytes: estimateNodeMetaBytes(node),
    nameMode: 'exact',
  })
  emitSystemVfsChange(`/Applications/${segments.join('/')}`, 'created')
  return created
}

/** 通用：按版本目录名写文本文件（导入整包 / 建正式版用；writable=false 为只读） */
export function writeVersionTextFile(params: {
  appId: string
  dirName: string
  relativePath: string
  text: string
  mimeType?: string
  writable?: boolean
}): Promise<FilesNode> {
  return writeVersionTreeTextFile({
    appId: params.appId,
    dirName: params.dirName,
    relativePath: params.relativePath,
    text: params.text,
    mimeType: params.mimeType ?? guessTextMime(params.relativePath),
    writable: params.writable ?? false,
  })
}

/** 通用：按版本目录名写二进制文件 */
export async function writeVersionBinaryFile(params: {
  appId: string
  dirName: string
  relativePath: string
  bytes: Uint8Array
  mimeType?: string
  writable?: boolean
}): Promise<FilesNode> {
  const attributes = params.writable ? WRITABLE_ATTRIBUTES : READONLY_ATTRIBUTES
  const rel = params.relativePath.trim().replace(/^\/+|\/+$/g, '')
  if (!rel) throw new Error('版本内文件路径不能为空')
  const segments = bundleSegments(params.appId, `${APP_VERSIONS_DIR}/${params.dirName}/${rel}`)
  const parent = await ensureFolderBySegments(segments.slice(0, -1), attributes)
  const fileName = segments[segments.length - 1]!
  const siblings = await listChildNodes(LOCATION_ID, parent.id)
  const existing = siblings.find((child) => child.name === fileName)
  const now = osNowMs()
  if (existing && existing.kind === 'file') {
    const updated = await writeBlobBytes({
      id: existing.id,
      bytes: params.bytes.slice().buffer as ArrayBuffer,
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
    mimeType: params.mimeType ?? 'application/octet-stream',
    byteSize: params.bytes.byteLength,
    createdAt: now,
    updatedAt: now,
    attributes,
  }
  const created = await createFileWithBytes({
    node,
    bytes: params.bytes.slice().buffer as ArrayBuffer,
    metaBytes: estimateNodeMetaBytes(node),
    nameMode: 'exact',
  })
  emitSystemVfsChange(`/Applications/${segments.join('/')}`, 'created')
  return created
}

export function writeDraftTextFile(params: {
  appId: string
  relativePath: string
  text: string
  mimeType?: string
}): Promise<FilesNode> {
  return writeVersionTreeTextFile({
    appId: params.appId,
    dirName: APP_DRAFT_DIR_NAME,
    relativePath: params.relativePath,
    text: params.text,
    mimeType: params.mimeType ?? guessTextMime(params.relativePath),
    writable: true,
  })
}

export function writeDraftManifest(
  appId: string,
  manifest: GeneratedAppVersionManifest,
): Promise<FilesNode> {
  return writeDraftTextFile({
    appId,
    relativePath: VERSION_MANIFEST_FILE,
    text: `${JSON.stringify(manifest, null, 2)}\n`,
    mimeType: 'application/json',
  })
}

/** 删除草稿树内某路径（文件或文件夹）；不存在则静默 */
export async function removeDraftPath(appId: string, relativePath: string): Promise<void> {
  const rel = relativePath.trim().replace(/^\/+|\/+$/g, '')
  if (!rel) throw new Error('草稿路径不能为空')
  const node = await resolveVersionNode(appId, APP_DRAFT_DIR_NAME, rel)
  if (!node) return
  await removeRealSubtree(
    node,
    `${appVersionDirPath(appId, APP_DRAFT_DIR_NAME)}/${rel}`,
  )
}

// ---- 版本树读取 ----

export type AppVersionTreeFile = {
  path: string
  node: FilesNode
}

/** 递归列出版本树内全部文件（路径相对该版本网站根，POSIX 风格） */
export async function listVersionTreeFiles(
  appId: string,
  selector: AppVersionSelector,
): Promise<AppVersionTreeFile[]> {
  const root = await resolveVersionNode(appId, selector, '')
  if (!root || root.kind !== 'folder') return []
  const files: AppVersionTreeFile[] = []
  const walk = async (node: FilesNode, prefix: string): Promise<void> => {
    const children = await listChildNodes(LOCATION_ID, node.id)
    for (const child of children) {
      if (child.kind === 'folder') {
        await walk(child, `${prefix}${child.name}/`)
      } else if (child.kind === 'file') {
        files.push({ path: `${prefix}${child.name}`, node: child })
      }
    }
  }
  await walk(root, '')
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

export async function readVersionFileText(
  appId: string,
  selector: AppVersionSelector,
  relativePath: string,
): Promise<string | undefined> {
  const node = await resolveVersionNode(appId, selector, relativePath)
  if (!node || node.kind !== 'file') return undefined
  return readBlobText(node.id)
}

export async function readVersionFileBytes(
  appId: string,
  selector: AppVersionSelector,
  relativePath: string,
): Promise<Uint8Array | undefined> {
  const node = await resolveVersionNode(appId, selector, relativePath)
  if (!node || node.kind !== 'file') return undefined
  const bytes = await readBlobBytes(node.id)
  return bytes === undefined ? undefined : new Uint8Array(bytes)
}

/** 整棵版本树读为资源表（path → bytes），供按目录加载器使用 */
export async function readVersionTreeResources(
  appId: string,
  selector: AppVersionSelector,
): Promise<Map<string, Uint8Array>> {
  const files = await listVersionTreeFiles(appId, selector)
  const resources = new Map<string, Uint8Array>()
  for (const file of files) {
    const bytes = await readBlobBytes(file.node.id)
    if (bytes !== undefined) {
      resources.set(file.path, new Uint8Array(bytes))
    }
  }
  return resources
}

// ---- 树复制 / 草稿 / 发布 ----

async function copyTreeTo(
  source: FilesNode,
  destParentId: string,
  destName: string,
  attributes: FilesNodeAttributes,
): Promise<FilesNode> {
  const now = osNowMs()
  if (source.kind === 'file') {
    const bytes = await readBlobBytes(source.id)
    const node: FilesNode = {
      id: newFilesNodeId(),
      locationId: LOCATION_ID,
      parentId: destParentId,
      name: destName,
      kind: 'file',
      mimeType: source.mimeType,
      byteSize: bytes?.byteLength ?? source.byteSize,
      createdAt: now,
      updatedAt: now,
      attributes,
    }
    if (bytes !== undefined) {
      return createFileWithBytes({
        node,
        bytes,
        metaBytes: estimateNodeMetaBytes(node),
        nameMode: 'exact',
      })
    }
    const text = await readBlobText(source.id)
    return createFileWithBlob({
      node,
      text,
      metaBytes: estimateNodeMetaBytes(node),
      nameMode: 'exact',
    })
  }

  const folderNode: FilesNode = {
    id: newFilesNodeId(),
    locationId: LOCATION_ID,
    parentId: destParentId,
    name: destName,
    kind: 'folder',
    mimeType: undefined,
    byteSize: 0,
    createdAt: now,
    updatedAt: now,
    attributes,
  }
  const createdFolder = await createFolderNode({
    node: folderNode,
    metaBytes: estimateNodeMetaBytes(folderNode),
    nameMode: 'exact',
  })
  const children = await listChildNodes(LOCATION_ID, source.id)
  for (const child of children) {
    await copyTreeTo(child, createdFolder.id, child.name, attributes)
  }
  return createdFolder
}

/** 把某版本整棵树拷贝为新的目标文件夹（同名精确创建，目标必须不存在） */
async function copyVersionTreeTo(
  appId: string,
  selector: AppVersionSelector,
  destDirName: string,
  attributes: FilesNodeAttributes,
): Promise<FilesNode> {
  const source = await resolveVersionNode(appId, selector, '')
  if (!source) throw new Error(`版本 ${String(selector)} 不存在`)
  const versionsRoot = await ensureFolderBySegments(
    [appBundleDirName(appId), APP_VERSIONS_DIR],
    READONLY_ATTRIBUTES,
  )
  const existing = (await listChildNodes(LOCATION_ID, versionsRoot.id)).find(
    (node) => node.name === destDirName,
  )
  if (existing) throw new Error(`目标文件夹 ${destDirName} 已存在`)
  return copyTreeTo(source, versionsRoot.id, destDirName, attributes)
}

async function removeVersionTree(appId: string, selector: AppVersionSelector): Promise<void> {
  const node = await resolveVersionNode(appId, selector, '')
  if (!node) return
  await removeRealSubtree(node, appVersionDirPath(appId, selector))
}

/**
 * 确保存在一棵可写草稿。没有则从当前最大正式版整棵拷贝；没有正式版则从给定模板起一棵
 * （仍不把它变成正式号）。存在但损坏（缺清单）则删掉重拷。
 */
export async function ensureDraftTree(
  appId: string,
  template: () => Promise<{ manifest: GeneratedAppVersionManifest; files: Array<{ path: string; text: string }> }>,
): Promise<'existed' | 'copied' | 'created'> {
  if (await hasDraftTree(appId)) {
    return 'existed'
  }

  // 残缺草稿（无清单）：整棵删掉重来，避免与新拷内容打架
  const partial = await resolveVersionNode(appId, APP_DRAFT_DIR_NAME, '')
  if (partial) {
    await removeVersionTree(appId, APP_DRAFT_DIR_NAME)
  }

  const max = await getMaxFormalVersionNumber(appId)
  if (max !== undefined) {
    await copyVersionTreeTo(appId, max, APP_DRAFT_DIR_NAME, WRITABLE_ATTRIBUTES)
    // 拷出来的整棵草稿统一改为可写属性
    await forceSubtreeAttributes(appId, APP_DRAFT_DIR_NAME, WRITABLE_ATTRIBUTES)
    emitSystemVfsChange(appVersionDirPath(appId, APP_DRAFT_DIR_NAME), 'created')
    return 'copied'
  }

  await ensureFolderBySegments(
    [appBundleDirName(appId), APP_VERSIONS_DIR],
    READONLY_ATTRIBUTES,
  )
  const { manifest, files } = await template()
  await writeDraftManifest(appId, manifest)
  for (const file of files) {
    await writeDraftTextFile({ appId, relativePath: file.path, text: file.text })
  }
  emitSystemVfsChange(appVersionDirPath(appId, APP_DRAFT_DIR_NAME), 'created')
  return 'created'
}

async function forceSubtreeAttributes(
  appId: string,
  selector: AppVersionSelector,
  attributes: FilesNodeAttributes,
): Promise<void> {
  const root = await resolveVersionNode(appId, selector, '')
  if (!root) return
  const walk = async (node: FilesNode): Promise<void> => {
    if (node.attributes.writable !== attributes.writable) {
      await updateNodeAttributes(node.id, attributes)
    }
    if (node.kind !== 'folder') return
    const children = await listChildNodes(LOCATION_ID, node.id)
    for (const child of children) {
      await walk(child)
    }
  }
  await walk(root)
}

/**
 * 发布：把当前草稿升格为 `max+1`（尚无正式版则为 `1`），该文件夹只读；
 * 然后立刻删掉旧草稿，再从这份新正式版拷一棵可写 `Draft`。
 * 「拷到新文件夹再处理旧草稿」：中途失败时旧草稿或正式版至少有一边完整，
 * 下次 ensureDraftTree 会自愈。
 */
export async function publishDraftToNewFormalVersion(appId: string): Promise<number> {
  if (!(await hasDraftTree(appId))) {
    throw new Error('草稿不存在，无法发布')
  }

  const max = await getMaxFormalVersionNumber(appId)
  const next = (max ?? 0) + 1
  await copyVersionTreeTo(appId, APP_DRAFT_DIR_NAME, String(next), READONLY_ATTRIBUTES)
  await forceSubtreeAttributes(appId, next, READONLY_ATTRIBUTES)
  emitSystemVfsChange(appVersionDirPath(appId, next), 'created')

  await removeVersionTree(appId, APP_DRAFT_DIR_NAME)
  await copyVersionTreeTo(appId, next, APP_DRAFT_DIR_NAME, WRITABLE_ATTRIBUTES)
  await forceSubtreeAttributes(appId, APP_DRAFT_DIR_NAME, WRITABLE_ATTRIBUTES)
  emitSystemVfsChange(appVersionDirPath(appId, APP_DRAFT_DIR_NAME), 'created')
  return next
}

/**
 * 第二期·删旧档：删除一个不是当前最大号的正式版。最大号不当「旧档」来删。
 * 只删那一棵网站根和那份版本清单 JSON；不动 Data、聊天、其它正式档。
 */
export async function removeFormalVersionTree(appId: string, version: number): Promise<void> {
  const max = await getMaxFormalVersionNumber(appId)
  if (max === undefined || version >= max) {
    throw new Error('不能删除当前最大正式版')
  }
  if (!(await resolveVersionNode(appId, version, ''))) {
    return
  }
  await removeVersionTree(appId, version)
}

/**
 * 第二期·基于某一正式版再接一档新的最大号：把选定那一档整棵网站根 + 该版清单
 * 拷成新的 `max+1` 并只读；草稿按第一期规则从新的最大号重新拷一棵。
 * 被选中的旧档保持只读、号码不变；比它大的旧号若还在就继续留着。
 */
export async function createFormalVersionFrom(
  appId: string,
  baseVersion: number,
): Promise<number> {
  if (!(await resolveVersionNode(appId, baseVersion, ''))) {
    throw new Error(`正式版 ${baseVersion} 不存在`)
  }
  const max = await getMaxFormalVersionNumber(appId)
  const next = (max ?? 0) + 1
  await copyVersionTreeTo(appId, baseVersion, String(next), READONLY_ATTRIBUTES)
  await forceSubtreeAttributes(appId, next, READONLY_ATTRIBUTES)
  emitSystemVfsChange(appVersionDirPath(appId, next), 'created')

  await removeVersionTree(appId, APP_DRAFT_DIR_NAME)
  await copyVersionTreeTo(appId, next, APP_DRAFT_DIR_NAME, WRITABLE_ATTRIBUTES)
  await forceSubtreeAttributes(appId, APP_DRAFT_DIR_NAME, WRITABLE_ATTRIBUTES)
  emitSystemVfsChange(appVersionDirPath(appId, APP_DRAFT_DIR_NAME), 'created')
  return next
}

// ---- Developer（聊天等开发附属，版本树之外） ----

export async function writeDeveloperTextFile(params: {
  appId: string
  relativePath: string
  text: string
  mimeType?: string
}): Promise<FilesNode> {
  const rel = params.relativePath.trim().replace(/^\/+|\/+$/g, '')
  if (!rel) throw new Error('开发目录路径不能为空')
  const segments = [...bundleSegments(params.appId, APP_DEVELOPER_DIR), ...rel.split('/')]
  const parent = await ensureFolderBySegments(segments.slice(0, -1), READONLY_ATTRIBUTES)
  const fileName = segments[segments.length - 1]!
  const siblings = await listChildNodes(LOCATION_ID, parent.id)
  const existing = siblings.find((child) => child.name === fileName)
  const now = osNowMs()
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
    mimeType: params.mimeType ?? 'application/json',
    byteSize: estimateTextBytes(params.text),
    createdAt: now,
    updatedAt: now,
    attributes: READONLY_ATTRIBUTES,
  }
  const created = await createFileWithBlob({
    node,
    text: params.text,
    metaBytes: estimateNodeMetaBytes(node),
    nameMode: 'exact',
  })
  emitSystemVfsChange(`/Applications/${segments.join('/')}`, 'created')
  return created
}

export async function readDeveloperTextFile(
  appId: string,
  relativePath: string,
): Promise<string | undefined> {
  const node = await resolveRealNodeBySegments([
    ...bundleSegments(appId, APP_DEVELOPER_DIR),
    ...relativePath.split('/').filter(Boolean),
  ])
  if (!node || node.kind !== 'file') return undefined
  return readBlobText(node.id)
}

// ---- 包级索引（旧 Contents 位置） ----

function packageIndexPath(appId: string): string {
  return `/Applications/${appBundleDirName(appId)}/Contents/manifest.json`
}

export async function readVersionsPackageIndex(
  appId: string,
): Promise<GeneratedAppVersionsPackageIndex | undefined> {
  const node = await resolveRealNodeBySegments([
    ...bundleSegments(appId, 'Contents'),
    'manifest.json',
  ])
  if (!node || node.kind !== 'file') return undefined
  try {
    const parsed: unknown = JSON.parse(await readBlobText(node.id))
    if (typeof parsed !== 'object' || parsed === undefined) return undefined
    const index = parsed as Record<string, unknown>
    if (index.format !== 'instant-os-generated-app' || index.layout !== 'versions') {
      return undefined
    }
    return parsed as GeneratedAppVersionsPackageIndex
  } catch {
    return undefined
  }
}

export async function writeVersionsPackageIndex(
  appId: string,
  index: GeneratedAppVersionsPackageIndex,
): Promise<void> {
  const segments = [...bundleSegments(appId, 'Contents'), 'manifest.json']
  const parent = await ensureFolderBySegments(segments.slice(0, -1), READONLY_ATTRIBUTES)
  const fileName = segments[segments.length - 1]!
  const siblings = await listChildNodes(LOCATION_ID, parent.id)
  const existing = siblings.find((child) => child.name === fileName)
  const text = `${JSON.stringify(index, null, 2)}\n`
  const now = osNowMs()
  if (existing && existing.kind === 'file') {
    await writeBlobText({
      id: existing.id,
      text,
      previousByteSize: existing.byteSize,
      nameMetaDelta: 0,
    })
    emitSystemVfsChange(packageIndexPath(appId), 'modified')
    return
  }
  const node: FilesNode = {
    id: newFilesNodeId(),
    locationId: LOCATION_ID,
    parentId: parent.id,
    name: fileName,
    kind: 'file',
    mimeType: 'application/json',
    byteSize: estimateTextBytes(text),
    createdAt: now,
    updatedAt: now,
    attributes: READONLY_ATTRIBUTES,
  }
  await createFileWithBlob({
    node,
    text,
    metaBytes: estimateNodeMetaBytes(node),
    nameMode: 'exact',
  })
  emitSystemVfsChange(packageIndexPath(appId), 'created')
}

// ---- 整包删除（卸载） ----

/** 删除应用包整个 bundle 子树（Versions / Developer / Data / Contents） */
export async function removeGeneratedAppBundle(appId: string): Promise<void> {
  const bundleName = appBundleDirName(appId)
  const bundles = await listChildNodes(LOCATION_ID, undefined)
  const bundle = bundles.find((node) => node.kind === 'folder' && node.name === bundleName)
  if (!bundle) return
  await removeRealSubtree(bundle, `/Applications/${bundleName}`)
}

function guessTextMime(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.css')) return 'text/css'
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'text/javascript'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.md')) return 'text/markdown'
  return 'text/plain'
}
