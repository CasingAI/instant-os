/**
 * 运行：node --experimental-strip-types src/apps/chromo/chromo-internal.test.ts
 */
import assert from 'node:assert/strict'
import {
  chromoInternalPageTitle,
  chromoInternalUrl,
  isChromoInternalUrl,
  normalizeChromoInternalUrl,
  parseChromoInternalPage,
  shouldIgnoreChromoViewerNavigation,
  canUseChromoPageChrome,
} from './chromo-internal.ts'

function testNormalizeKeepsAllowedPages(): void {
  assert.equal(normalizeChromoInternalUrl('browser://history'), 'browser://history')
  assert.equal(normalizeChromoInternalUrl('browser://history/'), 'browser://history')
  assert.equal(normalizeChromoInternalUrl('BROWSER://BOOKMARKS'), 'browser://bookmarks')
  assert.equal(normalizeChromoInternalUrl('chromo://settings'), 'browser://settings')
  assert.equal(normalizeChromoInternalUrl('chrome://history'), 'browser://history')
  assert.equal(normalizeChromoInternalUrl('browser://downloads'), 'browser://downloads')
  assert.equal(parseChromoInternalPage('browser://downloads'), 'downloads')
  assert.equal(chromoInternalPageTitle('downloads'), '下载内容')
  assert.equal(parseChromoInternalPage('browser://settings'), 'settings')
  assert.equal(chromoInternalUrl('history'), 'browser://history')
  assert.equal(chromoInternalPageTitle('bookmarks'), '书签')
  console.log('ok: allowed internal pages')
}

function testRejectUnknownInternalUrls(): void {
  assert.equal(normalizeChromoInternalUrl('browser://flags'), undefined)
  assert.equal(normalizeChromoInternalUrl('browser://'), undefined)
  assert.equal(normalizeChromoInternalUrl('chrome://flags'), undefined)
  assert.equal(normalizeChromoInternalUrl(''), undefined)
  assert.equal(isChromoInternalUrl('https://www.google.com/'), false)
  assert.equal(isChromoInternalUrl('browser://history'), true)
  console.log('ok: reject unknown internal urls')
}

function testIgnoreViewerNavForInternalPages(): void {
  assert.equal(shouldIgnoreChromoViewerNavigation('browser://downloads'), true)
  assert.equal(shouldIgnoreChromoViewerNavigation('browser://settings'), true)
  assert.equal(shouldIgnoreChromoViewerNavigation('', 'browser://history'), true)
  assert.equal(shouldIgnoreChromoViewerNavigation('https://example.com/', 'browser://settings'), true)
  assert.equal(shouldIgnoreChromoViewerNavigation(''), false)
  assert.equal(shouldIgnoreChromoViewerNavigation('https://example.com/'), false)
  console.log('ok: ignore viewer nav for internal pages')
}

function testPageChromeUnavailableOnInternalAndNewTab(): void {
  assert.equal(canUseChromoPageChrome('browser://settings', true), false)
  assert.equal(canUseChromoPageChrome('browser://history'), false)
  assert.equal(canUseChromoPageChrome('browser://downloads'), false)
  assert.equal(canUseChromoPageChrome('', true), false)
  assert.equal(canUseChromoPageChrome('https://example.com/', false), false)
  assert.equal(canUseChromoPageChrome('https://example.com/', true), true)
  console.log('ok: page chrome disabled on internal pages and new tab')
}

testNormalizeKeepsAllowedPages()
testRejectUnknownInternalUrls()
testIgnoreViewerNavForInternalPages()
testPageChromeUnavailableOnInternalAndNewTab()
console.log('chromo-internal tests passed')
