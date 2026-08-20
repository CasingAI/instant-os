/**
 * 运行：node --experimental-strip-types src/apps/chromo/chromo-session.test.ts
 */
import assert from 'node:assert/strict'
import { DEVICE_STORAGE_KEYS } from '../../os/device-storage.ts'
import {
  CHROMO_SESSION_MAX_TABS,
  chromoSessionHasPages,
  emptyChromoSession,
  loadChromoSession,
  normalizeChromoSession,
  saveChromoBlankSession,
  saveChromoSession,
} from './chromo-session.ts'

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
  localStorage.removeItem(DEVICE_STORAGE_KEYS.chromoSession)
}

function testMissingSession(): void {
  resetStorage()
  assert.equal(loadChromoSession(), undefined)
  assert.equal(chromoSessionHasPages(undefined), false)
  console.log('ok: missing session')
}

function testDiscardInvalidAndClampIndex(): void {
  const normalized = normalizeChromoSession({
    tabs: [
      { url: 'ftp://bad.example', title: 'FTP' },
      { url: 'https://www.example.com/ok', title: 'OK' },
      { url: '', title: '空白' },
      { title: '缺 URL' },
      null,
    ],
    activeIndex: 99,
  })

  assert.equal(normalized.tabs.length, 2)
  assert.equal(normalized.tabs[0]?.url, 'https://www.example.com/ok')
  assert.equal(normalized.tabs[1]?.url, '')
  assert.equal(normalized.activeIndex, 1)
  console.log('ok: discard invalid and clamp index')
}

function testCapTabCount(): void {
  const tabs = Array.from({ length: CHROMO_SESSION_MAX_TABS + 8 }, (_, index) => ({
    url: `https://www.example.com/${index}`,
    title: `Tab ${index}`,
  }))
  const normalized = normalizeChromoSession({ tabs, activeIndex: 0 })
  assert.equal(normalized.tabs.length, CHROMO_SESSION_MAX_TABS)
  console.log('ok: cap tab count')
}

function testEmptyFallsBackToBlank(): void {
  const normalized = normalizeChromoSession({ tabs: [{ url: 'not a url', title: '坏' }], activeIndex: 3 })
  assert.deepEqual(normalized, emptyChromoSession())
  console.log('ok: empty falls back to blank')
}

function testKeepInternalHistoryTab(): void {
  const normalized = normalizeChromoSession({
    tabs: [
      { url: 'browser://history', title: '历史记录' },
      { url: 'chrome://history', title: '旧协议' },
      { url: 'browser://flags', title: 'Flags' },
      { url: 'https://www.example.com/', title: 'Example' },
    ],
    activeIndex: 0,
  })
  assert.equal(normalized.tabs.length, 3)
  assert.equal(normalized.tabs[0]?.url, 'browser://history')
  assert.equal(normalized.tabs[1]?.url, 'browser://history')
  assert.equal(normalized.tabs[2]?.url, 'https://www.example.com/')
  assert.equal(normalized.activeIndex, 0)
  console.log('ok: keep browser://history session tab')
}

function testPersistBlank(): void {
  resetStorage()
  assert.equal(saveChromoSession({
    tabs: [
      { url: 'https://www.example.com/', title: 'Example' },
      { url: 'https://github.com/', title: 'GitHub' },
    ],
    activeIndex: 1,
  }), true)
  assert.equal(chromoSessionHasPages(loadChromoSession()), true)
  assert.equal(saveChromoBlankSession(), true)
  const session = loadChromoSession()
  assert.equal(chromoSessionHasPages(session), false)
  assert.equal(session?.tabs.length, 1)
  assert.equal(session?.tabs[0]?.url, '')
  console.log('ok: persist blank')
}

testMissingSession()
testDiscardInvalidAndClampIndex()
testCapTabCount()
testEmptyFallsBackToBlank()
testKeepInternalHistoryTab()
testPersistBlank()
console.log('chromo-session tests passed')
