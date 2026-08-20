/**
 * 运行：node --experimental-strip-types src/apps/chromo/chromo-history.test.ts
 */
import assert from 'node:assert/strict'
import { DEVICE_STORAGE_KEYS } from '../../os/device-storage.ts'
import {
  clearChromoHistory,
  loadChromoHistory,
  recordChromoHistoryVisit,
  removeChromoHistoryVisit,
} from './chromo-history.ts'

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
  localStorage.removeItem(DEVICE_STORAGE_KEYS.chromoHistory)
}

function testSkipEmptyAndInvalid(): void {
  resetStorage()
  assert.equal(recordChromoHistoryVisit({ url: '', title: '空白' }), false)
  assert.equal(recordChromoHistoryVisit({ url: '   ', title: '空白' }), false)
  assert.equal(recordChromoHistoryVisit({ url: 'ftp://example.com', title: 'FTP' }), false)
  assert.equal(loadChromoHistory().length, 0)
  console.log('ok: skip empty and invalid')
}

function testDedupMovesToFront(): void {
  resetStorage()
  assert.equal(recordChromoHistoryVisit({ url: 'https://www.example.com/a', title: 'A' }), true)
  assert.equal(recordChromoHistoryVisit({ url: 'https://www.example.com/b', title: 'B' }), true)
  assert.equal(recordChromoHistoryVisit({ url: 'https://www.example.com/a', title: 'A 更新' }), true)

  const visits = loadChromoHistory()
  assert.equal(visits.length, 2)
  assert.equal(visits[0]?.url, 'https://www.example.com/a')
  assert.equal(visits[0]?.title, 'A 更新')
  assert.equal(visits[1]?.url, 'https://www.example.com/b')
  console.log('ok: dedup moves to front')
}

function testKeepWww(): void {
  resetStorage()
  assert.equal(recordChromoHistoryVisit({ url: 'https://www.github.com/path', title: 'GitHub' }), true)
  const visit = loadChromoHistory()[0]
  assert.ok(visit?.url.includes('www.github.com'))
  console.log('ok: keep www')
}

function testSkipInternalPages(): void {
  resetStorage()
  assert.equal(recordChromoHistoryVisit({ url: 'browser://history', title: '历史记录' }), false)
  assert.equal(recordChromoHistoryVisit({ url: 'browser://bookmarks', title: '书签' }), false)
  assert.equal(recordChromoHistoryVisit({ url: 'browser://settings', title: '设置' }), false)
  assert.equal(loadChromoHistory().length, 0)
  console.log('ok: skip internal pages')
}

function testRemoveAndClear(): void {
  resetStorage()
  recordChromoHistoryVisit({ url: 'https://www.example.com/a', title: 'A' })
  recordChromoHistoryVisit({ url: 'https://www.example.com/b', title: 'B' })
  removeChromoHistoryVisit('https://www.example.com/a')
  assert.equal(loadChromoHistory().length, 1)
  assert.equal(loadChromoHistory()[0]?.url, 'https://www.example.com/b')
  clearChromoHistory()
  assert.equal(loadChromoHistory().length, 0)
  console.log('ok: remove and clear')
}

testSkipEmptyAndInvalid()
testDedupMovesToFront()
testKeepWww()
testSkipInternalPages()
testRemoveAndClear()
console.log('chromo-history tests passed')
