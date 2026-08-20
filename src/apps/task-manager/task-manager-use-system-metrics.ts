import { useEffect, useRef, useState } from 'preact/hooks'
import {
  EXPERIMENTAL_SETTINGS_CHANGED_EVENT,
} from '../../os/experimental-settings-storage.ts'
import { listGeneratedAppHeapReports } from '../../os/generated-app-heap-reports.ts'
import { SANDBOXED_CORS_PROBE_COMPLETED_EVENT } from '../../os/resolve-generated-app-process-isolation.ts'
import {
  listWorkerHeapReports,
  WORKER_HEAP_REPORTS_CHANGED_EVENT,
} from '../../os/worker-heap-reports.ts'
import {
  appendMetricSeriesPoint,
  type MetricSeriesPoint,
} from './task-manager-metric-series.ts'
import { SPEED_SERIES_MAX_POINTS, type SpeedSampleIntervalSec } from './task-manager-speed-series.ts'
import {
  aggregateMemorySnapshot,
  readJsHeapSnapshot,
  type AggregatedMemorySnapshot,
} from './task-manager-system-metrics.ts'

export type TaskManagerSystemMetrics = {
  fpsSeries: MetricSeriesPoint[]
  memorySeries: MetricSeriesPoint[]
  latestFps: number
  memory: AggregatedMemorySnapshot
  memorySupported: boolean
}

function readAggregatedMemory(): AggregatedMemorySnapshot {
  return aggregateMemorySnapshot(
    readJsHeapSnapshot(),
    listGeneratedAppHeapReports(),
    undefined,
    listWorkerHeapReports(),
  )
}

/**
 * 性能监视器打开期间持续采样帧率与 JS 堆内存。
 * 内存在进程隔离开启时会汇总宿主与微应用上报，但先按堆指纹去重（同堆只计一次）；
 * 关闭时只记宿主，避免同域整堆读数按窗口翻倍。
 * Dedicated Worker 独立堆始终与宿主相加。
 */
export function useTaskManagerSystemMetrics(
  sampleIntervalSec: SpeedSampleIntervalSec,
): TaskManagerSystemMetrics {
  const [fpsSeries, setFpsSeries] = useState<MetricSeriesPoint[]>([])
  const [memorySeries, setMemorySeries] = useState<MetricSeriesPoint[]>([])
  const [latestFps, setLatestFps] = useState(0)
  const [memory, setMemory] = useState<AggregatedMemorySnapshot>(() => readAggregatedMemory())
  const [memorySupported] = useState(() => readJsHeapSnapshot() !== undefined)

  const fpsInstantRef = useRef(0)
  const frameCountRef = useRef(0)
  const frameWindowStartRef = useRef(0)

  useEffect(() => {
    setFpsSeries([])
    setMemorySeries([])
    setLatestFps(0)
    setMemory(readAggregatedMemory())
    fpsInstantRef.current = 0
    frameCountRef.current = 0
    frameWindowStartRef.current = performance.now()

    let rafId = 0
    const tickFrame = (now: number) => {
      frameCountRef.current += 1
      const elapsed = now - frameWindowStartRef.current
      if (elapsed >= 500) {
        const fps = (frameCountRef.current * 1000) / elapsed
        fpsInstantRef.current = Math.round(fps * 10) / 10
        setLatestFps(fpsInstantRef.current)
        frameCountRef.current = 0
        frameWindowStartRef.current = now
      }
      rafId = window.requestAnimationFrame(tickFrame)
    }
    rafId = window.requestAnimationFrame(tickFrame)

    const sample = () => {
      const now = Date.now()
      const fps = fpsInstantRef.current
      setFpsSeries((current) =>
        appendMetricSeriesPoint(current, { at: now, value: fps }, SPEED_SERIES_MAX_POINTS),
      )

      const nextMemory = readAggregatedMemory()
      setMemory(nextMemory)
      const displayUsed = nextMemory.display?.usedBytes
      if (displayUsed !== undefined) {
        setMemorySeries((current) =>
          appendMetricSeriesPoint(
            current,
            { at: now, value: displayUsed },
            SPEED_SERIES_MAX_POINTS,
          ),
        )
      }
    }

    const refreshMemoryBreakdown = () => {
      setMemory(readAggregatedMemory())
    }

    sample()
    const timer = window.setInterval(sample, sampleIntervalSec * 1000)
    window.addEventListener(EXPERIMENTAL_SETTINGS_CHANGED_EVENT, refreshMemoryBreakdown)
    window.addEventListener(SANDBOXED_CORS_PROBE_COMPLETED_EVENT, refreshMemoryBreakdown)
    window.addEventListener(WORKER_HEAP_REPORTS_CHANGED_EVENT, refreshMemoryBreakdown)
    return () => {
      window.cancelAnimationFrame(rafId)
      window.clearInterval(timer)
      window.removeEventListener(EXPERIMENTAL_SETTINGS_CHANGED_EVENT, refreshMemoryBreakdown)
      window.removeEventListener(SANDBOXED_CORS_PROBE_COMPLETED_EVENT, refreshMemoryBreakdown)
      window.removeEventListener(WORKER_HEAP_REPORTS_CHANGED_EVENT, refreshMemoryBreakdown)
    }
  }, [sampleIntervalSec])

  return {
    fpsSeries,
    memorySeries,
    latestFps,
    memory,
    memorySupported,
  }
}
