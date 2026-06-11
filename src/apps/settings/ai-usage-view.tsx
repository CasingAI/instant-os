import { useEffect, useMemo, useState } from 'preact/hooks'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import {
  AI_TOKEN_USAGE_CHANGED_EVENT,
  clearAiTokenUsage,
  formatUsageDayLabel,
  formatUsageTime,
  getActorUsageList,
  getAiUsageRequestsForDay,
  getBehaviorUsageList,
  getDayUsageList,
  loadAiTokenUsage,
  resolveRequestActorLabel,
  type ActorTokenUsage,
  type AiTokenUsageRecord,
  type AiUsageRequestRecord,
  type DayTokenUsage,
} from '../../ai/ai-token-usage.ts'
import { formatTokenCount } from '../browser/format-token-count.ts'
import type { GeneratedAppRecord } from '../appstore/types.ts'
import { generatedAppIdToSlug } from '../appstore/store-agent.ts'
import type { GeneratedAppId } from '../../os/types.ts'
import { isGeneratedAppId } from '../../os/types.ts'
import { SettingsDisclosureIcon } from './settings-disclosure-icon.tsx'

const AI_USAGE_NAV_LABEL = 'AI 用量'
const DAY_PREVIEW_COUNT = 14
const ACTOR_PREVIEW_COUNT = 12
const REQUEST_PREVIEW_COUNT = 30
const BEHAVIOR_PREVIEW_COUNT = 20

type AiUsageViewProps = {
  onBack: () => void
  installedApps?: GeneratedAppRecord[]
}

type Screen = 'overview' | 'day' | 'actor'

function resolveActorDisplayName(actor: string, installedApps: GeneratedAppRecord[]): string {
  if (isGeneratedAppId(actor as GeneratedAppId)) {
    const app = installedApps.find((entry) => entry.id === actor)
    return app?.name ?? generatedAppIdToSlug(actor as GeneratedAppId)
  }
  return actor
}

function enrichActorLabels(
  actors: ActorTokenUsage[],
  installedApps: GeneratedAppRecord[],
): ActorTokenUsage[] {
  return actors.map((entry) => {
    const resolved = resolveActorDisplayName(entry.actor, installedApps)
    return {
      ...entry,
      label: resolved === entry.actor ? entry.label : resolved,
    }
  })
}

function enrichDayLabels(days: DayTokenUsage[]): Array<DayTokenUsage & { label: string }> {
  return days.map((entry) => ({
    ...entry,
    label: formatUsageDayLabel(entry.day),
  }))
}

function SummaryBox({
  title,
  promptTokens,
  completionTokens,
  totalTokens,
  requestCount,
}: {
  title?: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  requestCount: number
}) {
  return (
    <div class="settings__box" aria-label={title ?? 'AI 用量摘要'}>
      <dl class="settings__form-row">
        <dt>累计 Tokens</dt>
        <dd>{formatTokenCount(totalTokens)}</dd>
      </dl>
      <dl class="settings__form-row">
        <dt>输入 Tokens</dt>
        <dd>{formatTokenCount(promptTokens)}</dd>
      </dl>
      <dl class="settings__form-row">
        <dt>输出 Tokens</dt>
        <dd>{formatTokenCount(completionTokens)}</dd>
      </dl>
      <dl class="settings__form-row">
        <dt>请求次数</dt>
        <dd>{requestCount.toLocaleString('zh-CN')} 次</dd>
      </dl>
    </div>
  )
}

function UsageNavRow({
  label,
  hint,
  countLabel,
  tokenLabel,
  onClick,
}: {
  label: string
  hint?: string
  countLabel: string
  tokenLabel: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      class="settings__row settings__row--button settings__row--ai-nav"
      onClick={onClick}
    >
      <span class="settings__row-meta">
        <span class="settings__row-name">{label}</span>
        {hint && <span class="settings__row-hint">{hint}</span>}
      </span>
      <span class="settings__row-count">{countLabel}</span>
      <span class="settings__row-size">{tokenLabel}</span>
      <SettingsDisclosureIcon />
    </button>
  )
}

function RequestRow({
  request,
  installedApps,
}: {
  request: AiUsageRequestRecord
  installedApps: GeneratedAppRecord[]
}) {
  const installedName = isGeneratedAppId(request.actor as GeneratedAppId)
    ? installedApps.find((entry) => entry.id === request.actor)?.name
    : undefined
  const actorLabel = resolveRequestActorLabel(request, installedName)

  return (
    <div class="settings__row settings__row--ai-request">
      <span class="settings__row-size settings__row-time">{formatUsageTime(request.at)}</span>
      <span class="settings__row-meta">
        <span class="settings__row-name">{actorLabel}</span>
        <span class="settings__row-hint">{request.behaviorLabel}</span>
      </span>
      <span class="settings__row-size">{formatTokenCount(request.promptTokens)}</span>
      <span class="settings__row-size">{formatTokenCount(request.completionTokens)}</span>
      <span class="settings__row-size">{formatTokenCount(request.totalTokens)}</span>
    </div>
  )
}

export function AiUsageView({ onBack, installedApps = [] }: AiUsageViewProps) {
  const [screen, setScreen] = useState<Screen>('overview')
  const [selectedDay, setSelectedDay] = useState<string | undefined>()
  const [selectedActor, setSelectedActor] = useState<string | undefined>()
  const [record, setRecord] = useState<AiTokenUsageRecord | undefined>()
  const [dayRequests, setDayRequests] = useState<AiUsageRequestRecord[]>([])
  const [daysExpanded, setDaysExpanded] = useState(false)
  const [actorsExpanded, setActorsExpanded] = useState(false)
  const [requestsExpanded, setRequestsExpanded] = useState(false)
  const [behaviorsExpanded, setBehaviorsExpanded] = useState(false)
  const [loading, setLoading] = useState(true)

  const refreshSummary = async () => {
    const next = await loadAiTokenUsage()
    setRecord(next)
    setLoading(false)
  }

  useEffect(() => {
    void refreshSummary()
    const refresh = () => {
      void refreshSummary()
    }
    window.addEventListener(AI_TOKEN_USAGE_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(AI_TOKEN_USAGE_CHANGED_EVENT, refresh)
  }, [])

  useEffect(() => {
    if (screen !== 'day' || !selectedDay) {
      setDayRequests([])
      return
    }

    let cancelled = false
    void getAiUsageRequestsForDay(selectedDay).then((requests) => {
      if (!cancelled) {
        setDayRequests(requests)
        setRequestsExpanded(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [screen, selectedDay])

  const actors = useMemo(
    () => (record ? enrichActorLabels(getActorUsageList(record), installedApps) : []),
    [record, installedApps],
  )
  const days = useMemo(() => (record ? enrichDayLabels(getDayUsageList(record)) : []), [record])
  const selectedEntry = selectedActor && record ? record.byActor[selectedActor] : undefined
  const selectedBehaviors = useMemo(
    () => (selectedEntry ? getBehaviorUsageList(selectedEntry) : []),
    [selectedEntry],
  )
  const selectedDaySummary = selectedDay && record ? record.byDay[selectedDay] : undefined

  const canExpandDays = days.length > DAY_PREVIEW_COUNT
  const showExpandDays = canExpandDays && !daysExpanded
  const visibleDays = showExpandDays ? days.slice(0, DAY_PREVIEW_COUNT) : days

  const canExpandActors = actors.length > ACTOR_PREVIEW_COUNT
  const showExpandActors = canExpandActors && !actorsExpanded
  const visibleActors = showExpandActors ? actors.slice(0, ACTOR_PREVIEW_COUNT) : actors

  const canExpandRequests = dayRequests.length > REQUEST_PREVIEW_COUNT
  const showExpandRequests = canExpandRequests && !requestsExpanded
  const visibleRequests = showExpandRequests
    ? dayRequests.slice(0, REQUEST_PREVIEW_COUNT)
    : dayRequests

  const canExpandBehaviors = selectedBehaviors.length > BEHAVIOR_PREVIEW_COUNT
  const showExpandBehaviors = canExpandBehaviors && !behaviorsExpanded
  const visibleBehaviors = showExpandBehaviors
    ? selectedBehaviors.slice(0, BEHAVIOR_PREVIEW_COUNT)
    : selectedBehaviors

  const handleClear = () => {
    void clearAiTokenUsage().then(() => {
      setScreen('overview')
      setSelectedDay(undefined)
      setSelectedActor(undefined)
      setDayRequests([])
      void refreshSummary()
    })
  }

  const openDay = (day: string) => {
    setSelectedDay(day)
    setSelectedActor(undefined)
    setScreen('day')
  }

  const openActor = (actor: string) => {
    setSelectedActor(actor)
    setSelectedDay(undefined)
    setScreen('actor')
  }

  const backToOverview = () => {
    setScreen('overview')
    setSelectedDay(undefined)
    setSelectedActor(undefined)
    setDayRequests([])
  }

  if (loading && !record) {
    return (
      <div class="settings">
        <div class="settings__nav">
          <IosNavBackButton label="显示全部" onClick={onBack} />
        </div>
        <div class="settings__content settings__content--compact">
          <div class="settings__box settings__empty">正在加载 AI 用量…</div>
        </div>
      </div>
    )
  }

  if (screen === 'day' && selectedDay && selectedDaySummary) {
    return (
      <div class="settings">
        <div class="settings__nav">
          <IosNavBackButton label={AI_USAGE_NAV_LABEL} onClick={backToOverview} />
        </div>
        <div class="settings__content settings__content--compact">
          <section class="settings__section">
            <h2 class="settings__section-title">{formatUsageDayLabel(selectedDay)}</h2>
            <SummaryBox
              promptTokens={selectedDaySummary.promptTokens}
              completionTokens={selectedDaySummary.completionTokens}
              totalTokens={selectedDaySummary.totalTokens}
              requestCount={selectedDaySummary.requestCount}
            />
          </section>

          <section class="settings__section">
            <h2 class="settings__section-title">当日请求</h2>
            {dayRequests.length === 0 ? (
              <div class="settings__box settings__empty">暂无请求明细</div>
            ) : (
              <div class="settings__list">
                <div class="settings__list-head settings__list-head--ai-request">
                  <span>时间</span>
                  <span>来源</span>
                  <span>输入</span>
                  <span>输出</span>
                  <span>合计</span>
                </div>
                <div class="settings__list-body settings__list-body--apps">
                  {visibleRequests.map((request) => (
                    <RequestRow key={request.id} request={request} installedApps={installedApps} />
                  ))}
                  {showExpandRequests && (
                    <button
                      type="button"
                      class="settings__row settings__row--show-all"
                      onClick={() => setRequestsExpanded(true)}
                    >
                      显示全部请求
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    )
  }

  if (screen === 'actor' && selectedEntry) {
    return (
      <div class="settings">
        <div class="settings__nav">
          <IosNavBackButton label={AI_USAGE_NAV_LABEL} onClick={backToOverview} />
        </div>
        <div class="settings__content settings__content--compact">
          <section class="settings__section">
            <h2 class="settings__section-title">
              {resolveActorDisplayName(selectedEntry.actor, installedApps)}
            </h2>
            <SummaryBox
              promptTokens={selectedEntry.promptTokens}
              completionTokens={selectedEntry.completionTokens}
              totalTokens={selectedEntry.totalTokens}
              requestCount={selectedEntry.requestCount}
            />
          </section>

          <section class="settings__section">
            <h2 class="settings__section-title">按行为统计</h2>
            {selectedBehaviors.length === 0 ? (
              <div class="settings__box settings__empty">暂无记录</div>
            ) : (
              <div class="settings__list">
                <div class="settings__list-head settings__list-head--ai-detail">
                  <span>行为</span>
                  <span>输入</span>
                  <span>输出</span>
                  <span>合计</span>
                </div>
                <div class="settings__list-body settings__list-body--apps">
                  {visibleBehaviors.map((entry) => (
                    <div key={entry.behavior} class="settings__row settings__row--ai-detail">
                      <span class="settings__row-meta">
                        <span class="settings__row-name">{entry.label}</span>
                        <span class="settings__row-hint">
                          {entry.requestCount.toLocaleString('zh-CN')} 次
                        </span>
                      </span>
                      <span class="settings__row-size">{formatTokenCount(entry.promptTokens)}</span>
                      <span class="settings__row-size">{formatTokenCount(entry.completionTokens)}</span>
                      <span class="settings__row-size">{formatTokenCount(entry.totalTokens)}</span>
                    </div>
                  ))}
                  {showExpandBehaviors && (
                    <button
                      type="button"
                      class="settings__row settings__row--show-all"
                      onClick={() => setBehaviorsExpanded(true)}
                    >
                      显示全部行为
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    )
  }

  const usageRecord = record ?? {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    requestCount: 0,
    byActor: {},
    byDay: {},
  }

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">总用量</h2>
          <SummaryBox
            promptTokens={usageRecord.totalPromptTokens}
            completionTokens={usageRecord.totalCompletionTokens}
            totalTokens={usageRecord.totalTokens}
            requestCount={usageRecord.requestCount}
          />
        </section>

        <section class="settings__section">
          <h2 class="settings__section-title">按日期</h2>
          {days.length === 0 ? (
            <div class="settings__box settings__empty">暂无 AI 使用记录</div>
          ) : (
            <div class="settings__list">
              <div class="settings__list-head settings__list-head--ai-nav">
                <span>日期</span>
                <span>请求</span>
                <span>Tokens</span>
                <span class="settings__list-head-spacer" aria-hidden="true" />
              </div>
              <div class="settings__list-body settings__list-body--apps">
                {visibleDays.map((entry) => (
                  <UsageNavRow
                    key={entry.day}
                    label={entry.label}
                    hint={entry.day}
                    countLabel={entry.requestCount.toLocaleString('zh-CN')}
                    tokenLabel={formatTokenCount(entry.totalTokens)}
                    onClick={() => openDay(entry.day)}
                  />
                ))}
                {showExpandDays && (
                  <button
                    type="button"
                    class="settings__row settings__row--show-all"
                    onClick={() => setDaysExpanded(true)}
                  >
                    显示全部日期
                  </button>
                )}
              </div>
            </div>
          )}
        </section>

        <section class="settings__section">
          <h2 class="settings__section-title">按应用</h2>
          {actors.length === 0 ? (
            <div class="settings__box settings__empty">暂无应用统计</div>
          ) : (
            <div class="settings__list">
              <div class="settings__list-head settings__list-head--ai-nav">
                <span>应用</span>
                <span>请求</span>
                <span>Tokens</span>
                <span class="settings__list-head-spacer" aria-hidden="true" />
              </div>
              <div class="settings__list-body settings__list-body--apps">
                {visibleActors.map((entry) => (
                  <UsageNavRow
                    key={entry.actor}
                    label={entry.label}
                    countLabel={entry.requestCount.toLocaleString('zh-CN')}
                    tokenLabel={formatTokenCount(entry.totalTokens)}
                    onClick={() => openActor(entry.actor)}
                  />
                ))}
                {showExpandActors && (
                  <button
                    type="button"
                    class="settings__row settings__row--show-all"
                    onClick={() => setActorsExpanded(true)}
                  >
                    显示全部应用
                  </button>
                )}
              </div>
            </div>
          )}
        </section>

        <section class="settings__section">
          <div class="settings__box">
            <button type="button" class="settings__btn" onClick={handleClear}>
              清除 AI 用量统计
            </button>
          </div>
          <p class="settings__section-footnote">
            仅统计 AI 请求完成后 API 返回的 usage 数据；未返回 usage 的请求不会计入。用量明细保存在数据空间（IndexedDB）。
          </p>
        </section>
      </div>
    </div>
  )
}
