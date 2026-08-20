import type { FilesNode } from '../files/files-types.ts'
import { resolveFilesAbsolutePath } from '../files/files-vfs.ts'

/** 本机文件在浏览器中的地址（file 协议，不走 AI 生成） */
export function isFileDocumentUrl(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) return false
  try {
    return new URL(trimmed).protocol === 'file:'
  } catch {
    return /^file:/i.test(trimmed)
  }
}

/** POSIX 绝对路径 → `file:///user/...` */
export function absolutePathToFileUrl(absolutePath: string): string {
  const path = absolutePath.startsWith('/') ? absolutePath : `/${absolutePath}`
  const encodedPath = path
    .split('/')
    .map((segment, index) => (index === 0 ? '' : encodeURIComponent(segment)))
    .join('/')
  return `file://${encodedPath}`
}

export function fileUrlToAbsolutePath(url: string): string | undefined {
  if (!isFileDocumentUrl(url)) return undefined
  try {
    const pathname = new URL(url.trim()).pathname
    if (!pathname || pathname === '/') return undefined
    return pathname
      .split('/')
      .map((segment, index) => {
        if (index === 0) return ''
        try {
          return decodeURIComponent(segment)
        } catch {
          return segment
        }
      })
      .join('/')
  } catch {
    return undefined
  }
}

export async function buildFileDocumentUrl(node: FilesNode): Promise<string> {
  const absolutePath = await resolveFilesAbsolutePath(node)
  return absolutePathToFileUrl(absolutePath)
}

export function fileDocumentDisplayName(url: string): string | undefined {
  const absolutePath = fileUrlToAbsolutePath(url)
  if (!absolutePath) return undefined
  const parts = absolutePath.split('/').filter(Boolean)
  return parts.at(-1)
}

/** 地址栏展示：解码后的 file:///... 路径（接近真实浏览器） */
export function fileDocumentAddressBarText(url: string): string {
  const absolutePath = fileUrlToAbsolutePath(url)
  if (!absolutePath) return url.trim()
  return `file://${absolutePath}`
}

/**
 * 将 file URL 解析为全局绝对路径（跨 App 文件句柄）。
 * 保留旧名以兼容调用方；语义已是路径而非节点 id。
 */
export async function resolveDocumentIdFromFileUrl(url: string): Promise<string | undefined> {
  return fileUrlToAbsolutePath(url)
}

function escapeHtmlText(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function looksLikeMarkupDocument(text: string): boolean {
  const trimmed = text.trimStart().slice(0, 256).toLowerCase()
  return (
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<?xml') ||
    trimmed.startsWith('<svg')
  )
}

/**
 * 把本机文件内容转成 Safari iframe 可展示的 HTML。
 * 网页 / SVG 原样；纯文本（如 LICENSE）包一层预格式化页。
 */
export function htmlForFileDocument(node: Pick<FilesNode, 'name' | 'mimeType'>, text: string): string {
  const mime = node.mimeType ?? ''
  if (mime === 'text/html' || mime === 'image/svg+xml' || looksLikeMarkupDocument(text)) {
    return text
  }

  const title = escapeHtmlText(node.name)
  const body = escapeHtmlText(text)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>
html,body{margin:0;padding:0;background:#fff;color:#111}
body{padding:24px;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
</style></head><body>${body}</body></html>`
}

/** 「关于本机」打开的许可证文件（源码快照内的根目录 LICENSE） */
export const SYSTEM_LICENSE_PATH = '/system/LICENSE'
