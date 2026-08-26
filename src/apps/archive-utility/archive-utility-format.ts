export type ArchiveUtilityFormat = 'zip' | 'gzip-tar' | 'tar' | 'gzip-file' | 'iso'

const ARCHIVE_OPEN_EXTENSIONS = ['zip', 'tar', 'gz', 'tgz', 'iso'] as const

export const ARCHIVE_UTILITY_OPEN_EXTENSIONS: readonly string[] = ARCHIVE_OPEN_EXTENSIONS

/** 根据文件名判定解压格式（优先匹配 .tar.gz）。 */
export function resolveArchiveUtilityFormat(fileName: string): ArchiveUtilityFormat | undefined {
  const base = fileName.trim().toLowerCase()
  if (!base || base.endsWith('/')) return undefined
  if (base.endsWith('.tar.gz') || base.endsWith('.tgz')) return 'gzip-tar'
  if (base.endsWith('.zip')) return 'zip'
  if (base.endsWith('.iso')) return 'iso'
  if (base.endsWith('.tar')) return 'tar'
  if (base.endsWith('.gz')) return 'gzip-file'
  return undefined
}

/** 去掉压缩后缀后的展示名（用于单文件 .gz 落盘名）。 */
export function stripArchiveExtension(fileName: string): string {
  const name = fileName.trim()
  const lower = name.toLowerCase()
  if (lower.endsWith('.tar.gz')) return name.slice(0, -7)
  if (lower.endsWith('.tgz')) return name.slice(0, -4)
  if (
    lower.endsWith('.zip') ||
    lower.endsWith('.tar') ||
    lower.endsWith('.gz') ||
    lower.endsWith('.iso')
  ) {
    return name.slice(0, -4)
  }
  const dot = name.lastIndexOf('.')
  if (dot > 0) return name.slice(0, dot)
  return name
}

export function parentAbsolutePath(absolutePath: string): string {
  const trimmed = absolutePath.replace(/\/+$/, '') || '/'
  const slash = trimmed.lastIndexOf('/')
  if (slash <= 0) return '/'
  return trimmed.slice(0, slash) || '/'
}
