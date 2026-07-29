/**
 * 系统服务监督器：把 Dedicated Worker 当作"服务"管理生命周期。
 *
 * 语义（与 Windows 服务 / systemd 类似）：
 * - 懒启动：首个请求到来时才拉起 Worker。
 * - 崩溃（onerror）：所有在途请求立即拒绝——毒请求永不重放；
 *   之后按 1s → 2s → 4s 退避自动重启，连续崩溃 3 次转入 failed。
 * - 重启期间到达的新请求排队，Worker 恢复后按序发出——
 *   调用方看来只是"前一个任务执行得比较久"。
 * - Worker 稳定运行 10 秒后连续崩溃计数清零。
 * - failed 状态下新请求立即拒绝；只能手动 restart() 恢复。
 * - 手动 restart()：拒绝全部在途与排队请求（调用方立刻感知服务不可用），
 *   清零计数并立即拉起新 Worker。
 * - 永不回退主线程执行：服务不可用时功能直接不可用。
 */
import { isWorkerHeapSampleMessage } from './worker-heap-sampler.ts'
import {
  upsertWorkerHeapReport,
  WORKER_HEAP_SERVICE_LABELS,
  type WorkerHeapServiceId,
  type WorkerServiceStatus,
} from './worker-heap-reports.ts'

export type ServiceStatus = 'idle' | WorkerServiceStatus

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
  /** 新 Worker 拉起后调用（首次启动与每次重启），用于重置调用方缓存状态 */
  onRestarted?: () => void
  onLog?: (message: string, level?: 'info' | 'warn' | 'error') => void
}

export type ServiceClient<Req extends ServiceRequestBase, Res> = {
  readonly id: WorkerHeapServiceId
  status(): ServiceStatus
  request<T>(payload: ServicePayload<Req>, options?: ServiceRequestOptions<Res, T>): Promise<T>
  /** fire-and-forget；仅在 running 时发送，返回是否已发 */
  post(payload: ServicePayload<Req>): boolean
  restart(): void
}

const MAX_CONSECUTIVE_CRASHES = 3
const RESTART_BACKOFF_MS = [1000, 2000, 4000]
const STABILITY_WINDOW_MS = 10_000

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

const supervisors = new Map<WorkerHeapServiceId, { restart(): void }>()

/** 定义并登记一个系统服务（在服务 client 模块加载时执行） */
export function defineService<Req extends ServiceRequestBase, Res>(
  definition: ServiceDefinition,
): ServiceClient<Req, Res> {
  const { id, createWorker, onRestarted, onLog } = definition
  const label = WORKER_HEAP_SERVICE_LABELS[id]

  let worker: Worker | undefined
  let status: ServiceStatus = 'idle'
  let nextRequestId = 1
  let consecutiveCrashes = 0
  let restartCount = 0
  let restartTimer: ReturnType<typeof setTimeout> | undefined
  let stabilityTimer: ReturnType<typeof setTimeout> | undefined
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
    if (status === 'idle') return
    upsertWorkerHeapReport({ id, status, restartCount })
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

  function spawn(): void {
    clearRestartTimer()
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
    onRestarted?.()
    armStabilityTimer()
    syncStore()
    //  flush 排队请求
    for (const entry of entries.values()) {
      if (!entry.posted) postEntry(instance, entry)
    }
  }

  const ensureWorker = (): void => {
    if (worker || status !== 'idle') return
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

  const client: ServiceClient<Req, Res> = {
    id,

    status: () => status,

    request<T>(payload: ServicePayload<Req>, options?: ServiceRequestOptions<Res, T>): Promise<T> {
      const signal = options?.signal
      if (signal?.aborted) {
        return Promise.resolve(options?.abortedValue?.() as T)
      }
      if (status === 'failed') {
        return Promise.reject(new Error(`${label} 服务已失败，需手动重启`))
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

    restart(): void {
      clearRestartTimer()
      clearStabilityTimer()
      if (worker) {
        const dead = worker
        worker = undefined
        try {
          dead.terminate()
        } catch {
          // 忽略 terminate 异常
        }
      }
      // 关闭即拒绝全部队列，让上层立刻感知服务不可用
      rejectAll(new Error(`${label} 服务已手动重启`))
      consecutiveCrashes = 0
      restartCount += 1
      status = 'idle'
      log('手动重启服务', 'warn')
      spawn()
    },
  }

  supervisors.set(id, client)
  return client
}

/** 任务管理器手动重启入口 */
export function restartWorkerService(id: WorkerHeapServiceId): void {
  supervisors.get(id)?.restart()
}
