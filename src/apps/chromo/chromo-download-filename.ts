import { fileNameExtension } from '../../os/file-open-registry.ts'
import { sanitizeSaveFileName } from '../../window/system-save-path.ts'
import { suggestedSaveNameFromUrl } from './chromo-save-page.ts'

export const CHROMO_DOWNLOAD_UNTITLED_NAME = '未命名'

const MIME_EXTENSION: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/gzip': 'gz',
  'application/json': 'json',
  'application/xml': 'xml',
  'application/octet-stream': '',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/html': 'html',
  'text/css': 'css',
  'text/javascript': 'js',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}

export function mimeFromContentType(value: string | undefined | null): string | undefined {
  if (!value) {
    return undefined
  }
  const mime = value.split(';')[0]?.trim().toLowerCase()
  return mime || undefined
}

function extensionForMime(mime: string | undefined): string | undefined {
  if (!mime) {
    return undefined
  }
  const mapped = MIME_EXTENSION[mime]
  if (mapped) {
    return mapped
  }
  if (mapped === '') {
    return undefined
  }
  const subtype = mime.split('/')[1]
  if (!subtype || subtype.includes('+') || subtype === '*') {
    return undefined
  }
  return subtype.replace(/[^a-z0-9]+/gi, '') || undefined
}

function decodeRfc5987(value: string): string {
  const trimmed = value.trim().replace(/^"(.*)"$/s, '$1')
  try {
    return decodeURIComponent(trimmed)
  } catch {
    return trimmed
  }
}

/**
 * RFC 6266：优先 `filename*`，再 `filename`。
 */
export function parseContentDispositionFilename(header: string | undefined | null): string | undefined {
  if (!header) {
    return undefined
  }
  const starred = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/i.exec(header)
  if (starred?.[1]) {
    const decoded = decodeRfc5987(starred[1])
    if (decoded.trim()) {
      return decoded.trim()
    }
  }
  const quoted = /filename\s*=\s*"((?:\\.|[^"\\])*)"/i.exec(header)
  if (quoted?.[1]) {
    const name = quoted[1].replace(/\\"/g, '"').trim()
    if (name) {
      return name
    }
  }
  const unquoted = /filename\s*=\s*([^;]+)/i.exec(header)
  if (unquoted?.[1]) {
    const name = unquoted[1].trim().replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1')
    if (name) {
      return name
    }
  }
  return undefined
}

export function resolveDownloadFileName(params: {
  hinted?: string
  disposition?: string | null
  url: string
  mime?: string | null
}): string {
  const fromHint = params.hinted?.trim()
  const fromDisposition = parseContentDispositionFilename(params.disposition ?? undefined)
  const raw =
    fromHint ||
    fromDisposition ||
    suggestedSaveNameFromUrl(params.url, CHROMO_DOWNLOAD_UNTITLED_NAME)
  const mime = mimeFromContentType(params.mime)
  const fallbackExt = fileNameExtension(raw) ? undefined : extensionForMime(mime)
  return sanitizeSaveFileName(raw, fallbackExt)
}
