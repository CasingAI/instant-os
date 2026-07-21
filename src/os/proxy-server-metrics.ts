export type ProxyServerRequestRecord = {
  id: string
  startedAt: number
  endedAt: number
  durationMs: number
  method: string
  targetUrl: string
  host: string
  status: number | undefined
  ok: boolean
  errorMessage: string | undefined
  uploadBytes: number
  downloadBytes: number
}

export type ProxyServerByteEvent = {
  at: number
  uploadBytes: number
  downloadBytes: number
}

export type ProxyServerThroughputSnapshot = {
  downloadBytesPerSec: number
  uploadBytesPerSec: number
  /** 采样窗口长度（毫秒） */
  windowMs: number
}

export const PROXY_SERVER_METRICS_CHANGED_EVENT = 'instant-os:proxy-server-metrics-changed'

const RECENT_REQUEST_LIMIT = 50
const BYTE_EVENT_RETENTION_MS = 60_000
const THROUGHPUT_WINDOW_MS = 3_000

const recentRequests: ProxyServerRequestRecord[] = []
const byteEvents: ProxyServerByteEvent[] = []

let nextRequestId = 1

function emitChanged() {
  window.dispatchEvent(new CustomEvent(PROXY_SERVER_METRICS_CHANGED_EVENT))
}

function pruneByteEvents(now: number) {
  const cutoff = now - BYTE_EVENT_RETENTION_MS
  while (byteEvents.length > 0 && byteEvents[0]!.at < cutoff) {
    byteEvents.shift()
  }
}

export function recordProxyServerRequest(
  record: Omit<ProxyServerRequestRecord, 'id'>,
): ProxyServerRequestRecord {
  const full: ProxyServerRequestRecord = {
    ...record,
    id: `proxy-${nextRequestId++}`,
  }
  recentRequests.push(full)
  while (recentRequests.length > RECENT_REQUEST_LIMIT) {
    recentRequests.shift()
  }

  const now = record.endedAt
  byteEvents.push({
    at: now,
    uploadBytes: record.uploadBytes,
    downloadBytes: record.downloadBytes,
  })
  pruneByteEvents(now)
  emitChanged()
  return full
}

export function listRecentProxyServerRequests(limit = 20): ProxyServerRequestRecord[] {
  const count = Math.max(0, Math.min(limit, recentRequests.length))
  if (count === 0) {
    return []
  }
  return recentRequests.slice(recentRequests.length - count).reverse()
}

export function getProxyServerThroughputSnapshot(
  windowMs: number = THROUGHPUT_WINDOW_MS,
): ProxyServerThroughputSnapshot {
  const now = Date.now()
  pruneByteEvents(now)
  const cutoff = now - windowMs
  let uploadBytes = 0
  let downloadBytes = 0
  for (const event of byteEvents) {
    if (event.at < cutoff) {
      continue
    }
    uploadBytes += event.uploadBytes
    downloadBytes += event.downloadBytes
  }
  const seconds = Math.max(windowMs / 1000, 0.001)
  return {
    downloadBytesPerSec: downloadBytes / seconds,
    uploadBytesPerSec: uploadBytes / seconds,
    windowMs,
  }
}

/** 自某个时间戳以来累计的字节（供监视器差分采样） */
export function getProxyServerByteTotalsSince(sinceAt: number): {
  uploadBytes: number
  downloadBytes: number
} {
  const now = Date.now()
  pruneByteEvents(now)
  let uploadBytes = 0
  let downloadBytes = 0
  for (const event of byteEvents) {
    if (event.at <= sinceAt) {
      continue
    }
    uploadBytes += event.uploadBytes
    downloadBytes += event.downloadBytes
  }
  return { uploadBytes, downloadBytes }
}

export function getProxyServerLifetimeTotals(): {
  uploadBytes: number
  downloadBytes: number
  requestCount: number
} {
  let uploadBytes = 0
  let downloadBytes = 0
  for (const record of recentRequests) {
    uploadBytes += record.uploadBytes
    downloadBytes += record.downloadBytes
  }
  return {
    uploadBytes,
    downloadBytes,
    requestCount: recentRequests.length,
  }
}

export function subscribeProxyServerMetrics(listener: () => void): () => void {
  window.addEventListener(PROXY_SERVER_METRICS_CHANGED_EVENT, listener)
  return () => window.removeEventListener(PROXY_SERVER_METRICS_CHANGED_EVENT, listener)
}

export function formatProxyServerBytesPerSec(bytesPerSec: number | undefined): string {
  if (bytesPerSec === undefined || !Number.isFinite(bytesPerSec) || bytesPerSec < 0) {
    return '—'
  }
  if (bytesPerSec < 1024) {
    return `${bytesPerSec.toFixed(0)} B/s`
  }
  if (bytesPerSec < 1024 * 1024) {
    return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
  }
  return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`
}

export function formatProxyServerDataBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return '—'
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function formatProxyServerAxisTick(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
  }
  if (bytesPerSec >= 1024) {
    return `${(bytesPerSec / 1024).toFixed(0)} KB/s`
  }
  return `${Math.round(bytesPerSec)} B/s`
}
