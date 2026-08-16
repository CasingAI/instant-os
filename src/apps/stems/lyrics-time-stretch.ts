/**
 * 保调时间伸缩（time-stretch）纯函数：供「放慢重识别」在识别前把快嘴音频放慢。
 *
 * 输入/输出均为 interleaved stereo float32 PCM（与 vocalsAudio 和识别 worker
 * 协议一致；worker 内部会自行重采样到 16k mono）。
 *
 * rate < 1 放慢：输出时长 ≈ 输入时长 / rate，音高不变（保调）。
 * rate 夹取 [0.4, 0.95]，过伸（<0.4）会把爆破音/摩擦音拉变形，反而伤害识别。
 *
 * 两种算法：
 *  - wsola：时域波形相似度重叠相加。对语音最友好、无频域伪影；
 *    立体声两声道共用同一锚点序列，保持时间轴与声场一致。
 *  - phase-vocoder：频域相位推进。音乐性更强，但瞬态会略微模糊，
 *    爆破音可能发虚；左右声道独立处理。
 *
 * 纯函数、无浏览器依赖，可 node --experimental-strip-types 直接单测。
 */

import { isPunctuationOnly } from '../align/align-lrc.ts'

export type StretchMethod = 'wsola' | 'phase-vocoder'

/** 放慢速率的允许范围（rate < 1 为放慢；1 = 恒等，用于对照与测试）。 */
export const STRETCH_MIN_RATE = 0.4
export const STRETCH_MAX_RATE = 1.0

/** 夹取放慢速率到允许范围；非法输入回退 0.7。 */
export function clampStretchRate(rate: number): number {
  if (!Number.isFinite(rate)) return 0.7
  return Math.min(STRETCH_MAX_RATE, Math.max(STRETCH_MIN_RATE, rate))
}

/** Hann 窗（size > 1，首尾为 0）。 */
function hannWindow(size: number): Float32Array {
  const win = new Float32Array(size)
  const denom = size - 1
  for (let i = 0; i < size; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / denom)
  }
  return win
}

/**
 * 主入口：对 interleaved stereo PCM 做保调放慢。
 * 输出长度 = round(输入帧数 / rate) × 2。
 */
export function timeStretchAudio(
  audio: Float32Array,
  sampleRate: number,
  rate: number,
  method: StretchMethod,
): Float32Array {
  const r = clampStretchRate(rate)
  const frames = Math.floor(audio.length / 2)
  if (frames === 0) return new Float32Array(0)
  const outLen = Math.round(frames / r)
  if (outLen === 0) return new Float32Array(0)

  // 解交织为左右声道
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    left[i] = audio[i * 2]
    right[i] = audio[i * 2 + 1]
  }

  let outL: Float32Array
  let outR: Float32Array
  if (method === 'wsola') {
    // 帧长 30ms（取奇数为 Hann 窗保持对称）、分析 hop 10ms、合成 hop = 分析 hop / rate
    const w = Math.max(3, Math.round(sampleRate * 0.03) | 1)
    const ss = Math.max(1, Math.round(sampleRate * 0.01))
    const sa = ss / r
    // 锚点搜索窗：±2.5ms，步进 2 采样点（行窗口通常 3–20s，需控制互相关开销）
    const maxShift = Math.max(2, Math.round(sampleRate * 0.0025))
    // 两声道共用左声道算出的锚点序列，保证左右时间轴一致
    const anchors = wsolaAnchors(left, w, ss, sa, maxShift)
    outL = wsolaSynthesize(left, anchors, w, sa, outLen)
    outR = wsolaSynthesize(right, anchors, w, sa, outLen)
  } else {
    outL = phaseVocoderMono(left, r)
    outR = phaseVocoderMono(right, r)
  }

  const out = new Float32Array(outLen * 2)
  for (let i = 0; i < outLen; i++) {
    out[i * 2] = outL[i]
    out[i * 2 + 1] = outR[i]
  }
  return out
}

// —— WSOLA（时域） ——

/**
 * 计算输入锚点序列：首帧锚点 0，之后理想锚点 = 上一锚点 + 分析 hop，
 * 在 ±maxShift 内按步进搜索「候选帧开头 vs 上一帧在输出重叠区的尾部」
 * 波形最相似（归一化互相关最高）的位置——保证重叠相加处波形连续、音高不变。
 */
function wsolaAnchors(
  x: Float32Array,
  w: number,
  ss: number,
  sa: number,
  maxShift: number,
): number[] {
  const n = x.length
  const anchors: number[] = [0]
  const step = 2
  // 相邻输出帧的重叠量（样本）：上一帧尾部对应输出中与本帧重叠的部分
  const overlap = Math.max(1, Math.round(w - sa))
  const refStartOfs = Math.round(sa)
  let a = 0
  while (a + ss + maxShift + w <= n) {
    const ideal = a + ss
    const refStart = a + refStartOfs
    let best = ideal
    let bestScore = -Infinity
    for (let cand = ideal - maxShift; cand <= ideal + maxShift; cand += step) {
      const score = normalizedCrossCorrelation(x, refStart, cand, overlap)
      if (score > bestScore) {
        bestScore = score
        best = cand
      }
    }
    anchors.push(best)
    a = best
  }
  return anchors
}

/** 两窗口的归一化互相关（分母加小量防除零）。 */
function normalizedCrossCorrelation(x: Float32Array, a: number, b: number, w: number): number {
  let dot = 0
  let ea = 0
  let eb = 0
  for (let i = 0; i < w; i++) {
    const va = x[a + i]
    const vb = x[b + i]
    dot += va * vb
    ea += va * va
    eb += vb * vb
  }
  const denom = Math.sqrt(ea * eb)
  return denom > 1e-12 ? dot / denom : 0
}

/**
 * 按锚点序列把帧重叠相加到输出：分析加窗后合成再加同窗（窗²叠加），
 * 除以窗²累积权重归一化——单帧覆盖区与多帧重叠区都精确重建，不放大。
 * 输出长度固定 outLen；合成位置 = j × sa（浮点，落位取整）。
 */
function wsolaSynthesize(
  x: Float32Array,
  anchors: number[],
  w: number,
  sa: number,
  outLen: number,
): Float32Array {
  const win = hannWindow(w)
  const buf = new Float32Array(outLen + w)
  const acc = new Float32Array(outLen + w)
  let outPos = 0
  for (let j = 0; j < anchors.length; j++) {
    const a = anchors[j]
    const o = Math.round(outPos)
    for (let i = 0; i < w && o + i < outLen; i++) {
      const wi = win[i]
      const w2 = wi * wi
      buf[o + i] += x[a + i] * w2
      acc[o + i] += w2
    }
    outPos += sa
    if (outPos >= outLen) break
  }
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const av = acc[i]
    out[i] = av > 1e-3 ? buf[i] / av : 0
  }
  return out
}

// —— Phase Vocoder（频域） ——

/** radix-2 复数 FFT（就地），n 必须为 2 的幂。 */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
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
        const nr = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nr
      }
    }
  }
}

/** 逆 FFT（就地）。 */
function ifft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 0; i < n; i++) im[i] = -im[i]
  fft(re, im)
  for (let i = 0; i < n; i++) {
    re[i] /= n
    im[i] = -im[i] / n
  }
}

/**
 * 单声道相位声码器：STFT → 逐 bin 解卷绕相位差得瞬时频率 →
 * 按合成 hop 累积相位 → 幅度不变逆变换 → 重叠相加 + 窗²归一化。
 */
function phaseVocoderMono(x: Float32Array, rate: number): Float32Array {
  const n = 2048
  const hopA = 512
  const hopS = hopA / rate
  const half = n >> 1
  const win = hannWindow(n)
  const outLen = Math.round(x.length / rate)
  const buf = new Float32Array(outLen + n)
  const acc = new Float32Array(outLen + n)

  const re = new Float64Array(n)
  const im = new Float64Array(n)
  const synthRe = new Float64Array(n)
  const synthIm = new Float64Array(n)
  const prevPhase = new Float64Array(half)
  const phaseAcc = new Float64Array(half)

  let pos = 0
  let outPos = 0
  let first = true
  while (pos + n <= x.length && outPos < outLen) {
    for (let k = 0; k < n; k++) {
      re[k] = x[pos + k] * win[k]
      im[k] = 0
    }
    fft(re, im)

    // 相位推进：bin 1..half-1；DC/Nyquist 为实值 bin，直接复制幅度与相位
    synthRe[0] = re[0]
    synthIm[0] = 0
    synthRe[half] = re[half]
    synthIm[half] = 0
    for (let k = 1; k < half; k++) {
      const mag = Math.hypot(re[k], im[k])
      const phase = Math.atan2(im[k], re[k])
      if (first) {
        phaseAcc[k] = phase
      } else {
        // 期望相位增量（bin 中心角频率 × 分析 hop），解卷绕到 (-π, π]
        const omega = (2 * Math.PI * k * hopA) / n
        let delta = phase - prevPhase[k] - omega
        delta -= Math.round(delta / (2 * Math.PI)) * (2 * Math.PI)
        // 瞬时频率（rad/样本）= (omega + delta) / hopA，按合成 hop 累积相位
        phaseAcc[k] += (omega + delta) * (hopS / hopA)
      }
      synthRe[k] = mag * Math.cos(phaseAcc[k])
      synthIm[k] = mag * Math.sin(phaseAcc[k])
      prevPhase[k] = phase
    }
    // 负频率 bin = 正频率共轭（实数信号频谱共轭对称）；不填会丢一半能量且残留旧帧时域值
    for (let k = 1; k < half; k++) {
      synthRe[n - k] = synthRe[k]
      synthIm[n - k] = -synthIm[k]
    }
    first = false

    ifft(synthRe, synthIm)
    // 合成位置取整后再索引 buf/acc：TypedArray 对非整数索引赋值会静默丢弃
    const o = Math.round(outPos)
    for (let k = 0; k < n && o + k < outLen; k++) {
      const wk = win[k]
      buf[o + k] += synthRe[k] * wk
      acc[o + k] += wk * wk
    }
    pos += hopA
    outPos += hopS
  }

  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const av = acc[i]
    out[i] = av > 1e-3 ? buf[i] / av : 0
  }
  return out
}

// —— 自主放慢方案推荐（先分析当前行窗口，再决定怎么放慢） ——

/** 目标语速（字/秒）：ASR 训练分布内偏快的值，快嘴行放慢到接近它再识别。 */
export const STRETCH_TARGET_SPEECH_RATE = 5
/** 归一化谱通量阈值：高于它视为瞬态密集（爆破/摩擦音多），WSOLA 优先。 */
export const STRETCH_FLUX_THRESHOLD = 0.05
/** 过零率阈值：高于它视为清辅音密集，WSOLA 优先。 */
export const STRETCH_ZCR_THRESHOLD = 0.1

/** 自主放慢方案：由 planStretchParams 对当前行窗口分析得出。 */
export type StretchPlan = {
  /** 目标放慢速率（1 = 原速不拉伸，直接识别） */
  rate: number
  /** 算法推荐排序：首位为最可能保真语音的算法 */
  methods: [StretchMethod, StretchMethod]
}

/**
 * 分析行文本/行时长 + 行窗口音频，自主确定最优放慢速率与算法排序。
 *  - rate：当前语速（去标点字数 / 行时长）与目标语速之比反推，钳到合法范围；
 *    语速正常（≤ 目标）时为 1，即不拉伸直接识别。
 *  - methods：用 mono left 的短时谱通量 + 过零率估计瞬态密度；
 *    瞬态密集（快嘴的爆破/摩擦音）WSOLA 优先，长音旋律主导时 PV 优先。
 */
export function planStretchParams(
  lineText: string,
  spanSec: number,
  slice: Float32Array,
  sampleRate: number,
): StretchPlan {
  const contentChars = [...lineText].filter((c) => !isPunctuationOnly(c)).length
  const speechRate = spanSec > 0 && contentChars > 0 ? contentChars / spanSec : 0
  const rate = clampStretchRate(speechRate > 0 ? STRETCH_TARGET_SPEECH_RATE / speechRate : 1)
  const methods = pickStretchMethods(slice, sampleRate)
  return { rate, methods }
}

/** 根据瞬态密度排序算法：返回 [优先, 次选]；样本太少时默认 WSOLA 优先。 */
function pickStretchMethods(
  slice: Float32Array,
  sampleRate: number,
): [StretchMethod, StretchMethod] {
  const frames = Math.floor(slice.length / 2)
  if (frames < 512) return ['wsola', 'phase-vocoder']
  const left = new Float32Array(frames)
  for (let i = 0; i < frames; i++) left[i] = slice[i * 2]
  const { flux, zcr } = transientFeatures(left, sampleRate)
  const wsolaFirst = flux >= STRETCH_FLUX_THRESHOLD || zcr >= STRETCH_ZCR_THRESHOLD
  return wsolaFirst ? ['wsola', 'phase-vocoder'] : ['phase-vocoder', 'wsola']
}

/**
 * 瞬态特征（仅左声道）：归一化谱通量（相邻帧幅度谱正变化 / 帧能量）与过零率。
 * 行窗口量级全部帧跑一遍开销可忽略；帧长按采样率选 2 的幂（FFT 要求）。
 */
function transientFeatures(x: Float32Array, sampleRate: number): { flux: number; zcr: number } {
  const n = sampleRate >= 32000 ? 512 : 256
  const hop = n >> 1
  const half = n >> 1
  const win = hannWindow(n)
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  const mag = new Float64Array(half + 1)
  const prevMag = new Float64Array(half + 1)
  let hasPrev = false
  let fluxAcc = 0
  let fluxCount = 0
  let zcAcc = 0
  let zcFrames = 0
  for (let pos = 0; pos + n <= x.length; pos += hop) {
    let signChanges = 0
    for (let i = 1; i < n; i++) {
      if ((x[pos + i] >= 0) !== (x[pos + i - 1] >= 0)) signChanges += 1
    }
    zcAcc += signChanges / n
    zcFrames += 1

    for (let k = 0; k < n; k++) {
      re[k] = x[pos + k] * win[k]
      im[k] = 0
    }
    fft(re, im)
    for (let k = 0; k <= half; k++) mag[k] = Math.hypot(re[k], im[k])
    if (hasPrev) {
      let flux = 0
      let energy = 0
      for (let k = 0; k <= half; k++) {
        if (mag[k] > prevMag[k]) flux += mag[k] - prevMag[k]
        energy += mag[k]
      }
      fluxAcc += flux / (energy + 1e-12)
      fluxCount += 1
    }
    prevMag.set(mag)
    hasPrev = true
  }
  return {
    flux: fluxCount > 0 ? fluxAcc / fluxCount : 0,
    zcr: zcFrames > 0 ? zcAcc / zcFrames : 0,
  }
}
