import type { ChromoNetworkBodyReadResult, ChromoNetworkEntry } from './chromo-bridge.ts'

export type NetworkPreviewKind = 'image' | 'text' | 'json' | 'binary'

export function networkEntryName(url: string): string {
  try {
    const parsed = new URL(url)
    if (!parsed.pathname || parsed.pathname === '/') {
      return parsed.host
    }
    const segments = parsed.pathname.split('/').filter(Boolean)
    if (segments.length === 0) {
      return parsed.host
    }
    try {
      return decodeURIComponent(segments[segments.length - 1])
    } catch {
      return segments[segments.length - 1]
    }
  } catch {
    const stripped = url.split('?')[0]?.split('#')[0] ?? url
    const slash = stripped.lastIndexOf('/')
    if (slash < 0) {
      return url
    }
    const tail = stripped.slice(slash + 1)
    return tail || stripped
  }
}

const NON_PREVIEWABLE_DESTINATIONS = new Set(['video', 'audio', 'font'])

const TEXT_APPLICATION_MIMES = new Set([
  'application/javascript',
  'application/x-javascript',
  'application/ecmascript',
  'application/xml',
  'application/xhtml+xml',
  'application/rss+xml',
  'application/atom+xml',
  'application/x-www-form-urlencoded',
  'application/graphql',
  'application/sql',
])

function normalizeMime(contentType?: string): string {
  return (contentType || '').split(';')[0].trim().toLowerCase()
}

/** image/* 或 DevTools destination type=image */
export function isPreviewableImageBody(
  entry: ChromoNetworkEntry,
  contentType?: string,
): boolean {
  const type = (entry.type || '').toLowerCase()
  if (type === 'image') {
    return true
  }
  const mime = normalizeMime(contentType)
  return mime.startsWith('image/')
}

/**
 * 不可预览的二进制（不含 image）：video / audio / font / pdf / wasm / zip 等。
 * 用于跳过 body RPC。
 */
export function isNonPreviewableBinaryBody(
  entry: ChromoNetworkEntry,
  contentType?: string,
): boolean {
  const type = (entry.type || '').toLowerCase()
  if (NON_PREVIEWABLE_DESTINATIONS.has(type)) {
    return true
  }
  const mime = normalizeMime(contentType)
  if (!mime) {
    return false
  }
  return (
    mime.startsWith('video/') ||
    mime.startsWith('audio/') ||
    mime.startsWith('font/') ||
    mime === 'application/octet-stream' ||
    mime === 'application/wasm' ||
    mime === 'application/pdf' ||
    mime === 'application/zip' ||
    mime === 'application/gzip'
  )
}

/** 图片或不可预览二进制（旧语义：媒体类二进制） */
export function isBinaryNetworkBody(
  entry: ChromoNetworkEntry,
  contentType?: string,
): boolean {
  return isPreviewableImageBody(entry, contentType) || isNonPreviewableBinaryBody(entry, contentType)
}

export function classifyNetworkPreviewKind(
  entry: ChromoNetworkEntry,
  contentType?: string,
): NetworkPreviewKind {
  const mime = normalizeMime(contentType)

  if (isPreviewableImageBody(entry, mime)) {
    return 'image'
  }
  if (isNonPreviewableBinaryBody(entry, mime)) {
    return 'binary'
  }
  if (mime.includes('json') || mime === 'application/ld+json') {
    return 'json'
  }
  if (
    !mime ||
    mime.startsWith('text/') ||
    TEXT_APPLICATION_MIMES.has(mime) ||
    mime.endsWith('+xml')
  ) {
    return 'text'
  }
  return 'binary'
}

/** MIME → 假文件名后缀，供 Monaco 语言推断 */
function extensionFromMime(mime: string): string {
  switch (mime) {
    case 'text/html':
    case 'application/xhtml+xml':
      return 'html'
    case 'text/css':
      return 'css'
    case 'text/javascript':
    case 'application/javascript':
    case 'application/x-javascript':
    case 'application/ecmascript':
      return 'js'
    case 'text/typescript':
      return 'ts'
    case 'text/xml':
    case 'application/xml':
    case 'image/svg+xml':
      return 'xml'
    case 'text/csv':
      return 'csv'
    case 'text/markdown':
      return 'md'
    case 'text/plain':
      return 'txt'
    case 'text/x-python':
      return 'py'
    case 'text/x-sh':
    case 'application/x-sh':
      return 'sh'
    default:
      if (mime.startsWith('text/')) return 'txt'
      return 'txt'
  }
}

/**
 * 从 URL 末段或 MIME 生成假文件名（如 response.html），供 Monaco 语言推断。
 */
export function previewFileNameFromEntry(url: string, mime?: string): string {
  const name = networkEntryName(url)
  const hasExt = /\.[a-z0-9]{1,12}$/i.test(name)
  if (hasExt && name !== url) {
    return name
  }
  const normalized = normalizeMime(mime)
  const ext = normalized ? extensionFromMime(normalized) : 'txt'
  if (name && name !== url && !name.includes('/')) {
    return `${name}.${ext}`
  }
  return `response.${ext}`
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/** 将 network body 转为图片 Blob（base64 或 text 兜底） */
export function networkBodyToImageBlob(
  result: ChromoNetworkBodyReadResult,
  mime?: string,
): Blob {
  const type =
    normalizeMime(mime) ||
    normalizeMime(result.headers['content-type'] || result.headers['Content-Type']) ||
    'application/octet-stream'
  if (result.encoding === 'base64') {
    const bytes = base64ToBytes(result.body)
    return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)], {
      type,
    })
  }
  // Rare: image body delivered as text encoding — treat as UTF-8 bytes
  return new Blob([new TextEncoder().encode(result.body)], { type })
}
