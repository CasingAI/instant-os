import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import {
  AI_EVENT_LOG_CHANGED_EVENT,
  formatDurationMs,
  formatTokensPerSecond,
  getLiveAiEventLogCount,
  loadRecentEventLogs,
  type AiEventLogRecord,
} from '../../ai/ai-event-log.ts'
import { formatUsageTime } from '../../ai/ai-token-usage.ts'
import { formatTokenCount } from '../browser/format-token-count.ts'
import {
  analyzeAiEventPerformance,
  type AiPerformanceAnalysis,
} from './task-manager-ai-performance.ts'
import {
  buildRealtimeMetricPolyline,
  type MetricSeriesPoint,
} from './task-manager-metric-series.ts'
import {
  buildRealtimeSpeedPolyline,
  SPEED_SERIES_MAX_POINTS,
  speedSeriesTimeWindowLabel,
  type SpeedSampleIntervalSec,
  type SpeedSeriesPoint,
} from './task-manager-speed-series.ts'
import {
  formatFps,
  formatMemoryAxisTick,
  formatMemoryBytes,
  memoryUsagePercent,
  type AggregatedMemorySnapshot,
  type MemoryHeapCluster,
} from './task-manager-system-metrics.ts'

const LOG_LIMIT = 200
const CHART_VIEW_WIDTH = 960
const CHART_VIEW_HEIGHT = 280
/** 左侧留给轴标签；窄屏字号按 viewBox 放大后仍需足够边距 */
const CHART_PADDING = { top: 16, right: 16, bottom: 20, left: 72 }
const CHART_PLOT_LEFT = CHART_PADDING.left
const CHART_AXIS_LABEL_X = CHART_PADDING.left - 6

type PerfCategory = 'ai' | 'fps' | 'memory'

const PERF_CATEGORIES: { id: PerfCategory; label: string }[] = [
  { id: 'ai', label: 'AI 输出' },
  { id: 'fps', label: '帧率' },
  { id: 'memory', label: '内存' },
]

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div class="task-manager__stat">
      <span class="task-manager__stat-label">{label}</span>
      <span class="task-manager__stat-value">{value}</span>
      {hint ? <span class="task-manager__stat-hint">{hint}</span> : undefined}
    </div>
  )
}

type TaskManagerPerformancePanelProps = {
  sampleIntervalSec: SpeedSampleIntervalSec
  series: SpeedSeriesPoint[]
  fpsSeries: MetricSeriesPoint[]
  memorySeries: MetricSeriesPoint[]
  latestFps: number
  memory: AggregatedMemorySnapshot
  memorySupported: boolean
}

function formatHeapClusterLabel(cluster: MemoryHeapCluster, index: number, total: number): string {
  if (cluster.sharedWithHost) {
    return '与宿主同堆'
  }
  if (total <= 1) {
    return cluster.reportCount > 1 ? '微应用（共享堆）' : '微应用'
  }
  return cluster.reportCount > 1 ? `微应用堆 ${index + 1}（共享）` : `微应用堆 ${index + 1}`
}

export function TaskManagerPerformancePanel({
  sampleIntervalSec,
  series,
  fpsSeries,
  memorySeries,
  latestFps,
  memory,
  memorySupported,
}: TaskManagerPerformancePanelProps) {
  const [category, setCategory] = useState<PerfCategory>('ai')
  const [records, setRecords] = useState<AiEventLogRecord[]>([])

  const latestHeap = memory.display
  const hostHeap = memory.host
  const appsHeap = memory.apps
  const isolationActive = memory.isolationActive

  const refresh = useCallback(async () => {
    const next = await loadRecentEventLogs(LOG_LIMIT)
    setRecords(next)
  }, [])

  useEffect(() => {
    void refresh()
    const onChanged = () => {
      void refresh()
    }
    window.addEventListener(AI_EVENT_LOG_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(AI_EVENT_LOG_CHANGED_EVENT, onChanged)
  }, [refresh])

  const analysis = useMemo((): AiPerformanceAnalysis => analyzeAiEventPerformance(records), [records])
  const chart = useMemo(
    () => buildRealtimeSpeedPolyline(series, CHART_VIEW_WIDTH, CHART_VIEW_HEIGHT, CHART_PADDING),
    [series],
  )
  const fpsChart = useMemo(
    () =>
      buildRealtimeMetricPolyline(fpsSeries, CHART_VIEW_WIDTH, CHART_VIEW_HEIGHT, CHART_PADDING, {
        minAxisMax: 60,
        formatTick: (value) => (value >= 10 ? `${Math.round(value)}` : value.toFixed(1)),
      }),
    [fpsSeries],
  )
  const memoryChart = useMemo(
    () =>
      buildRealtimeMetricPolyline(
        memorySeries,
        CHART_VIEW_WIDTH,
        CHART_VIEW_HEIGHT,
        CHART_PADDING,
        {
          formatTick: formatMemoryAxisTick,
          minAxisMax: latestHeap?.limitBytes ? latestHeap.limitBytes * 0.05 : undefined,
        },
      ),
    [latestHeap?.limitBytes, memorySeries],
  )
  const recentSamples = useMemo(
    () => [...analysis.samples].reverse().slice(0, 5),
    [analysis.samples],
  )
  const liveCount = getLiveAiEventLogCount()

  const hasSpeed = series.some((point) => point.tokensPerSecond > 0)
  const windowAverage =
    series.length === 0
      ? undefined
      : series.reduce((sum, point) => sum + point.tokensPerSecond, 0) / series.length
  const windowPeak = hasSpeed ? chart.maxSpeed : undefined
  const sampleMeta = speedSeriesTimeWindowLabel(series.length, sampleIntervalSec)
  const fpsSampleMeta = speedSeriesTimeWindowLabel(fpsSeries.length, sampleIntervalSec)
  const memorySampleMeta = speedSeriesTimeWindowLabel(memorySeries.length, sampleIntervalSec)

  const fpsWindowAverage =
    fpsSeries.length === 0
      ? undefined
      : fpsSeries.reduce((sum, point) => sum + point.value, 0) / fpsSeries.length
  const fpsWindowPeak = fpsSeries.length === 0 ? undefined : fpsChart.maxValue

  const memoryWindowPeak = memorySeries.length === 0 ? undefined : memoryChart.maxValue
  const heapPercent = memoryUsagePercent(latestHeap)
  const appReportCount = memory.appReports.length
  const uniqueGuestHeapCount = memory.heapClusters.filter((cluster) => !cluster.sharedWithHost).length
  const guestClusters = memory.heapClusters.filter((cluster) => !cluster.sharedWithHost)

  const categoryNow =
    category === 'ai'
      ? formatTokensPerSecond(chart.latest)
      : category === 'fps'
        ? formatFps(latestFps)
        : formatMemoryBytes(latestHeap?.usedBytes)

  const categorySubtitle =
    category === 'ai'
      ? `实时采样输出速度${liveCount > 0 ? ` · ${liveCount} 路正在生成` : ' · 当前无生成'}${
          analysis.sampleCount > 0 ? ` · 历史可分析 ${analysis.sampleCount} 条` : ''
        }`
      : category === 'fps'
        ? '主线程动画帧速率（与屏幕标称刷新率可能不同）'
        : !memorySupported
          ? '当前浏览器不支持读取 JS 堆内存'
          : isolationActive
            ? `按独立堆去重后合计${uniqueGuestHeapCount > 0 ? ` · ${uniqueGuestHeapCount} 个微应用堆` : ''}${
                memory.sharedGuestReportCount > 0 ? ' · 已合并同堆上报' : ''
              }`
            : '宿主 JS 堆（同域微应用通常同堆，不计多份）'

  return (
    <section class="task-manager__section task-manager__section--performance">
      <div class="task-manager__perf-layout">
        <nav class="task-manager__perf-nav" aria-label="性能栏目">
          {PERF_CATEGORIES.map((item) => {
            const active = category === item.id
            const value =
              item.id === 'ai'
                ? formatTokensPerSecond(chart.latest)
                : item.id === 'fps'
                  ? formatFps(latestFps)
                  : formatMemoryBytes(latestHeap?.usedBytes)
            const hint =
              item.id === 'ai'
                ? liveCount > 0
                  ? `${liveCount} 路生成中`
                  : '空闲'
                : item.id === 'fps'
                  ? fpsSampleMeta
                  : memorySupported
                    ? isolationActive
                      ? uniqueGuestHeapCount > 0
                        ? `${uniqueGuestHeapCount} 个独立堆`
                        : '隔离去重'
                      : '仅宿主'
                    : '不可用'
            return (
              <button
                key={item.id}
                type="button"
                class={`task-manager__perf-nav-item${active ? ' task-manager__perf-nav-item--active' : ''}`}
                aria-pressed={active}
                onClick={() => setCategory(item.id)}
              >
                <span class="task-manager__perf-nav-label">{item.label}</span>
                <span class="task-manager__perf-nav-value">{value}</span>
                <span class="task-manager__perf-nav-hint">{hint}</span>
              </button>
            )
          })}
        </nav>

        <div class="task-manager__perf-main">
          <div class="task-manager__perf-toolbar">
            <div class="task-manager__perf-toolbar-copy">
              <h2 class="task-manager__section-title">
                {PERF_CATEGORIES.find((item) => item.id === category)?.label}
              </h2>
              <p class="task-manager__section-subtitle">
                {categorySubtitle}
                <span class="task-manager__section-subtitle-meta">
                  {' '}
                  ·{' '}
                  {category === 'ai'
                    ? sampleMeta
                    : category === 'fps'
                      ? fpsSampleMeta
                      : memorySampleMeta}
                </span>
              </p>
            </div>
            <div class="task-manager__chart-now">
              <span class="task-manager__chart-now-label">当前</span>
              <span class="task-manager__chart-now-value">{categoryNow}</span>
            </div>
          </div>

          {category === 'ai' && (
            <div class="task-manager__perf-dashboard">
              <div class="task-manager__perf-chart-col">
                <div class="task-manager__chart-card task-manager__chart-card--hero">
                  <div class="task-manager__chart-header">
                    <h3 class="task-manager__chart-title">输出速度</h3>
                    <span class="task-manager__chart-meta">
                      {sampleMeta}
                      {' · '}
                      峰值 {formatTokensPerSecond(windowPeak)}
                    </span>
                  </div>
                  <div class="task-manager__chart-frame">
                    <MetricChart
                      chart={chart}
                      ariaLabel="输出 token 速度实时折线图"
                      tickClassPeak
                    />
                  </div>
                </div>
              </div>

              <div class="task-manager__perf-side-col">
                <div class="task-manager__stats">
                  <StatCard
                    label="窗口平均"
                    value={formatTokensPerSecond(windowAverage)}
                    hint={sampleMeta}
                  />
                  <StatCard label="窗口峰值" value={formatTokensPerSecond(windowPeak)} />
                  <StatCard
                    label="历史平均"
                    value={formatTokensPerSecond(analysis.averageTokensPerSecond)}
                    hint="已完成 + 进行中请求"
                  />
                </div>
              </div>

              <div class="task-manager__perf-bottom">
                {analysis.byActor.length > 0 && (
                  <div class="task-manager__list task-manager__list--compact">
                    <div class="task-manager__list-header">按应用</div>
                    {analysis.byActor.map((actor) => (
                      <div key={actor.actorLabel} class="task-manager__perf-row">
                        <span class="task-manager__perf-name">
                          {actor.actorLabel}
                          {actor.liveCount > 0 ? (
                            <span class="task-manager__perf-live-badge">生成中</span>
                          ) : undefined}
                        </span>
                        <span class="task-manager__perf-meta">
                          {actor.sampleCount} 次 · 平均{' '}
                          {formatTokensPerSecond(actor.averageTokensPerSecond)}
                        </span>
                        <span class="task-manager__perf-side">
                          {formatDurationMs(actor.averageDurationMs)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div class="task-manager__list task-manager__list--compact">
                  <div class="task-manager__list-header">最近请求</div>
                  {recentSamples.length === 0 ? (
                    <p class="task-manager__list-empty">开始 AI 生成后，这里会列出各次请求。</p>
                  ) : (
                    recentSamples.map((sample) => (
                      <div
                        key={sample.id}
                        class={`task-manager__perf-row${sample.live ? ' task-manager__perf-row--live' : ''}`}
                      >
                        <span class="task-manager__perf-name">
                          {sample.actorLabel}
                          <span class="task-manager__perf-behavior"> · {sample.behaviorLabel}</span>
                          {sample.live ? (
                            <span class="task-manager__perf-live-badge">生成中</span>
                          ) : undefined}
                        </span>
                        <span class="task-manager__perf-meta">
                          {sample.live ? '实时' : formatUsageTime(sample.at)} ·{' '}
                          {sample.usageEstimated ? '约 ' : ''}
                          {formatTokenCount(sample.completionTokens)} tok ·{' '}
                          {formatDurationMs(sample.durationMs)}
                          {sample.timeToFirstTokenMs !== undefined
                            ? ` · TTFT ${formatDurationMs(sample.timeToFirstTokenMs)}`
                            : ''}
                        </span>
                        <span class="task-manager__perf-side">
                          {formatTokensPerSecond(sample.tokensPerSecond)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {category === 'fps' && (
            <div class="task-manager__perf-dashboard">
              <div class="task-manager__perf-chart-col">
                <div class="task-manager__chart-card task-manager__chart-card--hero">
                  <div class="task-manager__chart-header">
                    <h3 class="task-manager__chart-title">帧率</h3>
                    <span class="task-manager__chart-meta">
                      {fpsSampleMeta}
                      {' · '}
                      峰值 {formatFps(fpsWindowPeak)}
                    </span>
                  </div>
                  <div class="task-manager__chart-frame">
                    <MetricChart chart={fpsChart} ariaLabel="帧率实时折线图" />
                  </div>
                </div>
              </div>

              <div class="task-manager__perf-side-col">
                <div class="task-manager__stats">
                  <StatCard label="当前" value={formatFps(latestFps)} hint="约每 0.5 秒刷新" />
                  <StatCard
                    label="窗口平均"
                    value={formatFps(fpsWindowAverage)}
                    hint={fpsSampleMeta}
                  />
                  <StatCard label="窗口峰值" value={formatFps(fpsWindowPeak)} />
                </div>
              </div>
            </div>
          )}

          {category === 'memory' && (
            <div class="task-manager__perf-dashboard">
              <div class="task-manager__perf-chart-col">
                <div class="task-manager__chart-card task-manager__chart-card--hero">
                  <div class="task-manager__chart-header">
                    <h3 class="task-manager__chart-title">
                      {isolationActive ? '合计已用内存' : '宿主已用内存'}
                    </h3>
                    <span class="task-manager__chart-meta">
                      {memorySupported
                        ? `${memorySampleMeta} · 峰值 ${formatMemoryBytes(memoryWindowPeak)}`
                        : '不可用'}
                    </span>
                  </div>
                  <div class="task-manager__chart-frame">
                    {memorySupported ? (
                      <MetricChart chart={memoryChart} ariaLabel="JS 堆内存实时折线图" />
                    ) : (
                      <p class="task-manager__chart-unavailable">
                        当前浏览器未暴露 JS 堆内存接口，无法绘制内存曲线。
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div class="task-manager__perf-side-col">
                <div class="task-manager__stats">
                  <StatCard
                    label={isolationActive ? '合计已用' : '宿主已用'}
                    value={formatMemoryBytes(latestHeap?.usedBytes)}
                    hint={
                      heapPercent !== undefined
                        ? `约占上限 ${heapPercent.toFixed(0)}%`
                        : undefined
                    }
                  />
                  <StatCard
                    label="宿主"
                    value={formatMemoryBytes(hostHeap?.usedBytes)}
                    hint={
                      hostHeap
                        ? `已分配 ${formatMemoryBytes(hostHeap.totalBytes)}`
                        : undefined
                    }
                  />
                  <StatCard
                    label="微应用"
                    value={formatMemoryBytes(appsHeap?.usedBytes)}
                    hint={
                      isolationActive
                        ? uniqueGuestHeapCount > 0
                          ? memory.sharedGuestReportCount > 0
                            ? `${uniqueGuestHeapCount} 堆 · 已去重`
                            : `${uniqueGuestHeapCount} 个独立堆`
                          : '暂无独立微应用堆'
                        : appReportCount > 0
                          ? '同域同堆，未另计'
                          : '进程隔离关闭'
                    }
                  />
                </div>
              </div>

              <div class="task-manager__perf-bottom">
                <div class="task-manager__list task-manager__list--compact">
                  <div class="task-manager__list-header">按独立堆</div>
                  <div class="task-manager__perf-row">
                    <span class="task-manager__perf-name">系统外壳</span>
                    <span class="task-manager__perf-meta">
                      已分配 {formatMemoryBytes(hostHeap?.totalBytes)} · 上限{' '}
                      {formatMemoryBytes(hostHeap?.limitBytes)}
                    </span>
                    <span class="task-manager__perf-side">
                      {formatMemoryBytes(hostHeap?.usedBytes)}
                    </span>
                  </div>
                  {guestClusters.length === 0 ? (
                    <p class="task-manager__list-empty">
                      {isolationActive
                        ? appReportCount > 0
                          ? '当前微应用上报与宿主同堆，已并入外壳，未再加总。'
                          : '打开带心跳的微应用后，这里按独立堆列出（同堆应用会合并且只计一次）。'
                        : '进程隔离关闭时，同域微应用与宿主通常共享同一 JS 堆，故只统计外壳。'}
                    </p>
                  ) : (
                    guestClusters.map((cluster, index) => (
                      <div
                        key={cluster.windowIds.join('|')}
                        class="task-manager__perf-row"
                      >
                        <span class="task-manager__perf-name">
                          {formatHeapClusterLabel(cluster, index, guestClusters.length)}
                        </span>
                        <span class="task-manager__perf-meta">
                          {cluster.reportCount > 1
                            ? `${cluster.reportCount} 个窗口 · `
                            : ''}
                          已分配 {formatMemoryBytes(cluster.totalBytes)} · 上限{' '}
                          {formatMemoryBytes(cluster.limitBytes)}
                        </span>
                        <span class="task-manager__perf-side">
                          {formatMemoryBytes(cluster.usedBytes)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          <p class="task-manager__footnote">
            {category === 'ai'
              ? `打开性能监视器后即按间隔写入速度点；无生成时记 0。菜单栏「视图」可切换 0.5 / 1 / 3 / 5 秒，最多保留 ${SPEED_SERIES_MAX_POINTS} 个点。`
              : category === 'fps'
                ? `帧率由主线程动画帧推算，部分浏览器会把页面更新锁在约 60，即使屏幕是 120；拖动等合成器动画仍可能更顺。折线按采样间隔写入，最多保留 ${SPEED_SERIES_MAX_POINTS} 个点。`
                : memorySupported
                  ? `JS 堆接口按隔离堆报整堆，不是按应用分摊；多个第三方应用若同堆，只计一份。折线为去重后的独立堆之和（非整机物理内存）。最多保留 ${SPEED_SERIES_MAX_POINTS} 个点。`
                  : '内存数据依赖 Chromium 系浏览器的 JS 堆接口；Safari 等环境通常不可用。'}
          </p>
        </div>
      </div>
    </section>
  )
}

type MetricChartModel = {
  linePoints: string
  areaPoints: string
  axisMax: number
  ticks: { value: number; label: string; y: number }[]
}

function MetricChart({
  chart,
  ariaLabel,
  tickClassPeak = false,
}: {
  chart: MetricChartModel
  ariaLabel: string
  tickClassPeak?: boolean
}) {
  return (
    <svg
      class="task-manager__chart"
      viewBox={`0 0 ${CHART_VIEW_WIDTH} ${CHART_VIEW_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={ariaLabel}
    >
      {chart.ticks.map((tick) => (
        <g key={`tick-${tick.value}`}>
          <line
            class={`task-manager__chart-grid${tick.value === 0 ? ' task-manager__chart-grid--baseline' : ''}${tickClassPeak && tick.value === chart.axisMax ? ' task-manager__chart-grid--peak' : ''}`}
            x1={CHART_PLOT_LEFT}
            y1={tick.y}
            x2={CHART_VIEW_WIDTH - 16}
            y2={tick.y}
          />
          <text
            class={`task-manager__chart-axis${tickClassPeak && tick.value === chart.axisMax ? ' task-manager__chart-axis--peak' : ''}`}
            x={CHART_AXIS_LABEL_X}
            y={tick.y}
            text-anchor="end"
            dominant-baseline="middle"
          >
            {tick.label}
          </text>
        </g>
      ))}
      {chart.areaPoints && (
        <polygon class="task-manager__chart-area" points={chart.areaPoints} />
      )}
      {chart.linePoints && (
        <polyline class="task-manager__chart-line" fill="none" points={chart.linePoints} />
      )}
    </svg>
  )
}
