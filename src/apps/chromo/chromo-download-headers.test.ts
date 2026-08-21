/**
 * 运行：node --experimental-strip-types src/apps/chromo/chromo-download-headers.test.ts
 */
import assert from 'node:assert/strict'
import type { ChromoCookie } from '../../page-host/page-bridge.ts'
import {
  buildChromoDownloadProxyHeaders,
  buildCookieHeaderForUrl,
  CHROMO_DOWNLOAD_COOKIE_HEADER,
  CHROMO_DOWNLOAD_REFERER_HEADER,
  listForbiddenDownloadHeaderNames,
} from './chromo-download-headers.ts'

function cookie(name: string, domain: string, extra: Partial<ChromoCookie> = {}): ChromoCookie {
  return {
    id: name,
    name,
    value: `${name}-v`,
    domain,
    path: '/',
    expires: null,
    secure: false,
    httpOnly: false,
    sameSite: 'lax',
    hostOnly: true,
    ...extra,
  }
}

function testCookieHeader(): void {
  const header = buildCookieHeaderForUrl(
    [
      cookie('sid', 'example.com'),
      cookie('other', 'evil.test'),
      cookie('gone', 'example.com', { expires: 1 }),
    ],
    'https://example.com/file.pdf',
    1_700_000_000_000,
  )
  assert.equal(header, 'sid=sid-v')
  console.log('ok: cookie header matches url and drops expired')
}

function testForbiddenHeaders(): void {
  const headers = buildChromoDownloadProxyHeaders({
    cookieHeader: 'sid=1',
    referrer: 'https://example.com/page',
  })
  assert.equal(headers.get(CHROMO_DOWNLOAD_COOKIE_HEADER), 'sid=1')
  assert.equal(headers.get(CHROMO_DOWNLOAD_REFERER_HEADER), 'https://example.com/page')
  assert.deepEqual(listForbiddenDownloadHeaderNames(headers), [])
  assert.equal(headers.get('cookie'), null)
  assert.equal(headers.get('referer'), null)
  console.log('ok: proxy headers never set Cookie/Referer')
}

testCookieHeader()
testForbiddenHeaders()
console.log('chromo-download-headers tests passed')
