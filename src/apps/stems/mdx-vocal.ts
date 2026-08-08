/**
 * MDX-NET 人声增强纯逻辑：Bluestein FFT / STFT-ISTFT / 切块 / WOLA 拼接。
 *
 * 与模型推理解耦，可独立单测。所有参数逐行核对 UVR 的
 * `separate.py`（demix）与 `lib_v5/tfc_tdf_v3.py`（STFT 类）：
 *   - STFT：n_fft=6144, hop=1024, hann periodic 窗, center=True（两侧各补 n_fft/2）
 *   - 模型输入 [batch, 4, 3072, 256]：4 通道 = [实L, 虚L, 实R, 虚R]，前 3 个频点清零
 *   - 切块：每块 1024×255=261120 采样，步长 (1−0.25)×块长，hanning 重叠相加，整曲一次归一
 *   - 输出：伴奏（instrumental）；人声 = 原曲 − 伴奏
 *
 * FFT 用 Bluestein 算法支持非 2 的幂的 n_fft=6144（M=16384 的 radix-2 FFT），
 * 每帧把左右声道打包进一次复数 FFT（Z = L + iR）同时算出两声道谱。
 */

/** 模型期望的采样率（MDX-NET 训练于 44.1kHz）。 */
export const MDX_TARGET_SAMPLE_RATE = 44100
export const MDX_N_FFT = 6144
export const MDX_HOP = 1024
/** 模型保留的频点数（n_fft/2+1=3073 中的前 3072，丢奈奎斯特点）。 */
export const MDX_DIM_F = 3072
export const MDX_DIM_T = 256
/** 每块采样数 = hop × (dim_t − 1) ≈ 5.92s @44.1kHz。 */
export const MDX_CHUNK = MDX_HOP * (MDX_DIM_T - 1)
/** STFT center=True 两侧补零长度。 */
export const MDX_TRIM = MDX_N_FFT / 2
/** 块内有效长度（去两侧 trim）。 */
export const MDX_GEN = MDX_CHUNK - 2 * MDX_TRIM
/** 相邻块步长（UVR 默认 overlap 0.25）。 */
export const MDX_STEP = Math.round((1 - 0.25) * MDX_CHUNK)
/** 单块模型输入的通道数（实/虚 × 左右）。 */
export const MDX_SPEC_CHANNELS = 4
export const MDX_SPEC_SIZE = MDX_SPEC_CHANNELS * MDX_DIM_F * MDX_DIM_T

/** torch.hann_window(periodic=True)：w[n] = 0.5(1 − cos(2πn/N))。 */
export function hannPeriodic(n: number): Float32Array {
  const win = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n))
  }
  return win
}

/** np.hanning（对称）：w[n] = 0.5(1 − cos(2πn/(N−1)))。 */
export function hannSymmetric(n: number): Float32Array {
  const win = new Float32Array(n)
  const denom = Math.max(1, n - 1)
  for (let i = 0; i < n; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom))
  }
  return win
}

/** 迭代 radix-2 复 FFT（就地，n 必须为 2 的幂）。 */
function fftRadix2(re: Float32Array, im: Float32Array, n: number): void {
  // 位反转
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]
      re[i] = re[j]
      re[j] = t
      t = im[i]
      im[i] = im[j]
      im[j] = t
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wRe = Math.cos(ang)
    const wIm = Math.sin(ang)
    const half = len >> 1
    for (let i = 0; i < n; i += len) {
      let curRe = 1
      let curIm = 0
      for (let k = 0; k < half; k++) {
        const uRe = re[i + k]
        const uIm = im[i + k]
        const vRe = re[i + k + half] * curRe - im[i + k + half] * curIm
        const vIm = re[i + k + half] * curIm + im[i + k + half] * curRe
        re[i + k] = uRe + vRe
        im[i + k] = uIm + vIm
        re[i + k + half] = uRe - vRe
        im[i + k + half] = uIm - vIm
        const nRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nRe
      }
    }
  }
}

/**
 * Bluestein 复 FFT：支持任意长度 n（内部用 M = 2^ceil(log2(2n−1)) 的 radix-2 FFT）。
 * 预计算 chirp 与 B 谱；forward/inverse 均为就地，输入长度 n。
 *
 * 公式（Wikipedia Bluestein's algorithm）：
 *   w[n] = exp(−iπn²/N)，X[k] = w[k]·Σ_n (x[n]·w[n])·w*[k−n]
 * 逆变换用「共轭 → 正变换 → 共轭 ÷ N」。
 */
export class BluesteinFFT {
  readonly n: number
  private readonly m: number
  private readonly wRe: Float32Array
  private readonly wIm: Float32Array
  private readonly bRe: Float32Array
  private readonly bIm: Float32Array
  private readonly tmpRe: Float32Array
  private readonly tmpIm: Float32Array

  constructor(n: number) {
    this.n = n
    // 线性卷积长度 ≥ 2n−1 的下一个 2 的幂
    let m = 1
    while (m < 2 * n - 1) m <<= 1
    this.m = m

    // chirp：w[j] = exp(−iπj²/n)，b[j] = w*[j] = exp(+iπj²/n)（偶对称）
    const wRe = new Float32Array(n)
    const wIm = new Float32Array(n)
    const bRe = new Float32Array(m)
    const bIm = new Float32Array(m)
    for (let j = 0; j < n; j++) {
      const ang = (-Math.PI * j * j) / n
      wRe[j] = Math.cos(ang)
      wIm[j] = Math.sin(ang)
      // b 的负半轴部分放在尾部：b[−j] = b[j]
      bRe[j] = wRe[j]
      bIm[j] = -wIm[j]
      if (j > 0) {
        bRe[m - j] = wRe[j]
        bIm[m - j] = -wIm[j]
      }
    }
    fftRadix2(bRe, bIm, m)
    this.wRe = wRe
    this.wIm = wIm
    this.bRe = bRe
    this.bIm = bIm
    this.tmpRe = new Float32Array(m)
    this.tmpIm = new Float32Array(m)
  }

  /** 就地正变换（re/im 长度 n）。 */
  forward(re: Float32Array, im: Float32Array): void {
    const { n, m, wRe, wIm, bRe, bIm, tmpRe, tmpIm } = this
    // a[j] = x[j]·w[j]，零填充到 m
    for (let j = 0; j < n; j++) {
      const xr = re[j]
      const xi = im[j]
      tmpRe[j] = xr * wRe[j] - xi * wIm[j]
      tmpIm[j] = xr * wIm[j] + xi * wRe[j]
    }
    for (let j = n; j < m; j++) {
      tmpRe[j] = 0
      tmpIm[j] = 0
    }
    fftRadix2(tmpRe, tmpIm, m) // FFT(A)
    // 乘 B 谱
    for (let j = 0; j < m; j++) {
      const ar = tmpRe[j]
      const ai = tmpIm[j]
      tmpRe[j] = ar * bRe[j] - ai * bIm[j]
      tmpIm[j] = ar * bIm[j] + ai * bRe[j]
    }
    // 逆卷积：IFFT(X) = conj(FFT(conj(X)))/M
    for (let j = 0; j < m; j++) tmpIm[j] = -tmpIm[j]
    fftRadix2(tmpRe, tmpIm, m)
    for (let j = 0; j < m; j++) {
      tmpRe[j] /= m
      tmpIm[j] = -tmpIm[j] / m
    }
    // X[j] = c[j]·w[j]
    for (let j = 0; j < n; j++) {
      const cr = tmpRe[j]
      const ci = tmpIm[j]
      re[j] = cr * wRe[j] - ci * wIm[j]
      im[j] = cr * wIm[j] + ci * wRe[j]
    }
  }

  /** 就地逆变换（re/im 长度 n）：x = conj(FFT(conj(X)))/N。 */
  inverse(re: Float32Array, im: Float32Array): void {
    const n = this.n
    for (let j = 0; j < n; j++) im[j] = -im[j]
    this.forward(re, im)
    for (let j = 0; j < n; j++) {
      re[j] /= n
      im[j] = -im[j] / n
    }
  }
}

/**
 * 单块 STFT：center=True 语义 —— 输入必须是**已垫零**的块
 * （长度 (MDX_CHUNK + 2×MDX_TRIM)，原块在中间），输出谱 [4, 3072, 256]。
 * out 布局 [c][f][t]，c = 0 实L, 1 虚L, 2 实R, 3 虚R；前 3 个频点保持为零（UVR 会清零）。
 * 用 Z = L + iR 打包一次 FFT 同时算两声道：
 *   X_L[k] = (Z[k] + conj(Z[m−k]))/2，X_R[k] = (Z[k] − conj(Z[m−k]))/(2i)
 */
export function mdxStftChunk(
  chunkPadded: Float32Array,
  out: Float32Array,
  fft: BluesteinFFT,
  win: Float32Array = hannPeriodic(MDX_N_FFT),
): void {
  const n = MDX_N_FFT
  const re = new Float32Array(n)
  const im = new Float32Array(n)
  for (let f = 0; f < MDX_DIM_T; f++) {
    const base = f * MDX_HOP
    for (let i = 0; i < n; i++) {
      const s = base + i
      const w = win[i]
      re[i] = chunkPadded[s * 2] * w
      im[i] = chunkPadded[s * 2 + 1] * w
    }
    fft.forward(re, im)
    // 提取 0..3071 频点（3072 为奈奎斯特点，丢弃；UVR 的 dim_f 截断）；
    // 前 3 个频点保持为零（UVR 在送模型前清零）
    for (let k = 3; k < MDX_DIM_F; k++) {
      const zr = re[k]
      const zi = im[k]
      // conj(Z[m−k])：k=0 时即 Z[0] 自身
      const nr = k === 0 ? zr : re[n - k]
      const ni = k === 0 ? -zi : -im[n - k]
      const tIdx = f
      // 实L / 虚L
      out[(0 * MDX_DIM_F + k) * MDX_DIM_T + tIdx] = (zr + nr) * 0.5
      out[(1 * MDX_DIM_F + k) * MDX_DIM_T + tIdx] = (zi + ni) * 0.5
      // 实R / 虚R：X_R = (Z − conj(Z[m−k]))/(2i) → re=(zi−ni)/2, im=(nr−zr)/2
      out[(2 * MDX_DIM_F + k) * MDX_DIM_T + tIdx] = (zi - ni) * 0.5
      out[(3 * MDX_DIM_F + k) * MDX_DIM_T + tIdx] = (nr - zr) * 0.5
    }
  }
}

/**
 * 单块 ISTFT：谱 [4, 3072, 256] → interleaved stereo 块（长度 = MDX_CHUNK + 2×MDX_TRIM）。
 * center=True 的语义：输出先含两侧 n_fft/2 补零，由调用方按需裁剪。
 * 与 torch.istft 一致：帧乘窗重叠相加后，除以窗² 的 OLA 包络（window envelope）。
 */
export function mdxIstftChunk(
  spec: Float32Array,
  out: Float32Array,
  fft: BluesteinFFT,
  win: Float32Array = hannPeriodic(MDX_N_FFT),
): void {
  const n = MDX_N_FFT
  const re = new Float32Array(n)
  const im = new Float32Array(n)
  out.fill(0)
  const totalFrames = MDX_CHUNK + 2 * MDX_TRIM
  const env = new Float32Array(totalFrames)
  for (let f = 0; f < MDX_DIM_T; f++) {
    re.fill(0)
    im.fill(0)
    // 组装双侧谱 Z = X_L + i·X_R；奈奎斯特点（3072）为 freq_pad 补零。
    // 注意 Z 是复数信号 L+iR 的谱，负频没有共轭对称：
    //   Z[m−k] = conj(X_L[k]) + i·conj(X_R[k])
    for (let k = 0; k < MDX_DIM_F; k++) {
      const lr = spec[(0 * MDX_DIM_F + k) * MDX_DIM_T + f]
      const li = spec[(1 * MDX_DIM_F + k) * MDX_DIM_T + f]
      const rr = spec[(2 * MDX_DIM_F + k) * MDX_DIM_T + f]
      const ri = spec[(3 * MDX_DIM_F + k) * MDX_DIM_T + f]
      re[k] = lr - ri
      im[k] = li + rr
      if (k > 0) {
        re[n - k] = lr + ri
        im[n - k] = rr - li
      }
    }
    fft.inverse(re, im)
    // 帧重叠相加（torch.istft 对每帧乘窗后 OLA，并累计窗² 包络）
    const base = f * MDX_HOP
    for (let i = 0; i < n; i++) {
      const idx = (base + i) * 2
      const w = win[i]
      out[idx] += re[i] * w
      out[idx + 1] += im[i] * w
      env[base + i] += w * w
    }
  }
  // 除以窗² 包络（torch.istft 的 y / window_envelop）；极边缘包络≈0 处保持原值（随后被裁剪）
  for (let s = 0; s < totalFrames; s++) {
    const e = env[s]
    if (e > 1e-11) {
      out[s * 2] /= e
      out[s * 2 + 1] /= e
    }
  }
}

/** 模型批量推理回调：输入/输出均为 [B, 4, 3072, 256] 连续 float32。 */
export type MdxRunBatch = (specBatch: Float32Array) => Float32Array | Promise<Float32Array>

export type MdxProgress = { done: number; total: number }

/**
 * 整曲伴奏分离（UVR demix 逐行复刻）：
 *  mixture = [trim 零] + mix + [pad 零]，按 step 切块、STFT→模型→ISTFT，
 *  输出乘 hanning 窗累积到 result/divider，最后整体归一、裁 trim、截回原长。
 * 返回 interleaved stereo 伴奏（44.1kHz，长度 = mix.length）。
 * 模型推理是异步的（onnxruntime），因此本函数为 async。
 */
export async function separateInstrumental(
  mix: Float32Array,
  runBatch: MdxRunBatch,
  batchSize = 4,
  onProgress?: (progress: MdxProgress) => void,
): Promise<Float32Array> {
  const frames = mix.length / 2
  const pad = MDX_GEN + MDX_TRIM - (frames % MDX_GEN)
  const total = MDX_TRIM + frames + pad
  const mixture = new Float32Array(total * 2)
  mixture.set(mix, MDX_TRIM * 2)

  const result = new Float32Array(total * 2)
  const divider = new Float32Array(total)
  const nChunks = Math.ceil(total / MDX_STEP)

  const fft = new BluesteinFFT(MDX_N_FFT)
  const stftWin = hannPeriodic(MDX_N_FFT)
  // center=True 语义：STFT 输入先补 n_fft/2。
  // torch.stft 默认 pad_mode='reflect'（UVR 未覆盖该参数）——补边是反射而非零。
  const chunkFull = new Float32Array(MDX_CHUNK * 2)
  const chunkPadded = new Float32Array((MDX_CHUNK + 2 * MDX_TRIM) * 2)
  const olaBuf = new Float32Array((MDX_CHUNK + 2 * MDX_TRIM) * 2)
  const specBatch = new Float32Array(batchSize * MDX_SPEC_SIZE)
  // 各块的实际长度（最后一块不足 MDX_CHUNK）；窗按实际长度对称 hann，与 UVR 一致
  const chunkLengths: number[] = []
  // 已满 batch 的块起始（帧）
  const batchStarts: number[] = []
  let chunksDone = 0

  const flushBatch = async () => {
    const b = batchStarts.length
    const out = await runBatch(specBatch.subarray(0, b * MDX_SPEC_SIZE))
    for (let i = 0; i < b; i++) {
      mdxIstftChunk(
        out.subarray(i * MDX_SPEC_SIZE, (i + 1) * MDX_SPEC_SIZE),
        olaBuf,
        fft,
        stftWin,
      )
      const start = batchStarts[i]
      const actual = chunkLengths[i]
      const win = hannSymmetric(actual)
      for (let s = 0; s < actual; s++) {
        const oi = (MDX_TRIM + s) * 2
        const w = win[s]
        result[(start + s) * 2] += olaBuf[oi] * w
        result[(start + s) * 2 + 1] += olaBuf[oi + 1] * w
        divider[start + s] += w
      }
    }
    batchStarts.length = 0
    chunkLengths.length = 0
    chunksDone += b
    onProgress?.({ done: chunksDone, total: nChunks })
  }

  for (let start = 0; start < total; start += MDX_STEP) {
    const end = Math.min(start + MDX_CHUNK, total)
    const actual = end - start
    // 完整块（不足时尾部补零，与 UVR 的 mix_part_ 一致）
    chunkFull.fill(0)
    for (let s = 0; s < actual; s++) {
      chunkFull[s * 2] = mixture[(start + s) * 2]
      chunkFull[s * 2 + 1] = mixture[(start + s) * 2 + 1]
    }
    // reflect 补边：P[j] = chunkFull[TRIM−j]（不含边缘样本，半采样反射），
    // 右侧 P[TRIM+CHUNK+j] = chunkFull[CHUNK−2−j]
    for (let j = 0; j < MDX_TRIM; j++) {
      const src = (MDX_TRIM - j) * 2
      chunkPadded[j * 2] = chunkFull[src]
      chunkPadded[j * 2 + 1] = chunkFull[src + 1]
    }
    chunkPadded.set(chunkFull, MDX_TRIM * 2)
    for (let j = 0; j < MDX_TRIM; j++) {
      const src = (MDX_CHUNK - 2 - j) * 2
      const dst = (MDX_TRIM + MDX_CHUNK + j) * 2
      chunkPadded[dst] = chunkFull[src]
      chunkPadded[dst + 1] = chunkFull[src + 1]
    }
    mdxStftChunk(chunkPadded, specBatch.subarray(batchStarts.length * MDX_SPEC_SIZE), fft, stftWin)
    batchStarts.push(start)
    chunkLengths.push(actual)
    if (batchStarts.length === batchSize || start + MDX_STEP >= total) {
      await flushBatch()
    }
  }

  // 整体归一（UVR：result / divider）
  for (let s = 0; s < total; s++) {
    const d = divider[s]
    if (d > 0) {
      result[s * 2] /= d
      result[s * 2 + 1] /= d
    }
  }
  // 裁 trim、截回原长（UVR：[:, :, trim:-trim] 后 [:mix.shape[-1]]）
  const out = new Float32Array(frames * 2)
  out.set(result.subarray(MDX_TRIM * 2, MDX_TRIM * 2 + frames * 2))
  return out
}

/** 人声 = 原曲 − 伴奏（interleaved stereo，长度一致）。 */
export function mixMinus(orig: Float32Array, instrumental: Float32Array): Float32Array {
  const vocals = new Float32Array(orig.length)
  for (let i = 0; i < orig.length; i++) {
    vocals[i] = orig[i] - instrumental[i]
  }
  return vocals
}
