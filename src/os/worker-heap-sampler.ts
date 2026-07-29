/** Worker 侧堆采样消息（各 worker protocol 的 heap 变体形状保持一致） */
export type WorkerHeapSampleMessage = {
  type: 'heap'
  memorySupported: boolean
  usedBytes?: number
  totalBytes?: number
  limitBytes?: number
}

type PerformanceMemory = {
  usedJSHeapSize: number
  totalJSHeapSize: number
  jsHeapSizeLimit: number
}

const DEFAULT_INTERVAL_MS = 1000

function readWorkerHeap(): WorkerHeapSampleMessage {
  const mem = (performance as Performance & { memory?: PerformanceMemory }).memory
  if (!mem || typeof mem.usedJSHeapSize !== 'number') {
    return { type: 'heap', memorySupported: false }
  }
  return {
    type: 'heap',
    memorySupported: true,
    usedBytes: mem.usedJSHeapSize,
    totalBytes: mem.totalJSHeapSize,
    limitBytes: mem.jsHeapSizeLimit,
  }
}

/**
 * 在 Dedicated Worker 内定期上报 JS 堆。
 * 返回 stop 函数（一般不必调用；Worker terminate 即停）。
 */
export function startWorkerHeapSampler(
  post: (message: WorkerHeapSampleMessage) => void,
  intervalMs = DEFAULT_INTERVAL_MS,
): () => void {
  const tick = () => {
    post(readWorkerHeap())
  }
  tick()
  const timer = setInterval(tick, intervalMs)
  return () => {
    clearInterval(timer)
  }
}

export function isWorkerHeapSampleMessage(
  message: unknown,
): message is WorkerHeapSampleMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'heap'
  )
}
