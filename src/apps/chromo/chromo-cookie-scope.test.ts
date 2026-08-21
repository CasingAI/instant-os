/**
 * 运行：node --experimental-strip-types src/apps/chromo/chromo-cookie-scope.test.ts
 */
import assert from 'node:assert/strict'
import type { ChromoCookie } from '../../page-host/page-bridge.ts'
import {
  filterCookiesForRequest,
  filterFirstPartyCookies,
  isCookieExpired,
  isFirstPartyCookieForUrl,
} from './chromo-cookie-scope.ts'

function cookie(partial: Partial<ChromoCookie> & Pick<ChromoCookie, 'name' | 'domain'>): ChromoCookie {
  return {
    id: partial.id ?? partial.name,
    value: '1',
    path: '/',
    expires: null,
    secure: false,
    httpOnly: false,
    sameSite: 'lax',
    hostOnly: true,
    ...partial,
  }
}

function testDomainPathSecure(): void {
  const sid = cookie({ name: 'sid', domain: 'example.com', hostOnly: true })
  assert.equal(isFirstPartyCookieForUrl(sid, 'https://example.com/account'), true)
  assert.equal(isFirstPartyCookieForUrl(sid, 'https://other.example.com/'), false)
  const wild = cookie({ name: 'sid', domain: 'example.com', hostOnly: false })
  assert.equal(isFirstPartyCookieForUrl(wild, 'https://www.example.com/'), true)
  const secure = cookie({ name: 'sid', domain: 'example.com', secure: true })
  assert.equal(isFirstPartyCookieForUrl(secure, 'http://example.com/'), false)
  console.log('ok: domain/path/secure/hostOnly')
}

function testExpires(): void {
  const now = 1_700_000_000_000
  const session = cookie({ name: 's', domain: 'example.com', expires: null })
  assert.equal(isCookieExpired(session, now), false)
  const expiredSec = cookie({ name: 's', domain: 'example.com', expires: now / 1000 - 10 })
  assert.equal(isCookieExpired(expiredSec, now), true)
  const liveSec = cookie({ name: 's', domain: 'example.com', expires: now / 1000 + 10 })
  assert.equal(isCookieExpired(liveSec, now), false)
  const expiredMs = cookie({ name: 's', domain: 'example.com', expires: now - 1 })
  assert.equal(isCookieExpired(expiredMs, now), true)
  const shown = filterFirstPartyCookies(
    [expiredSec, liveSec],
    'https://example.com/',
  )
  assert.equal(shown.length, 2)
  const sent = filterCookiesForRequest([expiredSec, liveSec], 'https://example.com/', now)
  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.name, 's')
  assert.equal(sent[0]?.expires, now / 1000 + 10)
  console.log('ok: expire filter does not change application listing')
}

testDomainPathSecure()
testExpires()
console.log('chromo-cookie-scope tests passed')
