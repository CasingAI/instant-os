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
  buildRealtimeSpeedPolyline,
  SPEED_SERIES_MAX_POINTS,
  speedSeriesTimeWindowLabel,
  type SpeedSampleIntervalSec,
  type SpeedSeriesPoint,
} from './task-manager-speed-series.ts'

const LOG_LIMIT = 200
const CHART_VIEW_WIDTH = 960
const CHART_VIEW_HEIGHT = 280

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
}

export function TaskManagerPerformancePanel({
  sampleIntervalSec,
  series,
}: TaskManagerPerformancePanelProps) {
  const [records, setRecords] = useState<AiEventLogRecord[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const next = await loadRecentEventLogs(LOG_LIMIT)
    setRecords(next)
    setLoading(false)
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
    () =>
      buildRealtimeSpeedPolyline(series, CHART_VIEW_WIDTH, CHART_VIEW_HEIGHT, {
        top: 16,
        right: 16,
        bottom: 20,
        left: 56,
      }),
    [series],
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

  if (loading) {
    return <p class="task-manager__empty">正在读取事件日志…</p>
  }

  return (
    <section class="task-manager__section task-manager__section--performance">
      <div class="task-manager__perf-toolbar">
        <div class="task-manager__perf-toolbar-copy">
          <h2 class="task-manager__section-title">AI 输出性能</h2>
          <p class="task-manager__section-subtitle">
            实时采样输出速度
            {liveCount > 0 ? ` · ${liveCount} 路正在生成` : ' · 当前无生成'}
            {analysis.sampleCount > 0
              ? ` · 历史可分析 ${analysis.sampleCount} 条`
              : ''}
            <span class="task-manager__section-subtitle-meta"> · {sampleMeta}</span>
          </p>
        </div>
        <div class="task-manager__chart-now">
          <span class="task-manager__chart-now-label">当前</span>
          <span class="task-manager__chart-now-value">
            {formatTokensPerSecond(chart.latest)}
          </span>
        </div>
      </div>

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
              <svg
                class="task-manager__chart"
                viewBox={`0 0 ${CHART_VIEW_WIDTH} ${CHART_VIEW_HEIGHT}`}
                preserveAspectRatio="xMidYMid meet"
                role="img"
                aria-label="输出 token 速度实时折线图"
              >
                {chart.ticks.map((tick) => (
                  <g key={`tick-${tick.value}`}>
                    <line
                      class={`task-manager__chart-grid${tick.value === 0 ? ' task-manager__chart-grid--baseline' : ''}${tick.value === chart.axisMax ? ' task-manager__chart-grid--peak' : ''}`}
                      x1="56"
                      y1={tick.y}
                      x2={CHART_VIEW_WIDTH - 16}
                      y2={tick.y}
                    />
                    <text
                      class={`task-manager__chart-axis${tick.value === chart.axisMax ? ' task-manager__chart-axis--peak' : ''}`}
                      x="50"
                      y={tick.y + 3.5}
                      text-anchor="end"
                    >
                      {tick.label}
                    </text>
                  </g>
                ))}
                {chart.areaPoints && (
                  <polygon class="task-manager__chart-area" points={chart.areaPoints} />
                )}
                {chart.linePoints && (
                  <polyline
                    class="task-manager__chart-line"
                    fill="none"
                    points={chart.linePoints}
                  />
                )}
              </svg>
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
                    {actor.sampleCount} 次 · 平均 {formatTokensPerSecond(actor.averageTokensPerSecond)}
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

      <p class="task-manager__footnote">
        打开性能监视器后即按间隔写入速度点；无生成时记 0。菜单栏「视图」可切换 1 / 3 / 5 秒，最多保留{' '}
        {SPEED_SERIES_MAX_POINTS} 个点。
      </p>
    </section>
  )
}
