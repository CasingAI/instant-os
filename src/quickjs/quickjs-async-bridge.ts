import type {
  QuickJSContext,
  QuickJSDeferredPromise,
  QuickJSHandle,
  QuickJSRuntime,
} from 'quickjs-emscripten'

const MAX_TIMERS = 256
const MAX_DRAIN_ROUNDS = 10_000
const MAX_MICROTASKS_PER_DRAIN = 10_000
/** 单次 drainAfterSync 内最多执行的 nextTick 回调数（防死循环）。 */
const MAX_NEXTTICKS_PER_DRAIN = 10_000
/** 队列积压上限（含尚未执行的项）。 */
const MAX_NEXTTICK_QUEUE = 10_000

type HostTimerKind = 'timeout' | 'interval'

type HostTimerEntry = {
  id: number
  kind: HostTimerKind
  hostHandle: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>
  callback: QuickJSHandle
  args: QuickJSHandle[]
  /** 正在 callFunction(callback) 中；此时不可 dispose 句柄。 */
  invoking: boolean
  /** 已取消（clear* / clearAll）；若正在 invoking 则延后释放句柄。 */
  cancelled: boolean
  handlesDisposed: boolean
}

type NextTickEntry = {
  callback: QuickJSHandle
  args: QuickJSHandle[]
}

export type QuickJsAsyncBridgeOptions = {
  runtime: QuickJSRuntime
  context: QuickJSContext
  isDestroyed: () => boolean
  isBusy: () => boolean
  /** 开始一段同步切片；若已 busy 返回 false。 */
  tryBeginSlice: (timeoutMs: number) => boolean
  endSlice: () => void
  getSliceTimeoutMs: () => number
  /** 定时器 / 微任务内未捕获错误 → 宿主 console。 */
  reportError: (message: string) => void
}

export type QuickJsAsyncBridge = {
  /**
   * 注入定时器 / queueMicrotask，并在已有 `process` 上挂 `nextTick`
   *（须先 injectProcess）。
   */
  injectGlobals: () => void
  /**
   * 当前同步切片结束后调用：微任务 ↔ nextTick ↔ Promise jobs 同相轮转排空
   *（均先于定时器；不保证相对 Promise 的 Node 严格序）。
   */
  drainAfterSync: () => void
  /** 在非 busy 时执行；若 busy 则排队。 */
  enqueueHostTask: (task: () => void) => void
  /** 冲刷排队的宿主任务（eval/切片结束时调用）。 */
  flushHostTasks: () => void
  clearAll: () => void
  /** 结算 guest Promise 并调度 pendingJobs（供后续 fs/promises 等使用）。 */
  settleGuestPromise: (
    deferred: QuickJSDeferredPromise,
    outcome: { ok: true; value?: QuickJSHandle } | { ok: false; error?: QuickJSHandle },
  ) => void
  createDeferredPromise: () => QuickJSDeferredPromise
  /** 未走 settle 就丢弃 deferred（实例销毁等）；保持未结算计数一致。 */
  abandonDeferred: (deferred: QuickJSDeferredPromise) => void
  /**
   * 是否仍有未完成的异步：定时器、微任务、nextTick、宿主任务、
   * 未结算的 guest deferred、或 runtime pending jobs。
   */
  hasPendingAsyncWork: () => boolean
  /** 当前挂起的 setTimeout/setInterval 数量。 */
  getPendingTimerCount: () => number
}

function formatCallError(context: QuickJSContext, errorHandle: QuickJSHandle): string {
  try {
    const dumped = context.dump(errorHandle)
    if (typeof dumped === 'string') {
      return dumped
    }
    if (dumped instanceof Error) {
      return dumped.message
    }
    if (dumped && typeof dumped === 'object' && 'message' in dumped) {
      const message = (dumped as { message?: unknown }).message
      if (typeof message === 'string') {
        return message
      }
    }
    return JSON.stringify(dumped)
  } catch {
    try {
      return context.getString(errorHandle)
    } catch {
      return '[QuickJS callback error]'
    }
  } finally {
    errorHandle.dispose()
  }
}

function readDelayMs(context: QuickJSContext, handle: QuickJSHandle | undefined): number {
  if (handle === undefined) {
    return 0
  }
  try {
    const value = context.dump(handle)
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(n) || n <= 0) {
      return 0
    }
    return Math.min(Math.floor(n), 2_147_483_647)
  } catch {
    return 0
  }
}

/**
 * 宿主侧异步桥：定时器、queueMicrotask、process.nextTick、pendingJobs 与 Promise 续体回灌。
 * nextTick 与 Promise 同相（先于定时器），不保证 Node「严格先于 then」序。
 */
export function createQuickJsAsyncBridge(
  options: QuickJsAsyncBridgeOptions,
): QuickJsAsyncBridge {
  const { runtime, context } = options

  let nextTimerId = 1
  const timers = new Map<number, HostTimerEntry>()
  const microtasks: QuickJSHandle[] = []
  const nextTicks: NextTickEntry[] = []
  const hostTasks: Array<() => void> = []
  let drainingHostTasks = false
  let cleared = false
  /** createDeferredPromise 尚未 settle/abandon 的数量（含 in-flight host 异步）。 */
  let unsettledDeferredCount = 0

  const releaseUnsettledDeferred = () => {
    if (unsettledDeferredCount > 0) {
      unsettledDeferredCount -= 1
    }
  }

  const hasPendingAsyncWork = (): boolean => {
    if (options.isDestroyed()) {
      return false
    }
    return (
      timers.size > 0 ||
      microtasks.length > 0 ||
      nextTicks.length > 0 ||
      hostTasks.length > 0 ||
      unsettledDeferredCount > 0 ||
      runtime.hasPendingJob()
    )
  }

  const stopHostTimer = (entry: HostTimerEntry) => {
    if (entry.kind === 'timeout') {
      clearTimeout(entry.hostHandle)
    } else {
      clearInterval(entry.hostHandle)
    }
  }

  const disposeTimerHandles = (entry: HostTimerEntry) => {
    if (entry.handlesDisposed) {
      return
    }
    entry.handlesDisposed = true
    if (entry.callback.alive) {
      entry.callback.dispose()
    }
    for (const arg of entry.args) {
      if (arg.alive) {
        arg.dispose()
      }
    }
  }

  const disposeNextTickEntry = (entry: NextTickEntry) => {
    if (entry.callback.alive) {
      entry.callback.dispose()
    }
    for (const arg of entry.args) {
      if (arg.alive) {
        arg.dispose()
      }
    }
  }

  /**
   * 取消定时器。若回调正在执行，只停宿主 timer 并标记 cancelled，
   * 等 invoke 结束后再 dispose 句柄（避免 JS_FreeAtomStruct 双重释放）。
   */
  const cancelTimerEntry = (entry: HostTimerEntry) => {
    stopHostTimer(entry)
    entry.cancelled = true
    if (!entry.invoking) {
      disposeTimerHandles(entry)
    }
  }

  const clearAll = () => {
    cleared = true
    for (const entry of [...timers.values()]) {
      timers.delete(entry.id)
      cancelTimerEntry(entry)
    }
    while (microtasks.length > 0) {
      const handle = microtasks.shift()
      if (handle?.alive) {
        handle.dispose()
      }
    }
    while (nextTicks.length > 0) {
      const entry = nextTicks.shift()
      if (entry !== undefined) {
        disposeNextTickEntry(entry)
      }
    }
    hostTasks.length = 0
  }

  const runGuestCallback = (fnHandle: QuickJSHandle, argHandles: QuickJSHandle[] = []) => {
    if (options.isDestroyed() || !fnHandle.alive) {
      return
    }
    const result = context.callFunction(fnHandle, context.undefined, ...argHandles)
    if (result.error) {
      options.reportError(formatCallError(context, result.error))
      return
    }
    result.value.dispose()
  }

  const enqueueNextTick = (callbackHandle: QuickJSHandle, argHandles: QuickJSHandle[]) => {
    if (options.isDestroyed()) {
      return
    }
    if (context.typeof(callbackHandle) !== 'function') {
      throw new TypeError(
        'The "callback" argument must be of type function. Received type ' +
          context.typeof(callbackHandle),
      )
    }
    if (nextTicks.length >= MAX_NEXTTICK_QUEUE) {
      throw new Error(
        `process.nextTick queue overflow (max ${MAX_NEXTTICK_QUEUE}); possible infinite loop`,
      )
    }
    cleared = false
    nextTicks.push({
      callback: callbackHandle.dup(),
      args: argHandles.map((handle) => handle.dup()),
    })
  }

  const drainAfterSync = () => {
    if (options.isDestroyed()) {
      return
    }

    let rounds = 0
    let nextTickCount = 0
    while (rounds < MAX_DRAIN_ROUNDS) {
      rounds += 1

      let microCount = 0
      while (microtasks.length > 0 && microCount < MAX_MICROTASKS_PER_DRAIN) {
        microCount += 1
        const fnHandle = microtasks.shift()
        if (fnHandle === undefined) {
          break
        }
        try {
          runGuestCallback(fnHandle)
        } finally {
          if (fnHandle.alive) {
            fnHandle.dispose()
          }
        }
        if (options.isDestroyed()) {
          return
        }
      }

      while (nextTicks.length > 0 && nextTickCount < MAX_NEXTTICKS_PER_DRAIN) {
        nextTickCount += 1
        const entry = nextTicks.shift()
        if (entry === undefined) {
          break
        }
        try {
          runGuestCallback(entry.callback, entry.args)
        } finally {
          disposeNextTickEntry(entry)
        }
        if (options.isDestroyed()) {
          return
        }
      }
      if (nextTickCount >= MAX_NEXTTICKS_PER_DRAIN && nextTicks.length > 0) {
        options.reportError(
          `process.nextTick drain limit exceeded (max ${MAX_NEXTTICKS_PER_DRAIN}); remaining callbacks dropped`,
        )
        while (nextTicks.length > 0) {
          const entry = nextTicks.shift()
          if (entry !== undefined) {
            disposeNextTickEntry(entry)
          }
        }
        break
      }

      if (!runtime.hasPendingJob()) {
        if (microtasks.length === 0 && nextTicks.length === 0) {
          break
        }
        continue
      }

      const jobsResult = runtime.executePendingJobs()
      if (jobsResult.error) {
        const errorHandle = jobsResult.error
        const errorContext = errorHandle.context ?? context
        options.reportError(formatCallError(errorContext, errorHandle))
        break
      }
    }
  }

  const flushHostTasks = () => {
    if (drainingHostTasks || options.isDestroyed()) {
      return
    }
    drainingHostTasks = true
    try {
      while (hostTasks.length > 0 && !options.isDestroyed()) {
        if (options.isBusy()) {
          break
        }
        const task = hostTasks.shift()
        if (task === undefined) {
          break
        }
        task()
      }
    } finally {
      drainingHostTasks = false
    }
  }

  const enqueueHostTask = (task: () => void) => {
    if (options.isDestroyed() || cleared) {
      return
    }
    hostTasks.push(task)
    if (!options.isBusy()) {
      flushHostTasks()
    }
  }

  const runTimerCallback = (timerId: number) => {
    enqueueHostTask(() => {
      if (options.isDestroyed()) {
        return
      }
      const entry = timers.get(timerId)
      if (entry === undefined || entry.cancelled) {
        return
      }

      if (!options.tryBeginSlice(options.getSliceTimeoutMs())) {
        enqueueHostTask(() => runTimerCallback(timerId))
        return
      }

      entry.invoking = true
      try {
        runGuestCallback(entry.callback, entry.args)
        if (!options.isDestroyed() && !entry.cancelled) {
          drainAfterSync()
        }
      } finally {
        entry.invoking = false

        const stillScheduled = timers.get(timerId) === entry
        // timeout 只触发一次；或已被 clear* / clearAll
        if (entry.kind === 'timeout' || entry.cancelled || !stillScheduled) {
          if (stillScheduled) {
            timers.delete(timerId)
          }
          stopHostTimer(entry)
          disposeTimerHandles(entry)
        }

        options.endSlice()
        flushHostTasks()
      }
    })
  }

  const scheduleTimeout = (
    callbackHandle: QuickJSHandle,
    delayHandle: QuickJSHandle | undefined,
    restArgs: QuickJSHandle[],
  ): QuickJSHandle => {
    if (timers.size >= MAX_TIMERS) {
      throw new Error(`Too many timers scheduled (max ${MAX_TIMERS})`)
    }
    if (context.typeof(callbackHandle) !== 'function') {
      throw new TypeError('setTimeout handler must be a function')
    }

    const id = nextTimerId
    nextTimerId += 1
    const delayMs = readDelayMs(context, delayHandle)
    const callback = callbackHandle.dup()
    const args = restArgs.map((handle) => handle.dup())
    cleared = false

    const hostHandle = setTimeout(() => {
      runTimerCallback(id)
    }, delayMs)

    timers.set(id, {
      id,
      kind: 'timeout',
      hostHandle,
      callback,
      args,
      invoking: false,
      cancelled: false,
      handlesDisposed: false,
    })
    return context.newNumber(id)
  }

  const scheduleInterval = (
    callbackHandle: QuickJSHandle,
    delayHandle: QuickJSHandle | undefined,
    restArgs: QuickJSHandle[],
  ): QuickJSHandle => {
    if (timers.size >= MAX_TIMERS) {
      throw new Error(`Too many timers scheduled (max ${MAX_TIMERS})`)
    }
    if (context.typeof(callbackHandle) !== 'function') {
      throw new TypeError('setInterval handler must be a function')
    }

    const id = nextTimerId
    nextTimerId += 1
    const delayMs = Math.max(readDelayMs(context, delayHandle), 1)
    const callback = callbackHandle.dup()
    const args = restArgs.map((handle) => handle.dup())
    cleared = false

    const hostHandle = setInterval(() => {
      runTimerCallback(id)
    }, delayMs)

    timers.set(id, {
      id,
      kind: 'interval',
      hostHandle,
      callback,
      args,
      invoking: false,
      cancelled: false,
      handlesDisposed: false,
    })
    return context.newNumber(id)
  }

  const clearTimer = (idHandle: QuickJSHandle | undefined) => {
    if (idHandle === undefined) {
      return context.undefined
    }
    let id: number
    try {
      id = context.getNumber(idHandle)
    } catch {
      return context.undefined
    }
    const entry = timers.get(id)
    if (entry === undefined) {
      return context.undefined
    }
    timers.delete(id)
    cancelTimerEntry(entry)
    return context.undefined
  }

  const injectGlobals = () => {
    const setTimeoutFn = context.newFunction('setTimeout', (callbackHandle, delayHandle, ...rest) =>
      scheduleTimeout(callbackHandle, delayHandle, rest),
    )
    context.setProp(context.global, 'setTimeout', setTimeoutFn)
    setTimeoutFn.dispose()

    const setIntervalFn = context.newFunction(
      'setInterval',
      (callbackHandle, delayHandle, ...rest) => scheduleInterval(callbackHandle, delayHandle, rest),
    )
    context.setProp(context.global, 'setInterval', setIntervalFn)
    setIntervalFn.dispose()

    const clearTimeoutFn = context.newFunction('clearTimeout', (idHandle) => clearTimer(idHandle))
    context.setProp(context.global, 'clearTimeout', clearTimeoutFn)
    clearTimeoutFn.dispose()

    const clearIntervalFn = context.newFunction('clearInterval', (idHandle) => clearTimer(idHandle))
    context.setProp(context.global, 'clearInterval', clearIntervalFn)
    clearIntervalFn.dispose()

    const queueMicrotaskFn = context.newFunction('queueMicrotask', (callbackHandle) => {
      if (context.typeof(callbackHandle) !== 'function') {
        throw new TypeError('queueMicrotask handler must be a function')
      }
      microtasks.push(callbackHandle.dup())
      return context.undefined
    })
    context.setProp(context.global, 'queueMicrotask', queueMicrotaskFn)
    queueMicrotaskFn.dispose()

    // L1.16：挂到已有 process（须先 injectProcess）
    const processHandle = context.getProp(context.global, 'process')
    try {
      if (context.typeof(processHandle) === 'object') {
        const nextTickFn = context.newFunction('nextTick', (callbackHandle, ...rest) => {
          enqueueNextTick(callbackHandle, rest)
          return context.undefined
        })
        context.setProp(processHandle, 'nextTick', nextTickFn)
        nextTickFn.dispose()
      }
    } finally {
      processHandle.dispose()
    }
  }

  /**
   * 实例销毁 / context.dispose 之后，deferred.alive 仍可能为 true，但内部
   * resolve/reject 句柄已死；再 dispose 会触发 QuickJSUseAfterFree。
   */
  const safeDisposeDeferred = (deferred: QuickJSDeferredPromise) => {
    if (options.isDestroyed() || !deferred.alive) {
      return
    }
    try {
      deferred.dispose()
    } catch {
      // Lifetime already freed with the context
    }
  }

  const createDeferredPromise = () => {
    unsettledDeferredCount += 1
    return context.newPromise()
  }

  const abandonDeferred = (deferred: QuickJSDeferredPromise) => {
    releaseUnsettledDeferred()
    safeDisposeDeferred(deferred)
  }

  const settleGuestPromise = (
    deferred: QuickJSDeferredPromise,
    outcome: { ok: true; value?: QuickJSHandle } | { ok: false; error?: QuickJSHandle },
  ) => {
    if (options.isDestroyed() || !deferred.alive) {
      releaseUnsettledDeferred()
      const leftover = outcome.ok ? outcome.value : outcome.error
      if (leftover?.alive) {
        try {
          leftover.dispose()
        } catch {
          // ignore
        }
      }
      safeDisposeDeferred(deferred)
      return
    }

    releaseUnsettledDeferred()

    if (outcome.ok) {
      deferred.resolve(outcome.value)
    } else {
      deferred.reject(outcome.error)
    }

    void deferred.settled.then(() => {
      enqueueHostTask(() => {
        if (options.isDestroyed()) {
          return
        }
        const started = options.tryBeginSlice(options.getSliceTimeoutMs())
        if (!started) {
          enqueueHostTask(() => {
            if (options.isDestroyed()) {
              return
            }
            if (!options.tryBeginSlice(options.getSliceTimeoutMs())) {
              return
            }
            try {
              drainAfterSync()
            } finally {
              options.endSlice()
              flushHostTasks()
            }
          })
          return
        }
        try {
          drainAfterSync()
        } finally {
          options.endSlice()
          flushHostTasks()
        }
      })
    })
  }

  return {
    injectGlobals,
    drainAfterSync,
    enqueueHostTask,
    flushHostTasks,
    clearAll,
    settleGuestPromise,
    createDeferredPromise,
    abandonDeferred,
    hasPendingAsyncWork,
    getPendingTimerCount: () => timers.size,
  }
}
