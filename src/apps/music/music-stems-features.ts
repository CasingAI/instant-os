/**
 * 分轨可视化特征：从 7 轨立体声 PCM 派生轻量包络 / 三带能量 / 鼓 onset，
 * 供播放进度插值采样。纯函数、无浏览器依赖，可 node 单测。
 */

import { STEM_IDS } from '../stems/stems-types.ts'
import type { StemAudio, StemId } from '../stems/stems-types.ts'
import type { TempoInfo } from '../stems/stems-tempo.ts'

/** 特征帧长与 hop（采样点）；hop=882 @44.1kHz ≈ 50 Hz，兼顾精度与体积。 */
export const STEM_VIZ_FRAME = 2048
export const STEM_VIZ_HOP = 882

export type StemBands = {
  low: number
  mid: number
  high: number
}

/** 某一时刻、某一轨的采样（0..1）。 */
export type StemFrameSample = {
  energy: number
  bands: StemBands
  /** 鼓轨有意义；其它轨一般为 0 */
  onset: number
}

export type StemVizFeatures = {
  trackId: string
  sampleRate: number
  hopSamples: number
  hopSec: number
  frameCount: number
  durationSec: number
  tempo: TempoInfo | undefined
  energy: Record<StemId, Float32Array>
  low: Record<StemId, Float32Array>
  mid: Record<StemId, Float32Array>
  high: Record<StemId, Float32Array>
  /** 仅鼓轨填充；其它轨为空数组或零 */
  onset: Record<StemId, Float32Array>
}

/** 全轨当前帧快照，附带节拍相位。 */
export type StemVizSample = {
  byStem: Record<StemId, StemFrameSample>
  bpm: number
  /** 0..1，当前拍内相位 */
  beatPhase: number
  /** 鼓 onset（0..1） */
  drumsOnset: number
}

function emptyStemRecord(): Record<StemId, Float32Array> {
  const out = {} as Record<StemId, Float32Array>
  for (const id of STEM_IDS) {
    out[id] = new Float32Array(0)
  }
  return out
}

function emptySample(): StemFrameSample {
  return { energy: 0, bands: { low: 0, mid: 0, high: 0 }, onset: 0 }
}

/** 线性插值 Float32Array；越界钳制到端点。 */
export function lerpSeries(series: Float32Array, index: number): number {
  if (series.length === 0) return 0
  if (index <= 0) return series[0] ?? 0
  if (index >= series.length - 1) return series[series.length - 1] ?? 0
  const i0 = Math.floor(index)
  const i1 = i0 + 1
  const t = index - i0
  const a = series[i0] ?? 0
  const b = series[i1] ?? 0
  return a + (b - a) * t
}

/** 按时长加权取当前秒的 BPM；无 tempo 时回退 120。 */
export function tempoBpmAt(tempo: TempoInfo | undefined, timeSec: number): number {
  if (!tempo) return 120
  for (const seg of tempo.segments) {
    if (timeSec >= seg.startSec && timeSec < seg.endSec) return seg.bpm
  }
  return tempo.bpm
}

/**
 * 节拍相位 0..1：按分段 BPM 积分拍点（切段时相位连续）。
 * 无 tempo 时按 120 BPM。
 */
export function beatPhaseAt(tempo: TempoInfo | undefined, timeSec: number): number {
  const t = Math.max(0, timeSec)
  if (!tempo || tempo.segments.length === 0) {
    const bpm = tempo?.bpm ?? 120
    return ((t * bpm) / 60) % 1
  }
  let beats = 0
  let cursor = 0
  for (const seg of tempo.segments) {
    const start = Math.max(cursor, seg.startSec)
    const end = Math.min(t, seg.endSec)
    if (end > start) {
      beats += ((end - start) * seg.bpm) / 60
    }
    if (t <= seg.endSec) break
    cursor = seg.endSec
  }
  if (t > (tempo.segments[tempo.segments.length - 1]?.endSec ?? 0)) {
    const lastEnd = tempo.segments[tempo.segments.length - 1]?.endSec ?? 0
    if (t > lastEnd) {
      beats += ((t - lastEnd) * tempo.bpm) / 60
    }
  }
  return beats % 1
}

/** onset：包络正差分 + 一阶平滑。 */
export function buildOnsetFromEnvelope(envelope: Float32Array): Float32Array {
  const n = envelope.length
  const onset = new Float32Array(n)
  let prev = 0
  for (let i = 0; i < n; i++) {
    const diff = Math.max(0, (envelope[i] ?? 0) - prev)
    prev = envelope[i] ?? 0
    onset[i] = i > 0 ? (onset[i - 1] ?? 0) * 0.7 + diff * 0.3 : diff
  }
  return onset
}

/** 按 95 分位软归一到 0..1，避免极端峰值压扁动态。 */
export function normalizeSeries(raw: Float32Array): Float32Array {
  const n = raw.length
  if (n === 0) return new Float32Array(0)
  const sorted = Float32Array.from(raw)
  sorted.sort()
  const p95 = sorted[Math.min(n - 1, Math.floor(n * 0.95))] ?? 0
  const scale = Math.max(1e-6, p95)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = Math.min(1, (raw[i] ?? 0) / scale)
  }
  return out
}

/**
 * 单轨：RMS 能量 + 一极点低/高通拆出的粗三带。
 * interleaved stereo → mono；返回未归一化序列。
 */
export function extractStemEnvelopes(
  data: Float32Array,
  hopSamples = STEM_VIZ_HOP,
  frameSamples = STEM_VIZ_FRAME,
): {
  energy: Float32Array
  low: Float32Array
  mid: Float32Array
  high: Float32Array
} {
  const totalFrames = Math.floor(data.length / 2)
  const count = Math.max(1, Math.ceil(totalFrames / hopSamples))
  const energy = new Float32Array(count)
  const low = new Float32Array(count)
  const mid = new Float32Array(count)
  const high = new Float32Array(count)

  // 一极点低通系数（相对 hop 窗口内采样）
  const alphaLow = 0.02
  const alphaMid = 0.12

  for (let i = 0; i < count; i++) {
    const start = i * hopSamples
    const end = Math.min(totalFrames, start + frameSamples)
    let sumSq = 0
    let lowSq = 0
    let midSq = 0
    let highSq = 0
    let lp = 0
    let mp = 0
    const n = Math.max(1, end - start)
    for (let f = start; f < end; f++) {
      const l = data[f * 2] ?? 0
      const r = data[f * 2 + 1] ?? 0
      const x = (l + r) * 0.5
      sumSq += x * x
      lp += alphaLow * (x - lp)
      const hp = x - lp
      mp += alphaMid * (hp - mp)
      const midBand = mp
      const highBand = hp - mp
      lowSq += lp * lp
      midSq += midBand * midBand
      highSq += highBand * highBand
    }
    energy[i] = Math.sqrt(sumSq / n)
    low[i] = Math.sqrt(lowSq / n)
    mid[i] = Math.sqrt(midSq / n)
    high[i] = Math.sqrt(highSq / n)
  }
  return { energy, low, mid, high }
}

/**
 * 从已解包的分轨 PCM 提取可视化特征。调用方应在返回后丢弃 stems 引用。
 */
export function buildStemVizFeatures(input: {
  trackId: string
  stems: StemAudio[]
  sampleRate: number
  durationSec: number
  tempo?: TempoInfo
  hopSamples?: number
  frameSamples?: number
}): StemVizFeatures {
  const hopSamples = input.hopSamples ?? STEM_VIZ_HOP
  const frameSamples = input.frameSamples ?? STEM_VIZ_FRAME
  const byId = new Map(input.stems.map((s) => [s.stemId, s] as const))

  const energy = emptyStemRecord()
  const low = emptyStemRecord()
  const mid = emptyStemRecord()
  const high = emptyStemRecord()
  const onset = emptyStemRecord()

  let frameCount = 1
  for (const id of STEM_IDS) {
    const stem = byId.get(id)
    if (!stem) {
      energy[id] = new Float32Array(1)
      low[id] = new Float32Array(1)
      mid[id] = new Float32Array(1)
      high[id] = new Float32Array(1)
      onset[id] = new Float32Array(1)
      continue
    }
    const raw = extractStemEnvelopes(stem.data, hopSamples, frameSamples)
    energy[id] = normalizeSeries(raw.energy)
    low[id] = normalizeSeries(raw.low)
    mid[id] = normalizeSeries(raw.mid)
    high[id] = normalizeSeries(raw.high)
    frameCount = Math.max(frameCount, energy[id].length)
    if (id === 'drums') {
      onset[id] = normalizeSeries(buildOnsetFromEnvelope(raw.energy))
    } else {
      onset[id] = new Float32Array(energy[id].length)
    }
  }

  const hopSec = hopSamples / Math.max(1, input.sampleRate)
  const durationSec =
    input.durationSec > 0 ? input.durationSec : Math.max(hopSec, frameCount * hopSec)

  return {
    trackId: input.trackId,
    sampleRate: input.sampleRate,
    hopSamples,
    hopSec,
    frameCount,
    durationSec,
    tempo: input.tempo,
    energy,
    low,
    mid,
    high,
    onset,
  }
}

/** 按播放秒插值采样全轨特征。 */
export function sampleStemFeaturesAt(features: StemVizFeatures, timeSec: number): StemVizSample {
  const index = features.hopSec > 0 ? timeSec / features.hopSec : 0
  const byStem = {} as Record<StemId, StemFrameSample>
  for (const id of STEM_IDS) {
    byStem[id] = {
      energy: lerpSeries(features.energy[id], index),
      bands: {
        low: lerpSeries(features.low[id], index),
        mid: lerpSeries(features.mid[id], index),
        high: lerpSeries(features.high[id], index),
      },
      onset: lerpSeries(features.onset[id], index),
    }
  }
  return {
    byStem,
    bpm: tempoBpmAt(features.tempo, timeSec),
    beatPhase: beatPhaseAt(features.tempo, timeSec),
    drumsOnset: byStem.drums?.onset ?? 0,
  }
}

/** 待机：无特征时的假采样（缓慢呼吸）。 */
export function idleStemSample(timeSec: number): StemVizSample {
  const byStem = {} as Record<StemId, StemFrameSample>
  for (let i = 0; i < STEM_IDS.length; i++) {
    const id = STEM_IDS[i]!
    const e = 0.08 + 0.06 * Math.sin(timeSec * 1.1 + i * 0.7)
    byStem[id] = {
      energy: e,
      bands: { low: e * 0.7, mid: e * 0.5, high: e * 0.3 },
      onset: 0,
    }
  }
  return {
    byStem,
    bpm: 96,
    beatPhase: (timeSec * 96) / 60 % 1,
    drumsOnset: 0,
  }
}

/** 测试/空态用：构造全零特征。 */
export function emptyStemVizFeatures(trackId: string, frameCount = 1): StemVizFeatures {
  const energy = emptyStemRecord()
  const low = emptyStemRecord()
  const mid = emptyStemRecord()
  const high = emptyStemRecord()
  const onset = emptyStemRecord()
  for (const id of STEM_IDS) {
    energy[id] = new Float32Array(frameCount)
    low[id] = new Float32Array(frameCount)
    mid[id] = new Float32Array(frameCount)
    high[id] = new Float32Array(frameCount)
    onset[id] = new Float32Array(frameCount)
  }
  return {
    trackId,
    sampleRate: 44100,
    hopSamples: STEM_VIZ_HOP,
    hopSec: STEM_VIZ_HOP / 44100,
    frameCount,
    durationSec: frameCount * (STEM_VIZ_HOP / 44100),
    tempo: undefined,
    energy,
    low,
    mid,
    high,
    onset,
  }
}

export { emptySample }
