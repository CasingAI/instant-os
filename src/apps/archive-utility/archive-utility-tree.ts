import type { ArchiveCodecFormat } from '../../archive/archive-codec.ts'
import type { ArchiveEntryMeta } from '../../archive/archive-list.ts'

/**
 * 压缩包管理器的纯函数：目录树构建 / 选中过滤 / 格式化。
 * 与 VFS / Worker 无关，可被 node --experimental-strip-types 直接测试。
 */

export type ArchiveSession = {
  /** 归档在 VFS 中的绝对路径 */
  archivePath: string
  fileName: string
  format: ArchiveCodecFormat
  entries: ArchiveEntryMeta[]
}

export type ArchiveLevelItem =
  | { kind: 'dir'; name: string; path: string }
  | { kind: 'file'; name: string; path: string; meta: ArchiveEntryMeta }

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
}

/**
 * 构建当前目录下的一级条目（目录 + 文件，各按名称排序）。
 * 目录同时考虑显式目录条目（isDirectory）与隐式目录（仅存在于路径前缀）。
 */
export function buildArchiveLevel(
  entries: readonly ArchiveEntryMeta[],
  dir: readonly string[],
): ArchiveLevelItem[] {
  const dirPrefix = dir.length > 0 ? `${dir.join('/')}/` : ''
  const dirs = new Map<string, { name: string; path: string }>()
  const files: ArchiveLevelItem[] = []
  const seenDirs = new Set<string>()

  for (const entry of entries) {
    if (!entry.path.startsWith(dirPrefix)) continue
    const rest = entry.path.slice(dirPrefix.length)
    if (!rest) continue
    const slash = rest.indexOf('/')
    if (slash >= 0 || entry.isDirectory) {
      const dirName = slash >= 0 ? rest.slice(0, slash) : rest
      if (!dirName) continue
      const path = dir.length > 0 ? `${dir.join('/')}/${dirName}` : dirName
      if (seenDirs.has(path)) continue
      seenDirs.add(path)
      dirs.set(path, { name: dirName, path })
    } else {
      files.push({ kind: 'file', name: rest, path: entry.path, meta: entry })
    }
  }

  const dirItems: ArchiveLevelItem[] = [...dirs.values()]
    .sort((a, b) => compareNames(a.name, b.name))
    .map((item) => ({ kind: 'dir', ...item }))
  files.sort((a, b) => compareNames(a.name, b.name))
  return [...dirItems, ...files]
}

/**
 * 从完整条目表过滤出选中项：选中的文件保留自身，选中的目录保留其下所有条目。
 */
export function filterEntriesBySelection(
  entries: ReadonlyMap<string, Uint8Array>,
  selection: ReadonlySet<string>,
): Map<string, Uint8Array> {
  if (selection.size === 0) return new Map(entries)
  const prefixes: string[] = []
  for (const path of selection) {
    prefixes.push(`${path}/`)
  }
  const out = new Map<string, Uint8Array>()
  for (const [path, bytes] of entries) {
    if (selection.has(path)) {
      out.set(path, bytes)
      continue
    }
    for (const prefix of prefixes) {
      if (path.startsWith(prefix)) {
        out.set(path, bytes)
        break
      }
    }
  }
  return out
}

export function formatArchiveBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function formatArchiveDateTime(ms: number | undefined): string {
  if (ms === undefined) return '—'
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 压缩率百分比（压缩后 / 原始）；原始为 0 或未知时返回 undefined。 */
export function formatArchiveRatio(
  originalSize: number,
  compressedSize: number,
): string | undefined {
  if (originalSize <= 0) return undefined
  const ratio = (compressedSize / originalSize) * 100
  return `${Math.min(999, Math.round(ratio))}%`
}

/** 文件类型标签：目录 / 大扩展名 / 无扩展名。 */
export function fileTypeLabel(meta: ArchiveEntryMeta): string {
  if (meta.isDirectory) return '文件夹'
  const lastDot = meta.path.lastIndexOf('.')
  if (lastDot > 0 && lastDot < meta.path.length - 1) {
    return meta.path.slice(lastDot + 1).toUpperCase()
  }
  return '文件'
}
