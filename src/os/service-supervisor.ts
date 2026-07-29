/**
 * 系统服务监督器：把 Dedicated Worker 当作"服务"管理生命周期。
 *
 * 语义（与 Windows 服务 / systemd 类似）：
 * - 启动类型：自动 / 自动（延迟）/ 手动 / 禁用。
 * - 手动：按需拉起；显式停止后新请求仍会透明拉起（Windows 语义）。
 * - 自动：开机立即拉起；显式停止后拒绝新请求，直到手动启动或下次开机。
 * - 自动（延迟）：开机 10s 后拉起；延迟等待期内请求立即拉起；显式停止后拒绝。
 * - 禁用：不启动，新请求立即拒绝。
 * - 崩溃（onerror）：所有在途请求立即拒绝——毒请求永不重放；
 *   之后按 1s → 2s → 4s 退避自动重启，连续崩溃 3 次转入 failed。
 * - 重启期间到达的新请求排队，Worker 恢复后按序发出。
 * - Worker 稳定运行 10 秒后连续崩溃计数清零。
 * - failed 状态下新请求立即拒绝；只能手动 restart() / start() 恢复。
 * - 手动 restart() / stop()：拒绝全部在途与排队请求。
 * - 永不回退主线程执行：服务不可用时功能直接不可用。
 */
import { isWorkerHeapSampleMessage } from './worker-heap-sampler.ts'
import {
  upsertWorkerHeapReport,
  WORKER_HEAP_SERVICE_LABELS,
  type ServiceStartupType,
  type WorkerHeapServiceId,
  type WorkerServiceStatus,
} from './worker-heap-reports.ts'

export type ServiceStatus = WorkerServiceStatus

/** 单个响应消息的路由结果 */
export type ServiceRoute<T> =
  | { action: 'continue' }
  | { action: 'resolve'; value: T }
  | { action: 'reject'; error: Error }

type ServiceRequestBase = {
  type: string
  requestId: number
}

/** 分布式 Omit：对联合类型逐成员去掉 requestId */
export type ServicePayload<Req> = Req extends { requestId: number }
  ? Omit<Req, 'requestId'>
  : never

export type ServiceRequestOptions<Res, T> = {
  /**
   * 路由该请求的每条响应（协议中可能含 progress 等中间消息）。
   * 缺省：第一条消息直接 resolve。
   */
  route?: (message: Res) => ServiceRoute<T>
  /**
   * 取消信号。触发时：若请求已发出，向 Worker 发送协议 abort 消息
   * （要求协议包含 { type: 'abort', requestId }），并用 abortedValue 结案。
   */
  signal?: AbortSignal
  abortedValue?: () => T
}

export type ServiceDefinition = {
  id: WorkerHeapServiceId
  createWorker: () => Worker
  /** 服务说明（面板展示） */
  description?: string
  /** 默认启动类型；未持久化覆盖时使用。默认 manual */
  defaultStartupType?: ServiceStartupType
  /** 新 Worker 拉起后调用（首次启动与每次重启），用于重置调用方缓存状态 */
  onRestarted?: () => void
  onLog?: (message: string, level?: 'info' | 'warn' | 'error') => void
}

export type ServiceClient<Req extends ServiceRequestBase, Res> = {
  readonly id: WorkerHeapServiceId
  status(): ServiceStatus
  startupType(): ServiceStartupType
  request<T>(payload: ServicePayload<Req>, options?: ServiceRequestOptions<Res, T>): Promise<T>
  /** fire-and-forget；仅在 running 时发送，返回是否已发 */
  post(payload: ServicePayload<Req>): boolean
  start(): void
  stop(): void
  restart(): void
  setStartupType(type: ServiceStartupType): void
}

const MAX_CONSECUTIVE_CRASHES = 3
const RESTART_BACKOFF_MS = [1000, 2000, 4000]
const STABILITY_WINDOW_MS = 10_000
const DELAYED_START_MS = 10_000

type InternalEntry = {
  requestId: number
  payload: ServiceRequestBase
  posted: boolean
  route: (message: never) => ServiceRoute<unknown>
  resolve: (value: never) => void
  reject: (error: Error) => void
  abortedValue?: () => unknown
  signal?: AbortSignal
  abortListener?: () => void
}

type SupervisorHandle = {
  start(): void
  stop(): void
  restart(): void
  setStartupType(type: ServiceStartupType): void
  startupType(): ServiceStartupType
}

const supervisors = new Map<WorkerHeapServiceId, SupervisorHandle>()

/** 定义并登记一个系统服务（在服务 client 模块加载时执行） */
export function defineService<Req extends ServiceRequestBase, Res>(
  definition: ServiceDefinition,
): ServiceClient<Req, Res> {
  const {
    id,
    createWorker,
    description = '',
    defaultStartupType = 'manual',
    onRestarted,
    onLog,
  } = definition
  const label = WORKER_HEAP_SERVICE_LABELS[id]

  let worker: Worker | undefined
  let status: ServiceStatus = 'stopped'
  let startupType: ServiceStartupType = defaultStartupType
  /** 用户显式停止后，自动/延迟自动不再因请求透明拉起 */
  let explicitStop = false
  let nextRequestId = 1
  let consecutiveCrashes = 0
  let restartCount = 0
  let restartTimer: ReturnType<typeof setTimeout> | undefined
  let stabilityTimer: ReturnType<typeof setTimeout> | undefined
  let delayedStartTimer: ReturnType<typeof setTimeout> | undefined
  /** 在途（posted）与排队（!posted）请求的统一表；Map 保持插入序 */
  const entries = new Map<number, InternalEntry>()

  const log = (message: string, level?: 'info' | 'warn' | 'error'): void => {
    onLog?.(message, level)
    if (level === 'error') {
      console.error(`[service:${label}] ${message}`)
    } else if (level === 'warn') {
      console.warn(`[service:${label}] ${message}`)
    }
  }

  const syncStore = (): void => {
    upsertWorkerHeapReport({
      id,
      label,
      description,
      status,
      restartCount,
      defaultStartupType,
    })
  }

  const clearRestartTimer = (): void => {
    if (restartTimer === undefined) return
    clearTimeout(restartTimer)
    restartTimer = undefined
  }

  const clearStabilityTimer = (): void => {
    if (stabilityTimer === undefined) return
    clearTimeout(stabilityTimer)
    stabilityTimer = undefined
  }

  const clearDelayedStartTimer = (): void => {
    if (delayedStartTimer === undefined) return
    clearTimeout(delayedStartTimer)
    delayedStartTimer = undefined
  }

  const armStabilityTimer = (): void => {
    clearStabilityTimer()
    stabilityTimer = setTimeout(() => {
      stabilityTimer = undefined
      consecutiveCrashes = 0
    }, STABILITY_WINDOW_MS)
  }

  const detachEntry = (entry: InternalEntry): void => {
    if (entry.abortListener && entry.signal) {
      entry.signal.removeEventListener('abort', entry.abortListener)
      entry.abortListener = undefined
    }
    entries.delete(entry.requestId)
  }

  const settleReject = (entry: InternalEntry, error: Error): void => {
    detachEntry(entry)
    entry.reject(error)
  }

  const postEntry = (instance: Worker, entry: InternalEntry): void => {
    instance.postMessage({ ...entry.payload, requestId: entry.requestId })
    entry.posted = true
  }

  const handleMessage = (instance: Worker, event: MessageEvent): void => {
    if (worker !== instance) return // 旧 Worker 的滞留消息
    const message = event.data as unknown
    if (isWorkerHeapSampleMessage(message)) {
      // 心跳：刷新存活时间戳
      syncStore()
      return
    }
    const requestId = (message as { requestId?: unknown }).requestId
    if (typeof requestId !== 'number') return
    const entry = entries.get(requestId)
    if (!entry) return

    let route: ServiceRoute<unknown>
    try {
      route = entry.route(message as never)
    } catch (error) {
      route = {
        action: 'reject',
        error: error instanceof Error ? error : new Error(String(error)),
      }
    }
    if (route.action === 'continue') return
    detachEntry(entry)
    if (route.action === 'resolve') {
      entry.resolve(route.value as never)
    } else {
      entry.reject(route.error)
    }
  }

  const rejectPosted = (error: Error): void => {
    for (const entry of [...entries.values()]) {
      if (entry.posted) settleReject(entry, error)
    }
  }

  const rejectAll = (error: Error): void => {
    for (const entry of [...entries.values()]) {
      settleReject(entry, error)
    }
  }

  const recordCrashAndSchedule = (): void => {
    consecutiveCrashes += 1
    if (consecutiveCrashes > MAX_CONSECUTIVE_CRASHES) {
      status = 'failed'
      rejectAll(new Error(`${label} 服务连续崩溃，已停止自动重启`))
      syncStore()
      log(`连续崩溃 ${consecutiveCrashes} 次，服务标记为失败，需手动重启`, 'error')
      return
    }
    restartCount += 1
    status = 'restarting'
    syncStore()
    const delay = RESTART_BACKOFF_MS[Math.min(consecutiveCrashes, RESTART_BACKOFF_MS.length) - 1]
    log(`服务崩溃，${delay}ms 后自动重启（第 ${consecutiveCrashes} 次）`, 'warn')
    clearRestartTimer()
    restartTimer = setTimeout(spawn, delay)
  }

  const handleWorkerError = (instance: Worker, event: Event | ErrorEvent): void => {
    if (status !== 'running' || worker !== instance) return // 旧 Worker 的滞留事件
    const dead = instance
    worker = undefined
    try {
      dead.terminate()
    } catch {
      // 忽略 terminate 异常
    }
    clearStabilityTimer()
    const reason =
      'message' in event && typeof event.message === 'string' && event.message
        ? `：${event.message}`
        : ''
    // 毒请求永不重放：在途请求全部拒绝；排队请求保留等重启
    rejectPosted(new Error(`${label} 服务崩溃${reason}`))
    status = 'restarting'
    recordCrashAndSchedule()
  }

  function terminateWorker(): void {
    if (!worker) return
    const dead = worker
    worker = undefined
    try {
      dead.terminate()
    } catch {
      // 忽略 terminate 异常
    }
  }

  function spawn(): void {
    clearRestartTimer()
    clearDelayedStartTimer()
    let instance: Worker
    try {
      instance = createWorker()
    } catch (error) {
      log(
        `Worker 创建失败: ${error instanceof Error ? error.message : String(error)}`,
        'error',
      )
      recordCrashAndSchedule()
      return
    }
    instance.onmessage = (event: MessageEvent) => {
      handleMessage(instance, event)
    }
    instance.onerror = (event: ErrorEvent) => {
      handleWorkerError(instance, event)
    }
    worker = instance
    status = 'running'
    explicitStop = false
    onRestarted?.()
    armStabilityTimer()
    syncStore()
    // flush 排队请求
    for (const entry of entries.values()) {
      if (!entry.posted) postEntry(instance, entry)
    }
  }

  /** 请求侧：是否允许因请求透明拉起 */
  const canDemandStart = (): boolean => {
    if (startupType === 'disabled') return false
    if (startupType === 'manual') return true
    // auto / auto-delayed：显式停止后不再透明拉起
    return !explicitStop
  }

  const ensureWorker = (): void => {
    if (worker || status === 'running' || status === 'restarting') return
    if (status === 'failed') return
    if (!canDemandStart()) return
    spawn()
  }

  const settleAborted = (entry: InternalEntry): void => {
    detachEntry(entry)
    // 通知 Worker 取消在途请求（尽力而为）
    if (entry.posted && worker && status === 'running') {
      try {
        worker.postMessage({ type: 'abort', requestId: entry.requestId } satisfies ServiceRequestBase)
      } catch {
        // Worker 可能已死，忽略
      }
    }
    const value = entry.abortedValue?.()
    entry.resolve(value as never)
  }

  const start = (): void => {
    if (startupType === 'disabled') {
      log('服务已禁用，无法启动', 'warn')
      return
    }
    if (status === 'running' || status === 'restarting') return
    explicitStop = false
    consecutiveCrashes = 0
    clearRestartTimer()
    clearDelayedStartTimer()
    spawn()
  }

  const stop = (): void => {
    clearRestartTimer()
    clearStabilityTimer()
    clearDelayedStartTimer()
    terminateWorker()
    explicitStop = true
    consecutiveCrashes = 0
    rejectAll(new Error(`${label} 服务已停止`))
    status = 'stopped'
    syncStore()
    log('服务已停止', 'warn')
  }

  const restart = (): void => {
    if (startupType === 'disabled') {
      log('服务已禁用，无法重启', 'warn')
      return
    }
    clearRestartTimer()
    clearStabilityTimer()
    clearDelayedStartTimer()
    terminateWorker()
    // 关闭即拒绝全部队列，让上层立刻感知服务不可用
    rejectAll(new Error(`${label} 服务已手动重启`))
    consecutiveCrashes = 0
    restartCount += 1
    explicitStop = false
    status = 'stopped'
    log('手动重启服务', 'warn')
    spawn()
  }

  const setStartupType = (type: ServiceStartupType): void => {
    const previous = startupType
    startupType = type
    if (type === 'disabled') {
      // 禁用：立刻停掉
      if (status === 'running' || status === 'restarting' || status === 'failed') {
        clearRestartTimer()
        clearStabilityTimer()
        clearDelayedStartTimer()
        terminateWorker()
        rejectAll(new Error(`${label} 服务已禁用`))
        consecutiveCrashes = 0
        explicitStop = true
        status = 'stopped'
        syncStore()
        log('启动类型改为禁用，服务已停止', 'warn')
      } else {
        clearDelayedStartTimer()
        explicitStop = true
      }
      return
    }
    if (previous === 'disabled' || previous === 'manual') {
      // 从禁用/手动切到自动类：不自动拉起（等开机逻辑或手动 start）
      // 保持当前状态
    }
    // 切到非禁用时，不自动 start——由 system-services 开机逻辑或面板按钮决定
  }

  const scheduleDelayedStart = (): void => {
    if (startupType !== 'auto-delayed') return
    if (status === 'running' || status === 'restarting') return
    if (explicitStop) return
    clearDelayedStartTimer()
    delayedStartTimer = setTimeout(() => {
      delayedStartTimer = undefined
      if (startupType !== 'auto-delayed') return
      if (explicitStop) return
      if (status === 'running' || status === 'restarting') return
      spawn()
    }, DELAYED_START_MS)
  }

  const client: ServiceClient<Req, Res> = {
    id,

    status: () => status,

    startupType: () => startupType,

    request<T>(payload: ServicePayload<Req>, options?: ServiceRequestOptions<Res, T>): Promise<T> {
      const signal = options?.signal
      if (signal?.aborted) {
        return Promise.resolve(options?.abortedValue?.() as T)
      }
      if (startupType === 'disabled') {
        return Promise.reject(new Error(`${label} 服务已禁用`))
      }
      if (status === 'failed') {
        return Promise.reject(new Error(`${label} 服务已失败，需手动重启`))
      }
      // 自动类 + 显式停止：拒绝（需手动 start）
      if (
        (status === 'stopped' || !worker) &&
        !canDemandStart() &&
        status !== 'restarting'
      ) {
        return Promise.reject(new Error(`${label} 服务已停止`))
      }

      const requestId = nextRequestId
      nextRequestId += 1

      return new Promise<T>((resolve, reject) => {
        const entry: InternalEntry = {
          requestId,
          payload: payload as unknown as ServiceRequestBase,
          posted: false,
          route: (options?.route ?? ((message: unknown) => ({
            action: 'resolve',
            value: message,
          }))) as (message: never) => ServiceRoute<unknown>,
          resolve: resolve as (value: never) => void,
          reject,
          abortedValue: options?.abortedValue as (() => unknown) | undefined,
          signal,
        }
        if (signal) {
          const onAbort = (): void => {
            if (!entries.has(requestId)) return
            settleAborted(entry)
          }
          entry.abortListener = onAbort
          signal.addEventListener('abort', onAbort, { once: true })
        }
        entries.set(requestId, entry)

        // 延迟启动等待期内有请求 → 立即拉起（取消延迟定时器）
        if (delayedStartTimer !== undefined) {
          clearDelayedStartTimer()
        }
        ensureWorker()
        if (worker && status === 'running') {
          postEntry(worker, entry)
        }
        // 否则处于 restarting：排队等 spawn 后 flush
      })
    },

    post(payload: ServicePayload<Req>): boolean {
      if (!worker || status !== 'running') return false
      const requestId = nextRequestId
      nextRequestId += 1
      worker.postMessage({ ...payload, requestId })
      return true
    },

    start,
    stop,
    restart,
    setStartupType,
  }

  // 扩展 handle：开机延迟启动需要 scheduleDelayedStart
  const handle: SupervisorHandle & { scheduleDelayedStart(): void } = {
    start,
    stop,
    restart,
    setStartupType,
    startupType: () => startupType,
    scheduleDelayedStart,
  }

  // define 时立即注册到 store，面板能看到从未启动的服务
  syncStore()
  supervisors.set(id, handle)
  return client
}

type SupervisorHandleInternal = SupervisorHandle & {
  scheduleDelayedStart?(): void
}

/** 任务管理器 / 服务面板：手动启动 */
export function startWorkerService(id: WorkerHeapServiceId): void {
  supervisors.get(id)?.start()
}

/** 任务管理器 / 服务面板：手动停止 */
export function stopWorkerService(id: WorkerHeapServiceId): void {
  supervisors.get(id)?.stop()
}

/** 任务管理器手动重启入口 */
export function restartWorkerService(id: WorkerHeapServiceId): void {
  supervisors.get(id)?.restart()
}

/** 设置启动类型（不持久化；持久化由调用方负责） */
export function setWorkerServiceStartupType(
  id: WorkerHeapServiceId,
  type: ServiceStartupType,
): void {
  supervisors.get(id)?.setStartupType(type)
}

/** 开机：按启动类型拉起（自动立即，延迟排 10s） */
export function applyWorkerServiceStartup(id: WorkerHeapServiceId, type: ServiceStartupType): void {
  const handle = supervisors.get(id) as SupervisorHandleInternal | undefined
  if (!handle) return
  handle.setStartupType(type)
  if (type === 'auto') {
    handle.start()
  } else if (type === 'auto-delayed') {
    handle.scheduleDelayedStart?.()
  }
  // manual / disabled：不拉起
}
