import { useEffect, useRef, useState } from 'preact/hooks'
import {
  listLiveAiEventLogs,
  refreshLiveAiEventLogPerformance,
} from '../../ai/ai-event-log.ts'
import {
  appendSpeedSeriesPoint,
  computeInstantTokensPerSecond,
  SPEED_SERIES_MAX_POINTS,
  type SpeedSampleIntervalSec,
  type SpeedSeriesPoint,
} from './task-manager-speed-series.ts'

/**
 * 性能监视器打开期间持续采样输出速度；不依赖当前是否停留在「性能」页。
 */
export function useTaskManagerSpeedSeries(sampleIntervalSec: SpeedSampleIntervalSec): SpeedSeriesPoint[] {
  const [series, setSeries] = useState<SpeedSeriesPoint[]>([])
  const previousTokensRef = useRef<Map<string, number>>(new Map())
  const lastSampleAtRef = useRef(Date.now())

  useEffect(() => {
    setSeries([])
    previousTokensRef.current = new Map()
    lastSampleAtRef.current = Date.now()

    const sample = () => {
      refreshLiveAiEventLogPerformance()
      const live = listLiveAiEventLogs()
      const sessionTokens = new Map<string, number>()
      const fallbackRates = new Map<string, number>()

      for (const record of live) {
        sessionTokens.set(record.id, record.completionTokens ?? 0)
        if (record.completionTokensPerSecond !== undefined) {
          fallbackRates.set(record.id, record.completionTokensPerSecond)
        }
      }

      const now = Date.now()
      const elapsedSeconds = (now - lastSampleAtRef.current) / 1000
      const tokensPerSecond = computeInstantTokensPerSecond({
        sessionTokens,
        previousTokens: previousTokensRef.current,
        elapsedSeconds,
        fallbackRates,
      })

      previousTokensRef.current = sessionTokens
      lastSampleAtRef.current = now

      setSeries((current) =>
        appendSpeedSeriesPoint(
          current,
          { at: now, tokensPerSecond },
          SPEED_SERIES_MAX_POINTS,
        ),
      )
    }

    sample()
    const timer = window.setInterval(sample, sampleIntervalSec * 1000)
    return () => window.clearInterval(timer)
  }, [sampleIntervalSec])

  return series
}
