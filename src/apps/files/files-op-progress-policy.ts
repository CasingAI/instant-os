/** 进度窗最短停留时长：极快操作补足到 1 秒防一闪而过；已超过的任务完成即刻关窗 */
export const FILES_OP_PROGRESS_MIN_VISIBLE_MS = 1000

export type FilesOpProgressSnapshot = {
  done: number
  total: number
  elapsedMs: number
  /** 无实测吞吐时的总耗时预估（毫秒） */
  estimatedTotalMs?: number
}

const MIN_ELAPSED_FOR_THROUGHPUT_MS = 50
const MIN_DONE_FRACTION = 0.002

/** 将节点数与字节规模折算为统一工作量单位 */
export function filesWorkloadUnits(nodeCount: number, byteSize: number): number {
  const bytesPerUnit = 4096
  return Math.max(1, nodeCount + Math.ceil(byteSize / bytesPerUnit))
}

/** 保守预估本地卷 IndexedDB 操作总耗时 */
export function estimateFilesOpDurationMs(totalUnits: number): number {
  const msPerUnit = 6
  return Math.max(80, totalUnits * msPerUnit)
}

export function estimateRemainingMs(snapshot: FilesOpProgressSnapshot): number {
  const { done, total, elapsedMs, estimatedTotalMs } = snapshot
  if (total <= 0 || done >= total) return 0

  const minDone = Math.max(1, total * MIN_DONE_FRACTION)
  if (done >= minDone && elapsedMs >= MIN_ELAPSED_FOR_THROUGHPUT_MS) {
    const rate = done / elapsedMs
    if (rate > 0) {
      return Math.max(0, (total - done) / rate)
    }
  }

  if (estimatedTotalMs !== undefined) {
    return Math.max(0, estimatedTotalMs - elapsedMs)
  }

  return Number.POSITIVE_INFINITY
}

/** 进度折算到 0~1 */
export function filesOpProgressFraction(done: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(1, Math.max(0, done / total))
}

export function formatFilesOpRemainingLabel(remainingMs: number): string {
  if (!Number.isFinite(remainingMs)) {
    return '正在估算剩余时间…'
  }
  if (remainingMs <= 0) {
    return '即将完成…'
  }
  if (remainingMs < 1000) {
    return '大约还要不到 1 秒'
  }
  const seconds = Math.ceil(remainingMs / 1000)
  if (seconds < 60) {
    return `大约还要 ${seconds} 秒`
  }
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) {
    return `大约还要 ${minutes} 分钟`
  }
  const hours = Math.ceil(minutes / 60)
  if (hours >= 24) {
    return '大约还要超过 1 天'
  }
  return `大约还要 ${hours} 小时`
}
