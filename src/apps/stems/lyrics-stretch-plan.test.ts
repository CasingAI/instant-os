/**
 * 自主放慢方案推荐单测（node --experimental-strip-types 直接跑）。
 * 验证：语速反推 rate（快嘴放慢 / 正常 1 / 极快钳制）、标点不计入字数、
 * 瞬态密度排序算法（白噪声 → WSOLA 优先，稳态正弦 → PV 优先）。
 */

import assert from 'node:assert/strict'
import {
  planStretchParams,
  STRETCH_MIN_RATE,
  STRETCH_TARGET_SPEECH_RATE,
} from './lyrics-time-stretch.ts'

/** interleaved stereo：mono 信号复制到两声道 */
function stereo(mono: Float32Array): Float32Array {
  const out = new Float32Array(mono.length * 2)
  for (let i = 0; i < mono.length; i++) {
    out[i * 2] = mono[i]
    out[i * 2 + 1] = mono[i]
  }
  return out
}

/** 稳态正弦 mono：低瞬态（长音/旋律主导） */
function sine(freq: number, seconds: number, sampleRate: number): Float32Array {
  const n = Math.round(seconds * sampleRate)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate)
  return out
}

/** 确定性白噪声 mono：帧间频谱随机变化、过零率高（清辅音/瞬态密集的近似） */
function noise(seconds: number, sampleRate: number, seed: number): Float32Array {
  let s = seed
  const n = Math.round(seconds * sampleRate)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    out[i] = ((s / 0x7fffffff) * 2 - 1) * 0.5
  }
  return out
}

const SR = 44100

// 快嘴行（10 字/秒）反推出放慢速率
{
  const plan = planStretchParams('一二三四五六七八九十', 1.0, stereo(sine(200, 2, SR)), SR)
  assert.equal(plan.rate, STRETCH_TARGET_SPEECH_RATE / 10)
  assert.ok(plan.rate < 1)
}

// 极快语速被钳制到最小速率
{
  const plan = planStretchParams('一二三四五六七八九十', 0.3, stereo(sine(200, 2, SR)), SR)
  // 目标 5 字/秒 / 当前 (10/0.3=33.3) ≈ 0.15 → 钳到最小
  assert.equal(plan.rate, STRETCH_MIN_RATE)
}

// 正常语速（4 字/秒）→ rate=1 不拉伸
{
  const plan = planStretchParams('一二三四五六七八九十', 2.5, stereo(sine(200, 2, SR)), SR)
  assert.equal(plan.rate, 1)
}

// 标点不计入字数
{
  const plan = planStretchParams('一二三，四五！六七八。九十。', 1.0, stereo(sine(200, 2, SR)), SR)
  // 标点 4 个不计，剩 10 字 → 10 字/秒 → 0.5
  assert.equal(plan.rate, STRETCH_TARGET_SPEECH_RATE / 10)
}

// 瞬态密集（白噪声）→ WSOLA 优先
{
  const plan = planStretchParams('一二三四五六七八九十', 1.0, stereo(noise(2, SR, 42)), SR)
  assert.equal(plan.methods[0], 'wsola')
}

// 稳态长音（正弦）→ Phase Vocoder 优先
{
  const plan = planStretchParams('一二三四五六七八九十', 1.0, stereo(sine(440, 2, SR)), SR)
  assert.equal(plan.methods[0], 'phase-vocoder')
}

console.log('ok: lyrics-stretch-plan')
