import type { FilesLocationId } from '../apps/files/files-types.ts'
import {
  formatProxyServerAxisTick,
  formatProxyServerBytesPerSec,
  formatProxyServerDataBytes,
} from './proxy-server-metrics.ts'

export type FilesIoDirection = 'read' | 'write'

export type FilesIoByteEvent = {
  at: number
  locationId: FilesLocationId
  direction: FilesIoDirection
  bytes: number
  /** 该次操作耗时（毫秒） */
  durationMs: number
  op: string | undefined
}

export type FilesIoOperationRecord = {
  id: string
  at: number
  locationId: FilesLocationId
  direction: FilesIoDirection
  bytes: number
  durationMs: number
  path: string | undefined
  op: string | undefined
}

export type FilesIoThroughputSnapshot = {
  readBytesPerSec: number
  writeBytesPerSec: number
  readOpsPerSec: number
  writeOpsPerSec: number
  avgDurationMs: number
  peakDurationMs: number
  /** 采样窗口长度（毫秒） */
  windowMs: number
}

export type FilesIoOpBreakdownItem = {
  op: string
  direction: FilesIoDirection
  count: number
  bytes: number
  avgDurationMs: number
}

export const FILES_IO_METRICS_CHANGED_EVENT = 'instant-os:files-io-metrics-changed'

const RECENT_OPERATION_LIMIT = 50
const BYTE_EVENT_RETENTION_MS = 60_000
const THROUGHPUT_WINDOW_MS = 3_000

const recentOperations: FilesIoOperationRecord[] = []
const byteEvents: FilesIoByteEvent[] = []

let nextOperationId = 1

function emitChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(FILES_IO_METRICS_CHANGED_EVENT))
}

function pruneByteEvents(now: number) {
  const cutoff = now - BYTE_EVENT_RETENTION_MS
  while (byteEvents.length > 0 && byteEvents[0]!.at < cutoff) {
    byteEvents.shift()
  }
}

/** 记录一次数据读写（含 0 字节操作，用于次数统计） */
export function recordFilesIoByteEvent(params: {
  locationId: FilesLocationId
  direction: FilesIoDirection
  bytes: number
  path?: string
  op?: string
  at?: number
  durationMs?: number
}): FilesIoOperationRecord {
  const bytes = Math.max(0, Math.floor(params.bytes))
  const durationMs = Math.max(0, params.durationMs ?? 0)
  const at = params.at ?? Date.now()
  const record: FilesIoOperationRecord = {
    id: `files-io-${nextOperationId++}`,
    at,
    locationId: params.locationId,
    direction: params.direction,
    bytes,
    durationMs,
    path: params.path,
    op: params.op,
  }

  recentOperations.push(record)
  while (recentOperations.length > RECENT_OPERATION_LIMIT) {
    recentOperations.shift()
  }

  byteEvents.push({
    at,
    locationId: params.locationId,
    direction: params.direction,
    bytes,
    durationMs,
    op: params.op,
  })
  pruneByteEvents(at)
  emitChanged()
  return record
}

function matchesLocation(
  locationId: FilesLocationId,
  locationIds: readonly FilesLocationId[] | undefined,
): boolean {
  if (locationIds === undefined) return true
  return locationIds.includes(locationId)
}

export function listRecentFilesIoOperations(
  limit = 20,
  locationIds?: readonly FilesLocationId[],
): FilesIoOperationRecord[] {
  const filtered =
    locationIds === undefined
      ? recentOperations
      : recentOperations.filter((item) => matchesLocation(item.locationId, locationIds))
  const count = Math.max(0, Math.min(limit, filtered.length))
  if (count === 0) return []
  return filtered.slice(filtered.length - count).reverse()
}

export function getFilesIoThroughputSnapshot(
  locationIds?: readonly FilesLocationId[],
  windowMs: number = THROUGHPUT_WINDOW_MS,
): FilesIoThroughputSnapshot {
  const now = Date.now()
  pruneByteEvents(now)
  const cutoff = now - windowMs
  let readBytes = 0
  let writeBytes = 0
  let readOps = 0
  let writeOps = 0
  let durationSum = 0
  let durationCount = 0
  let peakDurationMs = 0
  for (const event of byteEvents) {
    if (event.at < cutoff) continue
    if (!matchesLocation(event.locationId, locationIds)) continue
    if (event.direction === 'read') {
      readBytes += event.bytes
      readOps += 1
    } else {
      writeBytes += event.bytes
      writeOps += 1
    }
    durationSum += event.durationMs
    durationCount += 1
    if (event.durationMs > peakDurationMs) peakDurationMs = event.durationMs
  }
  const seconds = Math.max(windowMs / 1000, 0.001)
  return {
    readBytesPerSec: readBytes / seconds,
    writeBytesPerSec: writeBytes / seconds,
    readOpsPerSec: readOps / seconds,
    writeOpsPerSec: writeOps / seconds,
    avgDurationMs: durationCount > 0 ? durationSum / durationCount : 0,
    peakDurationMs,
    windowMs,
  }
}

/** 自某个时间戳以来累计的字节与操作（供监视器差分采样） */
export function getFilesIoByteTotalsSince(
  sinceAt: number,
  locationIds?: readonly FilesLocationId[],
): {
  readBytes: number
  writeBytes: number
  readOps: number
  writeOps: number
  durationSumMs: number
  durationCount: number
  peakDurationMs: number
} {
  const now = Date.now()
  pruneByteEvents(now)
  let readBytes = 0
  let writeBytes = 0
  let readOps = 0
  let writeOps = 0
  let durationSumMs = 0
  let durationCount = 0
  let peakDurationMs = 0
  for (const event of byteEvents) {
    if (event.at <= sinceAt) continue
    if (!matchesLocation(event.locationId, locationIds)) continue
    if (event.direction === 'read') {
      readBytes += event.bytes
      readOps += 1
    } else {
      writeBytes += event.bytes
      writeOps += 1
    }
    durationSumMs += event.durationMs
    durationCount += 1
    if (event.durationMs > peakDurationMs) peakDurationMs = event.durationMs
  }
  return {
    readBytes,
    writeBytes,
    readOps,
    writeOps,
    durationSumMs,
    durationCount,
    peakDurationMs,
  }
}

/** 窗口内按 op 类型聚合（用于底部细分类） */
export function getFilesIoOpBreakdown(
  locationIds?: readonly FilesLocationId[],
  windowMs: number = BYTE_EVENT_RETENTION_MS,
): FilesIoOpBreakdownItem[] {
  const now = Date.now()
  pruneByteEvents(now)
  const cutoff = now - windowMs
  const map = new Map<
    string,
    {
      op: string
      direction: FilesIoDirection
      count: number
      bytes: number
      durationSum: number
    }
  >()

  for (const event of byteEvents) {
    if (event.at < cutoff) continue
    if (!matchesLocation(event.locationId, locationIds)) continue
    const op = event.op ?? 'other'
    const key = `${event.direction}:${op}`
    const current = map.get(key)
    if (current) {
      current.count += 1
      current.bytes += event.bytes
      current.durationSum += event.durationMs
    } else {
      map.set(key, {
        op,
        direction: event.direction,
        count: 1,
        bytes: event.bytes,
        durationSum: event.durationMs,
      })
    }
  }

  return [...map.values()]
    .map((item) => ({
      op: item.op,
      direction: item.direction,
      count: item.count,
      bytes: item.bytes,
      avgDurationMs: item.count > 0 ? item.durationSum / item.count : 0,
    }))
    .sort((a, b) => b.count - a.count || b.bytes - a.bytes)
}

export function subscribeFilesIoMetrics(listener: () => void): () => void {
  window.addEventListener(FILES_IO_METRICS_CHANGED_EVENT, listener)
  return () => window.removeEventListener(FILES_IO_METRICS_CHANGED_EVENT, listener)
}

export const formatFilesIoBytesPerSec = formatProxyServerBytesPerSec
export const formatFilesIoDataBytes = formatProxyServerDataBytes
export const formatFilesIoAxisTick = formatProxyServerAxisTick

export function formatFilesIoOpsPerSec(opsPerSec: number | undefined): string {
  if (opsPerSec === undefined || !Number.isFinite(opsPerSec) || opsPerSec < 0) {
    return '—'
  }
  if (opsPerSec < 10) {
    return `${opsPerSec.toFixed(1)} 次/s`
  }
  return `${opsPerSec.toFixed(0)} 次/s`
}

export function formatFilesIoOpsAxisTick(opsPerSec: number): string {
  if (opsPerSec >= 100) {
    return `${Math.round(opsPerSec)}`
  }
  if (opsPerSec >= 10) {
    return opsPerSec.toFixed(0)
  }
  return opsPerSec.toFixed(1)
}

export function formatFilesIoDurationMs(durationMs: number | undefined): string {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) {
    return '—'
  }
  if (durationMs < 1) {
    return '<1 ms'
  }
  if (durationMs < 1000) {
    return `${durationMs < 10 ? durationMs.toFixed(1) : durationMs.toFixed(0)} ms`
  }
  return `${(durationMs / 1000).toFixed(2)} s`
}

export function formatFilesIoDurationAxisTick(durationMs: number): string {
  if (durationMs >= 1000) {
    return `${(durationMs / 1000).toFixed(1)} s`
  }
  return `${Math.round(durationMs)} ms`
}

export function formatFilesIoOpLabel(op: string | undefined): string {
  switch (op) {
    case 'readText':
      return '读文本'
    case 'readBlob':
      return '读二进制'
    case 'writeText':
      return '写文本'
    case 'writeBinary':
      return '写二进制'
    case 'createText':
      return '新建文本'
    case 'createBinary':
      return '新建二进制'
    case 'upsertBatch':
      return '批量写入'
    default:
      return op ?? '其他'
  }
}
