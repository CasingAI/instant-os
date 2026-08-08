/// <reference lib="webworker" />

import * as ort from 'onnxruntime-web'
import { fetchModelWithCache, MDX_MODEL_URL } from '../../os/model-cache.ts'
import { resampleInterleaved } from './stems-separator.ts'
import {
  mixMinus,
  separateInstrumental,
  MDX_SPEC_SIZE,
  MDX_TARGET_SAMPLE_RATE,
} from './mdx-vocal.ts'
import type { StemEngineProvider } from './stems-types.ts'

// 用 ?url 让 vite 把 onnxruntime-web 的 wasm/glue 作为静态资源打包（与 stems-worker 一致）。
import ortWasmSimdThreadedJsepMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url'
import ortWasmSimdThreadedJsepWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url'

ort.env.wasm.wasmPaths = {
  mjs: ortWasmSimdThreadedJsepMjsUrl,
  wasm: ortWasmSimdThreadedJsepWasmUrl,
}

ort.env.wasm.numThreads = Math.min(navigator.hardwareConcurrency || 4, 8)

/** 主线程 → Worker：人声增强分离请求。 */
export type MdxVocalRequest = {
  type: 'separate'
  /** PCM 音频数据（interleaved stereo float32，范围 -1..1） */
  audio: Float32Array
  sampleRate: number
}

/** Worker → 主线程：进度/结果事件。 */
export type MdxVocalProgress =
  | { kind: 'model-loading' }
  | { kind: 'model-loaded'; provider: StemEngineProvider }
  | { kind: 'chunk'; done: number; total: number }
  | { kind: 'done'; vocals: Float32Array; sampleRate: number }
  | { kind: 'error'; message: string }

let session: ort.InferenceSession | undefined
let sessionProvider: StemEngineProvider = 'wasm'

function postProgress(progress: MdxVocalProgress): void {
  ;(self as unknown as Worker).postMessage(progress)
}

async function loadSession(): Promise<{ session: ort.InferenceSession; provider: StemEngineProvider }> {
  if (session) return { session, provider: sessionProvider }
  postProgress({ kind: 'model-loading' })
  const response = await fetchModelWithCache(MDX_MODEL_URL)
  const arrayBuffer = await response.arrayBuffer()
  const gpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator
  if (gpuAvailable) {
    try {
      session = await ort.InferenceSession.create(arrayBuffer, {
        executionProviders: ['webgpu'],
      })
      sessionProvider = 'webgpu'
    } catch {
      // WebGPU 初始化失败 → 回退 WASM
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

async function separate(request: MdxVocalRequest): Promise<void> {
  const { audio, sampleRate } = request
  // 模型期望 44.1kHz（与 htdemucs 相同），先重采样。
  const resampled = resampleInterleaved(audio, sampleRate, MDX_TARGET_SAMPLE_RATE)
  const { session: sessionInstance } = await loadSession()

  const runBatch = async (specBatch: Float32Array): Promise<Float32Array> => {
    const batchSize = specBatch.length / MDX_SPEC_SIZE
    // 模型输入/输出均为 [B, 4, 3072, 256]（实/虚 × 左右声道 STFT）
    const inputTensor = new ort.Tensor('float32', specBatch, [batchSize, 4, 3072, 256])
    const results = await sessionInstance.run({ input: inputTensor })
    const outputTensor = results.output as ort.Tensor
    // 返回模型输出的副本（ort 复用内部 buffer，下一轮 run 会覆盖）
    return outputTensor.data.slice() as Float32Array
  }

  const instrumental = await separateInstrumental(resampled, runBatch, 4, (progress) => {
    postProgress({ kind: 'chunk', done: progress.done, total: progress.total })
  })
  const vocals = mixMinus(resampled, instrumental)

  postProgress({ kind: 'done', vocals, sampleRate: MDX_TARGET_SAMPLE_RATE })
}

self.onmessage = (event: MessageEvent<MdxVocalRequest>) => {
  const request = event.data
  if (request.type !== 'separate') return
  void separate(request).catch((error) => {
    postProgress({
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  })
}

// 让 TS 把此文件当 worker 模块
export {}
