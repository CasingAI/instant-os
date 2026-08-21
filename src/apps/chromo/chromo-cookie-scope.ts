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

/**
 * CookieJar `expires`：秒级 Unix 时间（约 1e9）或毫秒（约 1e12）。
 * `null` / `<= 0` 视为会话 cookie，未过期。
 */
export function cookieExpiresAtMs(expires: number | null | undefined): number | undefined {
  if (expires == null || !Number.isFinite(expires) || expires <= 0) {
    return undefined
  }
  return expires < 1e12 ? expires * 1000 : expires
}

export function isCookieExpired(cookie: ChromoCookie, nowMs = Date.now()): boolean {
  const expiresAt = cookieExpiresAtMs(cookie.expires)
  return expiresAt !== undefined && expiresAt <= nowMs
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

/** 发给目标 URL 的罐：first-party 匹配且未过期。本期不过滤 SameSite。 */
export function filterCookiesForRequest(
  cookies: ChromoCookie[],
  requestUrl: string | undefined,
  nowMs = Date.now(),
): ChromoCookie[] {
  return filterFirstPartyCookies(cookies, requestUrl).filter((cookie) => !isCookieExpired(cookie, nowMs))
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
