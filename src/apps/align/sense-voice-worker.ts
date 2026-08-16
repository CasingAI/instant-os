/// <reference lib="webworker" />

/**
 * SenseVoice 五语识别 worker（onnxruntime-web 直跑 sherpa-onnx 模型）。
 *
 * 链路：stereo PCM → 重采样 16k mono → ×32768（normalize_samples=0）→
 *   hamming fbank80 → LFR(7/6) 拼 560 维 → CMVN → ONNX 一次前向 →
 *   CTC greedy 解码 → tokens.txt（SentencePiece BPE）拼词 → 每段时间戳。
 *
 * 与 zipformer worker 差异：
 *   - 4 个输入 tensor：x / x_length / language / text_norm
 *   - LFR 帧 shift = 0.01 × lfr_window_shift = 0.06s/帧
 *   - 模型每块输出前 4 帧是 lang/emotion/event 标记，语音帧从第 4 帧起算
 *   - 输出协议与 ZipformerProgress.done 一致，消费端无感
 *
 * 被 ai-inference-service 统一调度（换模型自动卸载旧 worker）。
 */

import { fetchModelWithCache, SENSE_VOICE_MODEL_URL } from '../../os/model-cache.ts'
import { ort, setupOrtWasm } from '../../os/ort-wasm-loader.ts'
import {
  resampleToMono16k,
  PHONEME_TARGET_SAMPLE_RATE,
} from '../stems/phoneme-types.ts'
import { computeSenseVoiceFeatures } from './sense-voice-feats.ts'
import { decodeSenseVoiceBpe, type SenseVoiceSegment } from './sense-voice-bpe.ts'
import { greedyDecode } from './align-greedy.ts'
import { sliceAudioOverlapped } from './align-chunking.ts'

export type SenseVoiceProvider = 'webgpu' | 'wasm'

/** 识别结果：识别出的词段（含起始/结束时间，秒），与 zipformer worker 同构 */
export type SenseVoiceSegmentOut = SenseVoiceSegment

export type SenseVoiceProgress =
  | { kind: 'model-loading' }
  | { kind: 'model-loaded'; provider: SenseVoiceProvider }
  | { kind: 'progress'; chunk: number; total: number }
  | {
      kind: 'done'
      segments: SenseVoiceSegmentOut[]
      /** 识别文本（BPE 拼词结果） */
      text: string
      sampleRate: number
    }
  | { kind: 'error'; message: string }

export type SenseVoiceRequest = {
  type: 'recognize'
  /** PCM 音频（interleaved stereo float32，范围 -1..1，来自人声轨） */
  audio: Float32Array
  /** 输入音频采样率（通常 44100） */
  sampleRate: number
}

let session: ort.InferenceSession | undefined
let sessionProvider: SenseVoiceProvider = 'wasm'

type SenseVoiceMeta = {
  lfrWindowSize: number
  lfrWindowShift: number
  vocabSize: number
  blankId: number
  languageId: number
  textNormId: number
  negMean: number[]
  invStddev: number[]
}

/** tokens.txt：每行 `piece id`，id 即模型输出类别下标 */
let tokens: string[] | undefined
let meta: SenseVoiceMeta | undefined

function postProgress(progress: SenseVoiceProgress): void {
  ;(self as unknown as Worker).postMessage(progress)
}

async function loadTokens(): Promise<void> {
  if (tokens) return
  const response = await fetch('/assets/sense-voice/tokens.txt')
  const text = await response.text()
  const byId = new Map<number, string>()
  let maxId = 0
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 2) continue
    const id = Number(parts[1])
    if (!Number.isFinite(id)) continue
    byId.set(id, parts[0])
    if (id > maxId) maxId = id
  }
  tokens = Array.from({ length: maxId + 1 }, (_, i) => byId.get(i) ?? '')
}

/** 从 metadata 读数值（缺省返回默认值） */
function metaNumber(metaJson: Record<string, string>, key: string, fallback: number): number {
  const v = metaJson[key]
  if (v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** 从 metadata 读逗号分隔的 float 向量（neg_mean / inv_stddev） */
function metaVector(metaJson: Record<string, string>, key: string): number[] {
  const v = metaJson[key]
  if (!v) return []
  return v
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n))
}

/**
 * 读取模型 metadata（预生成的 meta.json）：LFR 参数、CMVN 向量、blank/itn/language id。
 * onnxruntime-web 不暴露模型 metadata，vendor 时由 extract-onnx-metadata.mjs 提取。
 */
async function loadMeta(): Promise<SenseVoiceMeta> {
  if (meta) return meta
  const response = await fetch('/assets/sense-voice/meta.json')
  if (!response.ok) {
    throw new Error(`meta.json 加载失败：${response.status}`)
  }
  const raw = (await response.json()) as Record<string, string>
  meta = {
    lfrWindowSize: metaNumber(raw, 'lfr_window_size', 7),
    lfrWindowShift: metaNumber(raw, 'lfr_window_shift', 6),
    vocabSize: metaNumber(raw, 'vocab_size', 25_055),
    blankId: metaNumber(raw, 'blank_id', 0),
    languageId: metaNumber(raw, 'lang_auto', 0),
    textNormId: metaNumber(raw, 'without_itn', 15),
    negMean: metaVector(raw, 'neg_mean'),
    invStddev: metaVector(raw, 'inv_stddev'),
  }
  return meta
}

async function loadSession(): Promise<{ session: ort.InferenceSession; provider: SenseVoiceProvider }> {
  if (session) return { session, provider: sessionProvider }

  postProgress({ kind: 'model-loading' })

  await setupOrtWasm()
  const response = await fetchModelWithCache(SENSE_VOICE_MODEL_URL)
  const arrayBuffer = await response.arrayBuffer()

  const gpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator
  if (gpuAvailable) {
    try {
      session = await ort.InferenceSession.create(arrayBuffer, {
        executionProviders: ['webgpu'],
      })
      sessionProvider = 'webgpu'
    } catch {
      // WebGPU 不可用 → 回退 WASM
    }
  }

  if (!session) {
    session = await ort.InferenceSession.create(arrayBuffer, {
      executionProviders: ['wasm'],
    })
    sessionProvider = 'wasm'
  }

  postProgress({ kind: 'model-loaded', provider: sessionProvider })
  return { session, provider: sessionProvider }
}

/**
 * 长音频切块：SenseVoice 词表 25055 类，logits 巨大（30s 块约 50MB float32），
 * 块长取 30s；相邻块重叠 2s（=33 帧，远大于 LFR 上下文 7 帧）消除边界缺失。
 */
const MAX_SAMPLES = PHONEME_TARGET_SAMPLE_RATE * 30
const OVERLAP_SAMPLES = PHONEME_TARGET_SAMPLE_RATE * 2

async function recognize(request: SenseVoiceRequest): Promise<void> {
  const { audio, sampleRate } = request

  // 1. 重采样到 16kHz mono
  const mono16k = resampleToMono16k(audio, sampleRate)

  // 2. 切块（如过长）：相邻块重叠 2s，只保留各区输出帧
  const chunks = sliceAudioOverlapped(mono16k, MAX_SAMPLES, OVERLAP_SAMPLES)

  const { session: sessionInstance } = await loadSession()
  await loadTokens()
  await loadMeta()
  if (!tokens) throw new Error('tokens.txt 加载失败')
  if (!meta) throw new Error('模型 meta.json 加载失败')

  const inputNames = sessionInstance.inputNames
  if (inputNames.length < 4) {
    throw new Error(`SenseVoice 模型输入数量异常：${inputNames.length}`)
  }
  const [featName, lenName, langName, normName] = inputNames
  const outputName = sessionInstance.outputNames[0]

  const featDim = 80 * meta.lfrWindowSize
  const frameSec = 0.01 * meta.lfrWindowShift
  const sampleScale = 32_768 // normalize_samples=0：float [-1,1] → int16 域

  const segments: SenseVoiceSegmentOut[] = []
  let fullText = ''
  let prevToken = -1

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const chunkStartSec = chunk.startSample / PHONEME_TARGET_SAMPLE_RATE

    // 3. 特征：缩放 → fbank80(hamming/snip_edges/high_freq=0) → LFR(7/6) → CMVN
    const feats = computeSenseVoiceFeatures(chunk.data, {
      windowSize: meta.lfrWindowSize,
      windowShift: meta.lfrWindowShift,
      negMean: meta.negMean,
      invStddev: meta.invStddev,
      sampleScale,
    })
    const lfrFrames = feats.length / featDim
    if (lfrFrames === 0) continue

    // 4. ONNX 前向（4 输入：特征、长度、语言、文本规范化；x_length 为 int32）
    const featTensor = new ort.Tensor('float32', feats, [1, lfrFrames, featDim])
    const lenTensor = new ort.Tensor('int32', Int32Array.from([lfrFrames]), [1])
    const langTensor = new ort.Tensor('int32', Int32Array.from([meta.languageId]), [1])
    const normTensor = new ort.Tensor('int32', Int32Array.from([meta.textNormId]), [1])
    const feeds: Record<string, ort.Tensor> = {
      [featName]: featTensor,
      [lenName]: lenTensor,
      [langName]: langTensor,
      [normName]: normTensor,
    }
    const results = await sessionInstance.run(feeds)
    const logitsTensor = results[outputName] as ort.Tensor
    const logits = logitsTensor.data as Float32Array
    const vocabSize = logitsTensor.dims[2]

    // 5. 保留区帧范围（LFR 帧）：丢弃块内受边界影响的帧；模型输出比输入多 4 帧标记
    const trimStart = Math.ceil(
      (chunk.outStartSample - chunk.startSample) / (PHONEME_TARGET_SAMPLE_RATE * frameSec),
    )
    const trimEnd = Math.min(
      Math.ceil(
        (chunk.outEndSample - chunk.startSample) / (PHONEME_TARGET_SAMPLE_RATE * frameSec),
      ),
      lfrFrames,
    )

    // 6. CTC greedy 解码（跳过每块前 4 帧 lang/emotion/event 标记）+ BPE 拼词
    const decoded = greedyDecode(
      logits,
      vocabSize,
      meta.blankId,
      trimStart + 4,
      trimEnd + 4,
      prevToken,
    )
    prevToken = decoded.lastBest
    const chunkSegments = decodeSenseVoiceBpe(decoded.tokens, tokens, frameSec, chunkStartSec)
    for (const seg of chunkSegments) {
      segments.push(seg)
      fullText += seg.symbol
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

self.onmessage = (event: MessageEvent<SenseVoiceRequest>) => {
  const request = event.data
  if (request.type !== 'recognize') return
  void recognize(request).catch((error) => {
    postProgress({
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  })
}

export {}
