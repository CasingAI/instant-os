import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  AI_EVENT_LOG_CHANGED_EVENT,
  deleteAiEventLog,
  formatCharsPerSecond,
  formatDurationMs,
  formatEventLogRoleLabel,
  formatTokensPerSecond,
  getLiveAiEventLogCount,
  loadRecentEventLogs,
  refreshLiveAiEventLogPerformance,
  summarizeEventLogResponse,
  type AiEventLogRecord,
} from '../../ai/ai-event-log.ts'
import {
  estimateRequestCost,
  formatRequestCost,
} from '../../ai/ai-model-pricing-cache.ts'
import { resolvePricingForLoggedModel } from '../../ai/ai-providers.ts'
import { formatUsageDayLabel, formatUsageTime } from '../../ai/ai-token-usage.ts'
import { loadAccountSettings } from '../../os/account-settings-storage.ts'
import { formatTokenCount } from '../browser/format-token-count.ts'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { getAppDefinition } from '../../os/app-registry.tsx'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useGeneratedApps } from '../../os/generated-apps-context.tsx'
import { useDevExtApps } from '../../os/dev-ext-apps-context.tsx'
import { osDayKey } from '../../os/os-clock.ts'
import { useOs } from '../../os/os-context.tsx'
import { useOsNowDate } from '../../os/use-os-clock.ts'
import type { AppId } from '../../os/types.ts'
import { isExtAppId, isGeneratedAppId } from '../../os/types.ts'
import { useAppNarrowLayout } from '../../ui/use-app-narrow-layout.ts'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { generatedAppIdToSlug } from '../appstore/store-agent.ts'
import { SystemDebugLogPanel } from './system-debug-log-panel.tsx'
import './event-log.css'

const APP_ID = 'event-log' as const
const LOG_LIMIT = 200

type EventLogTab = 'ai' | 'system'

type EnrichedEventLogRecord = AiEventLogRecord & {
  actorName: string
}

type DayGroup = {
  day: string
  label: string
  records: EnrichedEventLogRecord[]
}

function resolveActorDisplayName(
  record: AiEventLogRecord,
  getInstalledApp: ReturnType<typeof useGeneratedApps>['getInstalledApp'],
  getSessionExtApp: ReturnType<typeof useDevExtApps>['getSessionExtApp'],
): string {
  if (record.actorLabel && record.actorLabel !== record.actor) {
    return record.actorLabel
  }

  const actor = record.actor as AppId

  if (isGeneratedAppId(actor)) {
    return getInstalledApp(actor)?.name ?? generatedAppIdToSlug(actor)
  }

  if (isExtAppId(actor)) {
    return getSessionExtApp(actor)?.manifest.name ?? actor
  }

  return getAppDefinition(actor)?.name ?? actor
}

function statusLabel(status: AiEventLogRecord['status']): string {
  switch (status) {
    case 'running':
      return '生成中'
    case 'success':
      return '成功'
    case 'aborted':
      return '已中止'
    case 'error':
      return '失败'
  }
}

function groupRecordsByDay(records: EnrichedEventLogRecord[]): DayGroup[] {
  const groups: DayGroup[] = []
  const indexByDay = new Map<string, number>()

  for (const record of records) {
    const existingIndex = indexByDay.get(record.day)
    if (existingIndex !== undefined) {
      groups[existingIndex].records.push(record)
      continue
    }
    indexByDay.set(record.day, groups.length)
    groups.push({
      day: record.day,
      label: formatUsageDayLabel(record.day),
      records: [record],
    })
  }

  return groups
}

export function EventLogApp() {
  const { windows, closeWindowsForApp, minimizeWindow } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const { getInstalledApp } = useGeneratedApps()
  const { getSessionExtApp } = useDevExtApps()
  const { hostRef, narrowLayout, layoutReady } = useAppNarrowLayout()
  const definition = getAppDefinition(APP_ID)

  const [records, setRecords] = useState<AiEventLogRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [stackedDetailOpen, setStackedDetailOpen] = useState(false)
  const [pinnedDay, setPinnedDay] = useState<string | undefined>()
  const [activeTab, setActiveTab] = useState<EventLogTab>('ai')
  const listRef = useRef<HTMLDivElement>(null)
  const prevNarrowLayoutRef = useRef<boolean | undefined>(undefined)
  const osNow = useOsNowDate(60_000)
  const todayKey = useMemo(() => {
    void osNow
    return osDayKey()
  }, [osNow])

  const refresh = useCallback(async () => {
    const next = await loadRecentEventLogs(LOG_LIMIT)
    setRecords(next)
    setSelectedId((current) => {
      if (current && next.some((record) => record.id === current)) {
        return current
      }
      return next[0]?.id
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const onChanged = () => {
      void refresh()
    }
    window.addEventListener(AI_EVENT_LOG_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(AI_EVENT_LOG_CHANGED_EVENT, onChanged)
  }, [refresh])

  useEffect(() => {
    const hasLive =
      records.some((record) => record.status === 'running') || getLiveAiEventLogCount() > 0
    if (!hasLive) {
      return
    }
    const timer = window.setInterval(() => {
      refreshLiveAiEventLogPerformance()
      void refresh()
    }, 500)
    return () => window.clearInterval(timer)
  }, [records, refresh])

  useEffect(() => {
    if (!layoutReady) {
      return
    }

    const previous = prevNarrowLayoutRef.current
    if (previous === undefined) {
      // 首次测量：窄屏从列表开始，不把「默认宽 → 实测窄」当成缩窗
      prevNarrowLayoutRef.current = narrowLayout
      return
    }

    prevNarrowLayoutRef.current = narrowLayout

    // 宽屏缩到窄屏时，若当前有选中项，保持详情页而不是退回列表
    if (!previous && narrowLayout && selectedId !== undefined) {
      setStackedDetailOpen(true)
      return
    }

    if (!narrowLayout) {
      setStackedDetailOpen(false)
    }
  }, [layoutReady, narrowLayout, selectedId])

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === APP_ID && !window.minimized)
    return [
      {
        label: definition?.name ?? '事件日志',
        items: [
          ...aboutAppMenuPrefix(
            `关于 ${definition?.name ?? '事件日志'}`,
            () => showBuiltinAbout(APP_ID),
          ),
          {
            type: 'action',
            label: `隐藏${definition?.name ?? '事件日志'}`,
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: `退出${definition?.name ?? '事件日志'}`,
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp(APP_ID),
          },
        ],
      },
    ]
  }, [closeWindowsForApp, definition?.name, minimizeWindow, showBuiltinAbout, windows])

  useAppMenuBar(APP_ID, menuBar)

  const enrichedRecords = useMemo(
    () =>
      records.map((record) => ({
        ...record,
        actorName: resolveActorDisplayName(record, getInstalledApp, getSessionExtApp),
      })),
    [getInstalledApp, getSessionExtApp, records],
  )

  const dayGroups = useMemo(() => groupRecordsByDay(enrichedRecords), [enrichedRecords])
  const hasTodayGroup = dayGroups.some((group) => group.day === todayKey)
  const showJumpToToday = hasTodayGroup && pinnedDay !== undefined && pinnedDay !== todayKey

  const selected = enrichedRecords.find((record) => record.id === selectedId)
  const selectedRequestCost = useMemo(() => {
    if (
      !selected?.model ||
      selected.promptTokens === undefined ||
      selected.completionTokens === undefined
    ) {
      return undefined
    }
    const pricing = resolvePricingForLoggedModel(
      selected.model,
      loadAccountSettings()?.providers ?? [],
    )
    if (!pricing) return undefined
    const amount = estimateRequestCost(
      pricing,
      selected.promptTokens,
      selected.completionTokens,
    )
    return {
      label: formatRequestCost(amount, pricing.currency),
      estimated: selected.usageEstimated === true,
    }
  }, [selected])
  const showStackedDetail = narrowLayout && stackedDetailOpen && selected !== undefined

  const syncPinnedDay = useCallback(() => {
    const list = listRef.current
    if (!list) {
      setPinnedDay(undefined)
      return
    }

    const headers = list.querySelectorAll<HTMLElement>('[data-day]')
    if (headers.length === 0) {
      setPinnedDay(undefined)
      return
    }

    const listTop = list.getBoundingClientRect().top
    let current = headers[0]?.dataset.day
    for (const header of headers) {
      if (header.getBoundingClientRect().top <= listTop + 1) {
        current = header.dataset.day
      }
    }
    setPinnedDay(current)
  }, [])

  useLayoutEffect(() => {
    syncPinnedDay()
  }, [dayGroups, syncPinnedDay])

  useEffect(() => {
    const list = listRef.current
    if (!list) {
      return
    }
    const onScroll = () => syncPinnedDay()
    list.addEventListener('scroll', onScroll, { passive: true })
    return () => list.removeEventListener('scroll', onScroll)
  }, [dayGroups.length, syncPinnedDay])

  const handleSelectRecord = (id: string) => {
    setSelectedId(id)
    if (narrowLayout) {
      setStackedDetailOpen(true)
    }
  }

  const handleDeleteRecord = (id: string) => {
    if (selectedId === id && narrowLayout) {
      setStackedDetailOpen(false)
    }
    void deleteAiEventLog(id)
  }

  const handleJumpToToday = () => {
    const list = listRef.current
    const todayHeader = list?.querySelector<HTMLElement>(`[data-day="${CSS.escape(todayKey)}"]`)
    todayHeader?.scrollIntoView({ block: 'start', behavior: 'smooth' })

    const firstToday = dayGroups.find((group) => group.day === todayKey)?.records[0]
    if (firstToday) {
      setSelectedId(firstToday.id)
    }
  }

  return (
    <div
      ref={hostRef}
      class={`event-log${narrowLayout ? ' event-log--narrow' : ''}${showStackedDetail && activeTab === 'ai' ? ' event-log--detail-open' : ''}`}
    >
      <header class="event-log__header">
        {showStackedDetail && activeTab === 'ai' ? (
          <IosNavBackButton
            class="event-log__back"
            iconSize={14}
            label="记录"
            aria-label="返回事件列表"
            onClick={() => setStackedDetailOpen(false)}
          />
        ) : undefined}
        <div class="event-log__header-copy">
          <h2 class="event-log__title">
            {activeTab === 'system'
              ? '系统诊断'
              : showStackedDetail && selected
                ? selected.actorName
                : 'AI 生成事件'}
          </h2>
          <p class="event-log__subtitle">
            {activeTab === 'system'
              ? 'npm / QuickJS / 文件系统采样面包屑'
              : showStackedDetail && selected
                ? selected.behaviorLabel
                : loading
                  ? '正在加载…'
                  : records.length === 0
                    ? '暂无记录'
                    : `最近 ${records.length} 条 · 保存在 IndexedDB`}
          </p>
        </div>
      </header>

      <div class="event-log__tabs" role="tablist" aria-label="日志类型">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'ai'}
          class={`event-log__tab${activeTab === 'ai' ? ' event-log__tab--active' : ''}`}
          onClick={() => setActiveTab('ai')}
        >
          AI
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'system'}
          class={`event-log__tab${activeTab === 'system' ? ' event-log__tab--active' : ''}`}
          onClick={() => setActiveTab('system')}
        >
          系统
        </button>
      </div>

      {activeTab === 'system' ? (
        <SystemDebugLogPanel narrowLayout={narrowLayout} />
      ) : (
      <div class="event-log__body">
        <section class="event-log__list-panel" aria-label="事件列表">
          <div class="event-log__panel-header">
            <h3 class="event-log__panel-title">记录</h3>
            {showJumpToToday ? (
              <button
                type="button"
                class="event-log__jump-today"
                onClick={handleJumpToToday}
              >
                今天
              </button>
            ) : undefined}
          </div>
          {records.length === 0 ? (
            <p class="event-log__empty">
              {loading ? '正在读取日志…' : '各应用调用 AI 生成内容后，完整输入与输出会显示在这里。'}
            </p>
          ) : (
            <div ref={listRef} class="event-log__list">
              {dayGroups.map((group) => (
                <div key={group.day} class="event-log__day-group">
                  <div class="event-log__day-header" data-day={group.day}>
                    {group.label}
                  </div>
                  {group.records.map((record) => (
                    <div
                      key={record.id}
                      class={`event-log__row${record.id === selectedId && !narrowLayout ? ' event-log__row--active' : ''}${record.status === 'running' ? ' event-log__row--running' : ''}`}
                    >
                      <button
                        type="button"
                        class="event-log__row-main"
                        onClick={() => handleSelectRecord(record.id)}
                      >
                        <span class="event-log__row-top">
                          <span class="event-log__row-actor">{record.actorName}</span>
                          <span class="event-log__row-time">
                            {record.status === 'running' ? '生成中' : formatUsageTime(record.at)}
                          </span>
                        </span>
                        <span class="event-log__row-behavior">{record.behaviorLabel}</span>
                        <span class="event-log__row-preview">
                          {record.status === 'running' && record.completionTokensPerSecond !== undefined
                            ? `${formatTokensPerSecond(record.completionTokensPerSecond)} · `
                            : record.completionTokensPerSecond !== undefined
                              ? `${formatTokensPerSecond(record.completionTokensPerSecond)} · `
                              : record.durationMs !== undefined
                                ? `${formatDurationMs(record.durationMs)} · `
                                : ''}
                          {summarizeEventLogResponse(record.response)}
                        </span>
                      </button>
                      {record.status !== 'running' ? (
                        <button
                          type="button"
                          class="event-log__row-delete"
                          aria-label={`删除 ${record.actorName} 的记录`}
                          title="删除"
                          onClick={(event) => {
                            event.stopPropagation()
                            handleDeleteRecord(record.id)
                          }}
                        >
                          ×
                        </button>
                      ) : undefined}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>

        <section class="event-log__detail-panel" aria-label="事件详情">
          {!narrowLayout && <h3 class="event-log__panel-title">详情</h3>}
          {!selected ? (
            <p class="event-log__empty">选择一条记录以查看完整内容。</p>
          ) : (
            <div class="event-log__detail-scroll">
              <dl class="event-log__meta-grid">
                <dt>应用</dt>
                <dd>{selected.actorName}</dd>
                <dt>行为</dt>
                <dd>{selected.behaviorLabel}</dd>
                <dt>系统时间</dt>
                <dd>{new Date(selected.at).toLocaleString('zh-CN')}</dd>
                <dt>真实时间</dt>
                <dd>
                  {selected.realAt !== undefined
                    ? new Date(selected.realAt).toLocaleString('zh-CN')
                    : '—'}
                </dd>
                <dt>状态</dt>
                <dd class={`event-log__status--${selected.status}`}>{statusLabel(selected.status)}</dd>
                {selected.model && (
                  <>
                    <dt>模型</dt>
                    <dd>{selected.model}</dd>
                  </>
                )}
                <dt>思考</dt>
                <dd>
                  {selected.thinkingEnabled === undefined
                    ? '—'
                    : selected.thinkingEnabled
                      ? '已启用'
                      : '未启用'}
                </dd>
                {selected.totalTokens !== undefined && (
                  <>
                    <dt>Tokens</dt>
                    <dd>
                      {selected.usageEstimated ? '约 ' : ''}
                      {formatTokenCount(selected.totalTokens)}
                      {selected.promptTokens !== undefined && selected.completionTokens !== undefined
                        ? `（输入 ${formatTokenCount(selected.promptTokens)} / 输出 ${formatTokenCount(selected.completionTokens)}）`
                        : ''}
                    </dd>
                  </>
                )}
                {selectedRequestCost && (
                  <>
                    <dt>成本</dt>
                    <dd>
                      {selectedRequestCost.estimated ? '约 ' : ''}
                      {selectedRequestCost.label}
                    </dd>
                  </>
                )}
                {selected.durationMs !== undefined && (
                  <>
                    <dt>{selected.status === 'running' ? '已进行' : '耗时'}</dt>
                    <dd>{formatDurationMs(selected.durationMs)}</dd>
                  </>
                )}
                {selected.timeToFirstTokenMs !== undefined && (
                  <>
                    <dt>首 token</dt>
                    <dd>{formatDurationMs(selected.timeToFirstTokenMs)}</dd>
                  </>
                )}
                {selected.completionTokensPerSecond !== undefined && (
                  <>
                    <dt>输出速度</dt>
                    <dd>
                      {selected.usageEstimated && selected.status === 'running' ? '约 ' : ''}
                      {formatTokensPerSecond(selected.completionTokensPerSecond)}
                      {selected.responseCharsPerSecond !== undefined
                        ? ` · ${formatCharsPerSecond(selected.responseCharsPerSecond)}`
                        : ''}
                    </dd>
                  </>
                )}
                {selected.responseCharCount !== undefined && (
                  <>
                    <dt>响应长度</dt>
                    <dd>{selected.responseCharCount.toLocaleString('zh-CN')} 字符</dd>
                  </>
                )}
                {selected.errorMessage && (
                  <>
                    <dt>错误</dt>
                    <dd>{selected.errorMessage}</dd>
                  </>
                )}
              </dl>

              <div class="event-log__section">
                <h4 class="event-log__section-label">输入</h4>
                {selected.messages.map((message, index) => (
                  <div key={`${selected.id}-msg-${index}`} class="event-log__message">
                    <div class="event-log__message-role">{formatEventLogRoleLabel(message.role)}</div>
                    <pre class="event-log__message-body">{message.content}</pre>
                  </div>
                ))}
              </div>

              <div class="event-log__section">
                <h4 class="event-log__section-label">输出</h4>
                <pre class="event-log__response">{selected.response || '（无输出内容）'}</pre>
              </div>
            </div>
          )}
        </section>
      </div>
      )}
    </div>
  )
}
