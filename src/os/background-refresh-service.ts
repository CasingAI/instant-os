import {
  BACKGROUND_REFRESH_TASKS,
  loadBackgroundRefreshSettings,
  subscribeBackgroundRefreshSettings,
  type BackgroundRefreshTaskId,
} from './background-refresh-settings-storage.ts'
import { loadModelPricingCache } from '../ai/ai-model-pricing-cache.ts'
import { refreshModelPricing } from '../ai/fetch-model-pricing.ts'
import { refreshBoundOpenRouterPricing } from '../ai/fetch-openrouter-pricing.ts'
import type { PricingRefreshOutcome } from '../ai/fetch-model-pricing.ts'

/**
 * 系统级背景刷新服务。
 * 进入系统后每分钟巡检到期任务；空 PriceToken 缓存时立即拉一次。
 */

const POLL_INTERVAL_MS = 60_000

/** 任务 id → 执行函数。新增任务时在注册表登记后，把执行函数挂到这里。 */
const TASK_RUNNERS: Record<
  BackgroundRefreshTaskId,
  () => Promise<PricingRefreshOutcome>
> = {
  'model-pricing': refreshModelPricing,
  'openrouter-model-pricing': refreshBoundOpenRouterPricing,
}

const inFlightByTask = new Map<
  BackgroundRefreshTaskId,
  Promise<PricingRefreshOutcome>
>()

let stopCurrentService: (() => void) | undefined

/** 当前已到期且已启用的任务 id 列表 */
function dueTaskIds(): BackgroundRefreshTaskId[] {
  const now = Date.now()
  return BACKGROUND_REFRESH_TASKS.filter((task) => task.msUntilDue(now) === 0).map(
    (task) => task.id,
  )
}

/**
 * 立即执行指定背景刷新任务（单飞：同任务进行中则等待已有 Promise）。
 * 先登记 inFlight 再启动 runner，避免同步 patch 存储时重入再开一轮。
 */
export function runBackgroundRefreshTask(
  taskId: BackgroundRefreshTaskId,
): Promise<PricingRefreshOutcome> {
  const existing = inFlightByTask.get(taskId)
  if (existing) {
    return existing
  }
  const runner = TASK_RUNNERS[taskId]
  const promise = Promise.resolve()
    .then(() => runner())
    .catch(
      (error): PricingRefreshOutcome => ({
        ok: false,
        updatedCount: 0,
        message: error instanceof Error ? error.message : '未知错误',
      }),
    )
    .finally(() => {
      if (inFlightByTask.get(taskId) === promise) {
        inFlightByTask.delete(taskId)
      }
    })
  inFlightByTask.set(taskId, promise)
  return promise
}

async function runDueTasks(): Promise<void> {
  const dueIds = dueTaskIds()
  if (dueIds.length === 0) return
  await Promise.all(dueIds.map((id) => runBackgroundRefreshTask(id)))
}

export function startBackgroundRefreshService(): () => void {
  stopCurrentService?.()

  let pollTimer: number | undefined

  const clearTimer = () => {
    if (pollTimer !== undefined) {
      window.clearInterval(pollTimer)
      pollTimer = undefined
    }
  }

  const tick = () => {
    void runDueTasks()
  }

  const settings = loadBackgroundRefreshSettings()
  let lastEnabled = settings.enabled
  let lastIntervalHours = settings.intervalHours

  const unsubscribeSettings = subscribeBackgroundRefreshSettings(() => {
    const next = loadBackgroundRefreshSettings()
    const shouldTick =
      next.enabled !== lastEnabled || next.intervalHours !== lastIntervalHours
    lastEnabled = next.enabled
    lastIntervalHours = next.intervalHours
    if (shouldTick) {
      tick()
    }
  })

  // 启动：立刻巡检 + 空 PriceToken 缓存则强制拉一次
  tick()
  if (
    settings.enabled &&
    Object.keys(loadModelPricingCache().prices).length === 0
  ) {
    void runBackgroundRefreshTask('model-pricing')
  }

  pollTimer = window.setInterval(tick, POLL_INTERVAL_MS)

  const stop = () => {
    clearTimer()
    unsubscribeSettings()
    if (stopCurrentService === stop) {
      stopCurrentService = undefined
    }
  }
  stopCurrentService = stop
  return stop
}
