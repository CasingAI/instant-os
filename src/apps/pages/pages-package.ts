import type { JSONContent } from '@tiptap/core'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

export const PAGES_PACKAGE_TYPE = 'instant-pages'
export const PAGES_PACKAGE_VERSION = 1
export const PAGES_FILE_EXTENSION = 'pages'
export const PAGES_MIME = 'application/vnd.instant.pages+zip'

export const PAGES_MANIFEST_PATH = 'manifest.json'
export const PAGES_DOCUMENT_PATH = 'document.json'
export const PAGES_ASSETS_PREFIX = 'assets/'

export type PagesManifest = {
  version: number
  type: typeof PAGES_PACKAGE_TYPE
  title?: string
}

export type PagesAsset = {
  id: string
  fileName: string
  mimeType: string
  bytes: Uint8Array
}

export type PagesAssetMap = Map<string, PagesAsset>

export type UnpackedPagesPackage = {
  manifest: PagesManifest
  document: JSONContent
  assets: PagesAssetMap
}

export const PAGES_EMPTY_DOCUMENT: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: '无标题文档' }],
    },
    { type: 'paragraph' },
  ],
}

export function createEmptyPagesManifest(title = '无标题文档'): PagesManifest {
  return {
    version: PAGES_PACKAGE_VERSION,
    type: PAGES_PACKAGE_TYPE,
    title,
  }
}

export function assetSrcPath(fileName: string): string {
  return `${PAGES_ASSETS_PREFIX}${fileName}`
}

export function parseAssetSrc(src: string | null | undefined): string | null {
  if (!src) return null
  if (!src.startsWith(PAGES_ASSETS_PREFIX)) return null
  const name = src.slice(PAGES_ASSETS_PREFIX.length)
  return name.length > 0 ? name : null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseManifest(raw: string): PagesManifest {
  const parsed: unknown = JSON.parse(raw)
  if (!isPlainObject(parsed)) throw new Error('manifest.json 无效')
  if (parsed.type !== PAGES_PACKAGE_TYPE) throw new Error('不是 Instant 文稿包')
  if (parsed.version !== PAGES_PACKAGE_VERSION) {
    throw new Error(`不支持的文稿版本：${String(parsed.version)}`)
  }
  return {
    version: PAGES_PACKAGE_VERSION,
    type: PAGES_PACKAGE_TYPE,
    title: typeof parsed.title === 'string' ? parsed.title : undefined,
  }
}

function parseDocument(raw: string): JSONContent {
  const parsed: unknown = JSON.parse(raw)
  if (!isPlainObject(parsed) || parsed.type !== 'doc') {
    throw new Error('document.json 无效')
  }
  return parsed as JSONContent
}

function guessMime(fileName: string): string {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  return 'application/octet-stream'
}

function assetIdFromFileName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

/** 打包为 .pages zip 字节 */
export function packPagesPackage(input: {
  manifest: PagesManifest
  document: JSONContent
  assets: PagesAssetMap
}): Uint8Array {
  const files: Record<string, Uint8Array> = {
    [PAGES_MANIFEST_PATH]: strToU8(JSON.stringify(input.manifest, null, 2)),
    [PAGES_DOCUMENT_PATH]: strToU8(JSON.stringify(input.document)),
  }
  for (const asset of input.assets.values()) {
    files[assetSrcPath(asset.fileName)] = asset.bytes
  }
  return zipSync(files, { level: 6 })
}

export function packEmptyPagesPackage(title = '无标题文档'): Uint8Array {
  return packPagesPackage({
    manifest: createEmptyPagesManifest(title),
    document: PAGES_EMPTY_DOCUMENT,
    assets: new Map(),
  })
}

/** 解压 .pages zip */
export function unpackPagesPackage(bytes: Uint8Array): UnpackedPagesPackage {
  const unzipped = unzipSync(bytes)
  const manifestBytes = unzipped[PAGES_MANIFEST_PATH]
  const documentBytes = unzipped[PAGES_DOCUMENT_PATH]
  if (!manifestBytes || !documentBytes) {
    throw new Error('文稿包缺少 manifest.json 或 document.json')
  }

  const manifest = parseManifest(strFromU8(manifestBytes))
  const document = parseDocument(strFromU8(documentBytes))
  const assets: PagesAssetMap = new Map()

  for (const [path, data] of Object.entries(unzipped)) {
    if (!path.startsWith(PAGES_ASSETS_PREFIX) || path.endsWith('/')) continue
    const fileName = path.slice(PAGES_ASSETS_PREFIX.length)
    if (!fileName || fileName.includes('/')) continue
    const id = assetIdFromFileName(fileName)
    assets.set(id, {
      id,
      fileName,
      mimeType: guessMime(fileName),
      bytes: data,
    })
  }

  return { manifest, document, assets }
}

export function collectReferencedAssetFileNames(doc: JSONContent): Set<string> {
  const found = new Set<string>()
  const walk = (node: JSONContent) => {
    if (node.type === 'image') {
      const src = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
      const name = parseAssetSrc(src)
      if (name) found.add(name)
    }
    node.content?.forEach(walk)
  }
  walk(doc)
  return found
}

/** 保存前去掉未被 document 引用的资源 */
export function pruneAssetsToDocument(doc: JSONContent, assets: PagesAssetMap): PagesAssetMap {
  const referenced = collectReferencedAssetFileNames(doc)
  const next: PagesAssetMap = new Map()
  for (const asset of assets.values()) {
    if (referenced.has(asset.fileName)) {
      next.set(asset.id, asset)
    }
  }
  return next
}
