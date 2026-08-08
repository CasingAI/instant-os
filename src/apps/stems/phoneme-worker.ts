/// <reference lib="webworker" />

import * as ort from 'onnxruntime-web'
import { fetchModelWithCache, PHONEME_MODEL_URL } from '../../os/model-cache.ts'
import {
  resampleToMono16k,
  zeroMeanUnitVariance,
  PHONEME_TARGET_SAMPLE_RATE,
} from './phoneme-types.ts'
import type { PhonemeEngineProvider, PhonemeProgress, PhonemeRequest } from './phoneme-types.ts'

// 复用 onnxruntime-web 的 wasm 路径配置（与 stems-worker 一致）。
import ortWasmSimdThreadedJsepMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url'
import ortWasmSimdThreadedJsepWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url'

ort.env.wasm.wasmPaths = {
  mjs: ortWasmSimdThreadedJsepMjsUrl,
  wasm: ortWasmSimdThreadedJsepWasmUrl,
}

ort.env.wasm.numThreads = Math.min(navigator.hardwareConcurrency || 4, 8)

let session: ort.InferenceSession | undefined
let sessionProvider: PhonemeEngineProvider = 'wasm'

function postProgress(progress: PhonemeProgress): void {
  ;(self as unknown as Worker).postMessage(progress)
}

async function loadSession(): Promise<{ session: ort.InferenceSession; provider: PhonemeEngineProvider }> {
  if (session) return { session, provider: sessionProvider }

  postProgress({ kind: 'model-loading' })

  const response = await fetchModelWithCache(PHONEME_MODEL_URL)
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
 * 把长音频切成模型能处理的窗口。
 * wav2vec2-large-lv60 使用卷积位置编码，理论上可处理任意长度，
 * 但实际 transformer 的注意力复杂度 O(n²) 会随长度增长。这里按 30 秒切块。
 */
const MAX_SAMPLES = PHONEME_TARGET_SAMPLE_RATE * 30 // 30 秒

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

async function recognize(request: PhonemeRequest): Promise<void> {
  const { audio, sampleRate } = request

  // 1. 重采样到 16kHz mono
  const mono16k = resampleToMono16k(audio, sampleRate)

  // 2. 零均值单位方差归一化
  const normalized = zeroMeanUnitVariance(mono16k)

  // 3. 切块（如果太长）
  const chunks = sliceAudio(normalized)

  const { session: sessionInstance } = await loadSession()

  // 4. 逐块推理
  const allLogits: Float32Array[] = []
  let totalFrames = 0

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    // 模型输入 [1, sequence_length]
    const inputTensor = new ort.Tensor('float32', chunk, [1, chunk.length])
    const feeds: Record<string, ort.Tensor> = { input_values: inputTensor }
    const results = await sessionInstance.run(feeds)

    const logitsTensor = results.logits as ort.Tensor
    // logits shape: [1, frames, 392]
    const logits = logitsTensor.data as Float32Array
    const frames = logitsTensor.dims[1]

    allLogits.push(logits)
    totalFrames += frames

    // 多块时上报进度
    if (chunks.length > 1) {
      postProgress({ kind: 'progress', chunk: i + 1, total: chunks.length })
    }
  }

  // 5. 合并所有块的 logits
  const numPhonemes = 392 // 模型固定输出 392 个音素
  const merged = new Float32Array(totalFrames * numPhonemes)

  let offset = 0
  for (const logits of allLogits) {
    merged.set(logits, offset)
    offset += logits.length
  }

  postProgress({
    kind: 'done',
    logits: merged,
    numFrames: totalFrames,
    numPhonemes: 392,
    sampleRate: PHONEME_TARGET_SAMPLE_RATE,
  })
}

self.onmessage = (event: MessageEvent<PhonemeRequest>) => {
  const request = event.data
  if (request.type !== 'recognize') return
  void recognize(request).catch((error) => {
    postProgress({
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  })
}

// 让 TS 把此文件当 worker 模块
export {}