/**
 * 保调时间伸缩单测（node --experimental-strip-types 直接跑）。
 * 验证：时长比（输出 ≈ 输入 / rate）、保调性（正弦放慢后主频不变）、
 * 静音保持静音、rate 夹取、立体声声道时间轴一致。
 */

import assert from 'node:assert/strict'
import { clampStretchRate, timeStretchAudio, type StretchMethod } from './lyrics-time-stretch.ts'

/** 生成 interleaved stereo 正弦（左右声道同相）。 */
function sineMono(freq: number, sampleRate: number, seconds: number): Float32Array {
  const frames = Math.round(sampleRate * seconds)
  const out = new Float32Array(frames * 2)
  for (let i = 0; i < frames; i++) {
    const v = Math.sin((2 * Math.PI * freq * i) / sampleRate)
    out[i * 2] = v
    out[i * 2 + 1] = v
  }
  return out
}

/** 零交叉频率估计（Hz）：每秒正过零次数的一半。 */
function zeroCrossRateHz(x: Float32Array, sampleRate: number): number {
  let crosses = 0
  for (let i = 1; i < x.length; i++) {
    if ((x[i - 1] < 0 && x[i] >= 0) || (x[i - 1] >= 0 && x[i] < 0)) crosses += 1
  }
  return crosses / 2 / (x.length / sampleRate)
}

/** 提取 interleaved stereo 的左声道（零交叉统计需在单声道上进行）。 */
function leftChannel(x: Float32Array): Float32Array {
  const m = new Float32Array(x.length / 2)
  for (let i = 0; i < m.length; i++) m[i] = x[i * 2]
  return m
}

for (const method of ['wsola', 'phase-vocoder'] as StretchMethod[]) {
  const label = method === 'wsola' ? 'WSOLA' : 'Phase Vocoder'

  {
    const input = sineMono(440, 44100, 1.0)
    const out = timeStretchAudio(input, 44100, 0.7, method)
    const inFrames = input.length / 2
    const outFrames = out.length / 2
    const ratio = outFrames / inFrames
    assert.ok(Math.abs(ratio - 1 / 0.7) < 0.08, `${label} 时长比：期望 ~1/0.7=1.429，实际 ${ratio.toFixed(3)}`)
  }

  {
    // 保调性：440Hz 正弦放慢 0.7x 后主频应仍在 ~440Hz
    const input = sineMono(440, 44100, 1.0)
    const out = timeStretchAudio(input, 44100, 0.7, method)
    const f = zeroCrossRateHz(leftChannel(out), 44100)
    assert.ok(Math.abs(f - 440) < 25, `${label} 保调：期望 ~440Hz，实际 ${f.toFixed(1)}Hz`)
  }

  {
    // rate=1 时长不变、频率不变（恒等性下限）
    const input = sineMono(220, 44100, 0.8)
    const out = timeStretchAudio(input, 44100, 1, method)
    assert.equal(out.length, input.length)
    const f = zeroCrossRateHz(leftChannel(out), 44100)
    assert.ok(Math.abs(f - 220) < 25, `${label} rate=1 保调：期望 ~220Hz，实际 ${f.toFixed(1)}Hz`)
  }

  {
    // 静音保持静音
    const silence = new Float32Array(44100 * 2)
    const out = timeStretchAudio(silence, 44100, 0.6, method)
    assert.ok(out.length > 0)
    for (let i = 0; i < out.length; i++) {
      assert.ok(Math.abs(out[i]) < 1e-6, `${label} 静音不应产生能量（i=${i}）`)
    }
  }

  {
    // 立体声：左右声道输出一致（输入同相正弦），长度成对
    const input = sineMono(330, 44100, 0.5)
    const out = timeStretchAudio(input, 44100, 0.7, method)
    assert.equal(out.length % 2, 0, `${label} 输出应为 interleaved stereo`)
    for (let i = 0; i < out.length; i += 2) {
      const l = out[i]
      const r = out[i + 1]
      assert.ok(Math.abs(l - r) < 1e-4, `${label} 左右声道应一致（i=${i}）`)
    }
  }
}

// rate 夹取
assert.equal(clampStretchRate(0.3), 0.4)
assert.equal(clampStretchRate(0.7), 0.7)
assert.equal(clampStretchRate(2), 1.0)
assert.equal(clampStretchRate(Number.NaN), 0.7)

// 空输入
assert.equal(timeStretchAudio(new Float32Array(0), 44100, 0.7, 'wsola').length, 0)
assert.equal(timeStretchAudio(new Float32Array(0), 44100, 0.7, 'phase-vocoder').length, 0)

console.log('ok: lyrics-time-stretch')
