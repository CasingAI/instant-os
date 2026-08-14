/**
 * 分轨纯逻辑：切块 / 重叠相加拼接 / 波形峰值。
 * 与模型推理解耦，可独立单测。
 */

import { HTDEMUCS_STEM_IDS, type StemAudio } from './stems-types.ts'

/** htdemucs_6s 的固定输入窗口长度（采样点，单声道）。 */
export const STEM_WINDOW = 343980
/** 推理时相邻窗口的重叠比例。 */
export const STEM_OVERLAP = 0.25
export const STEM_CHANNELS = 2

/** 模型期望的采样率（htdemucs 训练于 44.1kHz）。 */
export const STEM_TARGET_SAMPLE_RATE = 44100

/** 相邻窗口的有效步长（采样点）。 */
export function stemStep(): number {
  return Math.round(STEM_WINDOW * (1 - STEM_OVERLAP))
}

/**
 * 把 interleaved stereo PCM 从任意采样率线性插值重采样到目标采样率。
 * 纯函数、可单测；worker 内无 OfflineAudioContext，故用手写插值。
 */
export function resampleInterleaved(
  audio: Float32Array,
  fromRate: number,
  toRate: number = STEM_TARGET_SAMPLE_RATE,
): Float32Array {
  if (fromRate === toRate) return audio
  const fromFrames = Math.floor(audio.length / STEM_CHANNELS)
  const toFrames = Math.round((fromFrames * toRate) / fromRate)
  const out = new Float32Array(toFrames * STEM_CHANNELS)
  const ratio = fromFrames / toFrames
  for (let i = 0; i < toFrames; i++) {
    const srcPos = i * ratio
    const srcIndex = Math.floor(srcPos)
    const frac = srcPos - srcIndex
    const nextIndex = Math.min(fromFrames - 1, srcIndex + 1)
    for (let ch = 0; ch < STEM_CHANNELS; ch++) {
      const a = audio[srcIndex * STEM_CHANNELS + ch]
      const b = audio[nextIndex * STEM_CHANNELS + ch]
      out[i * STEM_CHANNELS + ch] = a + (b - a) * frac
    }
  }
  return out
}

export type StemChunk = {
  /** 该块在整首歌中的起始帧（采样点，单声道） */
  startFrame: number
  /** 该块输入 PCM（interleaved stereo，长度 = STEM_WINDOW × 2） */
  input: Float32Array
}

/**
 * 把整段 interleaved stereo PCM 切成模型输入窗口。
 * 每个窗口长度固定 STEM_WINDOW，最后不足时用零填充。
 */
export function sliceStemChunks(audio: Float32Array): StemChunk[] {
  const step = stemStep()
  const totalFrames = Math.floor(audio.length / STEM_CHANNELS)
  const chunks: StemChunk[] = []
  for (let start = 0; start < totalFrames; start += step) {
    const input = new Float32Array(STEM_WINDOW * STEM_CHANNELS)
    const count = Math.min(STEM_WINDOW, totalFrames - start)
    for (let i = 0; i < count; i++) {
      const src = (start + i) * STEM_CHANNELS
      input[i * STEM_CHANNELS] = audio[src]
      input[i * STEM_CHANNELS + 1] = audio[src + 1]
    }
    chunks.push({ startFrame: start, input })
  }
  return chunks
}

/** 三角窗函数值：前一半上升（0→1），后一半下降（1→0）。 */
function windowValue(i: number): number {
  const half = STEM_WINDOW / 2
  if (i < half) return i / half
  return (STEM_WINDOW - i) / half
}

/**
 * 把每块输出（stems，shape [6, 2, STEM_WINDOW]）用重叠相加拼回整首。
 * 归一化权重为「每帧的窗函数值和」，任意重叠比例下常数输入都能精确还原。
 * 返回 6 轨 interleaved stereo PCM（与 htdemucs 输出通道顺序一一对应）。
 */
export function stitchStemOutputs(
  chunkOutputs: Float32Array[],
  chunkStartFrames: number[],
  totalFrames: number,
): StemAudio[] {
  const accum: Float32Array[] = HTDEMUCS_STEM_IDS.map(() => new Float32Array(totalFrames * STEM_CHANNELS))
  const weight = new Float32Array(totalFrames)

  chunkOutputs.forEach((output, chunkIndex) => {
    const start = chunkStartFrames[chunkIndex]
    for (let stem = 0; stem < HTDEMUCS_STEM_IDS.length; stem++) {
      const stemBase = stem * STEM_WINDOW * STEM_CHANNELS
      const target = accum[stem]
      // 单块：模型输出 [2, STEM_WINDOW] interleaved 化
      const frame = new Float32Array(STEM_WINDOW * STEM_CHANNELS)
      for (let i = 0; i < STEM_WINDOW; i++) {
        const l = output[stemBase + i * 2]
        const r = output[stemBase + i * 2 + 1]
        frame[i * STEM_CHANNELS] = l
        frame[i * STEM_CHANNELS + 1] = r
      }
      for (let i = 0; i < STEM_WINDOW; i++) {
        const w = windowValue(i)
        const dest = (start + i) * STEM_CHANNELS
        if (start + i >= totalFrames) break
        target[dest] += frame[i * STEM_CHANNELS] * w
        target[dest + 1] += frame[i * STEM_CHANNELS + 1] * w
      }
    }
    for (let i = 0; i < STEM_WINDOW; i++) {
      const idx = start + i
      if (idx >= totalFrames) break
      weight[idx] += windowValue(i)
    }
  })

  return HTDEMUCS_STEM_IDS.map((stemId, stem) => {
    const data = new Float32Array(totalFrames * STEM_CHANNELS)
    for (let i = 0; i < totalFrames; i++) {
      // 窗和接近 0 的端点不归一化（避免放大噪声），保持原值
      const w = weight[i]
      const divisor = w > 1e-4 ? w : 1
      data[i * STEM_CHANNELS] = accum[stem][i * STEM_CHANNELS] / divisor
      data[i * STEM_CHANNELS + 1] = accum[stem][i * STEM_CHANNELS + 1] / divisor
    }
    return { stemId, data }
  })
}

/** 每桶波形峰值：min/max 为瞬时峰值（对称渲染），rms 为该桶均方根响度（长窗口显示包络用） */
export type WaveformPeak = { min: number; max: number; rms?: number }

/**
 * 写 44 字节标准 PCM WAV 头（16-bit 立体声），供导出与分轨打包共用。
 */
export function encodeWavHeader(numFrames: number, sampleRate: number): ArrayBuffer {
  const dataSize = numFrames * STEM_CHANNELS * 2
  const buffer = new ArrayBuffer(44)
  const view = new DataView(buffer)

  const writeString = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, STEM_CHANNELS, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * STEM_CHANNELS * 2, true) // byte rate
  view.setUint16(32, STEM_CHANNELS * 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)
  return buffer
}

/**
 * 把 interleaved stereo float32 PCM 编码为 16-bit WAV 的 ArrayBuffer。
 * 供「导出分轨」功能下载；纯函数、可单测。
 */
export function encodeWav(data: Float32Array, sampleRate: number): ArrayBuffer {
  const numFrames = Math.floor(data.length / STEM_CHANNELS)
  const dataSize = numFrames * STEM_CHANNELS * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  new Uint8Array(buffer).set(new Uint8Array(encodeWavHeader(numFrames, sampleRate)))
  const view = new DataView(buffer)

  let offset = 44
  for (let i = 0; i < data.length; i++) {
    const sample = Math.max(-1, Math.min(1, data[i]))
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    offset += 2
  }
  return buffer
}

/**
 * 分轨输出「其他二」的静音块占比阈值：分轨完成后检测 htdemucs 人声残余，
 * 静音块占比 ≥ 此值视为近似空轨，并入「其他一」而非单列一轨。
 */
export const STEM_SILENCE_MERGE_RATIO = 0.9
/** 静音判定块 RMS 阈值（约 -50 dBFS，与通用 silencedetect 语义一致）。 */
const STEM_SILENCE_RMS = 10 ** (-50 / 20)

/**
 * 计算 interleaved stereo PCM 中近似静音块占比（0..1）。
 * 每块 RMS 低于阈值视为静音；空数据按全静音计。
 */
export function silenceRatio(data: Float32Array, blockFrames = 2048): number {
  const frames = Math.floor(data.length / STEM_CHANNELS)
  if (frames <= 0) return 1
  let silent = 0
  let total = 0
  for (let f = 0; f < frames; f += blockFrames) {
    const end = Math.min(frames, f + blockFrames)
    let sumSq = 0
    for (let i = f; i < end; i++) {
      const l = data[i * STEM_CHANNELS]
      const r = data[i * STEM_CHANNELS + 1]
      sumSq += l * l + r * r
    }
    const rms = Math.sqrt(sumSq / ((end - f) * STEM_CHANNELS))
    if (rms < STEM_SILENCE_RMS) silent += 1
    total += 1
  }
  return silent / total
}

/**
 * 两条同长度 interleaved stereo 轨逐样本相加。
 * htdemucs 各输出通道是对输入的互补谱分解，直接求和不会覆盖内容。
 */
export function mixStems(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i] + b[i]
  return out
}

/** 计算 interleaved stereo PCM 的每桶峰值（min/max），用于波形渲染。
 *  可指定采样帧区间 [startFrame, endFrame) 只统计窗口内数据（横向缩放查看细节时用）。 */
export function computeWaveformPeaks(
  data: Float32Array,
  bucketCount: number,
  startFrame = 0,
  endFrame = Math.floor(data.length / STEM_CHANNELS),
): WaveformPeak[] {
  const totalFrames = Math.floor(data.length / STEM_CHANNELS)
  const from = Math.max(0, Math.min(totalFrames, startFrame))
  const to = Math.max(from, Math.min(totalFrames, endFrame))
  const windowFrames = to - from
  const peaks: WaveformPeak[] = []
  if (windowFrames <= 0) {
    for (let b = 0; b < bucketCount; b++) peaks.push({ min: 0, max: 0 })
    return peaks
  }
  for (let b = 0; b < bucketCount; b++) {
    let min = 0
    let max = 0
    let sumSq = 0
    let n = 0
    // 按比例切帧，避免 ceil(frames/buckets) 让末尾若干桶落在窗口外变成假静音
    const start = from + Math.floor((b * windowFrames) / bucketCount)
    const end = from + Math.floor(((b + 1) * windowFrames) / bucketCount)
    for (let i = start; i < end; i++) {
      // 取左右声道最大幅度
      const l = data[i * STEM_CHANNELS]
      const r = data[i * STEM_CHANNELS + 1]
      const amp = Math.max(Math.abs(l), Math.abs(r))
      if (amp > max) max = amp
      if (-amp < min) min = -amp
      sumSq += amp * amp
      n++
    }
    const peak: WaveformPeak = { min, max }
    if (n > 0) peak.rms = Math.sqrt(sumSq / n)
    peaks.push(peak)
  }
  return peaks
}

/** 波形峰值金字塔：基础桶存整轨 min/max（左右声道取大幅值，与 computeWaveformPeaks 语义一致）。
 *  rms 为每基础桶的均方根响度（可选：peaks.bin 旧格式反序列化结果没有，渲染端缺省时回退纯峰值）。 */
export type WaveformPyramid = {
  /** 每个基础桶的帧数（采样点） */
  bucketSamples: number
  /** 基础桶总数 */
  bucketCount: number
  min: Float32Array
  max: Float32Array
  /** 每基础桶的均方根响度（sqrt(mean amp²)），长窗口聚合包络显示用 */
  rms?: Float32Array
}

/** 金字塔基准分辨率：~1ms/桶（44.1kHz 下 44 帧）。 */
const PYRAMID_BUCKETS_PER_SEC = 1000
/** 封顶桶数：超长歌曲自动放大基础桶，控制内存。 */
const PYRAMID_MAX_BUCKETS = 400_000

/** 计算金字塔桶布局（bucketSamples/bucketCount）；buildWaveformPyramid 与合并遍历共用。 */
export function waveformPyramidLayout(
  totalFrames: number,
  sampleRate: number,
): { bucketSamples: number; bucketCount: number } {
  let bucketSamples = Math.max(1, Math.round(sampleRate / PYRAMID_BUCKETS_PER_SEC))
  if (Math.ceil(totalFrames / bucketSamples) > PYRAMID_MAX_BUCKETS) {
    bucketSamples = Math.ceil(totalFrames / PYRAMID_MAX_BUCKETS)
  }
  return { bucketSamples, bucketCount: Math.max(1, Math.ceil(totalFrames / bucketSamples)) }
}

/**
 * 一次遍历构建整轨峰值金字塔。之后任意窗口的波形绘制只需按桶聚合，
 * 复杂度 O(窗口毫秒数) 而非 O(窗口采样数)——全曲视图下捏合缩放不再每次
 * 逐采样遍历整段 PCM（这是缩放卡顿的根因）。
 */
export function buildWaveformPyramid(
  data: Float32Array,
  sampleRate: number,
): WaveformPyramid {
  const totalFrames = Math.floor(data.length / STEM_CHANNELS)
  const { bucketSamples, bucketCount } = waveformPyramidLayout(totalFrames, sampleRate)
  const min = new Float32Array(bucketCount)
  const max = new Float32Array(bucketCount)
  // 双精度累加：与 computeWaveformPeaks 的 number 累加逐位一致（金字塔聚合与直接计算可精确对比）
  const sumSq = new Float64Array(bucketCount)
  const counts = new Uint32Array(bucketCount)
  for (let f = 0; f < totalFrames; f++) {
    const l = data[f * STEM_CHANNELS]
    const r = data[f * STEM_CHANNELS + 1]
    const amp = Math.max(Math.abs(l), Math.abs(r))
    const b = Math.floor(f / bucketSamples)
    if (amp > max[b]) max[b] = amp
    const neg = -amp
    if (neg < min[b]) min[b] = neg
    sumSq[b] += amp * amp
    counts[b]++
  }
  const rms = new Float32Array(bucketCount)
  for (let b = 0; b < bucketCount; b++) {
    rms[b] = counts[b] > 0 ? Math.sqrt(sumSq[b] / counts[b]) : 0
  }
  return { bucketSamples, bucketCount, min, max, rms }
}

/**
 * 从峰值金字塔聚合任意窗口的每桶峰值（返回形状与 computeWaveformPeaks 相同）。
 * 窗口边界上的基础桶会被整体计入（±1 个桶 ≈ 1ms 的误差，2px 柱不可见）。
 */
export function computeWaveformPeaksFromPyramid(
  pyramid: WaveformPyramid,
  bucketCount: number,
  startFrame: number,
  endFrame: number,
): WaveformPeak[] {
  const totalFrames = pyramid.bucketCount * pyramid.bucketSamples
  const from = Math.max(0, Math.min(totalFrames, startFrame))
  const to = Math.max(from, Math.min(totalFrames, endFrame))
  const windowFrames = to - from
  const peaks: WaveformPeak[] = []
  if (windowFrames <= 0) {
    for (let b = 0; b < bucketCount; b++) peaks.push({ min: 0, max: 0 })
    return peaks
  }
  const B = pyramid.bucketSamples
  const rmsArr = pyramid.rms
  for (let b = 0; b < bucketCount; b++) {
    let min = 0
    let max = 0
    let sumSq = 0
    let n = 0
    // 与 computeWaveformPeaks 相同的比例切窗，保证末尾桶仍覆盖真实音频
    const start = from + Math.floor((b * windowFrames) / bucketCount)
    const end = from + Math.floor(((b + 1) * windowFrames) / bucketCount)
    if (end > start) {
      const first = Math.floor(start / B)
      const last = Math.min(pyramid.bucketCount - 1, Math.ceil(end / B) - 1)
      for (let p = first; p <= last; p++) {
        if (pyramid.min[p] < min) min = pyramid.min[p]
        if (pyramid.max[p] > max) max = pyramid.max[p]
        if (rmsArr) {
          sumSq += rmsArr[p] * rmsArr[p]
          n++
        }
      }
    }
    const peak: WaveformPeak = { min, max }
    if (n > 0) peak.rms = Math.sqrt(sumSq / n)
    peaks.push(peak)
  }
  return peaks
}
