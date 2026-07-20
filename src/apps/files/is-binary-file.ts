import { fileNameExtension } from '../../os/file-open-registry.ts'

/**
 * 与 git buffer_is_binary / ripgrep 常见实现一致：检查文件头一段是否含 NUL。
 */
export const BINARY_PROBE_BYTES = 8000

/** 常见二进制扩展名（不含 svg / gltf 等文本格式） */
const BINARY_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'bmp',
  'tif',
  'tiff',
  'heic',
  'heif',
  'avif',
  'psd',
  'mp3',
  'wav',
  'flac',
  'aac',
  'ogg',
  'm4a',
  'wma',
  'mp4',
  'mov',
  'avi',
  'mkv',
  'webm',
  'wmv',
  'flv',
  'm4v',
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'tgz',
  'bz2',
  'xz',
  'dmg',
  'iso',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'ttf',
  'otf',
  'woff',
  'woff2',
  'eot',
  'exe',
  'dll',
  'so',
  'dylib',
  'bin',
  'wasm',
  'class',
  'jar',
  'pyc',
  'o',
  'a',
  'glb',
  'sqlite',
  'db',
  'icns',
])

const BINARY_MIME_PREFIXES = ['image/', 'audio/', 'video/', 'font/'] as const

const BINARY_MIME_TYPES = new Set([
  'application/pdf',
  'application/zip',
  'application/gzip',
  'application/x-tar',
  'application/x-7z-compressed',
  'application/wasm',
  'application/font-woff',
  'application/font-woff2',
  'model/gltf-binary',
])

/** 内容启发式：前 probeBytes 个字节/码元出现 NUL 即视为二进制 */
export function isBinaryContent(
  data: string | ArrayBuffer | Uint8Array,
  probeBytes = BINARY_PROBE_BYTES,
): boolean {
  if (typeof data === 'string') {
    const limit = Math.min(data.length, probeBytes)
    for (let i = 0; i < limit; i += 1) {
      if (data.charCodeAt(i) === 0) return true
    }
    return false
  }

  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const limit = Math.min(bytes.length, probeBytes)
  for (let i = 0; i < limit; i += 1) {
    if (bytes[i] === 0) return true
  }
  return false
}

/** 按文件名扩展名判断是否为常见二进制文件 */
export function isBinaryFileName(fileName: string): boolean {
  const extension = fileNameExtension(fileName)
  return extension !== undefined && BINARY_EXTENSIONS.has(extension)
}

/** 按 MIME 判断是否为明确的二进制类型（不含过于宽泛的 octet-stream） */
export function isBinaryMimeType(mimeType: string | undefined): boolean {
  if (!mimeType) return false
  const mime = mimeType.trim().toLowerCase()
  if (!mime) return false
  if (BINARY_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) return true
  return BINARY_MIME_TYPES.has(mime)
}

/**
 * 综合判断文件是否应按二进制对待。
 * 任一信号成立即返回 true：扩展名、MIME、字节内容 NUL、文本内容 NUL。
 */
export function isBinaryFile(input: {
  fileName?: string
  mimeType?: string
  text?: string
  bytes?: ArrayBuffer | Uint8Array
}): boolean {
  if (input.fileName && isBinaryFileName(input.fileName)) return true
  if (isBinaryMimeType(input.mimeType)) return true
  if (input.bytes !== undefined && isBinaryContent(input.bytes)) return true
  if (input.text !== undefined && isBinaryContent(input.text)) return true
  return false
}
