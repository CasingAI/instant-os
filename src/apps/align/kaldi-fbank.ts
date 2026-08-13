/**
 * Kaldi Fbank 特征提取（16k，与 sherpa-onnx zipformer-ctc-zh 训练侧一致）。
 *
 * 参数从 sherpa-onnx / kaldi-native-fbank 源码逐项核对：
 *   - 采样率 16000；帧移 10ms（160 样本）；帧长 25ms（400 样本），补零到 512
 *   - remove_dc_offset、预加重 0.97、povey 窗、dither=0、snip_edges=false
 *   - 80 个 mel 三角滤波器，low_freq=20Hz，high_freq=Nyquist-400=7600Hz
 *   - MelScale(f) = 1127 * ln(1 + f/700)（HTK 刻度）
 *   - 输出 log(mel energy)，无 CMVN（zipformer 直接用 raw fbank）
 *
 * 帧数（snip_edges=false）：
 *   num_frames = floor((num_samples + frame_shift/2) / frame_shift)
 * 每帧起点：
 *   first_sample = frame_shift*f + frame_shift/2 - window_size/2（负值反射填充）
 *
 * 纯函数，可 node --experimental-strip-types 单测。
 */

export type KaldiFbankOptions = {
  sampleRate: number
  frameShiftMs: number
  frameLengthMs: number
  numMelBins: number
  lowFreq: number
  /** 若 <=0，按 Nyquist + highFreq 解释（-400 → 8000-400=7600） */
  highFreq: number
  preemphCoeff: number
  snipEdges: boolean
}

const DEFAULT_OPTS: KaldiFbankOptions = {
  sampleRate: 16000,
  frameShiftMs: 10,
  frameLengthMs: 25,
  numMelBins: 80,
  lowFreq: 20,
  highFreq: -400,
  preemphCoeff: 0.97,
  snipEdges: false,
}

function roundUpPow2(n: number): number {
  let v = n
  v -= 1
  v |= v >> 1
  v |= v >> 2
  v |= v >> 4
  v |= v >> 8
  v |= v >> 16
  return v + 1
}

/** HTK mel 刻度 */
function melScale(freq: number): number {
  return 1127 * Math.log(1 + freq / 700)
}

/** 实数 FFT（radix-2 迭代）→ 功率谱 [0..N/2]，与 kaldi RFFT 功率谱一致 */
function powerSpectrum(re: Float64Array, im: Float64Array, n: number): Float64Array {
  // 位反转置换
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wRe = Math.cos(ang)
    const wIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let curRe = 1
      let curIm = 0
      const half = len >> 1
      for (let k = 0; k < half; k++) {
        const uRe = re[i + k]
        const uIm = im[i + k]
        const vRe = re[i + k + half] * curRe - im[i + k + half] * curIm
        const vIm = re[i + k + half] * curIm + im[i + k + half] * curRe
        re[i + k] = uRe + vRe
        im[i + k] = uIm + vIm
        re[i + k + half] = uRe - vRe
        im[i + k + half] = uIm - vIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
  const half = n >> 1
  const out = new Float64Array(half + 1)
  out[0] = re[0] * re[0]
  for (let k = 1; k < half; k++) {
    out[k] = re[k] * re[k] + im[k] * im[k]
  }
  out[half] = re[half] * re[half]
  return out
}

/** 预计算 mel 三角滤波器组：80 行，每行 {offset, weights[]} */
function buildMelBank(opts: KaldiFbankOptions, paddedSize: number): { offset: number; weights: Float64Array }[] {
  const nyquist = 0.5 * opts.sampleRate
  const highFreq = opts.highFreq > 0 ? opts.highFreq : nyquist + opts.highFreq
  const numFftBins = paddedSize >> 1 // 256
  const fftBinWidth = opts.sampleRate / paddedSize

  const melLow = melScale(opts.lowFreq)
  const melHigh = melScale(highFreq)
  const melDelta = (melHigh - melLow) / (opts.numMelBins + 1)

  const banks: { offset: number; weights: Float64Array }[] = []
  for (let b = 0; b < opts.numMelBins; b++) {
    const leftMel = melLow + b * melDelta
    const centerMel = melLow + (b + 1) * melDelta
    const rightMel = melLow + (b + 2) * melDelta

    let first = -1
    let last = -1
    const weights = new Float64Array(numFftBins)
    for (let i = 0; i < numFftBins; i++) {
      const mel = melScale(fftBinWidth * i)
      if (mel > leftMel && mel < rightMel) {
        const w =
          mel <= centerMel
            ? (mel - leftMel) / (centerMel - leftMel)
            : (rightMel - mel) / (rightMel - centerMel)
        weights[i] = w
        if (first < 0) first = i
        last = i
      }
    }
    if (first < 0) {
      throw new Error(`mel bank ${b} 无有效 bin（numMelBins 过大？）`)
    }
    const size = last - first + 1
    banks.push({ offset: first, weights: weights.slice(first, first + size) })
  }
  return banks
}

export function computeKaldiFbank(
  wave: Float32Array,
  opts: Partial<KaldiFbankOptions> = {},
): Float32Array {
  const o: KaldiFbankOptions = { ...DEFAULT_OPTS, ...opts }
  const shift = Math.round((o.sampleRate * 0.001) * o.frameShiftMs)
  const frameLen = Math.round((o.sampleRate * 0.001) * o.frameLengthMs)
  const padded = roundUpPow2(frameLen)

  const numFrames = o.snipEdges
    ? Math.floor((wave.length - frameLen) / shift) + 1
    : Math.floor((wave.length + (shift >> 1)) / shift)
  if (numFrames <= 0) return new Float32Array(0)

  const banks = buildMelBank(o, padded)

  // povey 窗：pow(0.5 - 0.5*cos(2π*i/(N-1)), 0.85)
  const win = new Float64Array(frameLen)
  {
    const a = (2 * Math.PI) / (frameLen - 1)
    for (let i = 0; i < frameLen; i++) {
      win[i] = Math.pow(0.5 - 0.5 * Math.cos(a * i), 0.85)
    }
  }

  const re = new Float64Array(padded)
  const im = new Float64Array(padded)
  const frame = new Float64Array(padded)
  const out = new Float32Array(numFrames * o.numMelBins)

  for (let f = 0; f < numFrames; f++) {
    const start = o.snipEdges ? f * shift : f * shift + (shift >> 1) - (frameLen >> 1)
    // 提取窗口（反射填充越界样本）
    const dim = wave.length
    for (let s = 0; s < frameLen; s++) {
      let idx = start + s
      while (idx < 0 || idx >= dim) {
        idx = idx < 0 ? -idx - 1 : 2 * dim - 1 - idx
      }
      frame[s] = wave[idx]
    }

    // remove DC offset
    let sum = 0
    for (let s = 0; s < frameLen; s++) sum += frame[s]
    const mean = sum / frameLen
    for (let s = 0; s < frameLen; s++) frame[s] -= mean

    // 预加重
    if (o.preemphCoeff !== 0) {
      for (let s = frameLen - 1; s > 0; s--) {
        frame[s] -= o.preemphCoeff * frame[s - 1]
      }
      frame[0] -= o.preemphCoeff * frame[0]
    }

    // 加 povey 窗 + 补零到 padded
    for (let s = 0; s < padded; s++) {
      const v = s < frameLen ? frame[s] * win[s] : 0
      re[s] = v
      im[s] = 0
    }

    // FFT → 功率谱
    const ps = powerSpectrum(re, im, padded)

    // mel filterbank → log
    const base = f * o.numMelBins
    for (let b = 0; b < o.numMelBins; b++) {
      const bank = banks[b]
      let energy = 0
      for (let k = 0; k < bank.weights.length; k++) {
        energy += bank.weights[k] * ps[k + bank.offset]
      }
      out[base + b] = Math.log(Math.max(energy, Number.EPSILON))
    }
  }
  return out
}

/** 返回 [numFrames, numMelBins] 的形状信息（供调用方验证） */
export function fbankShape(
  wave: Float32Array,
  opts: Partial<KaldiFbankOptions> = {},
): { frames: number; dim: number } {
  const o: KaldiFbankOptions = { ...DEFAULT_OPTS, ...opts }
  const shift = Math.round((o.sampleRate * 0.001) * o.frameShiftMs)
  const frameLen = Math.round((o.sampleRate * 0.001) * o.frameLengthMs)
  const frames = o.snipEdges
    ? Math.floor((wave.length - frameLen) / shift) + 1
    : Math.floor((wave.length + (shift >> 1)) / shift)
  return { frames: Math.max(0, frames), dim: o.numMelBins }
}
