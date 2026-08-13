/// <reference lib="webworker" />

/**
 * Zipformer-CTC 中文识别 worker（onnxruntime-web 直跑 sherpa-onnx 模型）。
 *
 * 链路：stereo PCM → 重采样 16k mono → Kaldi fbank80（与训练侧一致）→
 *   ONNX 一次前向（zipformer encoder）→ CTC greedy 解码 →
 *   tokens.txt 查表 → 每 token 时间戳（subsampling 4 × 10ms = 0.04s/帧）。
 *
 * 与 phoneme-worker 共享同架构（onnxruntime-web + worker + Cache API），
 * 被 ai-inference-service 统一调度（换模型自动卸载旧 worker）。
 */

import * as ort from 'onnxruntime-web'
import { fetchModelWithCache, ZIPFORMER_MODEL_URL } from '../../os/model-cache.ts'
import {
  resampleToMono16k,
  PHONEME_TARGET_SAMPLE_RATE,
} from '../stems/phoneme-types.ts'
import { computeKaldiFbank } from './kaldi-fbank.ts'
import { decodeByteBpe } from './bbpe-decode.ts'

// 复用 onnxruntime-web 的 wasm 路径配置（与 phoneme-worker 一致）。
import ortWasmSimdThreadedJsepMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url'
import ortWasmSimdThreadedJsepWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url'

ort.env.wasm.wasmPaths = {
  mjs: ortWasmSimdThreadedJsepMjsUrl,
  wasm: ortWasmSimdThreadedJsepWasmUrl,
}

ort.env.wasm.numThreads = Math.min(navigator.hardwareConcurrency || 4, 8)

export type ZipformerProvider = 'webgpu' | 'wasm'

/** 识别结果：识别出的 token 段（含起始/结束时间，秒） */
export type ZipformerSegment = {
  symbol: string
  start: number
  end: number
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
  | { kind: 'error'; message: string }

export type ZipformerRequest = {
  type: 'recognize'
  /** PCM 音频（interleaved stereo float32，范围 -1..1，来自人声轨） */
  audio: Float32Array
  /** 输入音频采样率（通常 44100） */
  sampleRate: number
}

let session: ort.InferenceSession | undefined
let sessionProvider: ZipformerProvider = 'wasm'

/** tokens.txt：每行 `token id`，id 即模型输出类别下标 */
let tokens: string[] | undefined
let blankId = 0

function postProgress(progress: ZipformerProgress): void {
  ;(self as unknown as Worker).postMessage(progress)
}

async function loadTokens(): Promise<void> {
  if (tokens) return
  const response = await fetch('/assets/zipformer-ctc/tokens.txt')
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
  tokens = Array.from({ length: maxId + 1 }, (_, i) => byId.get(i) ?? '')
  blankId = blank >= 0 ? blank : 0
}

async function loadSession(): Promise<{ session: ort.InferenceSession; provider: ZipformerProvider }> {
  if (session) return { session, provider: sessionProvider }

  postProgress({ kind: 'model-loading' })

  const response = await fetchModelWithCache(ZIPFORMER_MODEL_URL)
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

/** 长音频切块：zipformer 动态下采样，60s 一块（fbank 帧数 ~6000，内存可控） */
const MAX_SAMPLES = PHONEME_TARGET_SAMPLE_RATE * 60

function sliceAudio(audio: Float32Array): Float32Array[] {
  if (audio.length <= MAX_SAMPLES) return [audio]
  const chunks: Float32Array[] = []
  let offset = 0
  while (offset < audio.length) {
    const end = Math.min(offset + MAX_SAMPLES, audio.length)
    chunks.push(audio.slice(offset, end))
    offset = end
  }
  return chunks
}

/** CTC greedy 解码：逐帧 argmax，非 blank 且不等于前一 token 才输出 */
function greedyDecode(
  logits: Float32Array,
  frames: number,
  vocabSize: number,
  blank: number,
): { token: number; frame: number }[] {
  const out: { token: number; frame: number }[] = []
  let prev = -1
  for (let t = 0; t < frames; t++) {
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
      out.push({ token: best, frame: t })
    }
    prev = best
  }
  return out
}

async function recognize(request: ZipformerRequest): Promise<void> {
  const { audio, sampleRate } = request

  // 1. 重采样到 16kHz mono
  const mono16k = resampleToMono16k(audio, sampleRate)

  // 2. 切块（如过长）
  const chunks = sliceAudio(mono16k)

  const { session: sessionInstance } = await loadSession()
  await loadTokens()
  if (!tokens) throw new Error('tokens.txt 加载失败')

  const inputName = sessionInstance.inputNames[0]
  const lengthName = sessionInstance.inputNames[1]
  const outputName = sessionInstance.outputNames[0]

  const frameSec = 0.01 * 4 // 10ms × subsampling 4

  const segments: ZipformerSegment[] = []
  let fullText = ''

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const chunkStartSec = (i * MAX_SAMPLES) / PHONEME_TARGET_SAMPLE_RATE

    // 3. Kaldi fbank
    const feats = computeKaldiFbank(chunk)
    const frames = feats.length / 80
    if (frames === 0) continue

    // 4. ONNX 前向
    const inputTensor = new ort.Tensor('float32', feats, [1, frames, 80])
    const lengthTensor = new ort.Tensor('int64', BigInt64Array.from([BigInt(frames)]), [1])
    const feeds: Record<string, ort.Tensor> = {
      [inputName]: inputTensor,
      [lengthName]: lengthTensor,
    }
    const results = await sessionInstance.run(feeds)
    const logitsTensor = results[outputName] as ort.Tensor
    const logits = logitsTensor.data as Float32Array
    const outFrames = logitsTensor.dims[1]
    const vocabSize = logitsTensor.dims[2]

    // 5. CTC greedy 解码 + 时间戳（token 用字节 BPE 解码为可读文本）
    const decoded = greedyDecode(logits, outFrames, vocabSize, blankId)
    for (const { token, frame } of decoded) {
      const symbol = tokens![token]
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

self.onmessage = (event: MessageEvent<ZipformerRequest>) => {
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
