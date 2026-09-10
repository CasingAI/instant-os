const DISK_IMAGE_EXTENSIONS = ['.img', '.raw', '.ima', '.dsk'] as const

/** 镜像后缀集合（导出供打开方式登记等复用） */
export { DISK_IMAGE_EXTENSIONS }

export function isDiskImageFileName(name: string): boolean {
  const lower = name.trim().toLowerCase()
  return DISK_IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

export function diskImageLabelFromFileName(name: string): string {
  const trimmed = name.trim()
  const lower = trimmed.toLowerCase()
  for (const extension of DISK_IMAGE_EXTENSIONS) {
    if (lower.endsWith(extension)) {
      const base = trimmed.slice(0, trimmed.length - extension.length).trim()
      return base || trimmed
    }
  }
  return trimmed || '磁盘镜像'
}
