import assert from 'node:assert/strict'
import { normalizeInstantShellUrl } from './instant-shell-url.ts'

function testNormalizeAcceptsHttpHttps(): void {
  assert.equal(normalizeInstantShellUrl('https://example.com/a'), 'https://example.com/a')
  assert.equal(normalizeInstantShellUrl('http://localhost:8080/'), 'http://localhost:8080/')
  assert.equal(normalizeInstantShellUrl('example.com'), 'https://example.com/')
  console.log('ok: normalizeInstantShellUrl accepts http/https and bare hosts')
}

function testNormalizeRejectsBlocked(): void {
  assert.throws(() => normalizeInstantShellUrl(''), /不能为空/)
  assert.throws(() => normalizeInstantShellUrl('javascript:alert(1)'), /不允许|仅支持/)
  assert.throws(() => normalizeInstantShellUrl('data:text/html,hi'), /不允许|仅支持/)
  assert.throws(() => normalizeInstantShellUrl('file:///tmp/x'), /不允许|仅支持/)
  assert.throws(() => normalizeInstantShellUrl('ftp://example.com'), /仅支持/)
  console.log('ok: normalizeInstantShellUrl rejects blocked schemes')
}

function main(): void {
  testNormalizeAcceptsHttpHttps()
  testNormalizeRejectsBlocked()
}

main()
