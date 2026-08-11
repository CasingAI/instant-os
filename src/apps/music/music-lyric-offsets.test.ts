/**
 * 歌词偏移纯函数单测。
 * 运行：node --experimental-strip-types src/apps/music/music-lyric-offsets.test.ts
 */
import assert from 'node:assert/strict'
import {
  clampLyricOffsetMs,
  formatLyricOffset,
  loadLyricOffsetMs,
  LYRIC_OFFSET_MAX_MS,
  LYRIC_OFFSET_MIN_MS,
  LYRIC_OFFSET_STEP_MS,
  saveLyricOffsetMs,
} from './music-lyric-offsets.ts'

const KEY = 'instant-os-music-lyric-offsets'

// Node 无 Web Storage / window：打桩内存实现（模块在调用时才访问，安全）
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
  localStorage.removeItem(KEY)
}

function testConstants(): void {
  assert.equal(LYRIC_OFFSET_STEP_MS, 100)
  assert.equal(LYRIC_OFFSET_MIN_MS, -10_000)
  assert.equal(LYRIC_OFFSET_MAX_MS, 10_000)
  console.log('ok: constants')
}

function testClamp(): void {
  assert.equal(clampLyricOffsetMs(0), 0)
  assert.equal(clampLyricOffsetMs(150), 150)
  assert.equal(clampLyricOffsetMs(-150), -150)
  assert.equal(clampLyricOffsetMs(20_000), LYRIC_OFFSET_MAX_MS)
  assert.equal(clampLyricOffsetMs(-20_000), LYRIC_OFFSET_MIN_MS)
  assert.equal(clampLyricOffsetMs(Number.NaN), 0)
  // 非有限值按防御逻辑归 0
  assert.equal(clampLyricOffsetMs(Number.POSITIVE_INFINITY), 0)
  console.log('ok: clamp')
}

function testSaveLoadRoundTrip(): void {
  resetStorage()
  // 未记录 → 0
  assert.equal(loadLyricOffsetMs('a'), 0)
  // 存取往返
  assert.equal(saveLyricOffsetMs('a', 300), true)
  assert.equal(loadLyricOffsetMs('a'), 300)
  // 不同曲目互不影响
  assert.equal(loadLyricOffsetMs('b'), 0)
  saveLyricOffsetMs('b', -500)
  assert.equal(loadLyricOffsetMs('a'), 300)
  assert.equal(loadLyricOffsetMs('b'), -500)
  // 归零会删除记录
  assert.equal(saveLyricOffsetMs('a', 0), true)
  assert.equal(loadLyricOffsetMs('a'), 0)
  const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
  assert.equal(raw.a, undefined)
  console.log('ok: save / load round trip')
}

function testClampedOnSave(): void {
  resetStorage()
  saveLyricOffsetMs('c', 50_000)
  assert.equal(loadLyricOffsetMs('c'), LYRIC_OFFSET_MAX_MS)
  saveLyricOffsetMs('c', -50_000)
  assert.equal(loadLyricOffsetMs('c'), LYRIC_OFFSET_MIN_MS)
  console.log('ok: clamped on save')
}

function testCorruptStorage(): void {
  localStorage.setItem(KEY, 'not-json{{{')
  assert.equal(loadLyricOffsetMs('a'), 0)
  localStorage.setItem(KEY, '{"a":"oops","b":120}')
  assert.equal(loadLyricOffsetMs('a'), 0)
  assert.equal(loadLyricOffsetMs('b'), 120)
  console.log('ok: corrupt storage tolerant')
}

function testFormat(): void {
  assert.equal(formatLyricOffset(0), '已同步')
  assert.equal(formatLyricOffset(300), '延后 0.3s')
  assert.equal(formatLyricOffset(-300), '提前 0.3s')
  assert.equal(formatLyricOffset(2000), '延后 2s')
  assert.equal(formatLyricOffset(-2000), '提前 2s')
  assert.equal(formatLyricOffset(1500), '延后 1.5s')
  assert.equal(formatLyricOffset(-10_000), '提前 10s')
  console.log('ok: format')
}

testConstants()
testClamp()
testSaveLoadRoundTrip()
testClampedOnSave()
testCorruptStorage()
testFormat()
