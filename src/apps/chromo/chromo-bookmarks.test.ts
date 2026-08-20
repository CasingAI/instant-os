/**
 * 运行：node --experimental-strip-types src/apps/chromo/chromo-bookmarks.test.ts
 */
import assert from 'node:assert/strict'
import { DEVICE_STORAGE_KEYS } from '../../os/device-storage.ts'
import {
  addChromoBookmark,
  isChromoBookmarked,
  loadChromoBookmarks,
  loadChromoBookmarksBarVisible,
  normalizeChromoBookmarkUrl,
  removeChromoBookmark,
  setChromoBookmarksBarVisible,
  toggleChromoBookmark,
} from './chromo-bookmarks.ts'

class MemoryStorage implements Storage {
  private map = new Map<string, string>()

  get length(): number {
    return this.map.size
  }

  clear(): void {
    this.map.clear()
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.map.delete(key)
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value))
  }
}

;(globalThis as { localStorage?: Storage }).localStorage ??= new MemoryStorage()
;(globalThis as { window?: EventTarget }).window ??= new EventTarget()

function resetStorage(): void {
  localStorage.removeItem(DEVICE_STORAGE_KEYS.chromoBookmarks)
  localStorage.removeItem(DEVICE_STORAGE_KEYS.chromoSettings)
}

function testNormalize(): void {
  assert.equal(normalizeChromoBookmarkUrl(''), undefined)
  assert.equal(normalizeChromoBookmarkUrl('   '), undefined)
  assert.equal(normalizeChromoBookmarkUrl('ftp://example.com'), undefined)
  assert.equal(normalizeChromoBookmarkUrl('https://www.google.com'), 'https://www.google.com/')
  assert.equal(normalizeChromoBookmarkUrl('https://ithome.com/path'), 'https://www.ithome.com/path')
  console.log('ok: normalize')
}

function testDefaultsAndBlank(): void {
  resetStorage()
  const defaults = loadChromoBookmarks()
  assert.ok(defaults.length > 0, 'empty storage yields defaults')
  assert.equal(addChromoBookmark({ url: '', title: '空白' }), false)
  assert.equal(isChromoBookmarked(''), false)
  assert.equal(loadChromoBookmarks().length, defaults.length)
  console.log('ok: defaults and blank')
}

function testAddToggleRemove(): void {
  resetStorage()
  const url = 'https://www.example.com/docs'
  assert.equal(isChromoBookmarked(url), false)
  assert.equal(addChromoBookmark({ url, title: 'Example' }), true)
  assert.equal(isChromoBookmarked(url), true)
  assert.equal(isChromoBookmarked('https://www.example.com/docs'), true)
  assert.equal(addChromoBookmark({ url, title: 'Example' }), false)

  const afterAdd = loadChromoBookmarks()
  assert.equal(afterAdd[0]?.title, 'Example')
  assert.equal(afterAdd[0]?.url, 'https://www.example.com/docs')

  assert.equal(toggleChromoBookmark({ url, title: 'Example' }), false)
  assert.equal(isChromoBookmarked(url), false)
  assert.equal(toggleChromoBookmark({ url, title: 'Example' }), true)
  assert.equal(isChromoBookmarked(url), true)

  removeChromoBookmark(url)
  assert.equal(isChromoBookmarked(url), false)
  console.log('ok: add toggle remove')
}

function testKeepWww(): void {
  resetStorage()
  assert.equal(addChromoBookmark({ url: 'https://www.github.com', title: 'GitHub www' }), true)
  const stored = loadChromoBookmarks().find((item) => item.title === 'GitHub www')
  assert.ok(stored?.url.includes('www.github.com'))
  console.log('ok: keep www')
}

function testBarVisible(): void {
  resetStorage()
  assert.equal(loadChromoBookmarksBarVisible(), true)
  setChromoBookmarksBarVisible(false)
  assert.equal(loadChromoBookmarksBarVisible(), false)
  setChromoBookmarksBarVisible(true)
  assert.equal(loadChromoBookmarksBarVisible(), true)
  console.log('ok: bar visible')
}

function testAllowEmptyAfterClear(): void {
  resetStorage()
  for (const item of loadChromoBookmarks()) {
    removeChromoBookmark(item.url)
  }
  assert.equal(loadChromoBookmarks().length, 0)
  console.log('ok: empty list persisted')
}

testNormalize()
testDefaultsAndBlank()
testAddToggleRemove()
testKeepWww()
testBarVisible()
testAllowEmptyAfterClear()
console.log('chromo-bookmarks tests passed')
