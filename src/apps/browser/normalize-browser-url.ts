import {
  fileDocumentAddressBarText,
  fileDocumentDisplayName,
  isFileDocumentUrl,
} from './browser-file-document.ts'

export const START_PAGE_URL = 'instant://home'

export const VIEW_SOURCE_PREFIX = 'view-source:'

export function isStartPageUrl(url: string): boolean {
  return url.trim().toLowerCase() === START_PAGE_URL
}

export function isViewSourceUrl(url: string): boolean {
  return url.trim().toLowerCase().startsWith(VIEW_SOURCE_PREFIX)
}

/** 去掉一层或多层 `view-source:` 前缀，得到被查看的真实地址 */
export function unwrapViewSourceUrl(url: string): string | undefined {
  let inner = url.trim()
  if (!inner.toLowerCase().startsWith(VIEW_SOURCE_PREFIX)) {
    return undefined
  }
  while (inner.toLowerCase().startsWith(VIEW_SOURCE_PREFIX)) {
    inner = inner.slice(VIEW_SOURCE_PREFIX.length).trim()
  }
  return inner || undefined
}

/** 为真实页面地址生成 `view-source:` URL（已是源码页则原样规范化） */
export function toViewSourceUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed || isStartPageUrl(trimmed)) {
    return trimmed
  }
  if (isViewSourceUrl(trimmed)) {
    return normalizeBrowserUrl(trimmed)
  }
  return `${VIEW_SOURCE_PREFIX}${normalizeBrowserUrl(trimmed)}`
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

  if (/^view-source:/i.test(trimmed)) {
    const inner = unwrapViewSourceUrl(trimmed)
    if (!inner) {
      return START_PAGE_URL
    }
    const normalizedInner = normalizeBrowserUrl(inner)
    if (isStartPageUrl(normalizedInner)) {
      return START_PAGE_URL
    }
    return `${VIEW_SOURCE_PREFIX}${normalizedInner}`
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

  if (isViewSourceUrl(url)) {
    const inner = unwrapViewSourceUrl(url)
    if (!inner) {
      return url
    }
    return `${VIEW_SOURCE_PREFIX}${displayUrl(inner) || normalizeBrowserUrl(inner)}`
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
  if (isViewSourceUrl(url)) {
    return normalizeBrowserUrl(url)
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

  if (isViewSourceUrl(url)) {
    const inner = unwrapViewSourceUrl(url)
    if (!inner) {
      return '[源代码]'
    }
    return `[源代码]${pageTitleFromUrl(inner)}`
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
  if (isViewSourceUrl(url)) {
    const inner = unwrapViewSourceUrl(url)
    return inner ? hostnameFromUrl(inner) : url
  }

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

  if (isViewSourceUrl(url)) {
    const inner = unwrapViewSourceUrl(url)
    return inner ? siteRootUrl(inner) : START_PAGE_URL
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

  if (isViewSourceUrl(urlA) || isViewSourceUrl(urlB)) {
    return false
  }

  return hostnameFromUrl(urlA) === hostnameFromUrl(urlB)
}

export function isSiteRootUrl(url: string): boolean {
  if (isStartPageUrl(url)) {
    return false
  }

  if (isViewSourceUrl(url)) {
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
