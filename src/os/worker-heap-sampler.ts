/**
 * Worker 侧心跳消息。
 *
 * performance.memory 是 Chromium 专有 API，IDL 只暴露在 window 上，
 * Dedicated Worker 内始终为 undefined。因此 Worker 堆大小无法读取。
 * 保留此消息是为了让主线程感知 Worker 存活状态（"系统服务"列表）。
 */
export type WorkerHeapSampleMessage = {
  type: 'heap'
}

const DEFAULT_INTERVAL_MS = 1000

/**
 * 在 Dedicated Worker 内定期发送心跳，让主线程知道该 Worker 存活。
 * 返回 stop 函数（一般不必调用；Worker terminate 即停）。
 */
export function startWorkerHeapSampler(
  post: (message: WorkerHeapSampleMessage) => void,
  intervalMs = DEFAULT_INTERVAL_MS,
): () => void {
  const tick = () => {
    post({ type: 'heap' })
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
