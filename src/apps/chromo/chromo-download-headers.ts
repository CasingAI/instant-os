import type { ChromoCookie } from '../../page-host/page-bridge.ts'
import { filterCookiesForRequest } from './chromo-cookie-scope.ts'

/** Instant OS → Worker CORS relay。浏览器禁止直接设 Cookie / Referer。 */
export const CHROMO_DOWNLOAD_COOKIE_HEADER = 'X-VC-Cookie'
export const CHROMO_DOWNLOAD_REFERER_HEADER = 'X-VC-Referer'

const FORBIDDEN_FETCH_HEADERS = ['cookie', 'referer'] as const

export function cookieHeaderFromCookies(cookies: ChromoCookie[]): string {
  return cookies
    .filter((cookie) => cookie.name)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ')
}

export function buildCookieHeaderForUrl(
  cookies: ChromoCookie[],
  url: string,
  nowMs = Date.now(),
): string {
  return cookieHeaderFromCookies(filterCookiesForRequest(cookies, url, nowMs))
}

export function buildChromoDownloadProxyHeaders(options: {
  cookieHeader?: string
  referrer?: string
}): Headers {
  const headers = new Headers()
  const cookieHeader = options.cookieHeader?.trim()
  if (cookieHeader) {
    headers.set(CHROMO_DOWNLOAD_COOKIE_HEADER, cookieHeader)
  }
  const referrer = options.referrer?.trim()
  if (referrer) {
    headers.set(CHROMO_DOWNLOAD_REFERER_HEADER, referrer)
  }
  return headers
}

export function listForbiddenDownloadHeaderNames(headers: Headers): string[] {
  const found: string[] = []
  for (const name of FORBIDDEN_FETCH_HEADERS) {
    if (headers.has(name)) {
      found.push(name)
    }
  }
  return found
}
