export type SpeedSampleIntervalSec = 1 | 3 | 5

export const SPEED_SAMPLE_INTERVALS: SpeedSampleIntervalSec[] = [1, 3, 5]

/** 折线最多保留的采样点数；超出后丢掉最旧的点。 */
export const SPEED_SERIES_MAX_POINTS = 60

export type SpeedSeriesPoint = {
  at: number
  tokensPerSecond: number
}

export function formatSampleIntervalLabel(seconds: SpeedSampleIntervalSec): string {
  return `${seconds} 秒`
}

export function speedSeriesTimeWindowLabel(
  pointCount: number,
  intervalSec: SpeedSampleIntervalSec,
): string {
  if (pointCount <= 0) {
    return `每 ${intervalSec} 秒采样 · 等待数据`
  }
  const windowSec = Math.max(intervalSec, (pointCount - 1) * intervalSec)
  if (windowSec < 60) {
    return `近 ${windowSec} 秒 · 每 ${intervalSec} 秒`
  }
  const minutes = windowSec / 60
  if (minutes < 10) {
    return `近 ${minutes.toFixed(1)} 分钟 · 每 ${intervalSec} 秒`
  }
  return `近 ${Math.round(minutes)} 分钟 · 每 ${intervalSec} 秒`
}

/**
 * 根据相邻两次「各会话累计 completion tokens」推算瞬时输出速度。
 * 没有仍在进行中的会话时返回 0（图表继续滚动）。
 */
export function computeInstantTokensPerSecond(options: {
  sessionTokens: Map<string, number>
  previousTokens: Map<string, number>
  elapsedSeconds: number
  fallbackRates: Map<string, number>
}): number {
  const elapsed = Math.max(0.001, options.elapsedSeconds)
  let total = 0

  for (const [id, tokens] of options.sessionTokens) {
    const previous = options.previousTokens.get(id)
    if (previous !== undefined) {
      total += Math.max(0, tokens - previous) / elapsed
      continue
    }
    const fallback = options.fallbackRates.get(id)
    if (fallback !== undefined && fallback > 0) {
      total += fallback
    }
  }

  return Math.round(total * 100) / 100
}

export function appendSpeedSeriesPoint(
  series: SpeedSeriesPoint[],
  point: SpeedSeriesPoint,
  maxPoints = SPEED_SERIES_MAX_POINTS,
): SpeedSeriesPoint[] {
  const next = [...series, point]
  if (next.length <= maxPoints) {
    return next
  }
  return next.slice(next.length - maxPoints)
}

/**
 * Y 轴顶就是真实峰值；中间刻度选整齐整数 / 5 的倍数等，且不盖住顶部真实最大值。
 */
export function niceAxisScale(rawMax: number, desiredDivisions = 4): {
  axisMax: number
  ticks: number[]
} {
  const axisMax = Math.max(0, rawMax)
  if (axisMax <= 0) {
    return { axisMax: 1, ticks: [0, 1] }
  }

  if (axisMax < 1) {
    return { axisMax, ticks: [0, axisMax] }
  }

  const roughStep = axisMax / Math.max(2, desiredDivisions)
  const step = pickNiceStep(roughStep)
  const ticks: number[] = [0]
  // 与峰值至少留出约 8% 间距，避免中间刻度贴着最大值挤在一起
  const stopBefore = axisMax * 0.92

  for (let value = step; value < stopBefore; value += step) {
    const rounded = Math.round(value * 1000) / 1000
    if (rounded > 0 && rounded < axisMax) {
      ticks.push(rounded)
    }
  }

  ticks.push(axisMax)
  return { axisMax, ticks }
}

/** 选出 1 / 2 / 5 × 10^n 这类整齐步长（含 5、10、25、50、100…）。 */
function pickNiceStep(rough: number): number {
  const safe = Math.max(rough, 1e-9)
  const exp = Math.floor(Math.log10(safe))
  const base = 10 ** exp
  const frac = safe / base
  if (frac <= 1) {
    return base
  }
  if (frac <= 2) {
    return 2 * base
  }
  if (frac <= 2.5) {
    return 2.5 * base
  }
  if (frac <= 5) {
    return 5 * base
  }
  return 10 * base
}

/** 轴标签：高速度用 k 缩写，避免 1000+ 把左侧挤爆。 */
export function formatAxisTickLabel(value: number): string {
  if (value === 0) {
    return '0'
  }
  if (value >= 10_000) {
    return `${Math.round(value / 1000)}k`
  }
  if (value >= 1000) {
    const k = value / 1000
    return k >= 10 || Number.isInteger(k) ? `${Math.round(k)}k` : `${k.toFixed(1)}k`
  }
  if (value >= 10) {
    return `${Math.round(value)}`
  }
  if (Math.abs(value - Math.round(value)) < 0.05) {
    return `${Math.round(value)}`
  }
  return value.toFixed(1)
}

export type SpeedChartTick = {
  value: number
  label: string
  y: number
}

/**
 * 按「固定槽位」铺点：窗口最多 MAX 个点，新点在右侧；
 * Y 轴用整齐刻度，而不是只标 0 与峰值。
 */
export function buildRealtimeSpeedPolyline(
  series: SpeedSeriesPoint[],
  width: number,
  height: number,
  padding: { top: number; right: number; bottom: number; left: number },
): {
  linePoints: string
  areaPoints: string
  maxSpeed: number
  axisMax: number
  latest: number
  ticks: SpeedChartTick[]
} {
  const plotWidth = Math.max(1, width - padding.left - padding.right)
  const plotHeight = Math.max(1, height - padding.top - padding.bottom)
  const latest = series.length > 0 ? series[series.length - 1]!.tokensPerSecond : 0
  const rawMax = Math.max(0, ...series.map((point) => point.tokensPerSecond), latest)
  const { axisMax, ticks: tickValues } = niceAxisScale(rawMax)
  const ticks = tickValues.map((value) => ({
    value,
    label: formatAxisTickLabel(value),
    y: padding.top + plotHeight * (1 - value / axisMax),
  }))

  if (series.length === 0) {
    return {
      linePoints: '',
      areaPoints: '',
      maxSpeed: rawMax,
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
    const y = padding.top + plotHeight * (1 - point.tokensPerSecond / axisMax)
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

  return { linePoints, areaPoints, maxSpeed: rawMax, axisMax, latest, ticks }
}

