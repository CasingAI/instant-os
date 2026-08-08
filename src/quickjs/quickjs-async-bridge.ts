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
   * 异步：job 内 `*Sync`（asyncified）挂起时会等待 rewind 完成，避免重入破坏 asyncify 状态。
   */
  drainAfterSync: () => Promise<void>
  /** 在非 busy 时执行；若 busy 则排队。任务可为异步（挂起感知的 drain / 回调）。 */
  enqueueHostTask: (task: () => void | Promise<void>) => void
  /** 冲刷排队的宿主任务（eval/切片结束时调用）。 */
  flushHostTasks: () => Promise<void>
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

/**
 * quickjs-emscripten Asyncify 内部状态的最小视图（release 构建压缩名为 Qa/Wa）。
 * `Qa`（currData）非 null 表示有挂起中的 asyncify 操作；`Wa`（whenDone handlers）
 * 由 ccall async 路径注册，挂起结算（rewind）时以最终返回值 resolve。
 */
type QuickJsAsyncifyState = {
  Qa: unknown
  Wa: { resolve: (value: unknown) => void; reject: (error: unknown) => void } | null
}

/**
 * 宿主侧直连的 quickjs-emscripten 内部对象（raw export 绕过 ccall 的 number 参数捷径，
 * 无法享受 ccall 的 async 路径；本模块需自行复刻挂起检测与 whenDone 等待）。
 */
type QuickJsRuntimeInternals = {
  /** QuickJSRuntime 本身无 .value；rt 指针在其 rt（Lifetime）上。 */
  rt: { value: number }
  ffi: {
    QTS_FreeValuePointerRuntime: (rt: number, value: number) => void
    QTS_ResolveException: (ctx: number, value: number) => number
    QTS_FreeValuePointer: (ctx: number, value: number) => void
  }
  module: {
    _QTS_ExecutePendingJob: (rt: number, maxJobs: number, ctxPtrOut: number) => number
    _QTS_Call: (ctx: number, fn: number, thisVal: number, argc: number, argv: number) => number
    Asyncify: QuickJsAsyncifyState
  }
  memory: {
    newMutablePointerArray: (
      length: number,
    ) => { value: { ptr: number; typedArray: Int32Array }; dispose: () => void }
    toPointerArray: (
      handles: QuickJSHandle[],
    ) => { value: { ptr: number }; dispose: () => void }
  }
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
 *
 * 挂起感知：raw export（QTS_ExecutePendingJob / QTS_Call）全 number 参数，cwrap 捷径下
 * 不走 ccall，job / 回调里 `*Sync`（asyncified）挂起时无法等 rewind；drain 循环重入会
 * 破坏 asyncify 状态（memory access out of bounds，见 docs/quickjs-stream-double-free-bug.md）。
 * 本桥复刻 ccall async 路径：调用后比对 `Asyncify.Qa`，变化即注册 whenDone 等 rewind。
 */
export function createQuickJsAsyncBridge(
  options: QuickJsAsyncBridgeOptions,
): QuickJsAsyncBridge {
  const { runtime, context } = options

  let nextTimerId = 1
  const timers = new Map<number, HostTimerEntry>()
  const microtasks: QuickJSHandle[] = []
  const nextTicks: NextTickEntry[] = []
  const hostTasks: Array<() => void | Promise<void>> = []
  let drainingHostTasks = false
  let hostTaskDrain: Promise<void> = Promise.resolve()
  let cleared = false
  /** createDeferredPromise 尚未 settle/abandon 的数量（含 in-flight host 异步）。 */
  let unsettledDeferredCount = 0

  const internals = (): QuickJsRuntimeInternals =>
    runtime as unknown as QuickJsRuntimeInternals

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

  const heapValueHandle = (ptr: number): QuickJSHandle =>
    (context as unknown as { memory: { heapValueHandle: (p: number) => QuickJSHandle } }).memory
      .heapValueHandle(ptr)

  const createHostErrorHandle = (error: unknown): QuickJSHandle => {
    const message = error instanceof Error ? error.message : String(error)
    try {
      return context.newError(message)
    } catch {
      // wasm 已损坏时 newError 也可能崩；退回纯字符串句柄
      return context.newString(`[QuickJS host error] ${message}`)
    }
  }

  /**
   * 复刻 vendor `callFunction`（QTS_Call），但走挂起感知路径：
   * 调用后 `Asyncify.Qa` 变化说明回调内发生了 asyncified（`*Sync`）挂起，
   * 注册 whenDone 等 rewind 完成再结算，避免 raw export 重入破坏 asyncify 状态。
   */
  const callFunctionSuspensionAware = async (
    fnHandle: QuickJSHandle,
    thisHandle: QuickJSHandle,
    ...argHandles: QuickJSHandle[]
  ): Promise<{ error: QuickJSHandle } | { value: QuickJSHandle }> => {
    const rt = internals()
    const args = argHandles
    const argvLifetime = rt.memory.toPointerArray(args)
    try {
      const prevData = rt.module.Asyncify.Qa
      let resultPtr: number
      try {
        resultPtr = rt.module._QTS_Call(
          context.value,
          fnHandle.value,
          thisHandle.value,
          args.length,
          argvLifetime.value.ptr,
        )
      } catch (error) {
        return {
          error: createHostErrorHandle(error),
        }
      }
      if (rt.module.Asyncify.Qa !== prevData) {
        resultPtr = await new Promise<number>((resolve, reject) => {
          rt.module.Asyncify.Wa = {
            resolve: (rewound) => resolve(rewound as number),
            reject: (error) => reject(error),
          }
        })
      }
      const errorPtr = rt.ffi.QTS_ResolveException(context.value, resultPtr)
      if (errorPtr) {
        rt.ffi.QTS_FreeValuePointer(context.value, resultPtr)
        return { error: heapValueHandle(errorPtr) }
      }
      return { value: heapValueHandle(resultPtr) }
    } finally {
      argvLifetime.dispose()
    }
  }

  const runGuestCallback = async (
    fnHandle: QuickJSHandle,
    argHandles: QuickJSHandle[] = [],
  ) => {
    if (options.isDestroyed() || !fnHandle.alive) {
      return
    }
    try {
      const result = context.callFunction(fnHandle, context.undefined, ...argHandles)
      if (result.error) {
        options.reportError(formatCallError(context, result.error))
        return
      }
      result.value.dispose()
    } catch (error) {
      options.reportError(`callback failed: ${String(error)}`)
    }
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

  /**
   * 复刻 vendor `executePendingJobs` 的结果结算（ctxPtrOut / 异常包装），
   * 但 raw export 调用本身走挂起感知路径（见 {@link executePendingJobsSuspensionAware}）。
   */
  const finishPendingJob = (valuePtr: number, ctxPtrOut: { dispose: () => void }): void => {
    const rt = internals()
    const ctxPtr = (ctxPtrOut as { value: { typedArray: Int32Array } }).value.typedArray[0]
    ctxPtrOut.dispose()
    if (ctxPtr === 0) {
      rt.ffi.QTS_FreeValuePointerRuntime(rt.rt.value, valuePtr)
      return
    }
    const jobContext = (
      runtime as unknown as { contextMap: Map<number, unknown> }
    ).contextMap.get(ctxPtr)
    if (jobContext === undefined) {
      // 未知 context（多实例共享 runtime 时兜底）：只释放，不结算
      rt.ffi.QTS_FreeValuePointerRuntime(rt.rt.value, valuePtr)
      return
    }
    const resultValue = (
      jobContext as unknown as { memory: { heapValueHandle: (p: number) => QuickJSHandle } }
    ).memory.heapValueHandle(valuePtr)
    if (context.typeof(resultValue) === 'number') {
      resultValue.dispose()
      return
    }
    // job 抛出异常：包装成 error 结果（后续 reportError 展示）
    const errorHandle = resultValue
    options.reportError(formatCallError(context, errorHandle))
  }

  /**
   * 挂起感知的 pending-job 泵。job 内 `*Sync`（asyncified）挂起时，
   * raw `QTS_ExecutePendingJob` 直接返回 suspend 标记（绕过 ccall），
   * 这里比对 `Asyncify.Qa` 检测挂起，并注册 whenDone 等待 rewind 完成
   *（rewind 会跑完剩余 jobs，包括被挂起 eval 的续体）。
   */
  const executePendingJobsSuspensionAware = async (): Promise<void> => {
    const rt = internals()
    const ctxPtrOut = rt.memory.newMutablePointerArray(1)
    const prevData = rt.module.Asyncify.Qa
    let valuePtr: number
    try {
      valuePtr = rt.module._QTS_ExecutePendingJob(rt.rt.value, -1, ctxPtrOut.value.ptr)
    } catch (error) {
      ctxPtrOut.dispose()
      options.reportError(`executePendingJobs failed: ${String(error)}`)
      return
    }
    if (rt.module.Asyncify.Qa !== prevData) {
      await new Promise<void>((resolve, reject) => {
        rt.module.Asyncify.Wa = {
          resolve: (rewound) => {
            finishPendingJob(rewound as number, ctxPtrOut)
            resolve()
          },
          reject: (error) => {
            ctxPtrOut.dispose()
            options.reportError(`asyncify rewind failed: ${String(error)}`)
            resolve()
          },
        }
      })
      return
    }
    finishPendingJob(valuePtr, ctxPtrOut)
  }

  /** drain 串行链：避免多个调用方（eval 泵 / 定时器 / deferred）并发重入 wasm。 */
  let drainChain: Promise<void> = Promise.resolve()

  const drainAfterSync = (): Promise<void> => {
    drainChain = drainChain.then(() => drainOnce())
    return drainChain
  }

  const drainOnce = async (): Promise<void> => {
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
          await runGuestCallback(fnHandle)
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
          await runGuestCallback(entry.callback, entry.args)
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

      await executePendingJobsSuspensionAware()
    }
  }

  const flushHostTasks = (): Promise<void> => {
    if (options.isDestroyed()) {
      return Promise.resolve()
    }
    if (drainingHostTasks) {
      return hostTaskDrain
    }
    drainingHostTasks = true
    hostTaskDrain = (async () => {
      try {
        while (hostTasks.length > 0 && !options.isDestroyed()) {
          if (options.isBusy()) {
            break
          }
          const task = hostTasks.shift()
          if (task === undefined) {
            break
          }
          await task()
        }
      } finally {
        drainingHostTasks = false
      }
    })()
    return hostTaskDrain
  }

  const enqueueHostTask = (task: () => void | Promise<void>) => {
    if (options.isDestroyed() || cleared) {
      return
    }
    hostTasks.push(task)
    if (!options.isBusy()) {
      void flushHostTasks()
    }
  }

  const runTimerCallback = (timerId: number) => {
    enqueueHostTask(async () => {
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
        await runGuestCallback(entry.callback, entry.args)
        if (!options.isDestroyed() && !entry.cancelled) {
          await drainAfterSync()
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
        void flushHostTasks()
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
      enqueueHostTask(async () => {
        if (options.isDestroyed()) {
          return
        }
        const started = options.tryBeginSlice(options.getSliceTimeoutMs())
        if (!started) {
          enqueueHostTask(async () => {
            if (options.isDestroyed()) {
              return
            }
            if (!options.tryBeginSlice(options.getSliceTimeoutMs())) {
              return
            }
            try {
              await drainAfterSync()
            } finally {
              options.endSlice()
              void flushHostTasks()
            }
          })
          return
        }
        try {
          await drainAfterSync()
        } finally {
          options.endSlice()
          void flushHostTasks()
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
