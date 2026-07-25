import { useEffect, useState } from 'preact/hooks'
import {
  BACKGROUND_REFRESH_TASKS,
  loadBackgroundRefreshSettings,
  loadTaskState,
  subscribeBackgroundRefreshSettings,
  type BackgroundRefreshTaskId,
  type BackgroundRefreshTaskState,
} from '../../os/background-refresh-settings-storage.ts'
import {
  loadModelPricingCache,
  subscribeModelPricingCache,
} from '../../ai/ai-model-pricing-cache.ts'
import {
  DEFAULT_PRICING_API_URL,
  refreshModelPricing,
} from '../../ai/fetch-model-pricing.ts'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'

type BackgroundRefreshTaskDetailViewProps = {
  taskId: BackgroundRefreshTaskId
  onBack: () => void
}

type StatusKind = 'idle' | 'refreshing' | 'success' | 'error'

function formatRefreshTimestamp(timestamp: number): string {
  if (!timestamp) {
    return '从未'
  }
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

/**
 * 每个任务在次级页中的展示配置。
 * 新增任务时在 BACKGROUND_REFRESH_TASKS 登记后，再在这里挂一份即可。
 */
type TaskDetailConfig = {
  footnote: string
  extraRows: (helpers: { cachedModelCount: number }) => { label: string; value: string }[]
  runNow: () => Promise<{ ok: boolean; message: string }>
}

const TASK_DETAIL_CONFIGS: Record<BackgroundRefreshTaskId, TaskDetailConfig> = {
  'model-pricing': {
    footnote: `数据源：pricetoken.ai SDK（${DEFAULT_PRICING_API_URL}），美元计价。`,
    extraRows: ({ cachedModelCount }) => [
      { label: '已缓存定价', value: `${cachedModelCount} 个模型` },
    ],
    runNow: refreshModelPricing,
  },
}

export function BackgroundRefreshTaskDetailView({
  taskId,
  onBack,
}: BackgroundRefreshTaskDetailViewProps) {
  const task = BACKGROUND_REFRESH_TASKS.find((entry) => entry.id === taskId)
  const config = TASK_DETAIL_CONFIGS[taskId]
  const [taskState, setTaskState] = useState<BackgroundRefreshTaskState>(() =>
    loadTaskState(loadBackgroundRefreshSettings(), taskId),
  )
  const [cachedModelCount, setCachedModelCount] = useState(
    () => Object.keys(loadModelPricingCache().prices).length,
  )
  const [statusKind, setStatusKind] = useState<StatusKind>('idle')
  const [statusMessage, setStatusMessage] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const sync = () => {
      setTaskState(loadTaskState(loadBackgroundRefreshSettings(), taskId))
    }
    sync()
    return subscribeBackgroundRefreshSettings(sync)
  }, [taskId])

  useEffect(() => {
    if (taskId !== 'model-pricing') return
    const syncCache = () => {
      setCachedModelCount(Object.keys(loadModelPricingCache().prices).length)
    }
    syncCache()
    return subscribeModelPricingCache(syncCache)
  }, [taskId])

  const handleRefreshNow = async () => {
    if (busy) return
    setBusy(true)
    setStatusKind('refreshing')
    setStatusMessage(`正在刷新${task?.label ?? '数据'}…`)
    try {
      const outcome = await config.runNow()
      setStatusKind(outcome.ok ? 'success' : 'error')
      setStatusMessage(outcome.message)
    } finally {
      setBusy(false)
    }
  }

  if (!task) {
    return (
      <div class="settings" data-settings-subpage>
        <div class="settings__nav">
          <IosNavBackButton label="背景刷新" onClick={onBack} />
        </div>
        <div class="settings__content settings__content--compact">
          <p class="settings__empty">未找到该刷新项目。</p>
        </div>
      </div>
    )
  }

  return (
    <div class="settings" data-settings-subpage>
      <div class="settings__nav">
        <IosNavBackButton label="背景刷新" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">{task.label}</h2>

          <div class="settings__list">
            <div class="settings__row settings__row--static">
              <span class="settings__row-name">上次刷新</span>
              <span class="settings__row-size">
                {formatRefreshTimestamp(taskState.lastSuccessAt)}
                {taskState.lastResult === 'failure' && '（失败）'}
              </span>
            </div>
            {config.extraRows({ cachedModelCount }).map((row) => (
              <div class="settings__row settings__row--static" key={row.label}>
                <span class="settings__row-name">{row.label}</span>
                <span class="settings__row-size">{row.value}</span>
              </div>
            ))}
          </div>
        </section>

        <section class="settings__section">
          <div class="settings__list">
            <button
              type="button"
              class="settings__row settings__row--show-all"
              disabled={busy}
              onClick={() => void handleRefreshNow()}
            >
              {busy ? '刷新中…' : '立即刷新'}
            </button>
          </div>

          {statusMessage && (
            <p
              class={
                statusKind === 'error'
                  ? 'settings__section-footnote settings__form-status--error'
                  : statusKind === 'success'
                    ? 'settings__section-footnote settings__form-status--ok'
                    : 'settings__section-footnote'
              }
              role="status"
            >
              {statusMessage}
            </p>
          )}

          <p class="settings__section-footnote">{config.footnote}</p>
        </section>
      </div>
    </div>
  )
}
