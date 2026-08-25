import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { formatUsageTime } from '../../ai/ai-token-usage.ts'
import { formatStorageSize } from '../../os/format-storage-size.ts'
import {
  isSystemDebugLogEnabled,
  patchSystemDebugLogSettings,
  SYSTEM_DEBUG_LOG_SETTINGS_CHANGED_EVENT,
} from '../../os/system-debug-log-settings-storage.ts'
import {
  clearSystemDebugCurrent,
  copyRecentSystemDebugText,
  dismissSystemDebugResidual,
  fetchSystemDebugCurrent,
  fetchSystemDebugResidual,
  fetchSystemDebugStats,
  formatSystemDebugLogLines,
  SYSTEM_DEBUG_LOG_CHANGED_EVENT,
  type SystemDebugCounters,
  type SystemDebugLogEntry,
  type SystemDebugLogLayer,
  type SystemDebugLogSnapshot,
  type SystemDebugLogStats,
} from '../../os/system-debug-log.ts'
import { IosButton } from '../../ui/ios-button.tsx'
import { SegmentedControl } from '../../ui/segmented-control.tsx'

const LAYER_CHIPS: readonly { id: SystemDebugLogLayer; label: string }[] = [
  { id: 'system', label: '系统' },
  { id: 'vm', label: '虚拟机' },
  { id: 'vfs-resolve', label: 'VFS' },
  { id: 'files', label: '文件' },
  { id: 'qjs', label: 'QuickJS' },
  { id: 'qjs-fs', label: 'fs' },
  { id: 'npm', label: 'npm' },
  { id: 'require', label: 'require' },
]

function layerLabel(layer: SystemDebugLogLayer | string): string {
  const chip = LAYER_CHIPS.find((item) => item.id === layer)
  return chip !== undefined ? chip.label : layer
}

function durationClass(durationMs: number): string {
  if (durationMs >= 1000) {
    return 'event-log__system-dur event-log__system-dur--danger'
  }
  if (durationMs >= 200) {
    return 'event-log__system-dur event-log__system-dur--warn'
  }
  return 'event-log__system-dur'
}

function residualTitle(snapshot: SystemDebugLogSnapshot): string {
  return snapshot.kind === 'unresponsive' ? '主线程未响应快照' : '上次会话残留'
}

function entryKey(entry: SystemDebugLogEntry, index: number): string {
  return `${entry.at}-${entry.id}-${index}`
}

function EntryRow({ entry }: { entry: SystemDebugLogEntry }) {
  const [open, setOpen] = useState(false)
  const hasDetail = entry.detail !== undefined && entry.detail.length > 0
  return (
    <li class="event-log__system-line">
      <button
        type="button"
        class="event-log__system-line-main"
        onClick={() => {
          setOpen(!open)
        }}
        title={hasDetail ? `${entry.op} ${entry.detail}` : entry.op}
      >
        <span class="event-log__system-time">{formatUsageTime(entry.at)}</span>
        <span class={`event-log__layer-badge event-log__layer-badge--${entry.layer}`}>
          {layerLabel(entry.layer)}
        </span>
        <span class="event-log__system-opcell">
          <span class="event-log__system-op">{entry.op}</span>
          {hasDetail ? <span class="event-log__system-detail">{entry.detail}</span> : undefined}
        </span>
        <span class="event-log__system-right">
          {entry.durationMs !== undefined ? (
            <span class={durationClass(entry.durationMs)}>{Math.round(entry.durationMs)}ms</span>
          ) : undefined}
          {entry.repeat !== undefined && entry.repeat > 1 ? (
            <span class="event-log__system-repeat">×{entry.repeat}</span>
          ) : undefined}
        </span>
      </button>
      {open && hasDetail ? (
        <div class="event-log__system-line-detail">{entry.detail}</div>
      ) : undefined}
    </li>
  )
}

function EntryLines({ entries }: { entries: SystemDebugLogEntry[] }) {
  const display = [...entries].reverse()
  if (display.length === 0) {
    return <p class="event-log__empty">暂无记录</p>
  }
  return (
    <ul class="event-log__system-lines">
      {display.map((entry, index) => (
        <EntryRow key={entryKey(entry, index)} entry={entry} />
      ))}
    </ul>
  )
}

type SystemDebugView = 'timeline' | 'hot' | 'counters'

type SystemDebugLogPanelProps = {
  narrowLayout: boolean
}

export function SystemDebugLogPanel({ narrowLayout }: SystemDebugLogPanelProps) {
  const [enabled, setEnabled] = useState(() => isSystemDebugLogEnabled())
  const [timeline, setTimeline] = useState<SystemDebugLogEntry[]>([])
  const [hot, setHot] = useState<SystemDebugLogEntry[]>([])
  const [counters, setCounters] = useState<SystemDebugCounters>({})
  const [unresponsive, setUnresponsive] = useState(false)
  const [residual, setResidual] = useState<SystemDebugLogSnapshot | undefined>(undefined)
  const [residualOpen, setResidualOpen] = useState(false)
  const [stats, setStats] = useState<SystemDebugLogStats | undefined>(undefined)
  const [loaded, setLoaded] = useState(false)
  const [view, setView] = useState<SystemDebugView>('timeline')
  const [activeLayers, setActiveLayers] = useState<Set<SystemDebugLogLayer>>(() => new Set())
  const [search, setSearch] = useState('')
  const [slowOnly, setSlowOnly] = useState(false)

  const refresh = useCallback(() => {
    void fetchSystemDebugCurrent().then((data) => {
      if (data !== undefined) {
        setTimeline(data.timeline)
        setHot(data.hot)
        setCounters(data.counters)
        setUnresponsive(data.mainThreadUnresponsive)
      }
      setLoaded(true)
    })
    void fetchSystemDebugResidual().then((snapshot) => {
      setResidual(snapshot)
    })
    void fetchSystemDebugStats().then((next) => {
      setStats(next)
    })
  }, [])

  useEffect(() => {
    refresh()
    const onChanged = () => refresh()
    const onSettingsChanged = () => {
      setEnabled(isSystemDebugLogEnabled())
    }
    window.addEventListener(SYSTEM_DEBUG_LOG_CHANGED_EVENT, onChanged)
    window.addEventListener(SYSTEM_DEBUG_LOG_SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => {
      window.removeEventListener(SYSTEM_DEBUG_LOG_CHANGED_EVENT, onChanged)
      window.removeEventListener(SYSTEM_DEBUG_LOG_SETTINGS_CHANGED_EVENT, onSettingsChanged)
    }
  }, [refresh])

  const query = search.trim().toLowerCase()

  const matchesFilters = useCallback(
    (entry: SystemDebugLogEntry) => {
      if (activeLayers.size > 0 && !activeLayers.has(entry.layer)) {
        return false
      }
      if (slowOnly && (entry.durationMs ?? 0) < 100 && (entry.repeat ?? 1) <= 1) {
        return false
      }
      if (query !== '') {
        const haystack = `${entry.op} ${entry.detail ?? ''}`.toLowerCase()
        if (!haystack.includes(query)) {
          return false
        }
      }
      return true
    },
    [activeLayers, slowOnly, query],
  )

  const filteredTimeline = useMemo(
    () => timeline.filter(matchesFilters),
    [timeline, matchesFilters],
  )
  const filteredHot = useMemo(() => hot.filter(matchesFilters), [hot, matchesFilters])
  const counterRows = useMemo(
    () => Object.entries(counters).sort((a, b) => b[1].count - a[1].count),
    [counters],
  )

  const toggleLayer = (layer: SystemDebugLogLayer) => {
    setActiveLayers((prev) => {
      const next = new Set(prev)
      if (next.has(layer)) {
        next.delete(layer)
      } else {
        next.add(layer)
      }
      return next
    })
  }

  const handleCopy = async () => {
    const lines = [
      '=== 时间线（当前会话） ===',
      formatSystemDebugLogLines(timeline),
      '',
      '=== 热路径（当前会话，采样） ===',
      formatSystemDebugLogLines(hot),
      '',
      '=== 计数器 ===',
      ...Object.entries(counters).map(
        ([key, counter]) =>
          `${key}: ${counter.count} 次, 最慢 ${Math.round(counter.slowestMs)}ms, 进环 ${counter.entries}, 限速丢 ${counter.dropped}`,
      ),
      residual !== undefined ? `\n=== ${residualTitle(residual)} ===` : '',
      residual !== undefined ? formatSystemDebugLogLines(residual.hot.slice(-120)) : '',
      residual?.note !== undefined ? `\n${residual.note}` : '',
    ]
      .filter((line) => line.length > 0)
      .join('\n')
    try {
      await navigator.clipboard.writeText(lines)
    } catch {
      // ignore
    }
  }

  const handleClear = () => {
    void clearSystemDebugCurrent().then(() => refresh())
  }

  const handleDismissResidual = () => {
    void dismissSystemDebugResidual().then(() => refresh())
  }

  const statusMeta = [
    loaded ? `时间线 ${timeline.length} · 热路径 ${hot.length}` : '正在读取诊断 Worker…',
    stats !== undefined ? `占用约 ${formatStorageSize(stats.bytes)}` : undefined,
    stats !== undefined && stats.persistFailures > 0 ? `落盘失败 ${stats.persistFailures}` : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(' · ')

  const badgeClass = !enabled
    ? 'event-log__system-badge--off'
    : unresponsive
      ? 'event-log__system-badge--unresponsive'
      : 'event-log__system-badge--on'

  const residualCount =
    residual !== undefined ? residual.timeline.length + residual.hot.length : 0

  return (
    <div class={`event-log event-log--system${narrowLayout ? ' event-log--narrow' : ''}`}>
      <div class="event-log__system-status">
        <span class={`event-log__system-badge ${badgeClass}`}>
          <span class="event-log__system-badge-dot" aria-hidden="true" />
          {!enabled ? '已关闭' : unresponsive ? '主线程未响应' : '记录中'}
        </span>
        <span class="event-log__system-status-meta">{statusMeta}</span>
        <div class="event-log__system-status-actions">
          <IosButton size="compact" onClick={() => void handleCopy()}>
            复制
          </IosButton>
          <IosButton size="compact" onClick={handleClear}>
            清空当前
          </IosButton>
        </div>
      </div>

      {residual !== undefined && residualCount > 0 ? (
        <section
          class={`event-log__system-residual${
            residual.kind === 'unresponsive' ? ' event-log__system-residual--unresponsive' : ''
          }`}
        >
          <div class="event-log__system-residual-head">
            <h3 class="event-log__system-residual-title">
              {residualTitle(residual)}（{formatUsageTime(residual.savedAt)}）
            </h3>
            <span class="event-log__system-residual-count">{residualCount} 条</span>
            <button
              type="button"
              class="event-log__system-btn event-log__system-btn--ghost"
              onClick={() => {
                setResidualOpen(!residualOpen)
              }}
            >
              {residualOpen ? '收起' : '展开'}
            </button>
            <button
              type="button"
              class="event-log__system-btn event-log__system-btn--ghost"
              onClick={handleDismissResidual}
            >
              隐藏
            </button>
          </div>
          {residualOpen ? (
            <div class="event-log__system-residual-body">
              {residual.note ? (
                <p class="event-log__system-residual-note">{residual.note}</p>
              ) : undefined}
              <EntryLines entries={[...residual.timeline, ...residual.hot.slice(-80)]} />
            </div>
          ) : undefined}
        </section>
      ) : undefined}

      {!enabled ? (
        <div class="event-log__system-off">
          <p class="event-log__system-off-title">诊断日志已关闭</p>
          <p class="event-log__system-off-text">
            开启后由独立 Worker 记录 npm / QuickJS / 文件系统 / 虚拟机的运行面包屑，主线程卡死也能留下黑匣子。开销极小：计数满
            64 次才与 Worker 通信一次，数据写入独立诊断库，不计入数据空间。
          </p>
          <IosButton
            tone="primary"
            onClick={() => {
              patchSystemDebugLogSettings({ enabled: true })
            }}
          >
            立即开启
          </IosButton>
        </div>
      ) : (
        <>
          <div class="event-log__system-filters">
            <button
              type="button"
              class={`event-log__system-chip${
                activeLayers.size === 0 ? ' event-log__system-chip--active' : ''
              }`}
              onClick={() => {
                setActiveLayers(new Set())
              }}
            >
              全部
            </button>
            {LAYER_CHIPS.map((chip) => (
              <button
                key={chip.id}
                type="button"
                class={`event-log__system-chip${
                  activeLayers.has(chip.id) ? ' event-log__system-chip--active' : ''
                }`}
                onClick={() => {
                  toggleLayer(chip.id)
                }}
              >
                {chip.label}
              </button>
            ))}
            <span class="event-log__system-filters-spacer" aria-hidden="true" />
            <label class="event-log__system-slow-toggle">
              <input
                type="checkbox"
                checked={slowOnly}
                onChange={(event) => {
                  setSlowOnly(event.currentTarget.checked)
                }}
              />
              只看 ≥100ms
            </label>
            <input
              class="event-log__system-search"
              type="search"
              placeholder="搜索操作 / 详情"
              value={search}
              onInput={(event) => {
                setSearch(event.currentTarget.value)
              }}
            />
          </div>

          <div class="event-log__system-views">
            <SegmentedControl
              value={view}
              onChange={setView}
              ariaLabel="诊断视图"
              className="event-log__system-seg"
              items={[
                { id: 'timeline', label: '时间线', badge: filteredTimeline.length },
                { id: 'hot', label: '热路径', badge: filteredHot.length },
                { id: 'counters', label: '计数', badge: counterRows.length },
              ]}
            />
          </div>

          <div class="event-log__system-list">
            {!loaded ? (
              <p class="event-log__empty">正在读取诊断 Worker…</p>
            ) : view === 'counters' ? (
              counterRows.length === 0 ? (
                <p class="event-log__empty">暂无计数</p>
              ) : (
                <table class="event-log__system-table">
                  <thead>
                    <tr>
                      <th class="event-log__system-th event-log__system-th--op">操作</th>
                      <th class="event-log__system-th">次数</th>
                      <th class="event-log__system-th">最慢</th>
                      <th class="event-log__system-th event-log__system-th--minor">进环</th>
                      <th class="event-log__system-th event-log__system-th--minor">限速丢</th>
                    </tr>
                  </thead>
                  <tbody>
                    {counterRows.map(([key, counter]) => (
                      <tr key={key}>
                        <td class="event-log__system-td event-log__system-td--op">{key}</td>
                        <td class="event-log__system-td event-log__system-td--count">
                          {counter.count}
                        </td>
                        <td
                          class={`event-log__system-td${
                            counter.slowestMs >= 1000 ? ' event-log__system-td--danger' : ''
                          }`}
                        >
                          {counter.slowestMs > 0 ? `${Math.round(counter.slowestMs)}ms` : '—'}
                        </td>
                        <td class="event-log__system-td event-log__system-td--minor">
                          {counter.entries}
                        </td>
                        <td class="event-log__system-td event-log__system-td--minor">
                          {counter.dropped}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            ) : view === 'timeline' ? (
              <EntryLines entries={filteredTimeline} />
            ) : (
              <EntryLines entries={filteredHot} />
            )}
          </div>
        </>
      )}

      <p class="event-log__system-footnote">
        采样写入独立诊断库（不计入数据空间）。整页卡死后请新开标签页打开本页查看残留快照。
      </p>
    </div>
  )
}

/** 卡死对话框「复制最近诊断」：能点时从 Worker 黑匣子取（冻结时只能靠新开标签） */
export async function copyRecentSystemDebugLogs(limit: number): Promise<string> {
  return copyRecentSystemDebugText(limit)
}
