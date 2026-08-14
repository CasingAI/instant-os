/**
 * file-info 窗口的 documentId 契约。
 * 供文件 APP、未来第三方应用等以 `openApp('file-info', { documentId })` 打开属性面板。
 *
 * - 单节点：纯全局绝对路径（如 `/user/笔记.txt`），与文档类应用既有语义一致
 * - 卷根：`volume:{locationId}`（如 `volume:local`），卷根没有真实节点，需虚拟构造
 * - 批量：`multi:{JSON 数组}`，JSON 编码避免路径含特殊字符歧义
 */

export type InfoDocumentKind = 'node' | 'volume' | 'multi'

export type InfoDocument =
  | { kind: 'node'; path: string }
  | { kind: 'volume'; locationId: string }
  | { kind: 'multi'; paths: string[] }

const VOLUME_PREFIX = 'volume:'
const MULTI_PREFIX = 'multi:'

export function encodeInfoDocumentId(paths: readonly string[]): string {
  if (paths.length === 1) return paths[0]
  if (paths.length > 1) return `${MULTI_PREFIX}${JSON.stringify(paths)}`
  throw new Error('file-info 至少需要一个路径')
}

export function encodeVolumeInfoDocumentId(locationId: string): string {
  return `${VOLUME_PREFIX}${locationId}`
}

export function decodeInfoDocumentId(documentId: string): InfoDocument {
  if (documentId.startsWith(MULTI_PREFIX)) {
    try {
      const raw = JSON.parse(documentId.slice(MULTI_PREFIX.length))
      if (Array.isArray(raw) && raw.length > 0 && raw.every((item) => typeof item === 'string')) {
        return { kind: 'multi', paths: raw }
      }
    } catch {
      // 非法 JSON 落到空批量，由调用方渲染空态
    }
    return { kind: 'multi', paths: [] }
  }
  if (documentId.startsWith(VOLUME_PREFIX)) {
    return { kind: 'volume', locationId: documentId.slice(VOLUME_PREFIX.length) }
  }
  return { kind: 'node', path: documentId }
}
