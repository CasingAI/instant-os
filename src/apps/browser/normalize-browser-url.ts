import {
  fileDocumentAddressBarText,
  fileDocumentDisplayName,
  isFileDocumentUrl,
} from './browser-file-document.ts'

export const START_PAGE_URL = 'instant://home'

export function isStartPageUrl(url: string): boolean {
  return url.trim().toLowerCase() === START_PAGE_URL
}

function canonicalizeHttpHostname(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return url
    }

    if (parsed.hostname.startsWith('www.')) {
      parsed.hostname = parsed.hostname.slice(4)
    }

    return parsed.href
  } catch {
    return url
  }
}

export function normalizeBrowserUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    return START_PAGE_URL
  }

  if (/^instant:\/\//i.test(trimmed)) {
    return trimmed.toLowerCase()
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return canonicalizeHttpHostname(trimmed)
  }

  const looksLikeDomain =
    trimmed.includes('.') ||
    trimmed.startsWith('localhost') ||
    /^\d{1,3}(\.\d{1,3}){3}(:\d+)?/.test(trimmed)

  if (looksLikeDomain) {
    return canonicalizeHttpHostname(`https://${trimmed}`)
  }

  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

export function displayUrl(url: string): string {
  if (isStartPageUrl(url)) {
    return ''
  }

  if (isFileDocumentUrl(url)) {
    return fileDocumentAddressBarText(url)
  }

  try {
    const parsed = new URL(url)
    const host = parsed.host
    const path = parsed.pathname === '/' ? '' : parsed.pathname
    const query = parsed.search
    return `${host}${path}${query}`
  } catch {
    return url
  }
}

/**
 * 地址栏可编辑文本：完整网址（含协议），或去掉协议的 host+path+query。
 * 未聚焦时的域名缩略由调用方单独用 hostnameFromUrl 处理。
 */
export function addressBarDisplayUrl(url: string, showFullUrl: boolean): string {
  if (isStartPageUrl(url)) {
    return ''
  }
  if (isFileDocumentUrl(url)) {
    return fileDocumentAddressBarText(url)
  }
  return showFullUrl ? normalizeBrowserUrl(url) : displayUrl(url)
}

export function pageTitleFromUrl(url: string): string {
  if (isStartPageUrl(url)) {
    return '起始页'
  }

  const fileName = fileDocumentDisplayName(url)
  if (fileName) {
    return fileName
  }

  try {
    const parsed = new URL(url)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function hostnameFromUrl(url: string): string {
  const fileName = fileDocumentDisplayName(url)
  if (fileName) {
    return fileName
  }

  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function siteRootUrl(url: string): string {
  if (isStartPageUrl(url)) {
    return START_PAGE_URL
  }

  try {
    const parsed = new URL(normalizeBrowserUrl(url))
    return `${parsed.protocol}//${parsed.host}/`
  } catch {
    return normalizeBrowserUrl(url)
  }
}

export function isSameSite(urlA: string, urlB: string): boolean {
  if (isStartPageUrl(urlA) || isStartPageUrl(urlB)) {
    return false
  }

  return hostnameFromUrl(urlA) === hostnameFromUrl(urlB)
}

export function isSiteRootUrl(url: string): boolean {
  if (isStartPageUrl(url)) {
    return false
  }

  try {
    const parsed = new URL(normalizeBrowserUrl(url))
    const path = parsed.pathname
    return (path === '/' || path === '') && !parsed.search && !parsed.hash
  } catch {
    return false
  }
}

export type BrowserUrlContext = {
  url: string
  protocol: string
  hostname: string
  pathname: string
  search: string
  hash: string
  isSearchResults: boolean
  searchQuery: string | undefined
}

export function describeBrowserUrl(url: string): BrowserUrlContext | undefined {
  try {
    const parsed = new URL(url)
    const isGoogleSearch =
      (parsed.hostname.includes('google.') && parsed.pathname === '/search') ||
      parsed.searchParams.has('q')
    const searchQuery = parsed.searchParams.get('q') ?? undefined

    return {
      url,
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      pathname: parsed.pathname,
      search: parsed.search,
      hash: parsed.hash,
      isSearchResults: isGoogleSearch && Boolean(searchQuery),
      searchQuery: searchQuery ?? undefined,
    }
  } catch {
    return undefined
  }
}
