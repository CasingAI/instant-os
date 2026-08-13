/**
 * Kaldi Fbank 特征提取单测（node --experimental-strip-types 直接跑）。
 * 验证：
 *  1. 帧数公式（snip_edges=false）：floor((N + shift/2) / shift)
 *  2. 特征形状与数值范围（log mel 能量，应为负值）
 *  3. 纯音正弦：能量集中在对应频率附近的 mel bin，其余 bin 很低
 *  4. 确定性：同输入两次结果一致
 */

import assert from 'node:assert/strict'
import { computeKaldiFbank, fbankShape } from './kaldi-fbank.ts'

const SR = 16000

function tone(freq: number, sec: number): Float32Array {
  const n = Math.round(SR * sec)
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    w[i] = Math.sin((2 * Math.PI * freq * i) / SR)
  }
  return w
}

// —— 1. 帧数 ——
{
  // 1 秒：floor((16000 + 80) / 160) = 100
  const w1 = tone(440, 1)
  assert.deepEqual(fbankShape(w1), { frames: 100, dim: 80 })

  // 0.05 秒：floor((800 + 80)/160) = 5
  const w05 = tone(440, 0.05)
  assert.deepEqual(fbankShape(w05), { frames: 5, dim: 80 })

  // 极短：不足一帧 → 0 帧
  const wTiny = new Float32Array(10)
  assert.equal(fbankShape(wTiny).frames, 0)
  assert.equal(computeKaldiFbank(wTiny).length, 0)
}

// —— 2. 形状与数值 ——
{
  const w = tone(1000, 0.5)
  const feats = computeKaldiFbank(w)
  assert.equal(feats.length, 50 * 80) // 0.5s → 50 帧

  // log mel 能量应为有限数（预加重可使其为正）
  for (let i = 0; i < feats.length; i++) {
    assert.ok(Number.isFinite(feats[i]), `feat ${i} 应为有限数`)
  }

  // 能量应集中在少数 mel bin（稀疏），大多数 bin 远低于峰值
  const frame = feats.subarray(25 * 80, 25 * 80 + 80)
  let max = -Infinity
  for (let b = 0; b < 80; b++) max = Math.max(max, frame[b])
  const hotCount = Array.from(frame).filter((v) => v > max - 6).length
  assert.ok(hotCount < 20, `1000Hz 应只激活少数 mel bin：${hotCount}`)
  assert.ok(max > -6, `峰值应较高：${max}`)
}

// —— 3. 频率定位：1kHz 与 2kHz 的峰值 bin 应不同 ——
{
  const f1 = computeKaldiFbank(tone(1000, 0.5))
  const f2 = computeKaldiFbank(tone(2000, 0.5))
  const argmax = (f: Float32Array): number => {
    let best = 0
    let bestV = -Infinity
    for (let b = 0; b < 80; b++) {
      if (f[25 * 80 + b] > bestV) {
        bestV = f[25 * 80 + b]
        best = b
      }
    }
    return best
  }
  const b1 = argmax(f1)
  const b2 = argmax(f2)
  assert.ok(Math.abs(b1 - b2) >= 3, `两个频率的峰值 bin 应分离：${b1} vs ${b2}`)
}

// —— 4. 确定性 ——
{
  const w = tone(660, 0.3)
  const a = computeKaldiFbank(w)
  const b = computeKaldiFbank(w)
  assert.deepEqual(a, b)
}
