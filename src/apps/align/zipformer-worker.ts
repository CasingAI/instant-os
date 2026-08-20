/// <reference lib="webworker" />

/**
 * Zipformer-CTC 识别 / 歌词强制对齐 worker（onnxruntime-web 直跑 sherpa-onnx 模型）。
 *
 * 两个模型：
 *  - zh（zipformer-ctc-zh）：中文，字节 BPE 词表 → 识别（recognize）与中文行强制对齐
 *  - en（zipformer-ctc-en）：英文，全大写字符级 BPE 词表 → 英文行强制对齐
 *
 * recognize：stereo PCM → 重采样 16k mono → Kaldi fbank80 → ONNX 前向 →
 *   CTC greedy 解码 → tokens.txt 查表 → 每 token 时间戳（subsampling 4 × 10ms = 0.04s/帧）。
 *
 * align：对每一行歌词，按行时间窗切音频 → 对应语言模型前向取 logits →
 *   行级 CTC Viterbi（歌词 token 序列 vs 帧后验）→ 词/字单元时间戳。
 *   不依赖识别文本，行内无法编码/未激活的单元用相邻单元插值兜底。
 *
 * 被 ai-inference-service 统一调度（换模型自动卸载旧 worker）。
 */

import {
  fetchModelAsset,
  fetchModelWithCache,
  ZIPFORMER_EN_MODEL_URL,
  ZIPFORMER_EN_TOKENS_URL,
  ZIPFORMER_MODEL_URL,
  ZIPFORMER_TOKENS_URL,
} from '../../os/model-cache.ts'
import { ort, setupOrtWasm } from '../../os/ort-wasm-loader.ts'
import {
  resampleToMono16k,
  PHONEME_TARGET_SAMPLE_RATE,
} from '../stems/phoneme-types.ts'
import { computeKaldiFbank } from './kaldi-fbank.ts'
import { sliceAudioOverlapped } from './align-chunking.ts'
import { decodeByteBpe } from './bbpe-decode.ts'
import { buildVocab, encodeLyricsLine } from './lyrics-bpe-encode.ts'
import { ctcForcedAlignLine, type CtcAlignResult } from './ctc-forced-align.ts'
import type { EncodedLine } from './lyrics-bpe-encode.ts'

export type ZipformerProvider = 'webgpu' | 'wasm'

/** 识别结果：识别出的 token 段（含起始/结束时间，秒） */
export type ZipformerSegment = {
  symbol: string
  start: number
  end: number
}

/** 强制对齐：一行歌词的对齐单元（词/字，秒）；confident=false 表示该词对齐失败（插值兜底） */
export type ZipformerAlignUnit = {
  text: string
  start: number
  end: number
  /** false：无真实声学证据，时间为插值兜底 */
  confident?: boolean
}

/** 强制对齐：一行歌词的结果（与 lyricsLines 一一对应） */
export type ZipformerAlignLine = {
  units: ZipformerAlignUnit[]
}

export type ZipformerProgress =
  | { kind: 'model-loading' }
  | { kind: 'model-loaded'; provider: ZipformerProvider }
  | { kind: 'progress'; chunk: number; total: number }
  | {
      kind: 'done'
      segments: ZipformerSegment[]
      /** 识别文本（tokens 去 ▁ 拼接） */
      text: string
      sampleRate: number
    }
  | { kind: 'align-done'; lines: ZipformerAlignLine[] }
  | { kind: 'error'; message: string }

export type ZipformerRequest = {
  type: 'recognize'
  /** PCM 音频（interleaved stereo float32，范围 -1..1，来自人声轨） */
  audio: Float32Array
  /** 输入音频采样率（通常 44100） */
  sampleRate: number
}

/** 强制对齐请求：按行对齐，不需要识别文本 */
export type ZipformerAlignRequest = {
  type: 'align'
  /** PCM 音频（interleaved stereo float32，范围 -1..1，来自人声轨） */
  audio: Float32Array
  /** 输入音频采样率（通常 44100） */
  sampleRate: number
  /** 清洗后的歌词行（与 lineTimesMs 一一对应） */
  lyricsLines: string[]
  /** 行时间戳（毫秒），长度 = lyricsLines.length + 1（末项 = 末行行尾） */
  lineTimesMs: number[]
}

type LoadedTokens = { tokens: string[]; blankId: number }

const sessions = new Map<string, { session: ort.InferenceSession; provider: ZipformerProvider }>()
const tokenLists = new Map<string, LoadedTokens>()

function postProgress(progress: ZipformerProgress): void {
  ;(self as unknown as Worker).postMessage(progress)
}

/** 读 tokens.txt：每行 `token id`，id 即模型输出类别下标。按 URL 缓存。 */
async function loadTokens(url: string): Promise<LoadedTokens> {
  const cached = tokenLists.get(url)
  if (cached) return cached
  const response = await fetchModelAsset(url)
  if (!response.ok) throw new Error(`tokens.txt 加载失败：${response.status}`)
  const text = await response.text()
  const byId = new Map<number, string>()
  let blank = -1
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 2) continue
    const id = Number(parts[1])
    if (!Number.isFinite(id)) continue
    byId.set(id, parts[0])
    if (parts[0] === '<blk>' || parts[0] === '<blank>' || parts[0] === '<eps>') {
      blank = id
    }
  }
  let maxId = 0
  for (const id of byId.keys()) maxId = Math.max(maxId, id)
  const tokens = Array.from({ length: maxId + 1 }, (_, i) => byId.get(i) ?? '')
  const result: LoadedTokens = { tokens, blankId: blank >= 0 ? blank : 0 }
  tokenLists.set(url, result)
  return result
}

/** 加载（并缓存）指定 URL 的 onnx 模型 session。 */
async function loadSessionByUrl(modelUrl: string): Promise<{ session: ort.InferenceSession; provider: ZipformerProvider }> {
  const cached = sessions.get(modelUrl)
  if (cached) return cached

  postProgress({ kind: 'model-loading' })

  await setupOrtWasm()
  const response = await fetchModelWithCache(modelUrl)
  const arrayBuffer = await response.arrayBuffer()

  let session: ort.InferenceSession | undefined
  let provider: ZipformerProvider = 'wasm'
  const gpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator
  if (gpuAvailable) {
    try {
      session = await ort.InferenceSession.create(arrayBuffer, {
        executionProviders: ['webgpu'],
      })
      provider = 'webgpu'
    } catch {
      // WebGPU 不可用 → 回退 WASM
    }
  }

  if (!session) {
    session = await ort.InferenceSession.create(arrayBuffer, {
      executionProviders: ['wasm'],
    })
  }

  const entry = { session, provider }
  sessions.set(modelUrl, entry)
  postProgress({ kind: 'model-loaded', provider })
  return entry
}

/** 一次 ONNX 前向：fbank 特征 → logits（帧 × vocab）。 */
async function runForward(
  session: ort.InferenceSession,
  feats: Float32Array,
  frames: number,
): Promise<{ logits: Float32Array; vocabSize: number; outFrames: number }> {
  const inputName = session.inputNames[0]
  const lengthName = session.inputNames[1]
  const outputName = session.outputNames[0]
  const inputTensor = new ort.Tensor('float32', feats, [1, frames, 80])
  const lengthTensor = new ort.Tensor('int64', BigInt64Array.from([BigInt(frames)]), [1])
  const feeds: Record<string, ort.Tensor> = {
    [inputName]: inputTensor,
    [lengthName]: lengthTensor,
  }
  const results = await session.run(feeds)
  const logitsTensor = results[outputName] as ort.Tensor
  return {
    logits: logitsTensor.data as Float32Array,
    vocabSize: logitsTensor.dims[2],
    outFrames: logitsTensor.dims[1],
  }
}

/** 长音频切块：zipformer 动态下采样，60s 一块（fbank 帧数 ~6000，内存可控）；
 *  相邻块重叠 2s 消除边界上下文缺失（= 50 输出帧，恰好整除 0.04s/帧）。 */
const MAX_SAMPLES = PHONEME_TARGET_SAMPLE_RATE * 60
const OVERLAP_SAMPLES = PHONEME_TARGET_SAMPLE_RATE * 2

/** 帧步长：10ms × subsampling 4 */
const FRAME_SEC = 0.04

/** CTC greedy 解码：逐帧 argmax，非 blank 且不等于前一 token 才输出；
 *  只解码 [startFrame, endFrame)（保留区，丢弃边界帧）；prev 为前一帧 best token，
 *  跨块透传避免边界处重复输出同一 token。 */
function greedyDecode(
  logits: Float32Array,
  vocabSize: number,
  blank: number,
  startFrame: number,
  endFrame: number,
  prev: number,
): { tokens: { token: number; frame: number }[]; lastBest: number } {
  const tokens: { token: number; frame: number }[] = []
  for (let t = startFrame; t < endFrame; t++) {
    const base = t * vocabSize
    let best = 0
    let bestV = logits[base]
    for (let v = 1; v < vocabSize; v++) {
      const val = logits[base + v]
      if (val > bestV) {
        bestV = val
        best = v
      }
    }
    if (best !== blank && best !== prev) {
      tokens.push({ token: best, frame: t })
    }
    prev = best
  }
  return { tokens, lastBest: prev }
}

async function recognize(request: ZipformerRequest): Promise<void> {
  const { audio, sampleRate } = request

  // 1. 重采样到 16kHz mono
  const mono16k = resampleToMono16k(audio, sampleRate)

  // 2. 切块（如过长）：相邻块重叠 2s，只保留各区输出帧
  const chunks = sliceAudioOverlapped(mono16k, MAX_SAMPLES, OVERLAP_SAMPLES)

  const { session: sessionInstance } = await loadSessionByUrl(ZIPFORMER_MODEL_URL)
  const loaded = await loadTokens(ZIPFORMER_TOKENS_URL)
  const tokens = loaded.tokens
  const blankId = loaded.blankId

  const frameSec = FRAME_SEC

  const segments: ZipformerSegment[] = []
  let fullText = ''
  let prevToken = -1

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const chunkStartSec = chunk.startSample / PHONEME_TARGET_SAMPLE_RATE

    // 3. Kaldi fbank
    const feats = computeKaldiFbank(chunk.data)
    const frames = feats.length / 80
    if (frames === 0) continue

    // 4. ONNX 前向
    const { logits, vocabSize, outFrames } = await runForward(sessionInstance, feats, frames)

    // 5. 保留区帧范围：丢弃块内受边界影响的帧（含前文 overlap 区域）
    const trimStart = Math.ceil(
      (chunk.outStartSample - chunk.startSample) / (PHONEME_TARGET_SAMPLE_RATE * frameSec),
    )
    const trimEnd = Math.min(
      Math.ceil(
        (chunk.outEndSample - chunk.startSample) / (PHONEME_TARGET_SAMPLE_RATE * frameSec),
      ),
      outFrames,
    )

    // 6. CTC greedy 解码 + 时间戳（token 用字节 BPE 解码为可读文本）
    const decoded = greedyDecode(logits, vocabSize, blankId, trimStart, trimEnd, prevToken)
    prevToken = decoded.lastBest
    for (const { token, frame } of decoded.tokens) {
      const symbol = tokens[token]
      if (!symbol) continue
      const start = chunkStartSec + frame * frameSec
      const end = chunkStartSec + (frame + 1) * frameSec
      const text = decodeByteBpe(symbol)
      if (!text.trim()) continue
      segments.push({ symbol: text, start, end })
      fullText += text
    }

    if (chunks.length > 1) {
      postProgress({ kind: 'progress', chunk: i + 1, total: chunks.length })
    }
  }

  postProgress({
    kind: 'done',
    segments,
    text: fullText,
    sampleRate: PHONEME_TARGET_SAMPLE_RATE,
  })
}

/** 行音频切片：[t0, t1] 秒范围（按输入采样率），clamp 到音频范围内。 */
function sliceAudioRange(
  audio: Float32Array,
  sampleRate: number,
  t0: number,
  t1: number,
): Float32Array {
  const a = Math.max(0, Math.floor(t0 * sampleRate))
  const b = Math.min(audio.length, Math.ceil(t1 * sampleRate))
  if (a >= b) return new Float32Array(0)
  return audio.slice(a, b)
}

/** 行内单元无对齐信息时：整行均匀分摊到 [tStart, tEnd]。 */
function uniformLine(
  enc: EncodedLine,
  tStart: number,
  tEnd: number,
): ZipformerAlignUnit[] {
  const n = Math.max(1, enc.units.length)
  const span = Math.max(0.05, tEnd - tStart)
  return enc.units.map((text, k) => ({
    text,
    start: tStart + (n === 1 ? 0 : (k / (n - 1)) * span),
    end: tStart + (n === 1 ? span : ((k + 1) / (n - 1)) * span),
    confident: false,
  }))
}

/** 聚合：token 段 → 单元时间戳，未覆盖单元按相邻单元线性插值。 */
function aggregateLine(
  enc: EncodedLine,
  aligned: CtcAlignResult,
  tStart: number,
  tEnd: number,
): ZipformerAlignUnit[] {
  const n = enc.units.length
  const unitStart = new Array<number>(n).fill(Number.NaN)
  const unitEnd = new Array<number>(n).fill(Number.NaN)

  if (aligned.ok) {
    for (let k = 0; k < enc.tokenIds.length; k++) {
      const s = aligned.tokenStartFrames[k]
      const e = aligned.tokenEndFrames[k]
      if (s < 0) continue
      const u = enc.tokenUnits[k]
      const st = tStart + s * FRAME_SEC
      const en = tStart + (e + 1) * FRAME_SEC
      if (Number.isNaN(unitStart[u]) || st < unitStart[u]) unitStart[u] = st
      if (Number.isNaN(unitEnd[u]) || en > unitEnd[u]) unitEnd[u] = en
    }
  }

  const out: ZipformerAlignUnit[] = []
  for (let u = 0; u < n; u++) {
    const text = enc.units[u]
    let start = unitStart[u]
    let end = unitEnd[u]
    let confident = !Number.isNaN(start)
    if (Number.isNaN(start)) {
      let p = -1
      for (let k = u - 1; k >= 0; k--) {
        if (!Number.isNaN(unitStart[k])) {
          p = k
          break
        }
      }
      let nx = -1
      for (let k = u + 1; k < n; k++) {
        if (!Number.isNaN(unitStart[k])) {
          nx = k
          break
        }
      }
      const left = p >= 0 ? unitEnd[p] : tStart
      const right = nx >= 0 ? unitStart[nx] : tEnd
      const gapUnits = (nx >= 0 ? nx : n) - (p >= 0 ? p : -1) - 1
      const offset = u - (p >= 0 ? p : -1) - 1
      const slot = Math.max(0.02, (right - left) / Math.max(1, gapUnits))
      start = left + offset * slot
      end = start + slot
    }
    out.push({ text, start, end, confident })
  }
  return out
}

/** 强制对齐：逐行选模型（含 ASCII → 英文模型，否则中文模型），行窗内 Viterbi。 */
async function alignVocals(request: ZipformerAlignRequest): Promise<void> {
  const { audio, sampleRate, lyricsLines, lineTimesMs } = request
  if (lyricsLines.length === 0 || lineTimesMs.length !== lyricsLines.length + 1) {
    throw new Error('align 请求参数无效：lyricsLines 与 lineTimesMs 长度不匹配')
  }

  const zhTokens = await loadTokens(ZIPFORMER_TOKENS_URL)
  const enTokens = await loadTokens(ZIPFORMER_EN_TOKENS_URL)
  const zhVocab = buildVocab(zhTokens.tokens)
  const enVocab = buildVocab(enTokens.tokens)

  const [{ session: zhSession }, { session: enSession }] = await Promise.all([
    loadSessionByUrl(ZIPFORMER_MODEL_URL),
    loadSessionByUrl(ZIPFORMER_EN_MODEL_URL),
  ])

  const durSec = audio.length / sampleRate
  const lines: ZipformerAlignLine[] = []

  for (let i = 0; i < lyricsLines.length; i++) {
    const text = lyricsLines[i]
    let tStart = lineTimesMs[i] / 1000
    let tEnd = lineTimesMs[i + 1] / 1000
    tStart = Math.min(Math.max(0, tStart), durSec)
    tEnd = Math.min(Math.max(tStart, tEnd), durSec)

    // 语言选择：含 ASCII 字母/数字 → 英文模型（中文词在 en 词表不可编码时插值）
    const hasAscii = /[A-Za-z0-9]/.test(text)
    const mode = hasAscii ? 'en' : 'zh'
    const vocab = hasAscii ? enVocab : zhVocab
    const enc = encodeLyricsLine(text, mode, vocab)

    let units: ZipformerAlignUnit[]
    if (enc.tokenIds.length === 0) {
      units = uniformLine(enc, tStart, tEnd)
    } else {
      const seg = sliceAudioRange(audio, sampleRate, tStart, tEnd)
      const mono16k = resampleToMono16k(seg, sampleRate)
      const feats = computeKaldiFbank(mono16k)
      const inFrames = feats.length / 80
      if (inFrames === 0) {
        units = uniformLine(enc, tStart, tEnd)
      } else {
        const { logits, vocabSize, outFrames } = await runForward(
          hasAscii ? enSession : zhSession,
          feats,
          inFrames,
        )
        if (outFrames === 0) {
          units = uniformLine(enc, tStart, tEnd)
        } else {
          const blankId = hasAscii ? enTokens.blankId : zhTokens.blankId
          const aligned = ctcForcedAlignLine(
            logits,
            vocabSize,
            blankId,
            0,
            outFrames,
            enc.tokenIds,
            true,
          )
          units = aligned.ok ? aggregateLine(enc, aligned, tStart, tEnd) : uniformLine(enc, tStart, tEnd)
        }
      }
    }

    lines.push({ units })
    postProgress({ kind: 'progress', chunk: i + 1, total: lyricsLines.length })
  }

  postProgress({ kind: 'align-done', lines })
}

self.onmessage = (event: MessageEvent<ZipformerRequest | ZipformerAlignRequest>) => {
  const request = event.data
  const run =
    request.type === 'align'
      ? alignVocals(request)
      : request.type === 'recognize'
        ? recognize(request)
        : Promise.reject(new Error(`未知请求类型：${(request as { type?: string }).type}`))
  void run.catch((error) => {
    postProgress({
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  })
}

export {}
