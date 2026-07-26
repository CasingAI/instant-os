import { fileNameExtension } from '../os/file-open-registry.ts'

export type PreviewKind = 'markdown' | 'image' | 'model3d' | 'docx' | 'unsupported'

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'])
const MODEL3D_EXTENSIONS = new Set(['gltf', 'glb'])
const DOCX_EXTENSIONS = new Set(['docx'])

export const PREVIEW_MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdx'] as const
export const PREVIEW_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'] as const
export const PREVIEW_MODEL3D_EXTENSIONS = ['gltf', 'glb'] as const
export const PREVIEW_DOCX_EXTENSIONS = ['docx'] as const

export const PREVIEW_OPEN_EXTENSIONS = [
  ...PREVIEW_MARKDOWN_EXTENSIONS,
  ...PREVIEW_IMAGE_EXTENSIONS,
  ...PREVIEW_MODEL3D_EXTENSIONS,
  ...PREVIEW_DOCX_EXTENSIONS,
] as const

/** 按路径扩展名分流预览格式；后续加格式时在此扩展 */
export function resolvePreviewKind(pathOrName: string): PreviewKind {
  const extension = fileNameExtension(pathOrName)
  if (extension && MARKDOWN_EXTENSIONS.has(extension)) {
    return 'markdown'
  }
  if (extension && IMAGE_EXTENSIONS.has(extension)) {
    return 'image'
  }
  if (extension && MODEL3D_EXTENSIONS.has(extension)) {
    return 'model3d'
  }
  if (extension && DOCX_EXTENSIONS.has(extension)) {
    return 'docx'
  }
  return 'unsupported'
}

export function guessDocxMime(): string {
  return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
}

export function fileNameFromPath(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  if (slash < 0) return trimmed || path
  return trimmed.slice(slash + 1) || trimmed
}

export function guessImageMime(pathOrName: string): string {
  const extension = fileNameExtension(pathOrName)
  switch (extension) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'ico':
      return 'image/x-icon'
    default:
      return 'application/octet-stream'
  }
}

export function guessModel3dMime(pathOrName: string): string {
  const extension = fileNameExtension(pathOrName)
  if (extension === 'glb') return 'model/gltf-binary'
  return 'model/gltf+json'
}
