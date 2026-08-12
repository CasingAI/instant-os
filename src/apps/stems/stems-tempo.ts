/**
 * 分段节拍检测纯逻辑：从分轨鼓轨 PCM 提取全曲分段 BPM。
 *
 * 思路（轻量启发式，无需 FFT）：
 *  1. 单声道混音 → RMS 包络（帧 1024 采样 / hop 512，≈11.6ms 分辨率）。
 *  2. Onset 强度 = 包络的正差分并轻度平滑——鼓点/重音处的能量突增。
 *  3. 滑动窗口（15s / hop 5s）内做定点滞后自相关，只在 60–200 BPM 对应的
 *     滞后范围内打分，取最高分对应的 BPM 为该窗口速度。
 *  4. 相邻窗口 BPM 相近（相对差 < 8%）合并成段；碎段（<6s）并入速度最接近的
 *     邻段；每段再用整段时长重新自相关精化速度。
 *
 * 与 stems-separator.ts 同风格：纯函数、无浏览器依赖，node 单测直跑。
 */

export type TempoSegment = {
  /** 段起点（秒） */
  startSec: number
  /** 段终点（秒，开区间） */
  endSec: number
  /** 段内 BPM */
  bpm: number
  /**
   * 段内第一拍相对段起点的偏移（秒，∈ [0, 拍间隔)）。
   * 检测输出必填；旧存档缺失时由载入端兜底 0。
   */
  phaseSec: number
}

export type TempoInfo = {
  /** 全曲主速度（按时长加权） */
  bpm: number
  segments: TempoSegment[]
}

/** 包络帧长（采样点）与 hop。 */
export const TEMPO_FRAME = 1024
export const TEMPO_HOP = 512

/** 检测的 BPM 范围。 */
export const TEMPO_MIN_BPM = 60
export const TEMPO_MAX_BPM = 200

/** 滑动窗口时长与步长（秒）。 */
export const TEMPO_WINDOW_SEC = 15
export const TEMPO_WINDOW_STEP_SEC = 5
/** 相邻窗口合并的 BPM 相对差阈值。 */
export const TEMPO_MERGE_RATIO = 0.08
/** 小于该时长的段并入邻段。 */
export const TEMPO_MIN_SEGMENT_SEC = 6
/** 自相关得分低于该值视为无节拍（静音/纯噪声）。 */
export const TEMPO_MIN_SCORE = 0.05

/** 分轨鼓轨的采样率（模型固定 44.1kHz，与 stems-separator 一致）。 */
export const TEMPO_SAMPLE_RATE = 44100

/**
 * interleaved stereo PCM → 单声道（左右平均）RMS 包络。
 * 返回每个包络帧的采样起始点（hop 对齐）。
 */
function buildRmsEnvelope(data: Float32Array): { envelope: Float32Array; hopSamples: number } {
  const totalFrames = Math.floor(data.length / 2)
  const count = Math.max(1, Math.ceil(totalFrames / TEMPO_HOP))
  const envelope = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const start = i * TEMPO_HOP
    const end = Math.min(totalFrames, start + TEMPO_FRAME)
    let sum = 0
    for (let f = start; f < end; f++) {
      const l = data[f * 2]
      const r = data[f * 2 + 1]
      const m = (l + r) * 0.5
      sum += m * m
    }
    const n = Math.max(1, end - start)
    envelope[i] = Math.sqrt(sum / n)
  }
  return { envelope, hopSamples: TEMPO_HOP }
}

/** onset 强度：包络正差分 + 轻度一阶平滑（去毛刺）。 */
function buildOnset(envelope: Float32Array): Float32Array {
  const n = envelope.length
  const onset = new Float32Array(n)
  let prev = 0
  for (let i = 0; i < n; i++) {
    const diff = Math.max(0, envelope[i] - prev)
    prev = envelope[i]
    onset[i] = i > 0 ? onset[i - 1] * 0.7 + diff * 0.3 : diff
  }
  return onset
}

/**
 * 定点滞后自相关打分：对 onset 序列在滞后 [lagLo, lagHi] 内计算
 * Σ onset[t]·onset[t−lag]（归一化），返回最高分滞后（帧）的二次插值精化值。
 */
function autocorrelatePeakLag(
  onset: Float32Array,
  startIdx: number,
  endIdx: number,
  hopSamples: number,
  sampleRate: number,
): number | undefined {
  const framesPerSec = sampleRate / hopSamples
  const loLag = Math.max(1, Math.round(framesPerSec * 60 / TEMPO_MAX_BPM))
  const hiLag = Math.round(framesPerSec * 60 / TEMPO_MIN_BPM)
  if (loLag > hiLag) return undefined

  const len = endIdx - startIdx
  if (len < hiLag + 1) return undefined

  let energy = 0
  for (let t = startIdx; t < endIdx; t++) energy += onset[t] * onset[t]
  energy = Math.max(1e-9, energy)

  const scores = new Float32Array(hiLag - loLag + 1)
  let best = -Infinity
  let bestLag = -1
  for (let lag = loLag; lag <= hiLag; lag++) {
    let acc = 0
    for (let t = startIdx + lag; t < endIdx; t++) acc += onset[t] * onset[t - lag]
    const score = acc / energy
    scores[lag - loLag] = score
    if (score > best) {
      best = score
      bestLag = lag
    }
  }
  if (bestLag < 0 || best < TEMPO_MIN_SCORE) return undefined

  // 二次插值精化峰位置（提高 BPM 分辨率）
  const i = bestLag - loLag
  const y1 = i > 0 ? scores[i - 1] : scores[i]
  const y2 = scores[i]
  const y3 = i < scores.length - 1 ? scores[i + 1] : scores[i]
  const denom = y1 - 2 * y2 + y3
  let refine = 0
  if (Math.abs(denom) > 1e-12) {
    refine = Math.max(-0.5, Math.min(0.5, 0.5 * (y1 - y3) / denom))
  }
  return bestLag + refine
}

function lagToBpm(lagFrames: number, hopSamples: number, sampleRate: number): number {
  const periodSec = (lagFrames * hopSamples) / sampleRate
  return periodSec > 0 ? 60 / periodSec : 0
}

/** 秒 → onset 数组索引（onsetDurationSec 为数组实际时长）。 */
function secToIdx(sec: number, onsetLength: number, onsetDurationSec: number): number {
  return Math.max(0, Math.min(onsetLength, Math.floor((sec / onsetDurationSec) * onsetLength)))
}

/**
 * 联合精化：对一段做倍频消歧 + 相位对齐。
 *
 * 候选 BPM 取 {b/2, b, 2b} ∩ [60, 200]（b 来自整段自相关精化值）。自相关本身
 * 对滞后 P 与 2P 给同样高分（倍频混叠根因）；若只按「拍点能量均值」打分，半速
 * 的拍点恰好全落在真实鼓点上（只是漏掉一半鼓点），均值与完整速度持平，消歧无效。
 * 因此改按「拍点能量 − 反相点能量」的均值判别：完整速度下拍点踩强拍、反相点落
 * 在两拍之间（弱拍/空隙），差值大；半速下反相点恰好是漏掉的真实鼓点，差值趋零。
 *
 * 对每个候选，在 [0, interval) 内以 ≤10ms 网格扫描相位 φ（段内第一拍偏移），
 * 拍点 = segStart + φ + k*interval，返回得分最高的 { bpm, phaseSec } 组合。
 */
function refineBpmPhase(
  onset: Float32Array,
  onsetDurationSec: number,
  segStart: number,
  segEnd: number,
  candidateBpm: number,
): { bpm: number; phaseSec: number; score: number } {
  const candidates: number[] = []
  for (const mult of [0.5, 1, 2]) {
    const bpm = candidateBpm * mult
    if (bpm >= TEMPO_MIN_BPM && bpm <= TEMPO_MAX_BPM && !candidates.includes(bpm)) {
      candidates.push(bpm)
    }
  }
  const idxAt = (sec: number): number =>
    Math.min(onset.length - 1, Math.max(0, Math.floor((sec / onsetDurationSec) * onset.length)))
  let best: { bpm: number; phaseSec: number; score: number } = {
    bpm: candidateBpm,
    phaseSec: 0,
    score: -Infinity,
  }
  const phaseStepSec = 0.01
  for (const bpm of candidates) {
    const interval = 60 / bpm
    const halfInterval = interval / 2
    const phaseSteps = Math.max(1, Math.ceil(interval / phaseStepSec))
    for (let p = 0; p < phaseSteps; p++) {
      const phaseSec = (p / phaseSteps) * interval
      let acc = 0
      let antiAcc = 0
      let beats = 0
      for (let t = segStart + phaseSec; t < segEnd; t += interval) {
        acc += onset[idxAt(t)]
        antiAcc += onset[idxAt(t + halfInterval)]
        beats += 1
      }
      const score = beats > 0 ? (acc - antiAcc) / beats : -Infinity
      if (score > best.score) {
        best = { bpm, phaseSec, score }
      }
    }
  }
  return best
}

/**
 * 合并相邻同速段（BPM 相对差 < TEMPO_MERGE_RATIO）：前段终点延伸到后段，
 * BPM 取两者的 3:7 加权混合（与既有合并逻辑一致）。
 */
function mergeAdjacentSegments(segs: TempoSegment[]): void {
  let j = 1
  while (j < segs.length) {
    const prev = segs[j - 1]
    const cur = segs[j]
    if (Math.abs(prev.bpm - cur.bpm) / prev.bpm < TEMPO_MERGE_RATIO) {
      prev.endSec = cur.endSec
      prev.bpm = Math.round(prev.bpm + (cur.bpm - prev.bpm) * 0.3)
      segs.splice(j, 1)
    } else {
      j += 1
    }
  }
}

/**
 * 检测全曲分段 BPM。data 为 interleaved stereo Float32（44.1kHz，鼓轨）。
 * 输入过短（<2 秒）或无可测节拍时返回 null。
 */
export function detectTempo(
  data: Float32Array,
  sampleRate: number = TEMPO_SAMPLE_RATE,
): TempoInfo | null {
  const totalFrames = Math.floor(data.length / 2)
  const durationSec = totalFrames / sampleRate
  if (totalFrames < sampleRate * 2) return null

  const { envelope, hopSamples } = buildRmsEnvelope(data)
  const onset = buildOnset(envelope)
  const onsetDurationSec = (onset.length * hopSamples) / sampleRate
  const windowSec = Math.min(TEMPO_WINDOW_SEC, durationSec)
  const stepSec = Math.min(TEMPO_WINDOW_STEP_SEC, windowSec)

  // 1. 滑动窗口 BPM 曲线
  const windows: { startSec: number; bpm: number }[] = []
  for (let s = 0; s + windowSec <= durationSec + 1e-6; s += stepSec) {
    const lag = autocorrelatePeakLag(
      onset,
      secToIdx(s, onset.length, onsetDurationSec),
      secToIdx(s + windowSec, onset.length, onsetDurationSec),
      hopSamples,
      sampleRate,
    )
    if (lag !== undefined) {
      windows.push({ startSec: s, bpm: lagToBpm(lag, hopSamples, sampleRate) })
    }
  }
  if (windows.length === 0) return null

  // 2. 相邻窗口 BPM 相近 → 合并成段
  const segs: TempoSegment[] = []
  for (let i = 0; i < windows.length; i++) {
    const start = windows[i].startSec
    const end = i < windows.length - 1 ? windows[i + 1].startSec : durationSec
    const last = segs[segs.length - 1]
    if (last && Math.abs(last.bpm - windows[i].bpm) / last.bpm < TEMPO_MERGE_RATIO) {
      last.endSec = end
      last.bpm = Math.round(last.bpm + (windows[i].bpm - last.bpm) * 0.3)
    } else {
      segs.push({ startSec: start, endSec: end, bpm: windows[i].bpm, phaseSec: 0 })
    }
  }
  segs[0].startSec = 0

  // 3. 碎段（< TEMPO_MIN_SEGMENT_SEC）并入速度最接近的邻段
  let i = 1
  while (i < segs.length) {
    const seg = segs[i]
    if (seg.endSec - seg.startSec >= TEMPO_MIN_SEGMENT_SEC) {
      i += 1
      continue
    }
    const prev = segs[i - 1]
    const next = segs[i + 1]
    const toPrev = prev ? Math.abs(prev.bpm - seg.bpm) : Infinity
    const toNext = next ? Math.abs(next.bpm - seg.bpm) : Infinity
    if (next && toNext < toPrev) {
      // 并入下一段：本段起点保留，终点取下一段的终点，速度取均值
      seg.endSec = next.endSec
      seg.bpm = Math.round((seg.bpm + next.bpm) / 2)
      segs.splice(i + 1, 1)
    } else if (prev) {
      // 并入上一段
      prev.endSec = seg.endSec
      segs.splice(i, 1)
    } else {
      // 理论不可达：首段不可能成为碎段合并目标
      i += 1
    }
  }

  // 4. 段内精化 BPM（用整段长度重新自相关）
  for (const seg of segs) {
    const lag = autocorrelatePeakLag(
      onset,
      secToIdx(seg.startSec, onset.length, onsetDurationSec),
      secToIdx(seg.endSec, onset.length, onsetDurationSec),
      hopSamples,
      sampleRate,
    )
    const refined = lag !== undefined ? lagToBpm(lag, hopSamples, sampleRate) : 0
    if (refined > 0) seg.bpm = Math.round(refined)
  }

  // 5. 每段联合精化：倍频消歧（{b/2, b, 2b}）+ 相位对齐（≤10ms 相位网格）。
  //    同一段内窗口 BPM 一致（步骤 2 已按 8% 阈值合并），消歧结果不会把段再切碎。
  for (const seg of segs) {
    const refined = refineBpmPhase(onset, onsetDurationSec, seg.startSec, seg.endSec, seg.bpm)
    seg.bpm = Math.round(refined.bpm)
    seg.phaseSec = refined.phaseSec
  }

  // 6. 联合精化后再合并相邻同速段：步骤 5 的消歧会让相邻段收敛到同一真实 BPM
  //    （如都消歧回 138，步骤 2 却按窗口原始 69↔138 切成了两段），此时应合并；
  //    合并后段的 BPM 是加权混合值，重跑一次联合精化补回相位。
  mergeAdjacentSegments(segs)
  for (const seg of segs) {
    const refined = refineBpmPhase(onset, onsetDurationSec, seg.startSec, seg.endSec, seg.bpm)
    seg.bpm = Math.round(refined.bpm)
    seg.phaseSec = refined.phaseSec
  }

  // 7. 全曲主速度 = 按时长加权
  let total = 0
  let weightSum = 0
  for (const seg of segs) {
    const w = seg.endSec - seg.startSec
    total += seg.bpm * w
    weightSum += w
  }
  const overall = weightSum > 0 ? Math.round(total / weightSum) : (segs[0]?.bpm ?? 0)

  return {
    bpm: overall,
    segments: segs.map((s) => ({
      startSec: s.startSec,
      endSec: s.endSec,
      bpm: s.bpm,
      phaseSec: s.phaseSec,
    })),
  }
}
