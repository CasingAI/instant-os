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

const IMAGE_URL_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'svg',
  'avif',
  'ico',
  'bmp',
  'tif',
  'tiff',
])

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

function urlHasImageExtension(url: string): boolean {
  const name = networkEntryName(url)
  const match = /\.([a-z0-9]{1,12})$/i.exec(name)
  if (!match) {
    return false
  }
  return IMAGE_URL_EXTENSIONS.has(match[1].toLowerCase())
}

/** image/*、DevTools destination type=image，或 URL 扩展名为常见图片格式 */
export function isPreviewableImageBody(
  entry: ChromoNetworkEntry,
  contentType?: string,
): boolean {
  const type = (entry.type || '').toLowerCase()
  if (type === 'image') {
    return true
  }
  const mime = normalizeMime(contentType)
  if (mime.startsWith('image/')) {
    return true
  }
  return urlHasImageExtension(entry.url)
}

/**
 * 不可预览的二进制（不含 image）：video / audio / font / pdf / wasm / zip 等。
 * 用于跳过 body RPC。图片类型优先，避免 octet-stream + type=image 被误判。
 */
export function isNonPreviewableBinaryBody(
  entry: ChromoNetworkEntry,
  contentType?: string,
): boolean {
  if (isPreviewableImageBody(entry, contentType)) {
    return false
  }
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

/** 将 latin1 字符串（每字符一字节）还原为原始字节 */
export function latin1StringToBytes(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0xff
  }
  return bytes
}

function normalizeBase64Payload(base64: string): string {
  let cleaned = base64.replace(/\s/g, '')
  const dataUrlMatch = /^data:[^;]*;base64,/i.exec(cleaned)
  if (dataUrlMatch) {
    cleaned = cleaned.slice(dataUrlMatch[0].length)
  }
  return cleaned
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(normalizeBase64Payload(base64))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * 粗略校验图片 magic bytes（JPEG / PNG / GIF / WebP / BMP / ICO / AVIF / SVG 文本）。
 * 用于在渲染前给出友好错误，避免破损图标。
 */
export function isLikelyValidImageBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 3) {
    return false
  }
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return true
  }
  // PNG
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return true
  }
  // GIF87a / GIF89a
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return true
  }
  // BMP
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return true
  }
  // ICO
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x00 &&
    bytes[2] === 0x01 &&
    bytes[3] === 0x00
  ) {
    return true
  }
  // WebP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return true
  }
  // AVIF / HEIC-family: ....ftyp
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return true
  }
  // SVG (text): leading whitespace then '<'
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, Math.min(bytes.length, 256)))
    .trimStart()
    .toLowerCase()
  if (head.startsWith('<?xml') || head.startsWith('<svg')) {
    return true
  }
  // gzip-compressed payload (common mis-store) — not a valid image for <img>
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return false
  }
  return false
}

/** 将 network body 解码为原始字节（base64 或 latin1 text；SVG 文本用 UTF-8） */
export function networkBodyToBytes(result: ChromoNetworkBodyReadResult, mime?: string): Uint8Array {
  if (result.encoding === 'base64') {
    return base64ToBytes(result.body)
  }
  const type =
    normalizeMime(mime) ||
    normalizeMime(result.headers['content-type'] || result.headers['Content-Type'])
  // SVG is text XML — body is already a JS string; encode as UTF-8
  if (type === 'image/svg+xml' || type === 'image/svg') {
    return new TextEncoder().encode(result.body)
  }
  // Binary image delivered as latin1 text — do NOT use TextEncoder (UTF-8 re-encodes >0x7F)
  return latin1StringToBytes(result.body)
}

/** Infer image/* MIME from magic bytes (fallback when Content-Type is octet-stream). */
export function sniffImageMime(bytes: Uint8Array): string | undefined {
  if (bytes.length < 3) {
    return undefined
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png'
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return 'image/gif'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'image/bmp'
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x00 &&
    bytes[2] === 0x01 &&
    bytes[3] === 0x00
  ) {
    return 'image/x-icon'
  }
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, Math.min(bytes.length, 256)))
    .trimStart()
    .toLowerCase()
  if (head.startsWith('<?xml') || head.startsWith('<svg')) {
    return 'image/svg+xml'
  }
  return undefined
}

/** 将 network body 转为图片 Blob（base64 或 latin1 text 兜底） */
export function networkBodyToImageBlob(
  result: ChromoNetworkBodyReadResult,
  mime?: string,
): Blob {
  const headerMime =
    normalizeMime(mime) ||
    normalizeMime(result.headers['content-type'] || result.headers['Content-Type'])
  const bytes = networkBodyToBytes(result, headerMime || undefined)
  const sniffed = sniffImageMime(bytes)
  const type =
    (headerMime && headerMime.startsWith('image/') ? headerMime : undefined) ||
    sniffed ||
    headerMime ||
    'application/octet-stream'
  return new Blob([new Uint8Array(bytes)], {
    type,
  })
}
