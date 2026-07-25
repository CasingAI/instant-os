import {
  BACKGROUND_REFRESH_TASKS,
  msUntilNextScheduledRefresh,
  subscribeBackgroundRefreshSettings,
  type BackgroundRefreshTaskId,
} from './background-refresh-settings-storage.ts'
import { refreshModelPricing } from '../ai/fetch-model-pricing.ts'

/**
 * 系统级背景刷新服务。
 * 用户开启后按设定间隔定期执行已注册的刷新任务。
 *
 * 实现说明：
 * - 任务清单与到期算法集中在 background-refresh-settings-storage 的
 *   BACKGROUND_REFRESH_TASKS 注册表；本服务只负责计时与派发，新增任务无需改动这里。
 * - 不使用固定 setInterval 轮询间隔，而是用「到点 setTimeout 跑一轮 → 重新排期」的方式，
 *   这样用户改了间隔或手动刷新后能立即按新时间线走。
 * - 页面休眠后计时器会被浏览器冻结；唤醒时 DOMContentLoaded 不会重放，
 *   因此额外监听 visibilitychange，回到前台时检查是否已错过到期时间。
 */

/** 任务 id → 执行函数。新增任务时在注册表登记后，把执行函数挂到这里。 */
const TASK_RUNNERS: Record<BackgroundRefreshTaskId, () => Promise<unknown>> = {
  'model-pricing': refreshModelPricing,
}

let stopCurrentService: (() => void) | undefined

/** 当前已到期且已启用的任务 id 列表 */
function dueTaskIds(): BackgroundRefreshTaskId[] {
  const now = Date.now()
  return BACKGROUND_REFRESH_TASKS.filter((task) => task.msUntilDue(now) === 0).map(
    (task) => task.id,
  )
}

export function startBackgroundRefreshService(): () => void {
  stopCurrentService?.()

  let refreshTimer: number | undefined
  let inFlight = false

  const clearTimer = () => {
    if (refreshTimer !== undefined) {
      window.clearTimeout(refreshTimer)
      refreshTimer = undefined
    }
  }

  const scheduleNext = () => {
    clearTimer()
    const wait = msUntilNextScheduledRefresh()
    if (!Number.isFinite(wait)) {
      return
    }
    refreshTimer = window.setTimeout(() => {
      void tick()
    }, wait)
  }

  const tick = async () => {
    if (inFlight) {
      return
    }
    const dueIds = dueTaskIds()
    if (dueIds.length === 0) {
      scheduleNext()
      return
    }
    inFlight = true
    try {
      // 同一轮内并行执行所有到期任务；单个任务的结果由任务自身记录
      await Promise.all(dueIds.map((id) => TASK_RUNNERS[id]()))
    } finally {
      inFlight = false
      scheduleNext()
    }
  }

  const handleVisibility = () => {
    if (document.visibilityState === 'visible' && dueTaskIds().length > 0) {
      void tick()
    }
  }

  const unsubscribeSettings = subscribeBackgroundRefreshSettings(() => {
    // 设置变化（开关/间隔/任务状态更新）后按新时间线重排
    scheduleNext()
  })

  document.addEventListener('visibilitychange', handleVisibility)

  // 启动即检查：有任务到期则立即触发，否则按最近到期时间排期
  if (dueTaskIds().length > 0) {
    void tick()
  } else {
    scheduleNext()
  }

  const stop = () => {
    clearTimer()
    unsubscribeSettings()
    document.removeEventListener('visibilitychange', handleVisibility)
    if (stopCurrentService === stop) {
      stopCurrentService = undefined
    }
  }
  stopCurrentService = stop
  return stop
}
