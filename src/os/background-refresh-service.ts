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
 *
 * 调度绝不能在「任务状态回写 → dispatchEvent」的同一调用栈里再开一轮：
 * 从未尝试过的任务 msUntilDue 仍是 0；若 runner 同步 patch 却没写下 lastAttemptAt，
 * 会把主线程钉死。设置页一打开就会订阅同一事件，等于把这条链接到 UI 上。
 */

export const BACKGROUND_REFRESH_POLL_INTERVAL_MS = 60_000

type TaskRunner = () => Promise<PricingRefreshOutcome>

/** 任务 id → 执行函数。新增任务时在注册表登记后，把执行函数挂到这里。 */
const TASK_RUNNERS: Record<BackgroundRefreshTaskId, TaskRunner> = {
  'model-pricing': refreshModelPricing,
  'openrouter-model-pricing': refreshBoundOpenRouterPricing,
}

const inFlightByTask = new Map<BackgroundRefreshTaskId, Promise<PricingRefreshOutcome>>()
const lastAutoStartAtByTask = new Map<BackgroundRefreshTaskId, number>()

let stopCurrentService: (() => void) | undefined
let tickQueued = false

const SKIPPED_COOLDOWN: PricingRefreshOutcome = {
  ok: true,
  updatedCount: 0,
  message: '距上次自动刷新过近，已跳过',
}

/** 当前已到期且已启用的任务 id 列表 */
function dueTaskIds(): BackgroundRefreshTaskId[] {
  const now = Date.now()
  return BACKGROUND_REFRESH_TASKS.filter((task) => task.msUntilDue(now) === 0).map(
    (task) => task.id,
  )
}

function queueTick(tick: () => void): void {
  if (tickQueued) return
  tickQueued = true
  queueMicrotask(() => {
    tickQueued = false
    tick()
  })
}

/**
 * 立即执行指定背景刷新任务（单飞：同任务进行中则等待已有 Promise）。
 * 先登记 inFlight 再启动 runner，避免同步 patch 存储时重入再开一轮。
 * 自动巡检有冷却：即使任务仍显示到期，也不会在同一分钟内连打。
 */
export function runBackgroundRefreshTask(
  taskId: BackgroundRefreshTaskId,
  options?: { force?: boolean },
): Promise<PricingRefreshOutcome> {
  const existing = inFlightByTask.get(taskId)
  if (existing) {
    return existing
  }

  if (!options?.force) {
    const lastAutoStartAt = lastAutoStartAtByTask.get(taskId) ?? 0
    if (
      lastAutoStartAt > 0 &&
      Date.now() - lastAutoStartAt < BACKGROUND_REFRESH_POLL_INTERVAL_MS
    ) {
      return Promise.resolve(SKIPPED_COOLDOWN)
    }
    lastAutoStartAtByTask.set(taskId, Date.now())
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
    const enabledChanged = next.enabled !== lastEnabled
    const intervalChanged = next.intervalHours !== lastIntervalHours
    lastEnabled = next.enabled
    lastIntervalHours = next.intervalHours
    // 只在开关打开或间隔变化时巡检；任务状态回写绝不能再 tick。
    if (enabledChanged && next.enabled) {
      lastAutoStartAtByTask.clear()
      queueTick(tick)
      return
    }
    if (intervalChanged && next.enabled) {
      queueTick(tick)
    }
  })

  // 启动：立刻巡检 + 空 PriceToken 缓存则强制拉一次
  tick()
  if (settings.enabled && Object.keys(loadModelPricingCache().prices).length === 0) {
    void runBackgroundRefreshTask('model-pricing', { force: true })
  }

  pollTimer = window.setInterval(tick, BACKGROUND_REFRESH_POLL_INTERVAL_MS)

  const stop = () => {
    clearTimer()
    unsubscribeSettings()
    tickQueued = false
    if (stopCurrentService === stop) {
      stopCurrentService = undefined
    }
  }
  stopCurrentService = stop
  return stop
}

/** 单测：替换某个任务的执行函数，返回还原函数。 */
export function installBackgroundRefreshTaskRunnerForTests(
  taskId: BackgroundRefreshTaskId,
  runner: TaskRunner,
): () => void {
  const previous = TASK_RUNNERS[taskId]
  TASK_RUNNERS[taskId] = runner
  return () => {
    TASK_RUNNERS[taskId] = previous
  }
}

/** 单测：清掉 inFlight / 冷却，并停掉当前服务。 */
export function resetBackgroundRefreshServiceForTests(): void {
  stopCurrentService?.()
  inFlightByTask.clear()
  lastAutoStartAtByTask.clear()
  tickQueued = false
}
