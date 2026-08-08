/**
 * 分轨纯逻辑：切块 / 重叠相加拼接 / 波形峰值。
 * 与模型推理解耦，可独立单测。
 */

import { STEM_IDS, type StemAudio } from './stems-types.ts'

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
 * 返回 6 轨 interleaved stereo PCM。
 */
export function stitchStemOutputs(
  chunkOutputs: Float32Array[],
  chunkStartFrames: number[],
  totalFrames: number,
): StemAudio[] {
  const accum: Float32Array[] = STEM_IDS.map(() => new Float32Array(totalFrames * STEM_CHANNELS))
  const weight = new Float32Array(totalFrames)

  chunkOutputs.forEach((output, chunkIndex) => {
    const start = chunkStartFrames[chunkIndex]
    for (let stem = 0; stem < STEM_IDS.length; stem++) {
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

  return STEM_IDS.map((stemId, stem) => {
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

export type WaveformPeak = { min: number; max: number }

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

/** 计算 interleaved stereo PCM 的每桶峰值（min/max），用于波形渲染。 */
export function computeWaveformPeaks(
  data: Float32Array,
  bucketCount: number,
): WaveformPeak[] {
  const peaks: WaveformPeak[] = []
  const totalFrames = Math.floor(data.length / STEM_CHANNELS)
  const framesPerBucket = Math.max(1, Math.ceil(totalFrames / bucketCount))
  for (let b = 0; b < bucketCount; b++) {
    let min = 0
    let max = 0
    const start = b * framesPerBucket
    const end = Math.min(totalFrames, start + framesPerBucket)
    for (let i = start; i < end; i++) {
      // 取左右声道最大幅度
      const l = data[i * STEM_CHANNELS]
      const r = data[i * STEM_CHANNELS + 1]
      const amp = Math.max(Math.abs(l), Math.abs(r))
      if (amp > max) max = amp
      if (-amp < min) min = -amp
    }
    peaks.push({ min, max })
  }
  return peaks
}
