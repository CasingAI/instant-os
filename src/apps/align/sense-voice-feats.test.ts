/**
 * SenseVoice 特征链路纯函数单测（node --experimental-strip-types 直接跑）。
 * 验证：
 *  1. LFR 输出帧数 = ceil(F/6)、维度 = 80×7；
 *  2. LFR 窗口内容（中心帧前后 3 帧，边界重复首/末帧）与 sherpa-onnx lfr.cc 一致；
 *  3. CMVN 逐维 (x + neg_mean) × inv_stddev；
 *  4. hamming fbank 数值（N=400 窗端点）与 povey 不同；
 *  5. sampleScale=32768 生效；
 *  6. computeSenseVoiceFeatures 组合形状。
 */

import assert from 'node:assert/strict'
import {
  applyLfr,
  applyCmvn,
  computeSenseVoiceFbank,
  computeSenseVoiceFeatures,
} from './sense-voice-feats.ts'
import { computeKaldiFbank } from './kaldi-fbank.ts'

// —— 1. LFR 输出帧数 = ceil(F/6)、维度 = 80×7 ——
{
  // 10 帧 → 2 输出帧；7 帧 → 2 输出帧（ceil(7/6)=2）
  assert.equal(applyLfr(new Float32Array(10 * 80), 80, 7, 6).length, 2 * 560)
  assert.equal(applyLfr(new Float32Array(7 * 80), 80, 7, 6).length, 2 * 560)
  assert.equal(applyLfr(new Float32Array(6 * 80), 80, 7, 6).length, 1 * 560)
  assert.equal(applyLfr(new Float32Array(12 * 80), 80, 7, 6).length, 2 * 560)
}

// —— 2. LFR 窗口内容（每帧第 0 维 = 帧号，其余为 0）——
{
  const F = 10
  const feats = new Float32Array(F * 80)
  for (let f = 0; f < F; f++) feats[f * 80] = f
  const out = applyLfr(feats, 80, 7, 6)

  // 输出帧 0：center=0，窗口 [0,0,0,0,1,2,3]（前 3 帧重复首帧）
  for (let j = 0; j < 7; j++) {
    const expected = [0, 0, 0, 0, 1, 2, 3][j]
    assert.equal(out[j * 80], expected, `帧0 窗口 j=${j}`)
  }
  // 输出帧 1：center=6，窗口 [3,4,5,6,7,8,9]
  for (let j = 0; j < 7; j++) {
    const expected = 3 + j
    assert.equal(out[560 + j * 80], expected, `帧1 窗口 j=${j}`)
  }
}

// —— 3. LFR 末帧边界：超出帧重复末帧 ——
{
  const F = 8
  const feats = new Float32Array(F * 80)
  for (let f = 0; f < F; f++) feats[f * 80] = f
  const out = applyLfr(feats, 80, 7, 6)
  // 输出帧数 = ceil(8/6) = 2
  assert.equal(out.length / 560, 2)
  // 输出帧 1：center=6，窗口 [3,4,5,6,7,7,7]（末帧 7 重复到右边界）
  for (let j = 0; j < 7; j++) {
    const expected = [3, 4, 5, 6, 7, 7, 7][j]
    assert.equal(out[560 + j * 80], expected, `帧1 窗口 j=${j}`)
  }
}

// —— 4. CMVN 逐维 (x + neg_mean) × inv_stddev ——
{
  const negMean = [-1, -2]
  const invStddev = [0.5, 2]
  const feats = new Float32Array([4, 6, 10, 12]) // 2 帧，dim=2
  const out = applyCmvn(feats, negMean, invStddev)
  assert.deepEqual(Array.from(out), [1.5, 8, 4.5, 20])
}

// —— 5. CMVN 空向量时不改动 ——
{
  const feats = new Float32Array([1, 2, 3])
  assert.equal(applyCmvn(feats, [], []), feats)
}

// —— 6. hamming fbank 数值（与 povey 窗输出不同；形状一致）——
{
  const wave = new Float32Array(16000)
  for (let i = 0; i < wave.length; i++) {
    wave[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / 16000)
  }
  const hamming = computeSenseVoiceFbank(wave)
  const povey = computeKaldiFbank(wave, { windowType: 'povey', snipEdges: true, highFreq: 0 })
  assert.ok(hamming.length > 0)
  assert.equal(hamming.length, povey.length)
  // hamming 与 povey 逐值不同（至少在部分维上）
  let diff = 0
  for (let i = 0; i < hamming.length; i++) {
    if (Math.abs(hamming[i] - povey[i]) > 1e-4) diff++
  }
  assert.ok(diff > 0, 'hamming 与 povey 输出应不同')
  // 全部有限
  for (let i = 0; i < hamming.length; i++) {
    assert.ok(Number.isFinite(hamming[i]))
  }
}

// —— 7. sampleScale 生效（×32768 后 fbank 整体平移 log 常数，值变大）——
{
  const wave = new Float32Array(3200)
  for (let i = 0; i < wave.length; i++) {
    wave[i] = 0.5 * Math.sin((2 * Math.PI * 880 * i) / 16000)
  }
  const scaled = computeSenseVoiceFeatures(wave, { sampleScale: 32768, negMean: [], invStddev: [] })
  const unscaled = computeSenseVoiceFeatures(wave, { sampleScale: 1, negMean: [], invStddev: [] })
  assert.equal(scaled.length, unscaled.length)
  // 缩放后能量更高（log 域约 +log(32768)）
  assert.ok(scaled[0] > unscaled[0] + 8)
}

// —— 8. computeSenseVoiceFeatures 组合形状 ——
{
  const wave = new Float32Array(16000) // 1s
  for (let i = 0; i < wave.length; i++) {
    wave[i] = 0.1 * Math.sin((2 * Math.PI * 220 * i) / 16000)
  }
  const out = computeSenseVoiceFeatures(wave, {
    windowSize: 7,
    windowShift: 6,
    negMean: [],
    invStddev: [],
  })
  assert.ok(out.length > 0)
  assert.equal(out.length % 560, 0)
  // 1s → fbank 帧 ≈ 100 → LFR ≈ 17
  const lfrFrames = out.length / 560
  assert.ok(lfrFrames >= 16 && lfrFrames <= 18, `LFR 帧数 ${lfrFrames}`)
}
