import {
  ensureSourceSnapshotLoaded,
  readSourceBytes,
  readSourceFile,
} from '../../ai/source-snapshot-store.ts'
import {
  getCachedAppCatalogEntryByBundlePath,
  listAppCatalogEntries,
  resolveAppCatalogEntryByBundlePath,
  type AppCatalogEntry,
} from '../../os/app-catalog.ts'
import {
  APP_DATA_DIR_NAME,
} from './files-app-data-root.ts'
import { APP_BUNDLE_SUFFIX } from './files-app-id.ts'
import {
  listChildNodes,
  readBlobBytes,
  readBlobText,
} from './files-storage.ts'
import { FILES_TEXT_MIME, type FilesNode } from './files-types.ts'

const LOCATION_ID = 'applications' as const
const EPOCH = 0
const READONLY_ATTRIBUTES = { readable: true, writable: false } as const
const CONTENTS_DIR = 'Contents'
const MANIFEST_FILE = 'instant-os.manifest.json'

// ---- App Data 真身（/Applications/{bundle}.app/Data ↔ applications 卷 IndexedDB 真实节点） ----

/** 相对 Data 根的子路径（'' 表示 Data 根本身；非 Data 子树返回 undefined） */
function appDataRelativePath(bundlePath: string, fullPath: string): string | undefined {
  const root = `${bundlePath}/${APP_DATA_DIR_NAME}`
  if (fullPath === root) return ''
  const prefix = `${root}/`
  if (!fullPath.startsWith(prefix)) return undefined
  return fullPath.slice(prefix.length)
}

/** 按路径段逐层解析 applications 卷里的 Data 真身节点（真实 IndexedDB 节点） */
async function resolveDataRealNode(
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

/** 把 applications 卷真实节点重映射为 applications 卷合成 id 的只读节点 */
function toApplicationsNode(node: FilesNode, applicationsPath: string): FilesNode {
  const parent = parentDirPath(applicationsPath)
  return {
    id: node.kind === 'folder' ? dirId(applicationsPath) : fileId(applicationsPath),
    locationId: LOCATION_ID,
    parentId: parent === undefined ? undefined : dirId(parent),
    name: node.name,
    kind: node.kind,
    mimeType: node.mimeType,
    byteSize: node.byteSize,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    attributes: READONLY_ATTRIBUTES,
  }
}

/** Data 真身路径段（以 applications 卷根为基准）：`{bundlePath}/Data/{relative}` */
function dataRealSegments(bundlePath: string, relativePath: string): string[] {
  return [
    ...bundlePath.split('/').filter(Boolean),
    APP_DATA_DIR_NAME,
    ...(relativePath ? relativePath.split('/') : []),
  ]
}

function dirId(path: string): string {
  return `applications:d:${path}`
}

function fileId(path: string): string {
  return `applications:f:${path}`
}

export function parseApplicationsDirPath(id: string): string | undefined {
  if (!id.startsWith('applications:d:')) return undefined
  return id.slice('applications:d:'.length)
}

function parseApplicationsFilePath(id: string): string | undefined {
  if (!id.startsWith('applications:f:')) return undefined
  return id.slice('applications:f:'.length)
}

function parentDirPath(path: string): string | undefined {
  const slash = path.lastIndexOf('/')
  if (slash <= 0) return undefined
  return path.slice(0, slash)
}

function baseName(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(slash + 1) : path
}

function guessMime(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.css')) return 'text/css'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html'
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.mdx')) {
    return 'text/markdown'
  }
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.tsx') || lower.endsWith('.ts')) return 'text/plain'
  return FILES_TEXT_MIME
}

function makeDirNode(path: string): FilesNode {
  const parent = parentDirPath(path)
  return {
    id: dirId(path),
    locationId: LOCATION_ID,
    parentId: parent === undefined ? undefined : dirId(parent),
    name: baseName(path),
    kind: 'folder',
    mimeType: undefined,
    byteSize: 0,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    attributes: READONLY_ATTRIBUTES,
  }
}

function makeFileNode(path: string, byteSize: number, mimeType: string): FilesNode {
  const parent = parentDirPath(path)
  return {
    id: fileId(path),
    locationId: LOCATION_ID,
    parentId: parent === undefined ? undefined : dirId(parent),
    name: baseName(path),
    kind: 'file',
    mimeType,
    byteSize,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    attributes: READONLY_ATTRIBUTES,
  }
}

function bundleContentsPath(bundlePath: string): string {
  return `${bundlePath}/${CONTENTS_DIR}`
}

function bundleManifestPath(bundlePath: string): string {
  return `${bundlePath}/${MANIFEST_FILE}`
}

function contentsRelativePath(bundlePath: string, fullPath: string): string | undefined {
  const contentsRoot = bundleContentsPath(bundlePath)
  if (fullPath === contentsRoot) return ''
  const prefix = `${contentsRoot}/`
  if (!fullPath.startsWith(prefix)) return undefined
  return fullPath.slice(prefix.length)
}

function sourcePathForContents(entry: AppCatalogEntry, relativePath: string): string | undefined {
  if (entry.kind !== 'builtin' || !entry.sourceRootPath) return undefined
  if (!relativePath) return entry.sourceRootPath
  return `${entry.sourceRootPath}/${relativePath}`
}

function buildManifest(entry: AppCatalogEntry): string {
  return `${JSON.stringify(
    {
      format: entry.kind === 'generated' ? 'instant-os-generated-app' : 'instant-os-builtin-app',
      id: entry.id,
      name: entry.name,
      description: entry.description ?? '',
      version: entry.version ?? '1.0.0',
      kind: entry.kind,
      ...(entry.kind === 'builtin' && entry.sourceRootPath
        ? { sourceRootPath: entry.sourceRootPath }
        : {}),
    },
    null,
    2,
  )}\n`
}

async function resolveEntryForPath(path: string): Promise<AppCatalogEntry | undefined> {
  const root = path.split('/')[0]
  if (!root) return undefined
  return resolveAppCatalogEntryByBundlePath(root)
}

async function sourcePathExists(sourcePath: string): Promise<boolean> {
  const files = await ensureSourceSnapshotLoaded()
  if (files.has(sourcePath)) return true
  const prefix = `${sourcePath}/`
  for (const candidate of files.keys()) {
    if (candidate === sourcePath || candidate.startsWith(prefix)) return true
  }
  return false
}

async function isKnownApplicationsPath(path: string): Promise<boolean> {
  const entry = await resolveEntryForPath(path)
  if (!entry) return false

  if (path === entry.bundlePath) return true
  if (path === bundleManifestPath(entry.bundlePath)) return true

  const dataRelative = appDataRelativePath(entry.bundlePath, path)
  if (dataRelative !== undefined) {
    // Data 根恒展示（未写入时为空目录）；子树按 applications 卷真实存在性判定
    if (dataRelative === '') return true
    return (
      (await resolveDataRealNode(dataRealSegments(entry.bundlePath, dataRelative))) !== undefined
    )
  }

  if (entry.kind === 'builtin') {
    if (path === bundleContentsPath(entry.bundlePath)) {
      return entry.sourceRootPath ? sourcePathExists(entry.sourceRootPath) : true
    }
    const relative = contentsRelativePath(entry.bundlePath, path)
    if (relative !== undefined && entry.sourceRootPath) {
      return sourcePathExists(sourcePathForContents(entry, relative)!)
    }
  }

  return false
}

async function readManifestFile(path: string): Promise<string | undefined> {
  const entry = await resolveEntryForPath(path)
  if (!entry || path !== bundleManifestPath(entry.bundlePath)) return undefined
  return buildManifest(entry)
}

async function readContentsSourceFile(
  entry: AppCatalogEntry,
  virtualPath: string,
): Promise<{ text: string; byteSize: number; mime: string } | undefined> {
  const relative = contentsRelativePath(entry.bundlePath, virtualPath)
  if (relative === undefined || entry.kind !== 'builtin' || !entry.sourceRootPath) return undefined

  const sourcePath = sourcePathForContents(entry, relative)!
  const text = await readSourceFile(sourcePath)
  if (text === undefined) return undefined
  const bytes = await readSourceBytes(sourcePath)
  return {
    text,
    byteSize: bytes?.byteLength ?? new TextEncoder().encode(text).length,
    mime: guessMime(sourcePath),
  }
}

async function listContentsDirectory(
  entry: AppCatalogEntry,
  relativePath: string,
): Promise<FilesNode[]> {
  const sourceRoot = sourcePathForContents(entry, relativePath)
  if (!sourceRoot) return []

  const files = await ensureSourceSnapshotLoaded()
  const prefix = relativePath ? `${entry.sourceRootPath}/${relativePath}` : entry.sourceRootPath!
  const contentsVirtualRoot = bundleContentsPath(entry.bundlePath)
  const virtualPrefix =
    relativePath === '' ? contentsVirtualRoot : `${contentsVirtualRoot}/${relativePath}`

  const dirs = new Set<string>()
  const filePaths: string[] = []

  for (const sourceFilePath of files.keys()) {
    if (sourceFilePath === prefix || !sourceFilePath.startsWith(`${prefix}/`)) continue
    const rest = sourceFilePath.slice(prefix.length + 1)
    const slash = rest.indexOf('/')
    if (slash === -1) {
      filePaths.push(`${virtualPrefix}/${rest}`)
    } else {
      dirs.add(`${virtualPrefix}/${rest.slice(0, slash)}`)
    }
  }

  return [
    ...[...dirs].sort((a, b) => a.localeCompare(b)).map((path) => makeDirNode(path)),
    ...filePaths
      .sort((a, b) => a.localeCompare(b))
      .map((path) => {
        const relativeFile = path.slice(contentsVirtualRoot.length + 1)
        const sourcePath = sourcePathForContents(entry, relativeFile)!
        const bytes = files.get(sourcePath)
        return makeFileNode(path, bytes?.byteLength ?? 0, guessMime(sourcePath))
      }),
  ]
}

export function isApplicationsBundleRootNode(node: FilesNode): boolean {
  if (node.locationId !== LOCATION_ID || node.kind !== 'folder') return false
  const path = parseApplicationsDirPath(node.id)
  if (!path) return false
  return path.endsWith('.app') && !path.includes('/')
}

/**
 * 文件管理器的显示名：包根节点用清单显示名（如「天气.app」），
 * 其余节点直接用 ID 原始名（终端 / AI / 复制路径仍见 `weather.app`）。
 * 同步实现：依赖已加载的 catalog 内存缓存；未命中时退化为节点名。
 */
export function applicationsBundleDisplayName(node: FilesNode): string {
  if (!isApplicationsBundleRootNode(node)) return node.name
  const bundlePath = parseApplicationsDirPath(node.id)
  const entry = bundlePath ? getCachedAppCatalogEntryByBundlePath(bundlePath) : undefined
  return entry ? `${entry.name}${APP_BUNDLE_SUFFIX}` : node.name
}

export async function getApplicationsNode(id: string): Promise<FilesNode | undefined> {
  const dirPath = parseApplicationsDirPath(id)
  if (dirPath !== undefined) {
    const entry = await resolveEntryForPath(dirPath)
    if (entry) {
      const dataRelative = appDataRelativePath(entry.bundlePath, dirPath)
      if (dataRelative !== undefined) {
        if (dataRelative === '') return makeDirNode(dirPath)
        const realNode = await resolveDataRealNode(dataRealSegments(entry.bundlePath, dataRelative))
        if (realNode && realNode.kind === 'folder') return toApplicationsNode(realNode, dirPath)
        return undefined
      }
    }
    return (await isKnownApplicationsPath(dirPath)) ? makeDirNode(dirPath) : undefined
  }

  const filePath = parseApplicationsFilePath(id)
  if (filePath === undefined) return undefined

  const manifest = await readManifestFile(filePath)
  if (manifest !== undefined) {
    return makeFileNode(filePath, new TextEncoder().encode(manifest).length, 'application/json')
  }

  const entry = await resolveEntryForPath(filePath)
  if (!entry) return undefined

  const dataRelative = appDataRelativePath(entry.bundlePath, filePath)
  if (dataRelative !== undefined && dataRelative !== '') {
    const realNode = await resolveDataRealNode(dataRealSegments(entry.bundlePath, dataRelative))
    if (realNode && realNode.kind === 'file') return toApplicationsNode(realNode, filePath)
    return undefined
  }

  const contentsFile = await readContentsSourceFile(entry, filePath)
  if (contentsFile === undefined) return undefined
  return makeFileNode(filePath, contentsFile.byteSize, contentsFile.mime)
}

export async function listApplicationsDirectory(folderId: string | undefined): Promise<FilesNode[]> {
  const prefix = folderId === undefined ? undefined : parseApplicationsDirPath(folderId)
  if (folderId !== undefined && prefix === undefined) return []

  if (prefix === undefined) {
    const entries = await listAppCatalogEntries()
    return entries.map((entry) => makeDirNode(entry.bundlePath))
  }

  const entry = await resolveEntryForPath(prefix)
  if (!entry) return []

  if (prefix === entry.bundlePath) {
    const children: FilesNode[] = []
    if (
      entry.kind === 'builtin' &&
      entry.sourceRootPath &&
      (await sourcePathExists(entry.sourceRootPath))
    ) {
      children.push(makeDirNode(bundleContentsPath(entry.bundlePath)))
    }
    children.push(makeDirNode(`${entry.bundlePath}/${APP_DATA_DIR_NAME}`))
    children.push(
      makeFileNode(
        bundleManifestPath(entry.bundlePath),
        new TextEncoder().encode(buildManifest(entry)).length,
        'application/json',
      ),
    )
    return children
  }

  const dataRelative = appDataRelativePath(entry.bundlePath, prefix)
  if (dataRelative !== undefined) {
    const realNode = await resolveDataRealNode(dataRealSegments(entry.bundlePath, dataRelative))
    if (!realNode || realNode.kind !== 'folder') return []
    const children = await listChildNodes(LOCATION_ID, realNode.id)
    return children.map((child) => toApplicationsNode(child, `${prefix}/${child.name}`))
  }

  if (entry.kind === 'builtin') {
    const relative = contentsRelativePath(entry.bundlePath, prefix)
    if (relative !== undefined) {
      return listContentsDirectory(entry, relative)
    }
  }

  return []
}

export async function resolveApplicationsPath(folderId: string | undefined): Promise<FilesNode[]> {
  if (folderId === undefined) return []
  const dirPath = parseApplicationsDirPath(folderId)
  if (dirPath === undefined || !(await isKnownApplicationsPath(dirPath))) return []

  const chain: FilesNode[] = []
  let current: string | undefined = dirPath
  while (current !== undefined) {
    chain.unshift(makeDirNode(current))
    current = parentDirPath(current)
  }
  return chain
}

export async function readApplicationsText(id: string): Promise<{ node: FilesNode; text: string }> {
  const filePath = parseApplicationsFilePath(id)
  if (filePath === undefined) {
    throw new Error('文件不存在')
  }

  const manifest = await readManifestFile(filePath)
  if (manifest !== undefined) {
    return {
      node: makeFileNode(filePath, new TextEncoder().encode(manifest).length, 'application/json'),
      text: manifest,
    }
  }

  const entry = await resolveEntryForPath(filePath)
  if (!entry) throw new Error('文件不存在')

  const dataRelative = appDataRelativePath(entry.bundlePath, filePath)
  if (dataRelative !== undefined && dataRelative !== '') {
    const realNode = await resolveDataRealNode(dataRealSegments(entry.bundlePath, dataRelative))
    if (!realNode || realNode.kind !== 'file') throw new Error('文件不存在')
    const text = await readBlobText(realNode.id)
    return { node: toApplicationsNode(realNode, filePath), text }
  }

  const contentsFile = await readContentsSourceFile(entry, filePath)
  if (contentsFile === undefined) throw new Error('文件不存在')

  return {
    node: makeFileNode(filePath, contentsFile.byteSize, contentsFile.mime),
    text: contentsFile.text,
  }
}

export async function readApplicationsBlob(id: string): Promise<{ node: FilesNode; blob: Blob }> {
  const filePath = parseApplicationsFilePath(id)
  if (filePath === undefined) {
    throw new Error('文件不存在')
  }

  const entry = await resolveEntryForPath(filePath)
  if (entry) {
    const dataRelative = appDataRelativePath(entry.bundlePath, filePath)
    if (dataRelative !== undefined && dataRelative !== '') {
      const realNode = await resolveDataRealNode(dataRealSegments(entry.bundlePath, dataRelative))
      if (!realNode || realNode.kind !== 'file') throw new Error('文件不存在')
      const bytes = await readBlobBytes(realNode.id)
      const mime = realNode.mimeType ?? FILES_TEXT_MIME
      if (bytes !== undefined) {
        return {
          node: toApplicationsNode(realNode, filePath),
          blob: new Blob([new Uint8Array(bytes) as BlobPart], { type: mime }),
        }
      }
      throw new Error('文件不存在')
    }
  }

  const relative = entry ? contentsRelativePath(entry.bundlePath, filePath) : undefined
  if (entry && relative !== undefined && entry.sourceRootPath) {
    const sourcePath = sourcePathForContents(entry, relative)!
    const bytes = await readSourceBytes(sourcePath)
    if (bytes !== undefined) {
      const mime = guessMime(sourcePath)
      return {
        node: makeFileNode(filePath, bytes.byteLength, mime),
        blob: new Blob([bytes as BlobPart], { type: mime }),
      }
    }
  }

  const { node, text } = await readApplicationsText(id)
  const type = node.mimeType ?? FILES_TEXT_MIME
  return {
    node,
    blob: new Blob([text], { type }),
  }
}
