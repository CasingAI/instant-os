/**
 * SenseVoice 五语识别特征链路（16k，与 sherpa-onnx sense-voice 训练侧一致）。
 *
 * 与 zipformer 的差异（已逐项对照 sherpa-onnx 源码）：
 *   - fbank：hamming 窗、snip_edges=true、high_freq=0（zipformer 是 povey/snip_edges=false/-400）
 *   - LFR（Low Frame Rate）：lfr_window_size=7 帧、lfr_window_shift=6，
 *     每 6 帧输出一帧，每个输出帧 = 中心帧前后 3 帧共 7 帧特征拼接 → 维度 80×7=560
 *   - CMVN：逐维 (x + neg_mean) * inv_stddev（neg_mean 即 -mean，从 ONNX metadata 读取）
 *
 * 纯函数，可 node --experimental-strip-types 单测。
 */

import { computeKaldiFbank } from './kaldi-fbank.ts'

export type SenseVoiceFeatureConfig = {
  /** LFR 拼接窗口（帧数），默认 7 */
  windowSize: number
  /** LFR 步进（帧数），默认 6 */
  windowShift: number
  /** CMVN 均值（含符号，即 -mean），逐维；缺省不做标准化 */
  negMean: number[]
  /** CMVN 标准差倒数，逐维；缺省不做标准化 */
  invStddev: number[]
  /**
   * 样本缩放：normalize_samples=0（SenseVoice）时模型按 int16 域训练，
   * float [-1,1] 需乘 32768（sherpa-onnx offline-stream 同款）。
   */
  sampleScale: number
}

const DEFAULT_FEATURE_CONFIG: SenseVoiceFeatureConfig = {
  windowSize: 7,
  windowShift: 6,
  negMean: [],
  invStddev: [],
  sampleScale: 1,
}

/** 80 维 hamming 窗 fbank（snip_edges=true，high_freq=0，low_freq=20），返回 [帧数×80] */
export function computeSenseVoiceFbank(wave: Float32Array): Float32Array {
  return computeKaldiFbank(wave, {
    windowType: 'hamming',
    snipEdges: true,
    highFreq: 0,
  })
}

/**
 * LFR 拼接（与 sherpa-onnx csrc/lfr.cc ApplyLfr 逐行对齐）：
 * 输出帧数 = 1 + floor((inputFrames - 1) / windowShift) = ceil(inputFrames / windowShift)；
 * 第 i 个输出帧取输入帧 [i*shift - leftContext, i*shift + windowSize - leftContext)，
 * 越界帧重复首/末帧。返回 [outputFrames × (inputDim×windowSize)]。
 */
export function applyLfr(
  feats: Float32Array,
  inputDim: number,
  windowSize: number,
  windowShift: number,
): Float32Array {
  if (windowSize <= 0 || windowShift <= 0) {
    throw new Error('applyLfr: 需 windowSize/windowShift 为正')
  }
  if (feats.length % inputDim !== 0) {
    throw new Error('applyLfr: 特征长度不能整除 inputDim')
  }
  if (feats.length === 0) return new Float32Array(0)

  const inputFrames = feats.length / inputDim
  const outputFrames = 1 + Math.floor((inputFrames - 1) / windowShift)
  const outputDim = inputDim * windowSize
  const out = new Float32Array(outputFrames * outputDim)

  const leftContext = (windowSize - 1) >> 1
  let dst = 0
  for (let i = 0; i < outputFrames; i++) {
    const center = i * windowShift
    const leftPadding = center < leftContext ? leftContext - center : 0
    const firstInput = center < leftContext ? 0 : center - leftContext
    const maxOffset = inputFrames - 1 - firstInput

    for (let j = 0; j < windowSize; j++) {
      let inputFrame = 0
      if (j >= leftPadding) {
        const offset = j - leftPadding
        inputFrame = offset > maxOffset ? inputFrames - 1 : firstInput + offset
      }
      const src = inputFrame * inputDim
      out.set(feats.subarray(src, src + inputDim), dst)
      dst += inputDim
    }
  }
  return out
}

/**
 * CMVN 标准化（与 sherpa-onnx ApplyCMVN 一致）：逐维 out = (x + neg_mean) * inv_stddev。
 * negMean/invStddev 为空时不改动。
 */
export function applyCmvn(
  feats: Float32Array,
  negMean: number[],
  invStddev: number[],
): Float32Array {
  if (negMean.length === 0 || invStddev.length === 0) return feats
  const dim = negMean.length
  const out = new Float32Array(feats.length)
  for (let i = 0; i < feats.length; i++) {
    const d = i % dim
    out[i] = (feats[i] + negMean[d]) * invStddev[d]
  }
  return out
}

/** 组合链路：缩放 → fbank → LFR → CMVN，返回可直接喂模型的 [输出帧数×560] 特征。 */
export function computeSenseVoiceFeatures(
  wave: Float32Array,
  config: Partial<SenseVoiceFeatureConfig> = {},
): Float32Array {
  const cfg: SenseVoiceFeatureConfig = { ...DEFAULT_FEATURE_CONFIG, ...config }
  const scaled =
    cfg.sampleScale === 1
      ? wave
      : Float32Array.from(wave, (v) => v * cfg.sampleScale)
  const fbank = computeSenseVoiceFbank(scaled)
  if (fbank.length === 0) return fbank
  const lfr = applyLfr(fbank, 80, cfg.windowSize, cfg.windowShift)
  return applyCmvn(lfr, cfg.negMean, cfg.invStddev)
}
