import { fileNameExtension } from '../os/file-open-registry.ts'

export type PreviewKind = 'markdown' | 'text' | 'image' | 'model3d' | 'docx' | 'unsupported'

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp'])
const MODEL3D_EXTENSIONS = new Set(['gltf', 'glb'])
const DOCX_EXTENSIONS = new Set(['docx'])

export const PREVIEW_MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdx'] as const
export const PREVIEW_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp'] as const
export const PREVIEW_MODEL3D_EXTENSIONS = ['gltf', 'glb'] as const
export const PREVIEW_DOCX_EXTENSIONS = ['docx'] as const

/**
 * 可预览的纯文本 / 源码后缀（Monaco 只读）。
 * 与 VSCODE_OPEN_EXTENSIONS（去掉 md/markdown/mdx）及 VSCODE_OPTIONAL_OPEN_EXTENSIONS 保持同步。
 */
export const PREVIEW_TEXT_EXTENSIONS = [
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'mts',
  'cts',
  'tsx',
  'json',
  'jsonc',
  'jsonl',
  'ndjson',
  'css',
  'scss',
  'less',
  'py',
  'pyw',
  'go',
  'rs',
  'java',
  'c',
  'h',
  'cpp',
  'cc',
  'cxx',
  'hpp',
  'hh',
  'cs',
  'php',
  'rb',
  'swift',
  'kt',
  'kts',
  'dart',
  'lua',
  'r',
  'sql',
  'sh',
  'bash',
  'zsh',
  'ps1',
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'conf',
  'cfg',
  'env',
  'properties',
  'vue',
  'svelte',
  'graphql',
  'gql',
  'proto',
  'txt',
  'html',
  'htm',
  'xhtml',
] as const

const TEXT_EXTENSIONS = new Set<string>(PREVIEW_TEXT_EXTENSIONS)

export const PREVIEW_OPEN_EXTENSIONS = [
  ...PREVIEW_MARKDOWN_EXTENSIONS,
  ...PREVIEW_TEXT_EXTENSIONS,
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
  if (extension && TEXT_EXTENSIONS.has(extension)) {
    return 'text'
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
    case 'bmp':
      return 'image/bmp'
    default:
      return 'application/octet-stream'
  }
}

export function guessModel3dMime(pathOrName: string): string {
  const extension = fileNameExtension(pathOrName)
  if (extension === 'glb') return 'model/gltf-binary'
  return 'model/gltf+json'
}
