import { fileNameExtension } from '../../os/file-open-registry.ts'

export type PreviewKind = 'markdown' | 'unsupported'

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx'])

export const PREVIEW_MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdx'] as const

/** 按路径扩展名分流预览格式；后续加格式时在此扩展 */
export function resolvePreviewKind(pathOrName: string): PreviewKind {
  const extension = fileNameExtension(pathOrName)
  if (extension && MARKDOWN_EXTENSIONS.has(extension)) {
    return 'markdown'
  }
  return 'unsupported'
}

export function fileNameFromPath(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  if (slash < 0) return trimmed || path
  return trimmed.slice(slash + 1) || trimmed
}
