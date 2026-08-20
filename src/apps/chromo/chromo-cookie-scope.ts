import type { ChromoCookie } from './chromo-bridge.ts'

/** Align with virtual-chromo cookie.js isSubDomain. */
function isSubDomain(cookieDomain: string, urlDomain: string): boolean {
  return urlDomain === cookieDomain || urlDomain.endsWith('.' + cookieDomain)
}

/** Align with virtual-chromo cookie.js isSubPath. */
function isSubPath(cookiePath: string, urlPath: string): boolean {
  let path = cookiePath || '/'
  if (urlPath === path) {
    return true
  }
  if (!path.endsWith('/')) {
    path += '/'
  }
  return urlPath.startsWith(path)
}

function normalizeCookieDomain(domain: string): string {
  return domain.replace(/^\./, '').toLowerCase()
}

/**
 * Whether this cookie would be sent with a request to pageUrl (first-party jar entry).
 * Mirrors virtual-chromo CookieJar.query domain/path/secure/hostOnly rules.
 */
export function isFirstPartyCookieForUrl(cookie: ChromoCookie, pageUrl: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(pageUrl)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false
  }

  const hostname = parsed.hostname.toLowerCase()
  const path = parsed.pathname || '/'
  const isHttps = parsed.protocol === 'https:'
  const cookieDomain = normalizeCookieDomain(cookie.domain || '')
  if (!cookieDomain) {
    return false
  }

  if (cookie.secure && !isHttps) {
    return false
  }

  if (cookie.hostOnly) {
    if (hostname !== cookieDomain) {
      return false
    }
  } else if (!isSubDomain(cookieDomain, hostname)) {
    return false
  }

  return isSubPath(cookie.path || '/', path)
}

export function filterFirstPartyCookies(
  cookies: ChromoCookie[],
  pageUrl: string | undefined,
): ChromoCookie[] {
  if (!pageUrl) {
    return []
  }
  return cookies.filter((cookie) => isFirstPartyCookieForUrl(cookie, pageUrl))
}

export function hostnameFromPageUrl(pageUrl: string | undefined): string {
  if (!pageUrl) {
    return ''
  }
  try {
    return new URL(pageUrl).hostname
  } catch {
    return ''
  }
}
