import { unzipSync } from 'fflate'

function normalizeZipPath(path: string): string {
  return path.replace(/^\/+/, '').replace(/\\/g, '/')
}

/**
 * fflate 在未置 UTF-8 标志时按 Latin-1 解文件名。
 * 国内常见 ZIP（Windows 压缩文件夹等）用 GBK/GB18030 存中文且不置该标志；
 * 也有工具存 UTF-8 但不置标志。此处从 Latin-1 还原字节后再按 UTF-8 / GB18030 解码。
 * 已是 UTF-8 标志解码结果的（出现码点 > 255）原样保留。
 */
function decodeZipEntryName(name: string): string {
  const len = name.length
  const bytes = new Uint8Array(len)
  let hasHigh = false
  for (let i = 0; i < len; i++) {
    const code = name.charCodeAt(i)
    if (code > 255) return name
    bytes[i] = code
    if (code >= 0x80) hasHigh = true
  }
  if (!hasHigh) return name

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // 非合法 UTF-8，继续尝试本地中文编码
  }

  try {
    return new TextDecoder('gb18030').decode(bytes)
  } catch {
    return name
  }
}

function remapZipEntryNames(files: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {}
  for (const [key, value] of Object.entries(files)) {
    out[decodeZipEntryName(key)] = value
  }
  return out
}

function unzipRaw(buffer: Uint8Array): Record<string, Uint8Array> {
  return remapZipEntryNames(unzipSync(buffer))
}

/**
 * 去掉 zip 内唯一公共顶层目录（GitHub zipball 常见 `owner-repo-sha/`）。
 * 多根或不存在公共根时原样保留相对路径。
 */
export function stripZipRoot(files: Record<string, Uint8Array>): Map<string, Uint8Array> {
  const map = new Map<string, Uint8Array>()
  const keys = Object.keys(files).filter((key) => !key.endsWith('/'))
  if (keys.length === 0) return map

  let commonRoot: string | undefined
  for (const key of keys) {
    const normalized = normalizeZipPath(key)
    const slash = normalized.indexOf('/')
    if (slash <= 0) {
      commonRoot = undefined
      break
    }
    const root = normalized.slice(0, slash)
    if (commonRoot === undefined) commonRoot = root
    else if (commonRoot !== root) {
      commonRoot = undefined
      break
    }
  }

  for (const key of keys) {
    const normalized = normalizeZipPath(key)
    const relative =
      commonRoot && normalized.startsWith(`${commonRoot}/`)
        ? normalized.slice(commonRoot.length + 1)
        : normalized
    if (!relative || relative.endsWith('/')) continue
    const bytes = files[key]
    if (!bytes) continue
    map.set(relative, bytes)
  }
  return map
}

/** 解压 zip 为相对路径 → 字节；保留归档内路径（含顶层目录）。 */
export function unzipBytesPreserveRoot(buffer: Uint8Array): Map<string, Uint8Array> {
  const unzipped = unzipRaw(buffer)
  const map = new Map<string, Uint8Array>()
  for (const [key, bytes] of Object.entries(unzipped)) {
    if (!bytes || key.endsWith('/')) continue
    const relative = normalizeZipPath(key)
    if (!relative || relative.split('/').includes('..')) continue
    map.set(relative, bytes)
  }
  return map
}

/** 解压 zip 为相对路径 → 字节；默认剥一层公共根目录。 */
export function unzipBytes(
  buffer: Uint8Array,
  options?: { stripRoot?: boolean },
): Map<string, Uint8Array> {
  if (options?.stripRoot === false) {
    return unzipBytesPreserveRoot(buffer)
  }
  return stripZipRoot(unzipRaw(buffer))
}
