import { unzipSync } from 'fflate'

function normalizeZipPath(path: string): string {
  return path.replace(/^\/+/, '').replace(/\\/g, '/')
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

/** 解压 zip 为相对路径 → 字节；自动剥一层公共根目录。 */
export function unzipBytes(buffer: Uint8Array): Map<string, Uint8Array> {
  return stripZipRoot(unzipSync(buffer))
}
