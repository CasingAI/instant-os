/** 本机文件在浏览器中的地址（不走 AI 生成） */
export const FILE_DOCUMENT_URL_PREFIX = 'instant-file://'

export function isFileDocumentUrl(url: string): boolean {
  return url.trim().toLowerCase().startsWith(FILE_DOCUMENT_URL_PREFIX)
}

export function buildFileDocumentUrl(documentId: string, fileName: string): string {
  return `${FILE_DOCUMENT_URL_PREFIX}${encodeURIComponent(documentId)}/${encodeURIComponent(fileName)}`
}

export function parseFileDocumentUrl(
  url: string,
): { documentId: string; fileName: string } | undefined {
  if (!isFileDocumentUrl(url)) {
    return undefined
  }

  try {
    const rest = url.trim().slice(FILE_DOCUMENT_URL_PREFIX.length)
    const slash = rest.indexOf('/')
    if (slash < 0) {
      const documentId = decodeURIComponent(rest)
      if (!documentId) return undefined
      return { documentId, fileName: '文件' }
    }

    const documentId = decodeURIComponent(rest.slice(0, slash))
    const fileName = decodeURIComponent(rest.slice(slash + 1)) || '文件'
    if (!documentId) return undefined
    return { documentId, fileName }
  } catch {
    return undefined
  }
}

export function fileDocumentDisplayName(url: string): string | undefined {
  return parseFileDocumentUrl(url)?.fileName
}
