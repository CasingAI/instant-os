/**
 * MDX-NET 人声增强纯逻辑单测（node --experimental-strip-types 直接跑，无浏览器依赖）。
 *
 * 验证内容：
 *  1. Bluestein FFT（非 2 的幂）与朴素 DFT 一致、正逆变换互逆；
 *  2. STFT→ISTFT 往返在稳态区精确重建（torch.istft 的窗²包络归一化）；
 *  3. 整曲管线（separateInstrumental）在「恒等模型」下输出 ≈ 输入；
 *  4. mixMinus 人声 = 原曲 − 伴奏。
 *
 * 与 UVR（torch.stft 默认 pad_mode='reflect'）逐采样一致的端到端验证
 * 在开发期用脚本完成（/tmp 一次性脚本，需模型文件），此处不依赖模型。
 */

import assert from 'node:assert/strict'
import {
  BluesteinFFT,
  hannPeriodic,
  hannSymmetric,
  mdxStftChunk,
  mdxIstftChunk,
  mixMinus,
  separateInstrumental,
  MDX_N_FFT,
  MDX_HOP,
  MDX_TRIM,
  MDX_CHUNK,
  MDX_DIM_F,
  MDX_DIM_T,
  MDX_SPEC_SIZE,
  MDX_GEN,
  MDX_STEP,
} from './mdx-vocal.ts'

// —— 1. Bluestein FFT：与朴素 DFT 对拍 + 正逆互逆 ——
{
  const n = MDX_N_FFT // 6144，非 2 的幂
  const fft = new BluesteinFFT(n)
  const re = new Float32Array(n)
  const im = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    re[i] = Math.sin(0.3 * i) + 0.2 * Math.cos(1.7 * i)
    im[i] = 0.1 * Math.sin(0.9 * i)
  }
  const re0 = re.slice()
  const im0 = im.slice()

  const dftAt = (k: number): [number, number] => {
    let sr = 0
    let si = 0
    for (let i = 0; i < n; i++) {
      const a = (-2 * Math.PI * i * k) / n
      sr += re0[i] * Math.cos(a) - im0[i] * Math.sin(a)
      si += re0[i] * Math.sin(a) + im0[i] * Math.cos(a)
    }
    return [sr, si]
  }

  fft.forward(re, im)
  for (const k of [0, 1, 3, 100, 1024, 2048, 3072, 5000]) {
    const [er, ei] = dftAt(k)
    assert.ok(Math.abs(re[k] - er) < 1e-2, `forward bin ${k}`)
    assert.ok(Math.abs(im[k] - ei) < 1e-2, `forward bin ${k} imag`)
  }

  fft.inverse(re, im)
  for (let i = 0; i < n; i += 97) {
    assert.ok(Math.abs(re[i] - re0[i]) < 1e-3, `roundtrip ${i}`)
    assert.ok(Math.abs(im[i] - im0[i]) < 1e-3, `roundtrip ${i} imag`)
  }
}

// —— 2. STFT→ISTFT 往返：稳态区增益 ≈ 1（torch.istft 按窗²包络归一化）——
{
  const fft = new BluesteinFFT(MDX_N_FFT)
  const win = hannPeriodic(MDX_N_FFT)
  // 完整 padded 块（原块在中间，两侧 reflect 补边，与 torch.stft 默认一致）
  const chunkPadded = new Float32Array((MDX_CHUNK + 2 * MDX_TRIM) * 2)
  for (let i = 0; i < chunkPadded.length / 2; i++) {
    chunkPadded[i * 2] = Math.sin(0.11 * i) + 0.3 * Math.sin(0.043 * i + 1)
    chunkPadded[i * 2 + 1] = Math.cos(0.07 * i) + 0.2 * Math.sin(0.13 * i)
  }
  const spec = new Float32Array(MDX_SPEC_SIZE)
  const out = new Float32Array(chunkPadded.length)
  mdxStftChunk(chunkPadded, spec, fft, win)
  mdxIstftChunk(spec, out, fft, win)
  // 稳态区（离两侧足够远，帧覆盖完整）
  let maxGainErr = 0
  const lo = 2 * MDX_TRIM
  const hi = chunkPadded.length / 2 - 2 * MDX_TRIM
  for (let s = lo; s < hi; s += 7) {
    maxGainErr = Math.max(maxGainErr, Math.abs(out[s * 2] / chunkPadded[s * 2] - 1))
    maxGainErr = Math.max(maxGainErr, Math.abs(out[s * 2 + 1] / chunkPadded[s * 2 + 1] - 1))
  }
  assert.ok(maxGainErr < 1e-2, `roundtrip gain error ${maxGainErr}`)
}

// —— 3. 整曲管线：恒等模型下输出 ≈ 输入 ——
{
  // 合成一段不长不短的音频（覆盖尾部不足块 + 跨块重叠区）
  const frames = Math.round(MDX_GEN * 2.3)
  const mix = new Float32Array(frames * 2)
  for (let i = 0; i < frames * 2; i++) {
    mix[i] = 0.4 * Math.sin(0.05 * i) + 0.1 * Math.sin(1.3 * i) + 0.01 * Math.sin(9.1 * i)
  }
  // 恒等模型：谱原样返回（每块 STFT→ISTFT 往返 ≈ 恒等，WOLA 应还原输入）
  const identityRun: (spec: Float32Array) => Float32Array = (spec) => spec.slice()
  const inst = await separateInstrumental(mix, identityRun, 4)
  assert.equal(inst.length, mix.length)

  let maxErr = 0
  let sumErr = 0
  const lo = Math.floor(MDX_TRIM * 1.5)
  const hi = frames - lo
  for (let s = lo; s < hi; s++) {
    maxErr = Math.max(maxErr, Math.abs(inst[s * 2] - mix[s * 2]))
    sumErr += Math.abs(inst[s * 2] - mix[s * 2])
  }
  const meanErr = sumErr / (hi - lo)
  // 全管线 float32 精度 + 块边界反射效应，取宽松阈值
  assert.ok(meanErr < 1e-3, `mean error ${meanErr}`)
  assert.ok(maxErr < 2e-2, `max error ${maxErr}`)
}

// —— 4. mixMinus ——
{
  const orig = new Float32Array([0.5, -0.25, 0.125, 0.0, 0.3, -0.4])
  const inst = new Float32Array([0.1, 0.05, -0.02, 0.0, 0.1, -0.1])
  const vocals = mixMinus(orig, inst)
  for (let i = 0; i < orig.length; i++) {
    assert.ok(Math.abs(vocals[i] - (orig[i] - inst[i])) < 1e-6, `mixMinus ${i}`)
  }
}

// —— 5. 常量自洽 ——
{
  assert.equal(MDX_CHUNK, MDX_HOP * (MDX_DIM_T - 1))
  assert.equal(MDX_GEN, MDX_CHUNK - 2 * MDX_TRIM)
  assert.equal(MDX_STEP, Math.round((1 - 0.25) * MDX_CHUNK))
  assert.equal(MDX_DIM_F, MDX_N_FFT / 2) // dim_f = n_fft/2（丢奈奎斯特点）
  assert.equal(hannSymmetric(8)[0], 0)
  assert.ok(Math.abs(hannSymmetric(7)[3] - 1) < 1e-6) // 对称 hann（奇数长度）中点 = 1
}

console.log('mdx-vocal tests OK')
