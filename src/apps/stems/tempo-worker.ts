/// <reference lib="webworker" />

/**
 * 分段节拍检测 Worker：在独立线程跑 detectTempo，避免阻塞主线程。
 * 不加载任何模型、不引入 onnxruntime，实例内存极小——与 AI 推理调度服务的
 * 「一次一个模型」纪律无冲突（它不属于模型 worker），由 stems-app 懒创建并复用。
 */
import { detectTempo } from './stems-tempo.ts'
import type { TempoInfo } from './stems-tempo.ts'

/** 主线程 → Worker：检测请求。 */
export type TempoWorkerRequest = {
  type: 'detect'
  /** interleaved stereo Float32 PCM（44.1kHz，鼓轨） */
  audio: Float32Array
  sampleRate: number
}

/** Worker → 主线程：结果/错误。 */
export type TempoWorkerResponse =
  | { type: 'done'; tempo: TempoInfo | null }
  | { type: 'error'; message: string }

self.onmessage = (event: MessageEvent<TempoWorkerRequest>) => {
  const request = event.data
  if (request.type !== 'detect') return
  try {
    const tempo = detectTempo(request.audio, request.sampleRate)
    ;(self as unknown as Worker).postMessage({ type: 'done', tempo } satisfies TempoWorkerResponse)
  } catch (error) {
    ;(self as unknown as Worker).postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    } satisfies TempoWorkerResponse)
  }
}

// 让 TS 把此文件当 worker 模块
export {}
