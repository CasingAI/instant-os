import type { JSONContent } from '@tiptap/core'
import {
  assetSrcPath,
  parseAssetSrc,
  type PagesAsset,
  type PagesAssetMap,
} from './pages-package.ts'

let assetSeq = 0

function nextAssetId(): string {
  assetSeq += 1
  return `img_${Date.now().toString(36)}_${assetSeq.toString(36)}`
}

function extFromMime(mime: string): string {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/gif') return 'gif'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/svg+xml') return 'svg'
  return 'bin'
}

export type PagesBlobUrlMap = Map<string, string>

export function createPagesAssetFromBytes(params: {
  bytes: Uint8Array
  mimeType: string
  id?: string
}): PagesAsset {
  const id = params.id ?? nextAssetId()
  const ext = extFromMime(params.mimeType)
  return {
    id,
    fileName: `${id}.${ext}`,
    mimeType: params.mimeType || 'application/octet-stream',
    bytes: params.bytes,
  }
}

export async function createPagesAssetFromFile(file: File): Promise<PagesAsset> {
  const buffer = new Uint8Array(await file.arrayBuffer())
  const mime = file.type || 'application/octet-stream'
  return createPagesAssetFromBytes({ bytes: buffer, mimeType: mime })
}

export function buildBlobUrlMap(assets: PagesAssetMap): PagesBlobUrlMap {
  const map: PagesBlobUrlMap = new Map()
  for (const asset of assets.values()) {
    const blob = new Blob([asset.bytes.slice()], { type: asset.mimeType })
    map.set(asset.fileName, URL.createObjectURL(blob))
  }
  return map
}

export function revokeBlobUrlMap(map: PagesBlobUrlMap | null | undefined) {
  if (!map) return
  for (const url of map.values()) {
    URL.revokeObjectURL(url)
  }
  map.clear()
}

/** 把 document 里的 assets/… 换成可显示的 blob: URL */
export function rewriteDocumentSrcToBlobUrls(
  doc: JSONContent,
  blobUrls: PagesBlobUrlMap,
): JSONContent {
  const rewrite = (node: JSONContent): JSONContent => {
    let next: JSONContent = { ...node }
    if (node.type === 'image' && node.attrs && typeof node.attrs.src === 'string') {
      const fileName = parseAssetSrc(node.attrs.src)
      const blobUrl = fileName ? blobUrls.get(fileName) : undefined
      if (blobUrl) {
        next = {
          ...next,
          attrs: { ...node.attrs, src: blobUrl },
        }
      }
    }
    if (node.content) {
      next = { ...next, content: node.content.map(rewrite) }
    }
    return next
  }
  return rewrite(doc)
}

/** 把 blob:/临时 src 规范回 assets/…（按 blobUrls 反查，或保留已有 assets 路径） */
export function rewriteDocumentSrcToAssetPaths(
  doc: JSONContent,
  blobUrls: PagesBlobUrlMap,
  assets: PagesAssetMap,
): JSONContent {
  const blobToFile = new Map<string, string>()
  for (const [fileName, url] of blobUrls) {
    blobToFile.set(url, fileName)
  }

  const rewrite = (node: JSONContent): JSONContent => {
    let next: JSONContent = { ...node }
    if (node.type === 'image' && node.attrs && typeof node.attrs.src === 'string') {
      const src = node.attrs.src
      const fromBlob = blobToFile.get(src)
      if (fromBlob) {
        next = { ...next, attrs: { ...node.attrs, src: assetSrcPath(fromBlob) } }
      } else if (parseAssetSrc(src)) {
        // already package path
      } else if (src.startsWith('blob:')) {
        // unknown blob — drop to empty to avoid persisting
        next = { ...next, attrs: { ...node.attrs, src: '' } }
      }
      // http(s) external URLs kept as-is for md interop
    }
    if (node.content) {
      next = { ...next, content: node.content.map(rewrite) }
    }
    return next
  }
  void assets
  return rewrite(doc)
}

export function mergeAsset(assets: PagesAssetMap, asset: PagesAsset): PagesAssetMap {
  const next = new Map(assets)
  next.set(asset.id, asset)
  return next
}
