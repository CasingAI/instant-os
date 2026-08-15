/// <reference lib="webworker" />

import * as ort from 'onnxruntime-web'
import { fetchModelWithCache, DEMUCS_MODEL_URL } from '../../os/model-cache.ts'
import {
  deinterleaveStereo,
  resampleInterleaved,
  sliceStemChunks,
  stitchStemOutputs,
  STEM_TARGET_SAMPLE_RATE,
  STEM_WINDOW,
} from './stems-separator.ts'
import type { StemEngineProvider, StemProgress, StemRequest } from './stems-types.ts'

// 用 ?url 让 vite 把 onnxruntime-web 的 wasm/glue 作为静态资源打包，
// 而不是放 public 目录（public 里的 .mjs 不能从源码 import）。
// 对象形式 wasmPaths 告诉 onnxruntime-web 分别去哪里加载 jsep 模块与 wasm 二进制。
import ortWasmSimdThreadedJsepMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url'
import ortWasmSimdThreadedJsepWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url'

ort.env.wasm.wasmPaths = {
  mjs: ortWasmSimdThreadedJsepMjsUrl,
  wasm: ortWasmSimdThreadedJsepWasmUrl,
}

// WASM 回退时 onnxruntime-web 默认只有 1 个线程（慢到不可用），按机器核数放开。
ort.env.wasm.numThreads = Math.min(navigator.hardwareConcurrency || 4, 8)

let session: ort.InferenceSession | undefined
let sessionProvider: StemEngineProvider = 'wasm'

function postProgress(progress: StemProgress): void {
  ;(self as unknown as Worker).postMessage(progress)
}

async function loadSession(): Promise<{ session: ort.InferenceSession; provider: StemEngineProvider }> {
  if (session) return { session, provider: sessionProvider }
  postProgress({ kind: 'model-loading' })
  const response = await fetchModelWithCache(DEMUCS_MODEL_URL)
  const arrayBuffer = await response.arrayBuffer()
  // 显式区分执行后端：onnxruntime 的多 provider 列表不会告知最终用了哪个，
  // 这里先单独尝试 WebGPU，失败再回退 WASM，并把实际生效的 provider 上报给 UI。
  const gpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator
  if (gpuAvailable) {
    try {
      session = await ort.InferenceSession.create(arrayBuffer, {
        executionProviders: ['webgpu'],
      })
      sessionProvider = 'webgpu'
    } catch {
      // WebGPU 初始化失败（无适配器 / 驱动问题）→ 回退 WASM
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

async function separate(request: StemRequest): Promise<void> {
  const { audio, sampleRate } = request
  // 模型输入窗口固定 [1, 2, 343980]（约 7.8 秒 @44.1kHz）。先重采样到模型期望的 44.1kHz。
  const resampled = resampleInterleaved(audio, sampleRate, STEM_TARGET_SAMPLE_RATE)
  const chunks = sliceStemChunks(resampled)
  const totalFrames = Math.floor(resampled.length / 2)
  const { session: sessionInstance } = await loadSession()
  const chunkOutputs: Float32Array[] = []
  const chunkStarts: number[] = []

  for (let i = 0; i < chunks.length; i++) {
    const { startFrame, input } = chunks[i]
    // 模型输入 [1, 2, W] 是 ch-major：先 de-interleave（L 全段 / R 全段）再构造张量
    const inputTensor = new ort.Tensor('float32', deinterleaveStereo(input), [1, 2, STEM_WINDOW])
    const feeds: Record<string, ort.Tensor> = { mix: inputTensor }
    const results = await sessionInstance.run(feeds)
    // 输出名通常是 stems，shape [1, 6, 2, W]
    const outputTensor = results.stems as ort.Tensor
    const output = outputTensor.data as Float32Array
    chunkOutputs.push(output)
    chunkStarts.push(startFrame)
    postProgress({ kind: 'chunk', index: i + 1, total: chunks.length })
  }

  const stems = stitchStemOutputs(chunkOutputs, chunkStarts, totalFrames)
  postProgress({ kind: 'done', stems, sampleRate: STEM_TARGET_SAMPLE_RATE })
}

self.onmessage = (event: MessageEvent<StemRequest>) => {
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
