/**
 * DTW 对齐引擎单测。
 * 运行：node --experimental-strip-types src/apps/align/align-dtw.test.ts
 */
import assert from 'node:assert/strict'
import { alignUnitsToPhones } from './align-dtw.ts'
import type { AlignedPhone, G2pUnit } from './align-types.ts'

function testExactMatch(): void {
  // 「你好」= n+i / x+ɑu，观测音素完全匹配
  const units: G2pUnit[] = [
    { text: '你', phones: ['n', 'i5'] },
    { text: '好', phones: ['x', 'ɑu5'] },
  ]
  const phones: AlignedPhone[] = [
    { symbol: 'n', start: 0.2, end: 0.35 },
    { symbol: 'i5', start: 0.35, end: 0.5 },
    { symbol: 'x', start: 0.6, end: 0.75 },
    { symbol: 'ɑu5', start: 0.75, end: 0.95 },
  ]
  const aligned = alignUnitsToPhones(units, phones)
  assert.equal(aligned.length, 2)
  assert.equal(aligned[0].text, '你')
  assert.ok(Math.abs(aligned[0].start - 0.2) < 1e-6)
  assert.ok(Math.abs(aligned[0].end - 0.5) < 1e-6)
  assert.equal(aligned[1].text, '好')
  assert.ok(Math.abs(aligned[1].start - 0.6) < 1e-6)
  assert.ok(Math.abs(aligned[1].end - 0.95) < 1e-6)
}

function testMonotonicWithNoise(): void {
  // 观测多了噪声音素，目标仍能对齐且时间戳单调
  const units: G2pUnit[] = [
    { text: '春', phones: ['tɕ', 'uən'] },
    { text: '天', phones: ['t', 'iɛn'] },
  ]
  const phones: AlignedPhone[] = [
    { symbol: '<pad>', start: 0, end: 0.1 }, // CTC → 过滤
    { symbol: 'ə', start: 0.1, end: 0.15 }, // 噪声
    { symbol: 'tɕ', start: 0.2, end: 0.35 },
    { symbol: 'uən', start: 0.35, end: 0.5 },
    { symbol: 'z', start: 0.52, end: 0.55 }, // 噪声
    { symbol: 't', start: 0.6, end: 0.72 },
    { symbol: 'iɛn', start: 0.72, end: 0.9 },
  ]
  const aligned = alignUnitsToPhones(units, phones)
  assert.equal(aligned.length, 2)
  assert.ok(aligned[0].start <= aligned[0].end)
  assert.ok(aligned[0].end <= aligned[1].start + 1e-6)
  assert.ok(aligned[1].start <= aligned[1].end)
  // 「春」应对到 tɕ..uən 附近
  assert.ok(aligned[0].start >= 0.15 && aligned[0].start <= 0.25)
  assert.ok(aligned[1].start >= 0.55 && aligned[1].start <= 0.65)
}

function testInterpolationFallback(): void {
  // 中间单元无音素（纯标点）→ 插值兜底，仍单调
  const units: G2pUnit[] = [
    { text: '你', phones: ['n', 'i5'] },
    { text: '，', phones: [] },
    { text: '好', phones: ['x', 'ɑu5'] },
  ]
  const phones: AlignedPhone[] = [
    { symbol: 'n', start: 0.2, end: 0.35 },
    { symbol: 'i5', start: 0.35, end: 0.5 },
    { symbol: 'x', start: 1.0, end: 1.15 },
    { symbol: 'ɑu5', start: 1.15, end: 1.3 },
  ]
  const aligned = alignUnitsToPhones(units, phones)
  assert.equal(aligned.length, 3)
  assert.ok(Number.isFinite(aligned[1].start))
  assert.ok(aligned[0].end <= aligned[1].start + 1e-6)
  assert.ok(aligned[1].end <= aligned[2].start + 1e-6)
}

function testEmptyInputs(): void {
  assert.deepEqual(alignUnitsToPhones([], []), [])
  const units: G2pUnit[] = [{ text: '啊', phones: ['a'] }]
  // 无观测 → 插值兜底，仍返回单元
  const aligned = alignUnitsToPhones(units, [])
  assert.equal(aligned.length, 1)
  assert.ok(Number.isFinite(aligned[0].start))
}

async function runAll(): Promise<void> {
  testExactMatch()
  testMonotonicWithNoise()
  testInterpolationFallback()
  testEmptyInputs()
  console.log('align-dtw: 全部通过')
}

runAll().catch((error) => {
  console.error(error)
  process.exit(1)
})
