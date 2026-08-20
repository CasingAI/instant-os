import { formatStorageSize } from '../../os/format-storage-size.ts'
import type { GeneratedAppHeapReport } from '../../os/generated-app-heap-reports.ts'
import { isGeneratedAppProcessIsolationActive } from '../../os/resolve-generated-app-process-isolation.ts'
import type { WorkerHeapReport } from '../../os/worker-heap-reports.ts'

export type JsHeapSnapshot = {
  usedBytes: number
  totalBytes: number
  limitBytes: number
}

/**
 * performance.memory 按「隔离堆 / 进程」报整堆，不是按应用分摊。
 * 多个微应用若落在同一堆，各自上报几乎相同；必须先按指纹去重再合计。
 */
export type MemoryHeapCluster = {
  usedBytes: number
  totalBytes: number
  limitBytes: number
  /** 共享该堆的上报窗口数 */
  reportCount: number
  appIds: string[]
  windowIds: string[]
  /** 是否与宿主堆读数一致（同堆） */
  sharedWithHost: boolean
}

export type MemoryTrackingMode = 'host-only' | 'deduped-heaps'

export type AggregatedMemorySnapshot = {
  mode: MemoryTrackingMode
  /** 折线主读数：宿主 + 去重后微应用堆。 */
  display: JsHeapSnapshot | undefined
  host: JsHeapSnapshot | undefined
  /** 与宿主不同堆的微应用侧合计（已去重）。 */
  apps: JsHeapSnapshot | undefined
  /** 存活的系统服务 Worker 列表（无法读取各自堆大小）。 */
  workerReports: WorkerHeapReport[]
  /** 去重后的独立堆；含宿主时 sharedWithHost 为 true。 */
  heapClusters: MemoryHeapCluster[]
  appReports: GeneratedAppHeapReport[]
  isolationActive: boolean
  /** 微应用上报里被识别为同一堆的窗口数（>1 表示存在共享）。 */
  sharedGuestReportCount: number
}

type PerformanceMemory = {
  usedJSHeapSize: number
  totalJSHeapSize: number
  jsHeapSizeLimit: number
}

/** 同堆读数允许的相对误差；GC 间隙下各帧上报会有小幅抖动。 */
const HEAP_FINGERPRINT_TOLERANCE = 0.04
const HEAP_FINGERPRINT_ABS_BYTES = 256 * 1024

export function readJsHeapSnapshot(): JsHeapSnapshot | undefined {
  const mem = (performance as Performance & { memory?: PerformanceMemory }).memory
  if (!mem || typeof mem.usedJSHeapSize !== 'number') {
    return undefined
  }
  return {
    usedBytes: mem.usedJSHeapSize,
    totalBytes: mem.totalJSHeapSize,
    limitBytes: mem.jsHeapSizeLimit,
  }
}

export function formatFps(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  if (value >= 100) {
    return `${Math.round(value)} FPS`
  }
  if (value >= 10) {
    return `${value.toFixed(0)} FPS`
  }
  return `${value.toFixed(1)} FPS`
}

export function formatMemoryBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return '—'
  }
  return formatStorageSize(bytes)
}

/** 内存轴标签：紧凑显示，避免左侧挤爆。 */
export function formatMemoryAxisTick(bytes: number): string {
  if (bytes <= 0) {
    return '0'
  }
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) {
    const gb = mb / 1024
    return gb >= 10 || Number.isInteger(gb) ? `${Math.round(gb)}G` : `${gb.toFixed(1)}G`
  }
  if (mb >= 10) {
    return `${Math.round(mb)}M`
  }
  if (mb >= 1) {
    return `${mb.toFixed(1)}M`
  }
  return formatStorageSize(bytes)
}

export function memoryUsagePercent(snapshot: JsHeapSnapshot | undefined): number | undefined {
  if (!snapshot || snapshot.limitBytes <= 0) {
    return undefined
  }
  return Math.min(100, (snapshot.usedBytes / snapshot.limitBytes) * 100)
}

export function heapsLookShared(
  a: Pick<JsHeapSnapshot, 'usedBytes' | 'totalBytes' | 'limitBytes'>,
  b: Pick<JsHeapSnapshot, 'usedBytes' | 'totalBytes' | 'limitBytes'>,
): boolean {
  return (
    valuesLookShared(a.usedBytes, b.usedBytes) &&
    valuesLookShared(a.totalBytes, b.totalBytes) &&
    valuesLookShared(a.limitBytes, b.limitBytes)
  )
}

function valuesLookShared(a: number, b: number): boolean {
  const delta = Math.abs(a - b)
  if (delta <= HEAP_FINGERPRINT_ABS_BYTES) {
    return true
  }
  const scale = Math.max(a, b, 1)
  return delta / scale <= HEAP_FINGERPRINT_TOLERANCE
}

/**
 * 将各窗口上报按「是否像同一隔离堆」聚类；每簇取最大已用作为该堆代表读数。
 */
export function clusterSharedHeaps(
  reports: GeneratedAppHeapReport[],
  host: JsHeapSnapshot | undefined,
): MemoryHeapCluster[] {
  const clusters: MemoryHeapCluster[] = []

  for (const report of reports) {
    const existing = clusters.find((cluster) => heapsLookShared(cluster, report))
    if (existing) {
      existing.reportCount += 1
      if (!existing.appIds.includes(report.appId)) {
        existing.appIds.push(report.appId)
      }
      existing.windowIds.push(report.windowId)
      if (report.usedBytes > existing.usedBytes) {
        existing.usedBytes = report.usedBytes
        existing.totalBytes = report.totalBytes
        existing.limitBytes = report.limitBytes
      }
      continue
    }

    clusters.push({
      usedBytes: report.usedBytes,
      totalBytes: report.totalBytes,
      limitBytes: report.limitBytes,
      reportCount: 1,
      appIds: [report.appId],
      windowIds: [report.windowId],
      sharedWithHost: host ? heapsLookShared(host, report) : false,
    })
  }

  for (const cluster of clusters) {
    if (!cluster.sharedWithHost && host) {
      cluster.sharedWithHost = heapsLookShared(host, cluster)
    }
  }

  return clusters
}

export function aggregateMemorySnapshot(
  host: JsHeapSnapshot | undefined,
  appReports: GeneratedAppHeapReport[],
  isolationActive = isGeneratedAppProcessIsolationActive(),
  workerReports: WorkerHeapReport[] = [],
): AggregatedMemorySnapshot {
  const heapClusters = clusterSharedHeaps(appReports, host)
  const sharedGuestReportCount = heapClusters.reduce(
    (sum, cluster) => sum + Math.max(0, cluster.reportCount - 1),
    0,
  )

  if (!isolationActive) {
    // 同域模式下宿主与微应用通常同堆：只计宿主，避免把整堆读数按窗口数翻倍。
    return {
      mode: 'host-only',
      display: host,
      host,
      apps: undefined,
      workerReports,
      heapClusters,
      appReports,
      isolationActive: false,
      sharedGuestReportCount,
    }
  }

  const guestOnlyClusters = heapClusters.filter((cluster) => !cluster.sharedWithHost)
  const apps =
    guestOnlyClusters.length === 0
      ? undefined
      : {
          usedBytes: guestOnlyClusters.reduce((sum, cluster) => sum + cluster.usedBytes, 0),
          totalBytes: guestOnlyClusters.reduce((sum, cluster) => sum + cluster.totalBytes, 0),
          limitBytes: guestOnlyClusters.reduce((sum, cluster) => sum + cluster.limitBytes, 0),
        }

  const display =
    !host && !apps
      ? undefined
      : {
          usedBytes: (host?.usedBytes ?? 0) + (apps?.usedBytes ?? 0),
          totalBytes: (host?.totalBytes ?? 0) + (apps?.totalBytes ?? 0),
          limitBytes: (host?.limitBytes ?? 0) + (apps?.limitBytes ?? 0),
        }

  return {
    mode: 'deduped-heaps',
    display,
    host,
    apps,
    workerReports,
    heapClusters,
    appReports,
    isolationActive: true,
    sharedGuestReportCount,
  }
}
