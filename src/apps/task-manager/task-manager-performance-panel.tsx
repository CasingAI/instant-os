import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  AI_EVENT_LOG_CHANGED_EVENT,
  formatDurationMs,
  formatTokensPerSecond,
  getLiveAiEventLogCount,
  listLiveAiEventLogs,
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
import {
  formatProxyServerAxisTick,
  formatProxyServerBytesPerSec,
  formatProxyServerDataBytes,
  type ProxyServerRequestRecord,
} from '../../os/proxy-server-metrics.ts'

const LOG_LIMIT = 200
const CHART_VIEW_WIDTH = 960
const CHART_VIEW_HEIGHT = 280
/** 轴标签与绘图区的间距（用户单位）；左侧宽度按实测标签动态算 */
const CHART_AXIS_LABEL_GAP = 8
const CHART_PADDING_BASE = { top: 22, right: 16, bottom: 20, left: 56 }
const CHART_AXIS_LEFT_MIN = 40
const CHART_AXIS_LEFT_MAX = 280

type ChartPadding = {
  top: number
  right: number
  bottom: number
  left: number
}

type PerfCategory = 'ai' | 'fps' | 'memory' | 'proxy-server'

const PERF_CATEGORIES: { id: PerfCategory; label: string }[] = [
  { id: 'ai', label: 'AI 输出' },
  { id: 'fps', label: '帧率' },
  { id: 'memory', label: '内存' },
  { id: 'proxy-server', label: '代理服务器' },
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
  proxyDownloadSeries: MetricSeriesPoint[]
  proxyUploadSeries: MetricSeriesPoint[]
  latestProxyDownload: number
  latestProxyUpload: number
  proxyServerConnected: boolean
  proxyRecentRequests: ProxyServerRequestRecord[]
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
  proxyDownloadSeries,
  proxyUploadSeries,
  latestProxyDownload,
  latestProxyUpload,
  proxyServerConnected,
  proxyRecentRequests,
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
  const recentSamples = useMemo(
    () => [...analysis.samples].reverse().slice(0, 5),
    [analysis.samples],
  )
  const liveCount = getLiveAiEventLogCount()
  const liveSpeedEstimated = listLiveAiEventLogs().some(
    (record) => record.usageEstimated === true,
  )

  const hasSpeed = series.some((point) => point.tokensPerSecond > 0)
  const latestSpeed = series.length > 0 ? series[series.length - 1]!.tokensPerSecond : 0
  const formatLiveSpeed = (rate: number | undefined) => {
    const text = formatTokensPerSecond(rate)
    if (text === '—' || !liveSpeedEstimated) {
      return text
    }
    return `~${text}`
  }
  const windowAverage =
    series.length === 0
      ? undefined
      : series.reduce((sum, point) => sum + point.tokensPerSecond, 0) / series.length
  const windowPeak = hasSpeed
    ? Math.max(...series.map((point) => point.tokensPerSecond))
    : undefined
  const sampleMeta = speedSeriesTimeWindowLabel(series.length, sampleIntervalSec)
  const fpsSampleMeta = speedSeriesTimeWindowLabel(fpsSeries.length, sampleIntervalSec)
  const memorySampleMeta = speedSeriesTimeWindowLabel(memorySeries.length, sampleIntervalSec)
  const proxySampleMeta = speedSeriesTimeWindowLabel(
    proxyDownloadSeries.length,
    sampleIntervalSec,
  )

  const fpsWindowAverage =
    fpsSeries.length === 0
      ? undefined
      : fpsSeries.reduce((sum, point) => sum + point.value, 0) / fpsSeries.length
  const fpsWindowPeak =
    fpsSeries.length === 0 ? undefined : Math.max(...fpsSeries.map((point) => point.value))

  const memoryWindowPeak =
    memorySeries.length === 0 ? undefined : Math.max(...memorySeries.map((point) => point.value))
  const heapPercent = memoryUsagePercent(latestHeap)
  const appReportCount = memory.appReports.length
  const uniqueGuestHeapCount = memory.heapClusters.filter((cluster) => !cluster.sharedWithHost).length
  const guestClusters = memory.heapClusters.filter((cluster) => !cluster.sharedWithHost)

  const proxyDownloadAverage =
    proxyDownloadSeries.length === 0
      ? undefined
      : proxyDownloadSeries.reduce((sum, point) => sum + point.value, 0) /
        proxyDownloadSeries.length
  const proxyDownloadPeak =
    proxyDownloadSeries.length === 0
      ? undefined
      : Math.max(...proxyDownloadSeries.map((point) => point.value))
  const proxyUploadPeak =
    proxyUploadSeries.length === 0
      ? undefined
      : Math.max(...proxyUploadSeries.map((point) => point.value))

  const categoryNow =
    category === 'ai'
      ? formatLiveSpeed(latestSpeed)
      : category === 'fps'
        ? formatFps(latestFps)
        : category === 'memory'
          ? formatMemoryBytes(latestHeap?.usedBytes)
          : formatProxyServerBytesPerSec(latestProxyDownload)

  const categorySubtitle =
    category === 'ai'
      ? `实时采样输出速度${liveCount > 0 ? ` · ${liveCount} 路正在生成` : ' · 当前无生成'}${
          analysis.sampleCount > 0 ? ` · 历史可分析 ${analysis.sampleCount} 条` : ''
        }`
      : category === 'fps'
        ? '主线程动画帧速率（与屏幕标称刷新率可能不同）'
        : category === 'memory'
          ? !memorySupported
            ? '当前浏览器不支持读取 JS 堆内存'
            : isolationActive
              ? `按独立堆去重后合计${uniqueGuestHeapCount > 0 ? ` · ${uniqueGuestHeapCount} 个微应用堆` : ''}${
                  memory.sharedGuestReportCount > 0 ? ' · 已合并同堆上报' : ''
                }`
              : '宿主 JS 堆（同域微应用通常同堆，不计多份）'
          : proxyServerConnected
            ? '经代理服务器的吞吐'
            : '尚未连接代理服务器'

  return (
    <section class="task-manager__section task-manager__section--performance">
      <div class="task-manager__perf-layout">
        <nav class="task-manager__perf-nav" aria-label="性能栏目">
          {PERF_CATEGORIES.map((item) => {
            const active = category === item.id
            const value =
              item.id === 'ai'
                ? formatLiveSpeed(latestSpeed)
                : item.id === 'fps'
                  ? formatFps(latestFps)
                  : item.id === 'memory'
                    ? formatMemoryBytes(latestHeap?.usedBytes)
                    : formatProxyServerBytesPerSec(latestProxyDownload)
            const hint =
              item.id === 'ai'
                ? liveCount > 0
                  ? `${liveCount} 路生成中`
                  : '空闲'
                : item.id === 'fps'
                  ? fpsSampleMeta
                  : item.id === 'memory'
                    ? memorySupported
                      ? isolationActive
                        ? uniqueGuestHeapCount > 0
                          ? `${uniqueGuestHeapCount} 个独立堆`
                          : '隔离去重'
                        : '仅宿主'
                      : '不可用'
                    : proxyServerConnected
                      ? proxySampleMeta
                      : '未连接'
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
                      : category === 'memory'
                        ? memorySampleMeta
                        : proxySampleMeta}
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
                      revision={series}
                      buildChart={(padding) =>
                        buildRealtimeSpeedPolyline(
                          series,
                          CHART_VIEW_WIDTH,
                          CHART_VIEW_HEIGHT,
                          padding,
                        )
                      }
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
                          {sample.usageEstimated ? '~' : ''}
                          {formatTokenCount(sample.completionTokens)} tok ·{' '}
                          {formatDurationMs(sample.durationMs)}
                          {sample.timeToFirstTokenMs !== undefined
                            ? ` · TTFT ${formatDurationMs(sample.timeToFirstTokenMs)}`
                            : ''}
                        </span>
                        <span class="task-manager__perf-side">
                          {sample.usageEstimated ? '~' : ''}
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
                    <MetricChart
                      revision={fpsSeries}
                      buildChart={(padding) =>
                        buildRealtimeMetricPolyline(
                          fpsSeries,
                          CHART_VIEW_WIDTH,
                          CHART_VIEW_HEIGHT,
                          padding,
                          {
                            minAxisMax: 60,
                            formatTick: (value) =>
                              value >= 10 ? `${Math.round(value)}` : value.toFixed(1),
                          },
                        )
                      }
                      ariaLabel="帧率实时折线图"
                    />
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
                      <MetricChart
                        revision={[memorySeries, latestHeap?.limitBytes]}
                        buildChart={(padding) =>
                          buildRealtimeMetricPolyline(
                            memorySeries,
                            CHART_VIEW_WIDTH,
                            CHART_VIEW_HEIGHT,
                            padding,
                            {
                              formatTick: formatMemoryAxisTick,
                              minAxisMax: latestHeap?.limitBytes
                                ? latestHeap.limitBytes * 0.05
                                : undefined,
                            },
                          )
                        }
                        ariaLabel="JS 堆内存实时折线图"
                      />
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

          {category === 'proxy-server' && (
            <div class="task-manager__perf-dashboard">
              <div class="task-manager__perf-chart-col">
                <div class="task-manager__chart-card task-manager__chart-card--hero">
                  <div class="task-manager__chart-header">
                    <h3 class="task-manager__chart-title">下行速率</h3>
                    <span class="task-manager__chart-meta">
                      {proxyServerConnected
                        ? `${proxySampleMeta} · 峰值 ${formatProxyServerBytesPerSec(proxyDownloadPeak)}`
                        : '未连接'}
                    </span>
                  </div>
                  <div class="task-manager__chart-frame">
                    {proxyServerConnected ? (
                      <MetricChart
                        revision={proxyDownloadSeries}
                        buildChart={(padding) =>
                          buildRealtimeMetricPolyline(
                            proxyDownloadSeries,
                            CHART_VIEW_WIDTH,
                            CHART_VIEW_HEIGHT,
                            padding,
                            {
                              formatTick: formatProxyServerAxisTick,
                              minAxisMax: 1024,
                            },
                          )
                        }
                        ariaLabel="代理服务器下行速率实时折线图"
                      />
                    ) : (
                      <p class="task-manager__chart-unavailable">
                        尚未连接代理服务器。请打开「系统设置 → 代理服务器」配置并连接。
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div class="task-manager__perf-side-col">
                <div class="task-manager__stats">
                  <StatCard
                    label="当前下行"
                    value={formatProxyServerBytesPerSec(latestProxyDownload)}
                    hint={proxyServerConnected ? proxySampleMeta : '未连接'}
                  />
                  <StatCard
                    label="当前上行"
                    value={formatProxyServerBytesPerSec(latestProxyUpload)}
                    hint={
                      proxyUploadPeak !== undefined
                        ? `峰值 ${formatProxyServerBytesPerSec(proxyUploadPeak)}`
                        : undefined
                    }
                  />
                  <StatCard
                    label="窗口平均下行"
                    value={formatProxyServerBytesPerSec(proxyDownloadAverage)}
                    hint={proxySampleMeta}
                  />
                  <StatCard
                    label="窗口峰值下行"
                    value={formatProxyServerBytesPerSec(proxyDownloadPeak)}
                  />
                </div>
              </div>

              <div class="task-manager__perf-bottom">
                <div class="task-manager__list task-manager__list--compact">
                  <div class="task-manager__list-header">最近请求</div>
                  {proxyRecentRequests.length === 0 ? (
                    <p class="task-manager__list-empty">
                      {proxyServerConnected ? '暂无请求' : '连接代理服务器后，这里会列出最近请求。'}
                    </p>
                  ) : (
                    proxyRecentRequests.map((request) => (
                      <div key={request.id} class="task-manager__perf-row">
                        <span class="task-manager__perf-name">{request.host}</span>
                        <span class="task-manager__perf-meta">
                          {request.method}
                          {request.status !== undefined ? ` · ${request.status}` : ' · 失败'}
                          {request.errorMessage ? ` · ${request.errorMessage}` : ''}
                          {' · '}
                          {request.durationMs} ms
                        </span>
                        <span class="task-manager__perf-side">
                          {formatProxyServerDataBytes(request.downloadBytes)}
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
                : category === 'memory'
                  ? memorySupported
                    ? `JS 堆接口按隔离堆报整堆，不是按应用分摊；多个第三方应用若同堆，只计一份。折线为去重后的独立堆之和（非整机物理内存）。最多保留 ${SPEED_SERIES_MAX_POINTS} 个点。`
                    : '内存数据依赖 Chromium 系浏览器的 JS 堆接口；Safari 等环境通常不可用。'
                  : `仅统计经代理服务器的流量。折线按采样间隔写入，最多保留 ${SPEED_SERIES_MAX_POINTS} 个点。`}
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

/**
 * 与 CSS `font-size: 15px * max(960/cqi, 280/cqh)` + viewBox meet 对齐，
 * 估算轴标签在用户坐标系中占用的左侧宽度。
 */
function estimateAxisLeftPadding(
  labels: string[],
  frameWidth: number,
  frameHeight: number,
): number {
  const maxChars = Math.max(1, ...labels.map((label) => label.length))
  if (frameWidth <= 0 || frameHeight <= 0) {
    return Math.min(
      CHART_AXIS_LEFT_MAX,
      Math.max(CHART_AXIS_LEFT_MIN, maxChars * 24 + CHART_AXIS_LABEL_GAP),
    )
  }
  const scale = Math.min(frameWidth / CHART_VIEW_WIDTH, frameHeight / CHART_VIEW_HEIGHT)
  const fontCssPx =
    15 * Math.max(CHART_VIEW_WIDTH / frameWidth, CHART_VIEW_HEIGHT / frameHeight)
  // 屏幕像素字宽换回用户单位；略放大系数覆盖粗体峰值刻度
  const charWidthUser = (0.72 * fontCssPx) / Math.max(scale, 1e-6)
  return Math.min(
    CHART_AXIS_LEFT_MAX,
    Math.max(CHART_AXIS_LEFT_MIN, Math.ceil(maxChars * charWidthUser + CHART_AXIS_LABEL_GAP)),
  )
}

function MetricChart({
  buildChart,
  revision,
  ariaLabel,
  tickClassPeak = false,
}: {
  buildChart: (padding: ChartPadding) => MetricChartModel
  /** 序列或相关参数变化时触发重绘 */
  revision: unknown
  ariaLabel: string
  tickClassPeak?: boolean
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [axisLeft, setAxisLeft] = useState(CHART_PADDING_BASE.left)
  const padding = useMemo(
    (): ChartPadding => ({ ...CHART_PADDING_BASE, left: axisLeft }),
    [axisLeft],
  )
  const chart = useMemo(
    () => buildChart(padding),
    // buildChart 闭包随父组件渲染更新；revision 承载数据依赖
    [buildChart, padding, revision],
  )
  const plotLeft = padding.left
  const labelX = padding.left - CHART_AXIS_LABEL_GAP

  useLayoutEffect(() => {
    const svg = svgRef.current
    const frame = svg?.parentElement
    if (!svg || !frame) {
      return
    }

    const syncAxisLeft = () => {
      const labels = [...svg.querySelectorAll('.task-manager__chart-axis')].map(
        (node) => node.textContent ?? '',
      )
      const cs = getComputedStyle(frame)
      const padX =
        (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
      const padY =
        (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
      const contentW = Math.max(0, frame.clientWidth - padX)
      const contentH = Math.max(0, frame.clientHeight - padY)
      let nextLeft = estimateAxisLeftPadding(labels, contentW, contentH)

      let maxBoxWidth = 0
      for (const node of svg.querySelectorAll('.task-manager__chart-axis')) {
        const box = (node as SVGGraphicsElement).getBBox()
        if (Number.isFinite(box.width)) {
          maxBoxWidth = Math.max(maxBoxWidth, box.width)
        }
      }
      if (maxBoxWidth > 0) {
        nextLeft = Math.max(
          nextLeft,
          Math.min(CHART_AXIS_LEFT_MAX, Math.ceil(maxBoxWidth + CHART_AXIS_LABEL_GAP)),
        )
      }

      setAxisLeft((prev) => (Math.abs(prev - nextLeft) >= 1 ? nextLeft : prev))
    }

    syncAxisLeft()
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(syncAxisLeft)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [chart])

  return (
    <svg
      ref={svgRef}
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
            x1={plotLeft}
            y1={tick.y}
            x2={CHART_VIEW_WIDTH - 16}
            y2={tick.y}
          />
          <text
            class={`task-manager__chart-axis${tickClassPeak && tick.value === chart.axisMax ? ' task-manager__chart-axis--peak' : ''}`}
            x={labelX}
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
