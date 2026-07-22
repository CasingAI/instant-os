import { useEffect, useState } from 'preact/hooks'
import {
  getFilesIoByteTotalsSince,
  getFilesIoOpBreakdown,
  listRecentFilesIoOperations,
  subscribeFilesIoMetrics,
  type FilesIoOpBreakdownItem,
  type FilesIoOperationRecord,
} from '../../os/files-io-metrics.ts'
import { FILES_MOUNTS_CHANGED_EVENT } from '../files/files-mount-store.ts'
import {
  isMountLocationId,
  type FilesLocationId,
} from '../files/files-types.ts'
import { listFilesLocations } from '../files/files-vfs.ts'
import {
  appendMetricSeriesPoint,
  type MetricSeriesPoint,
} from './task-manager-metric-series.ts'
import { SPEED_SERIES_MAX_POINTS, type SpeedSampleIntervalSec } from './task-manager-speed-series.ts'

/** 性能监视器磁盘栏目：逻辑容器（非单卷） */
export type FilesIoContainerId = 'data' | 'system' | 'physical'

export type FilesIoContainerMetrics = {
  id: FilesIoContainerId
  /** 主标题，如「数据空间」 */
  label: string
  /** 副说明，如「代码和用户数据」 */
  detail: string
  writable: boolean
  locationIds: readonly FilesLocationId[]
  /** 物理磁盘：当前挂载卷数量 */
  mountCount: number
  readSeries: MetricSeriesPoint[]
  writeSeries: MetricSeriesPoint[]
  opsSeries: MetricSeriesPoint[]
  latencySeries: MetricSeriesPoint[]
  latestReadBytesPerSec: number
  latestWriteBytesPerSec: number
  latestOpsPerSec: number
  latestAvgDurationMs: number
  latestPeakDurationMs: number
  opBreakdown: FilesIoOpBreakdownItem[]
}

export type TaskManagerFilesIoMetrics = {
  containers: FilesIoContainerMetrics[]
  recentOperations: FilesIoOperationRecord[]
}

/** @deprecated 使用 FilesIoContainerMetrics */
export type FilesIoVolumeMetrics = FilesIoContainerMetrics

const DATA_LOCATION_IDS: readonly FilesLocationId[] = ['local', 'dev']
/** 系统投影卷：系统源码 + 3D 模型 */
const SYSTEM_LOCATION_IDS: readonly FilesLocationId[] = ['source', 'models3d']

const CONTAINER_META: Record<
  FilesIoContainerId,
  { label: string; detail: string; writable: boolean }
> = {
  data: { label: '数据空间', detail: '代码和用户数据', writable: true },
  system: { label: '系统空间', detail: '系统', writable: false },
  physical: { label: '物理磁盘', detail: '挂载的', writable: true },
}

function emptyContainerMetrics(
  id: FilesIoContainerId,
  locationIds: readonly FilesLocationId[],
  mountCount = 0,
): FilesIoContainerMetrics {
  const meta = CONTAINER_META[id]
  return {
    id,
    label: meta.label,
    detail: meta.detail,
    writable: meta.writable,
    locationIds,
    mountCount,
    readSeries: [],
    writeSeries: [],
    opsSeries: [],
    latencySeries: [],
    latestReadBytesPerSec: 0,
    latestWriteBytesPerSec: 0,
    latestOpsPerSec: 0,
    latestAvgDurationMs: 0,
    latestPeakDurationMs: 0,
    opBreakdown: [],
  }
}

function buildContainerDefs(
  mountLocationIds: readonly FilesLocationId[],
): { id: FilesIoContainerId; locationIds: readonly FilesLocationId[]; mountCount: number }[] {
  return [
    { id: 'data', locationIds: DATA_LOCATION_IDS, mountCount: 0 },
    { id: 'system', locationIds: SYSTEM_LOCATION_IDS, mountCount: 0 },
    {
      id: 'physical',
      locationIds: mountLocationIds,
      mountCount: mountLocationIds.length,
    },
  ]
}

/**
 * 性能监视器打开期间按采样间隔记录各逻辑容器读写吞吐、操作次数与响应时间。
 * 仅统计经 VFS 的数据读写。
 */
export function useTaskManagerFilesIoMetrics(
  sampleIntervalSec: SpeedSampleIntervalSec,
): TaskManagerFilesIoMetrics {
  const [containers, setContainers] = useState<FilesIoContainerMetrics[]>(() =>
    buildContainerDefs([]).map((def) =>
      emptyContainerMetrics(def.id, def.locationIds, def.mountCount),
    ),
  )
  const [recentOperations, setRecentOperations] = useState<FilesIoOperationRecord[]>(() =>
    listRecentFilesIoOperations(40),
  )

  useEffect(() => {
    let cancelled = false
    let lastSampleAt = Date.now()
    const lastSampleByContainer = new Map<FilesIoContainerId, number>()

    setContainers((current) =>
      current.map((container) => ({
        ...container,
        readSeries: [],
        writeSeries: [],
        opsSeries: [],
        latencySeries: [],
        latestReadBytesPerSec: 0,
        latestWriteBytesPerSec: 0,
        latestOpsPerSec: 0,
        latestAvgDurationMs: 0,
        latestPeakDurationMs: 0,
      })),
    )

    const refreshLocations = async () => {
      const locations = await listFilesLocations()
      if (cancelled) return
      const mountIds = locations
        .map((item) => item.id)
        .filter((id): id is FilesLocationId => isMountLocationId(id))
      const defs = buildContainerDefs(mountIds)
      setContainers((current) => {
        const byId = new Map(current.map((item) => [item.id, item]))
        return defs.map((def) => {
          const existing = byId.get(def.id)
          if (existing) {
            return {
              ...existing,
              locationIds: def.locationIds,
              mountCount: def.mountCount,
              label: CONTAINER_META[def.id].label,
              detail: CONTAINER_META[def.id].detail,
              writable: CONTAINER_META[def.id].writable,
            }
          }
          if (!lastSampleByContainer.has(def.id)) {
            lastSampleByContainer.set(def.id, lastSampleAt)
          }
          return emptyContainerMetrics(def.id, def.locationIds, def.mountCount)
        })
      })
    }

    /** 事件驱动只刷新列表与分类，吞吐/次数/延迟跟采样间隔走 */
    const refreshLists = () => {
      setRecentOperations(listRecentFilesIoOperations(40))
      setContainers((current) =>
        current.map((container) => ({
          ...container,
          opBreakdown: getFilesIoOpBreakdown(container.locationIds),
        })),
      )
    }

    const sample = () => {
      const now = Date.now()
      setContainers((current) =>
        current.map((container) => {
          const since = lastSampleByContainer.get(container.id) ?? lastSampleAt
          const elapsedSec = Math.max((now - since) / 1000, 0.001)
          const delta = getFilesIoByteTotalsSince(since, container.locationIds)
          lastSampleByContainer.set(container.id, now)

          const readRate = delta.readBytes / elapsedSec
          const writeRate = delta.writeBytes / elapsedSec
          const opsRate = (delta.readOps + delta.writeOps) / elapsedSec
          const avgLatency =
            delta.durationCount > 0 ? delta.durationSumMs / delta.durationCount : 0
          return {
            ...container,
            latestReadBytesPerSec: readRate,
            latestWriteBytesPerSec: writeRate,
            latestOpsPerSec: opsRate,
            latestAvgDurationMs: avgLatency,
            latestPeakDurationMs: delta.peakDurationMs,
            opBreakdown: getFilesIoOpBreakdown(container.locationIds),
            readSeries: appendMetricSeriesPoint(
              container.readSeries,
              { at: now, value: readRate },
              SPEED_SERIES_MAX_POINTS,
            ),
            writeSeries: appendMetricSeriesPoint(
              container.writeSeries,
              { at: now, value: writeRate },
              SPEED_SERIES_MAX_POINTS,
            ),
            opsSeries: appendMetricSeriesPoint(
              container.opsSeries,
              { at: now, value: opsRate },
              SPEED_SERIES_MAX_POINTS,
            ),
            latencySeries: appendMetricSeriesPoint(
              container.latencySeries,
              { at: now, value: avgLatency },
              SPEED_SERIES_MAX_POINTS,
            ),
          }
        }),
      )
      lastSampleAt = now
      setRecentOperations(listRecentFilesIoOperations(40))
    }

    void refreshLocations().then(() => {
      if (cancelled) return
      refreshLists()
      sample()
    })

    const timer = window.setInterval(sample, sampleIntervalSec * 1000)
    const unsubMetrics = subscribeFilesIoMetrics(refreshLists)
    const onMountsChanged = () => {
      void refreshLocations()
    }
    window.addEventListener(FILES_MOUNTS_CHANGED_EVENT, onMountsChanged)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      unsubMetrics()
      window.removeEventListener(FILES_MOUNTS_CHANGED_EVENT, onMountsChanged)
    }
  }, [sampleIntervalSec])

  return {
    containers,
    recentOperations,
  }
}
