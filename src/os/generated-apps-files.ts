/**
 * 生成应用本体（Contents）系统层读写原语。
 * 已安装生成应用的本体（元数据 manifest + 各版本 html）从 localStorage 迁到
 * `/Applications/{appBundleDirName(appId)}/Contents` 真实文件（applications 卷 IndexedDB）。
 * 文件管理器 / 终端只读浏览，系统层直写；与内置应用的虚拟源码投影 Contents 互不冲突。
 */
import { osNowMs } from './os-clock.ts'
import { appBundleDirName } from '../apps/files/files-app-id.ts'
import type { AppCapabilityTag } from '../apps/appstore/app-capability-tags.ts'
import {
  collectSubtreeIds,
  createFolderNode,
  createFileWithBlob,
  deleteSubtree,
  estimateNodeMetaBytes,
  estimateTextBytes,
  listChildNodes,
  listLocalVolumeSubtreeNodes,
  newFilesNodeId,
  readBlobText,
  writeBlobText,
} from '../apps/files/files-storage.ts'
import type { FilesNode, FilesNodeAttributes } from '../apps/files/files-types.ts'
import {
  FILES_VFS_CHANGED_EVENT,
  invalidateFilesVfsPathCaches,
} from '../apps/files/files-vfs.ts'
import { notifyFilesWatch, type FilesWatchChangeKind } from '../apps/files/files-watch.ts'

const LOCATION_ID = 'applications' as const
export const GENERATED_APP_CONTENTS_DIR = 'Contents'
/** 包内系统目录（bundle 根、Contents 根）只读 */
const SYSTEM_FOLDER_ATTRIBUTES: FilesNodeAttributes = { readable: true, writable: false }
export const GENERATED_APP_MANIFEST_FILE = 'manifest.json'

/** 生成应用 Contents 清单：携带重建完整 GeneratedAppRecord 所需的全部元数据与版本文件清单 */
export type GeneratedAppManifest = {
  format: 'instant-os-generated-app'
  id: string
  name: string
  description: string
  category: string
  iconEmoji: string
  themeColor: string
  tags?: AppCapabilityTag[]
  version: string
  pendingUpdate?: boolean
  icodeProjectId?: string
  versions: Array<{ version: string; savedAt: number }>
}

function emitSystemVfsChange(path: string, kind: FilesWatchChangeKind): void {
  invalidateFilesVfsPathCaches()
  notifyFilesWatch({ kind, path })
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(FILES_VFS_CHANGED_EVENT))
  }
}

/** `/Applications/{appBundleDirName(appId)}/Contents` */
export function generatedAppContentsRootPath(appId: string): string {
  return `/Applications/${appBundleDirName(appId)}/${GENERATED_APP_CONTENTS_DIR}`
}

/** 由版本号派生的 Contents 内 html 文件名，例如 `v1.0.0.html`（点号是合法段字符；路径危险字符转下划线） */
export function generatedAppVersionFile(version: string): string {
  const clean = version.trim().replace(/[\\/:*?"<>|]/g, '_')
  return `v${clean || 'default'}.html`
}

function contentsSegments(appId: string, relativePath: string): string[] {
  const rel = relativePath.trim().replace(/^\/+|\/+$/g, '')
  if (!rel) throw new Error('应用本体文件路径不能为空')
  return [appBundleDirName(appId), GENERATED_APP_CONTENTS_DIR, ...rel.split('/')]
}

/**
 * 按路径段逐层确保 applications 卷下真实文件夹存在（系统层，绕过只读）。
 * 返回最后一个（叶子）文件夹节点。
 */
async function ensureContentsFolderBySegments(
  segments: readonly string[],
  attributes: FilesNodeAttributes,
): Promise<FilesNode> {
  let parentId: string | undefined
  let leaf: FilesNode | undefined
  for (let index = 0; index < segments.length; index += 1) {
    const name = segments[index]
    if (!name) throw new Error('无效的应用本体路径')
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
  if (!leaf) throw new Error('无效的应用本体路径')
  return leaf
}

/** 确保 `{bundlePath}/Contents` 真身目录存在（幂等），返回 Contents 根真实节点 */
export async function ensureGeneratedAppContentsRoot(appId: string): Promise<FilesNode> {
  const segments = [appBundleDirName(appId), GENERATED_APP_CONTENTS_DIR]
  return ensureContentsFolderBySegments(segments, SYSTEM_FOLDER_ATTRIBUTES)
}

/** 写一个 Contents 文件（自动建目录）；已存在则覆盖。mimeType 用于展示。 */
async function writeContentsSystemFile(params: {
  appId: string
  relativePath: string
  text: string
  mimeType: string
}): Promise<FilesNode> {
  await ensureGeneratedAppContentsRoot(params.appId)
  const segments = contentsSegments(params.appId, params.relativePath)
  const fileName = segments[segments.length - 1]!
  const parentSegments = segments.slice(0, -1)

  const parent = await ensureContentsFolderBySegments(parentSegments, SYSTEM_FOLDER_ATTRIBUTES)
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
    mimeType: params.mimeType,
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
  emitSystemVfsChange(`/Applications/${segments.join('/')}`, 'created')
  return created
}

/** 写生成应用清单（元数据） */
export function writeGeneratedAppManifest(appId: string, manifest: GeneratedAppManifest): Promise<FilesNode> {
  return writeContentsSystemFile({
    appId,
    relativePath: GENERATED_APP_MANIFEST_FILE,
    text: `${JSON.stringify(manifest, null, 2)}\n`,
    mimeType: 'application/json',
  })
}

/** 写生成应用的某个版本 html */
export function writeGeneratedAppHtmlFile(
  appId: string,
  version: string,
  html: string,
): Promise<FilesNode> {
  return writeContentsSystemFile({
    appId,
    relativePath: generatedAppVersionFile(version),
    text: html,
    mimeType: 'text/html',
  })
}

/** 按路径段逐层解析 applications 卷里某文件文本（直接读真实节点，不依赖 catalog） */
async function readApplicationsRealText(segments: readonly string[]): Promise<string | undefined> {
  let parentId: string | undefined
  for (let index = 0; index < segments.length; index += 1) {
    const name = segments[index]
    if (!name) return undefined
    const children = await listChildNodes(LOCATION_ID, parentId)
    const hit = children.find((child) => child.name === name)
    if (!hit) return undefined
    if (index === segments.length - 1) {
      if (hit.kind !== 'file') return undefined
      return readBlobText(hit.id)
    }
    if (hit.kind !== 'folder') return undefined
    parentId = hit.id
  }
  return undefined
}

/** 读取生成的 Contents 文本文件；不存在返回 undefined */
async function readContentsText(appId: string, relativePath: string): Promise<string | undefined> {
  const rel = relativePath.trim().replace(/^\/+|\/+$/g, '')
  if (!rel) return undefined
  return readApplicationsRealText([
    appBundleDirName(appId),
    GENERATED_APP_CONTENTS_DIR,
    ...rel.split('/'),
  ])
}

/** 读取生成应用清单；缺失/损坏返回 undefined */
export async function readGeneratedAppManifest(
  appId: string,
): Promise<GeneratedAppManifest | undefined> {
  const raw = await readContentsText(appId, GENERATED_APP_MANIFEST_FILE)
  if (raw === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isGeneratedAppManifest(parsed)) return undefined
    return parsed
  } catch {
    return undefined
  }
}

/** 读取生成应用的某个版本 html；不存在返回 undefined */
export async function readGeneratedAppHtmlFile(
  appId: string,
  version: string,
): Promise<string | undefined> {
  return readContentsText(appId, generatedAppVersionFile(version))
}

/** Contents 清单结构校验 */
export function isGeneratedAppManifest(value: unknown): value is GeneratedAppManifest {
  if (typeof value !== 'object' || value === undefined) return false
  const manifest = value as Record<string, unknown>
  if (
    manifest.format !== 'instant-os-generated-app' ||
    typeof manifest.id !== 'string' ||
    typeof manifest.name !== 'string' ||
    typeof manifest.description !== 'string' ||
    typeof manifest.category !== 'string' ||
    typeof manifest.iconEmoji !== 'string' ||
    typeof manifest.themeColor !== 'string' ||
    typeof manifest.version !== 'string' ||
    !Array.isArray(manifest.versions)
  ) {
    return false
  }
  return manifest.versions.every(
    (item) =>
      typeof item === 'object' &&
      item !== undefined &&
      typeof (item as { version?: unknown }).version === 'string' &&
      typeof (item as { savedAt?: unknown }).savedAt === 'number',
  )
}

/** 生成应用 Contents 子树总字节（供记账 / 去重）；无 Contents 目录时返回 0 */
export async function getGeneratedAppContentsBytes(appId: string): Promise<number> {
  try {
    const bundleName = appBundleDirName(appId)
    const bundles = await listChildNodes(LOCATION_ID, undefined)
    const bundle = bundles.find((node) => node.kind === 'folder' && node.name === bundleName)
    if (!bundle) return 0
    const contentsDir = (await listChildNodes(LOCATION_ID, bundle.id)).find(
      (node) => node.kind === 'folder' && node.name === GENERATED_APP_CONTENTS_DIR,
    )
    if (!contentsDir) return 0
    const { files } = await listLocalVolumeSubtreeNodes(LOCATION_ID, contentsDir.id)
    return files.reduce((total, file) => total + file.byteSize, 0)
  } catch {
    return 0
  }
}

/** 解析生成应用 Contents 下某个真实文件节点；不存在返回 undefined */
async function resolveContentsNode(
  appId: string,
  relativePath: string,
): Promise<FilesNode | undefined> {
  const rel = relativePath.trim().replace(/^\/+|\/+$/g, '')
  if (!rel) return undefined
  const segments = [appBundleDirName(appId), GENERATED_APP_CONTENTS_DIR, ...rel.split('/')]
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

/** 删除生成应用的某个版本 html 文件（回滚 / 裁剪版本历史用） */
export async function deleteGeneratedAppVersionFile(
  appId: string,
  version: string,
): Promise<void> {
  const node = await resolveContentsNode(appId, generatedAppVersionFile(version))
  if (!node) return
  const subtree = await collectSubtreeIds(node.id)
  await deleteSubtree(subtree)
  const path = `${generatedAppContentsRootPath(appId)}/${generatedAppVersionFile(version)}`
  emitSystemVfsChange(path, 'deleted')
}

/** 删除生成应用整个 Contents 子树（卸载应用用） */
export async function removeGeneratedAppContents(appId: string): Promise<void> {
  const bundleName = appBundleDirName(appId)
  const bundles = await listChildNodes(LOCATION_ID, undefined)
  const bundle = bundles.find((node) => node.kind === 'folder' && node.name === bundleName)
  if (!bundle) return
  const contentsDir = (await listChildNodes(LOCATION_ID, bundle.id)).find(
    (node) => node.kind === 'folder' && node.name === GENERATED_APP_CONTENTS_DIR,
  )
  if (!contentsDir) return
  const subtree = await collectSubtreeIds(contentsDir.id)
  await deleteSubtree(subtree)
  emitSystemVfsChange(generatedAppContentsRootPath(appId), 'deleted')
}
