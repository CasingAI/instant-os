import {
  formatAxisTickLabel,
  niceAxisScale,
  SPEED_SERIES_MAX_POINTS,
  type SpeedChartTick,
} from './task-manager-speed-series.ts'

export type MetricSeriesPoint = {
  at: number
  value: number
}

export function appendMetricSeriesPoint(
  series: MetricSeriesPoint[],
  point: MetricSeriesPoint,
  maxPoints = SPEED_SERIES_MAX_POINTS,
): MetricSeriesPoint[] {
  const next = [...series, point]
  if (next.length <= maxPoints) {
    return next
  }
  return next.slice(next.length - maxPoints)
}

/**
 * 按「固定槽位」铺点：窗口最多 MAX 个点，新点在右侧；
 * Y 轴用整齐刻度。formatTick 可覆盖默认轴标签（如内存字节）。
 */
export function buildRealtimeMetricPolyline(
  series: MetricSeriesPoint[],
  width: number,
  height: number,
  padding: { top: number; right: number; bottom: number; left: number },
  options?: {
    formatTick?: (value: number) => string
    /** 轴下限抬高到该值（例如 FPS 常见按 60 看） */
    minAxisMax?: number
  },
): {
  linePoints: string
  areaPoints: string
  maxValue: number
  axisMax: number
  latest: number
  ticks: SpeedChartTick[]
} {
  const plotWidth = Math.max(1, width - padding.left - padding.right)
  const plotHeight = Math.max(1, height - padding.top - padding.bottom)
  const latest = series.length > 0 ? series[series.length - 1]!.value : 0
  const rawMax = Math.max(0, ...series.map((point) => point.value), latest)
  const floorMax = Math.max(rawMax, options?.minAxisMax ?? 0)
  const { axisMax, ticks: tickValues } = niceAxisScale(floorMax)
  const formatTick = options?.formatTick ?? formatAxisTickLabel
  const ticks = tickValues.map((value) => ({
    value,
    label: formatTick(value),
    y: padding.top + plotHeight * (1 - value / axisMax),
  }))

  if (series.length === 0) {
    return {
      linePoints: '',
      areaPoints: '',
      maxValue: rawMax,
      axisMax,
      latest: 0,
      ticks,
    }
  }

  const slotCount = SPEED_SERIES_MAX_POINTS
  const step = plotWidth / (slotCount - 1)
  const startSlot = slotCount - series.length

  const coords = series.map((point, index) => {
    const x = padding.left + (startSlot + index) * step
    const y = padding.top + plotHeight * (1 - point.value / axisMax)
    return { x, y }
  })

  const linePoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
  const first = coords[0]!
  const last = coords[coords.length - 1]!
  const baseline = padding.top + plotHeight
  const areaPoints = [
    `${first.x.toFixed(1)},${baseline.toFixed(1)}`,
    ...coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`),
    `${last.x.toFixed(1)},${baseline.toFixed(1)}`,
  ].join(' ')

  return { linePoints, areaPoints, maxValue: rawMax, axisMax, latest, ticks }
}
