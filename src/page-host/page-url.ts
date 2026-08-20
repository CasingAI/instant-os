import { PAGE_DEFAULT_NEW_TAB_URL } from './page-host-config.ts'

/** Normalize user / page URL for virtual-chromo navigation (keeps www). */
export function normalizePageUrl(input: string, fallback = PAGE_DEFAULT_NEW_TAB_URL): string {
  const trimmed = input.trim()
  if (!trimmed) {
    return fallback
  }

  let candidate = trimmed
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    const looksLikeDomain =
      candidate.includes('.') ||
      candidate.startsWith('localhost') ||
      /^\d{1,3}(\.\d{1,3}){3}(:\d+)?/.test(candidate)
    candidate = looksLikeDomain
      ? `https://${candidate}`
      : `https://www.google.com/search?q=${encodeURIComponent(candidate)}`
  }

  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return fallback
    }
    if (parsed.hostname === 'ithome.com') {
      parsed.hostname = 'www.ithome.com'
    }
    return parsed.href
  } catch {
    return fallback
  }
}

export function pageUrlsMatch(expected: string, actual: string): boolean {
  try {
    const a = new URL(expected)
    const b = new URL(actual)
    const stripPath = (path: string) => (path === '/' ? '' : path.replace(/\/$/, ''))
    return (
      a.origin === b.origin &&
      stripPath(a.pathname) === stripPath(b.pathname) &&
      a.search === b.search
    )
  } catch {
    return expected === actual
  }
}

export function isSameDocumentHashLink(href: string, currentUrl: string): boolean {
  if (!href || !currentUrl) {
    return false
  }
  try {
    const target = new URL(href)
    const current = new URL(currentUrl)
    return (
      target.origin === current.origin &&
      target.pathname === current.pathname &&
      target.search === current.search &&
      Boolean(target.hash)
    )
  } catch {
    return false
  }
}

export function pageTitleFromUrl(url: string): string {
  try {
    return new URL(url).hostname || url
  } catch {
    return url || '新标签页'
  }
}

export function displayPageUrl(url: string): string {
  if (!url) return ''
  try {
    const u = new URL(url)
    return u.href.replace(/^https:\/\//, '').replace(/\/$/, '') || u.hostname
  } catch {
    return url
  }
}
