import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'

/**
 * L3.0.1 薄 `perf_hooks`：接到**宿主真实** `globalThis.performance`（浏览器 / 现代 Node），
 * 不是 guest 内 `Date.now()` 假时钟，也不是桌面 Node 的 libuv/`perf_hooks` 原生绑定。
 *
 * ## 真桥（W3C 计时面 → 宿主 Performance）
 * - `performance.now` / `timeOrigin`
 * - User Timing：`mark` / `measure` / `clearMarks` / `clearMeasures`
 * - Timeline 读：`getEntries` / `getEntriesByName` / `getEntriesByType`
 *   （条目以 plain `{ name, entryType, startTime, duration }` 回灌 guest）
 * - `PerformanceObserver`：宿主 Observer 桥；条目仍为 plain 对象
 *
 * ## 明确不做（本层）
 * - Node 专有：`eventLoopUtilization`、`monitorEventLoopDelay`、`nodeTiming` 真值、
 *   `timerify`、`createHistogram`、GC/http/net/dns 等 entryType
 * - 不把 `performance` 挂到 guest `globalThis`（仅 `require` / `import` 模块面）
 *
 * 差异见 `docs/instant-npm-differences.md`。
 */

const PERF_BUNDLE_GLOBAL_KEY = '__instantPerfHooksBundle'

const HOST_NOW_KEY = '__instantPerfNow'
const HOST_TIME_ORIGIN_KEY = '__instantPerfTimeOrigin'
const HOST_MARK_KEY = '__instantPerfMark'
const HOST_MEASURE_KEY = '__instantPerfMeasure'
const HOST_CLEAR_MARKS_KEY = '__instantPerfClearMarks'
const HOST_CLEAR_MEASURES_KEY = '__instantPerfClearMeasures'
const HOST_GET_ENTRIES_KEY = '__instantPerfGetEntries'
const HOST_GET_ENTRIES_BY_NAME_KEY = '__instantPerfGetEntriesByName'
const HOST_GET_ENTRIES_BY_TYPE_KEY = '__instantPerfGetEntriesByType'
const HOST_OBSERVER_CREATE_KEY = '__instantPerfObserverCreate'
const HOST_OBSERVER_OBSERVE_KEY = '__instantPerfObserverObserve'
const HOST_OBSERVER_DISCONNECT_KEY = '__instantPerfObserverDisconnect'
const HOST_OBSERVER_DISPATCH_KEY = '__instantPerfObserverDispatch'

const MAX_OBSERVER_CALLBACKS = 256

type PlainPerfEntry = {
  name: string
  entryType: string
  startTime: number
  duration: number
}

function requireHostPerformance(): Performance {
  const perf = globalThis.performance
  if (!perf || typeof perf.now !== 'function') {
    throw new Error(
      'Host globalThis.performance.now is unavailable; Instant perf_hooks requires a real host Performance API',
    )
  }
  return perf
}

function dumpArgString(context: QuickJSContext, handle: QuickJSHandle): string {
  try {
    const dumped = context.dump(handle)
    if (typeof dumped === 'string') {
      return dumped
    }
    if (
      dumped === undefined ||
      dumped === null ||
      typeof dumped === 'number' ||
      typeof dumped === 'boolean' ||
      typeof dumped === 'bigint'
    ) {
      return String(dumped)
    }
    return JSON.stringify(dumped)
  } catch {
    try {
      return context.getString(handle)
    } catch {
      return ''
    }
  }
}

function plainEntry(entry: PerformanceEntry): PlainPerfEntry {
  return {
    name: entry.name,
    entryType: entry.entryType,
    startTime: entry.startTime,
    duration: entry.duration,
  }
}

/** 把宿主 PerformanceEntry 列表编成 guest 可消费的 plain 数组（非真实 Entry 类实例）。 */
function entriesToGuest(context: QuickJSContext, entries: PerformanceEntry[]): QuickJSHandle {
  const json = JSON.stringify(entries.map(plainEntry))
  return context.unwrapResult(context.evalCode(`(${json})`, 'instant-perf-entries.js'))
}

function entryToGuest(
  context: QuickJSContext,
  entry: PerformanceEntry | undefined,
): QuickJSHandle {
  if (!entry) {
    return context.undefined
  }
  const json = JSON.stringify(plainEntry(entry))
  return context.unwrapResult(context.evalCode(`(${json})`, 'instant-perf-entry.js'))
}

function isAbsentHandle(
  context: QuickJSContext,
  handle: QuickJSHandle | undefined,
): boolean {
  return handle === undefined || context.typeof(handle) === 'undefined'
}

function installHostBridges(context: QuickJSContext): () => void {
  const hostPerf = requireHostPerformance()
  const HostPerformanceObserver = (
    globalThis as unknown as { PerformanceObserver?: typeof PerformanceObserver }
  ).PerformanceObserver

  // —— 真桥：单调时钟 / 原点 ——
  const nowFn = context.newFunction(HOST_NOW_KEY, () => context.newNumber(hostPerf.now()))
  context.setProp(context.global, HOST_NOW_KEY, nowFn)
  nowFn.dispose()

  const timeOriginFn = context.newFunction(HOST_TIME_ORIGIN_KEY, () =>
    context.newNumber(hostPerf.timeOrigin),
  )
  context.setProp(context.global, HOST_TIME_ORIGIN_KEY, timeOriginFn)
  timeOriginFn.dispose()

  // —— 真桥：User Timing 写 ——
  const markFn = context.newFunction(HOST_MARK_KEY, (nameHandle, optionsHandle) => {
    const name = dumpArgString(context, nameHandle)
    let mark: PerformanceMark
    if (!isAbsentHandle(context, optionsHandle) && context.typeof(optionsHandle) === 'object') {
      const options = context.dump(optionsHandle) as PerformanceMarkOptions
      mark = hostPerf.mark(name, options)
    } else {
      mark = hostPerf.mark(name)
    }
    return entryToGuest(context, mark)
  })
  context.setProp(context.global, HOST_MARK_KEY, markFn)
  markFn.dispose()

  const measureFn = context.newFunction(
    HOST_MEASURE_KEY,
    (nameHandle, startOrOptionsHandle, endHandle) => {
      const name = dumpArgString(context, nameHandle)
      let measure: PerformanceMeasure
      if (isAbsentHandle(context, startOrOptionsHandle)) {
        measure = hostPerf.measure(name)
      } else if (context.typeof(startOrOptionsHandle) === 'object') {
        const options = context.dump(startOrOptionsHandle) as PerformanceMeasureOptions
        measure = hostPerf.measure(name, options)
      } else {
        const startMark = dumpArgString(context, startOrOptionsHandle)
        if (isAbsentHandle(context, endHandle)) {
          measure = hostPerf.measure(name, startMark)
        } else {
          measure = hostPerf.measure(name, startMark, dumpArgString(context, endHandle))
        }
      }
      return entryToGuest(context, measure)
    },
  )
  context.setProp(context.global, HOST_MEASURE_KEY, measureFn)
  measureFn.dispose()

  const clearMarksFn = context.newFunction(HOST_CLEAR_MARKS_KEY, (nameHandle) => {
    if (isAbsentHandle(context, nameHandle)) {
      hostPerf.clearMarks()
    } else {
      hostPerf.clearMarks(dumpArgString(context, nameHandle))
    }
    return context.undefined
  })
  context.setProp(context.global, HOST_CLEAR_MARKS_KEY, clearMarksFn)
  clearMarksFn.dispose()

  const clearMeasuresFn = context.newFunction(HOST_CLEAR_MEASURES_KEY, (nameHandle) => {
    if (isAbsentHandle(context, nameHandle)) {
      hostPerf.clearMeasures()
    } else {
      hostPerf.clearMeasures(dumpArgString(context, nameHandle))
    }
    return context.undefined
  })
  context.setProp(context.global, HOST_CLEAR_MEASURES_KEY, clearMeasuresFn)
  clearMeasuresFn.dispose()

  // —— 真桥：Timeline 读 ——
  const getEntriesFn = context.newFunction(HOST_GET_ENTRIES_KEY, () =>
    entriesToGuest(context, [...hostPerf.getEntries()]),
  )
  context.setProp(context.global, HOST_GET_ENTRIES_KEY, getEntriesFn)
  getEntriesFn.dispose()

  const getEntriesByNameFn = context.newFunction(
    HOST_GET_ENTRIES_BY_NAME_KEY,
    (nameHandle, typeHandle) => {
      const name = dumpArgString(context, nameHandle)
      if (isAbsentHandle(context, typeHandle)) {
        return entriesToGuest(context, [...hostPerf.getEntriesByName(name)])
      }
      return entriesToGuest(context, [
        ...hostPerf.getEntriesByName(name, dumpArgString(context, typeHandle)),
      ])
    },
  )
  context.setProp(context.global, HOST_GET_ENTRIES_BY_NAME_KEY, getEntriesByNameFn)
  getEntriesByNameFn.dispose()

  const getEntriesByTypeFn = context.newFunction(HOST_GET_ENTRIES_BY_TYPE_KEY, (typeHandle) =>
    entriesToGuest(context, [
      ...hostPerf.getEntriesByType(dumpArgString(context, typeHandle)),
    ]),
  )
  context.setProp(context.global, HOST_GET_ENTRIES_BY_TYPE_KEY, getEntriesByTypeFn)
  getEntriesByTypeFn.dispose()

  // —— PerformanceObserver 桥 ——
  let nextObserverId = 1
  let observerCallbackCount = 0
  let disposed = false
  const observers = new Map<number, PerformanceObserver>()

  const createObserverFn = context.newFunction(HOST_OBSERVER_CREATE_KEY, () => {
    if (disposed) {
      throw new Error('QuickJS instance destroyed')
    }
    if (typeof HostPerformanceObserver !== 'function') {
      throw new Error(
        'Host PerformanceObserver is unavailable; Instant perf_hooks observer requires a host PerformanceObserver',
      )
    }
    const id = nextObserverId
    nextObserverId += 1
    const observer = new HostPerformanceObserver((list) => {
      if (disposed) {
        return
      }
      if (observerCallbackCount >= MAX_OBSERVER_CALLBACKS) {
        return
      }
      observerCallbackCount += 1
      const entries = [...list.getEntries()].map(plainEntry)
      let dispatch: QuickJSHandle | undefined
      let idHandle: QuickJSHandle | undefined
      let jsonHandle: QuickJSHandle | undefined
      try {
        dispatch = context.getProp(context.global, HOST_OBSERVER_DISPATCH_KEY)
        if (context.typeof(dispatch) !== 'function') {
          return
        }
        idHandle = context.newNumber(id)
        jsonHandle = context.newString(JSON.stringify(entries))
        const result = context.callFunction(dispatch, context.undefined, idHandle, jsonHandle)
        if (result.error) {
          result.error.dispose()
        } else {
          result.value.dispose()
        }
        context.runtime.executePendingJobs()
      } catch {
        // 实例销毁或 guest 出错时忽略
      } finally {
        jsonHandle?.dispose()
        idHandle?.dispose()
        dispatch?.dispose()
      }
    })
    observers.set(id, observer)
    return context.newNumber(id)
  })
  context.setProp(context.global, HOST_OBSERVER_CREATE_KEY, createObserverFn)
  createObserverFn.dispose()

  const observeFn = context.newFunction(
    HOST_OBSERVER_OBSERVE_KEY,
    (idHandle, optionsHandle) => {
      if (disposed) {
        return context.undefined
      }
      const id = context.getNumber(idHandle)
      const observer = observers.get(id)
      if (!observer) {
        throw new Error(`Unknown PerformanceObserver id ${id}`)
      }
      const options = (
        isAbsentHandle(context, optionsHandle)
          ? {}
          : (context.dump(optionsHandle) as PerformanceObserverInit)
      ) as PerformanceObserverInit
      observer.observe(options)
      return context.undefined
    },
  )
  context.setProp(context.global, HOST_OBSERVER_OBSERVE_KEY, observeFn)
  observeFn.dispose()

  const disconnectFn = context.newFunction(HOST_OBSERVER_DISCONNECT_KEY, (idHandle) => {
    const id = context.getNumber(idHandle)
    const observer = observers.get(id)
    if (observer) {
      try {
        observer.disconnect()
      } catch {
        // ignore
      }
      observers.delete(id)
    }
    return context.undefined
  })
  context.setProp(context.global, HOST_OBSERVER_DISCONNECT_KEY, disconnectFn)
  disconnectFn.dispose()

  return () => {
    disposed = true
    for (const observer of observers.values()) {
      try {
        observer.disconnect()
      } catch {
        // ignore
      }
    }
    observers.clear()
  }
}

/**
 * Guest 包装：把宿主桥函数收成 Node 风格 `require('perf_hooks').performance`。
 * 桥函数名见上方 HOST_*_KEY；边界说明见文件头注释。
 */
const QUICKJS_PERF_HOOKS_GUEST_SOURCE = `(function () {
  'use strict';

  var performance = {
    now: function now() {
      return globalThis.${HOST_NOW_KEY}();
    },
    get timeOrigin() {
      return globalThis.${HOST_TIME_ORIGIN_KEY}();
    },
    mark: function mark(name, options) {
      if (arguments.length < 2) {
        return globalThis.${HOST_MARK_KEY}(name);
      }
      return globalThis.${HOST_MARK_KEY}(name, options);
    },
    measure: function measure(name, startOrOptions, endMark) {
      if (arguments.length < 2) {
        return globalThis.${HOST_MEASURE_KEY}(name);
      }
      if (arguments.length < 3) {
        return globalThis.${HOST_MEASURE_KEY}(name, startOrOptions);
      }
      return globalThis.${HOST_MEASURE_KEY}(name, startOrOptions, endMark);
    },
    clearMarks: function clearMarks(name) {
      if (arguments.length < 1) {
        return globalThis.${HOST_CLEAR_MARKS_KEY}();
      }
      return globalThis.${HOST_CLEAR_MARKS_KEY}(name);
    },
    clearMeasures: function clearMeasures(name) {
      if (arguments.length < 1) {
        return globalThis.${HOST_CLEAR_MEASURES_KEY}();
      }
      return globalThis.${HOST_CLEAR_MEASURES_KEY}(name);
    },
    getEntries: function getEntries() {
      return globalThis.${HOST_GET_ENTRIES_KEY}();
    },
    getEntriesByName: function getEntriesByName(name, type) {
      if (arguments.length < 2) {
        return globalThis.${HOST_GET_ENTRIES_BY_NAME_KEY}(name);
      }
      return globalThis.${HOST_GET_ENTRIES_BY_NAME_KEY}(name, type);
    },
    getEntriesByType: function getEntriesByType(type) {
      return globalThis.${HOST_GET_ENTRIES_BY_TYPE_KEY}(type);
    },
  };

  var observerCallbacks = Object.create(null);

  globalThis.${HOST_OBSERVER_DISPATCH_KEY} = function (id, entriesJson) {
    var cb = observerCallbacks[id];
    if (typeof cb !== 'function') {
      return;
    }
    var entries = JSON.parse(entriesJson);
    var list = {
      getEntries: function getEntries() {
        return entries.slice();
      },
      getEntriesByType: function getEntriesByType(type) {
        return entries.filter(function (e) {
          return e.entryType === type;
        });
      },
      getEntriesByName: function getEntriesByName(name, type) {
        return entries.filter(function (e) {
          if (e.name !== name) {
            return false;
          }
          if (type !== undefined && e.entryType !== type) {
            return false;
          }
          return true;
        });
      },
    };
    cb(list);
  };

  function PerformanceObserver(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('The "callback" argument must be of type function');
    }
    var id = globalThis.${HOST_OBSERVER_CREATE_KEY}();
    observerCallbacks[id] = callback;
    this._id = id;
  }

  PerformanceObserver.prototype.observe = function observe(options) {
    globalThis.${HOST_OBSERVER_OBSERVE_KEY}(this._id, options || {});
  };

  PerformanceObserver.prototype.disconnect = function disconnect() {
    globalThis.${HOST_OBSERVER_DISCONNECT_KEY}(this._id);
    delete observerCallbacks[this._id];
  };

  PerformanceObserver.prototype.takeRecords = function takeRecords() {
    return [];
  };

  globalThis.${PERF_BUNDLE_GLOBAL_KEY} = {
    performance: performance,
    PerformanceObserver: PerformanceObserver,
  };
})();
`

export type InjectPerfHooksResult = {
  handle: QuickJSHandle
  dispose: () => void
}

/**
 * Eval 薄 perf_hooks 进 guest；返回模块 handle（含 `performance` / `PerformanceObserver`）。
 */
export function injectPerfHooks(context: QuickJSContext): InjectPerfHooksResult {
  const disposeObservers = installHostBridges(context)

  const evalResult = context.evalCode(QUICKJS_PERF_HOOKS_GUEST_SOURCE, 'instant-perf-hooks.js')
  if (evalResult.error) {
    disposeObservers()
    const message = (() => {
      try {
        return String(context.dump(evalResult.error))
      } catch {
        return 'perf_hooks guest eval failed'
      } finally {
        evalResult.error.dispose()
      }
    })()
    throw new Error(`Failed to inject perf_hooks: ${message}`)
  }
  evalResult.value.dispose()

  const moduleHandle = context.getProp(context.global, PERF_BUNDLE_GLOBAL_KEY)
  if (context.typeof(moduleHandle) !== 'object') {
    disposeObservers()
    moduleHandle.dispose()
    throw new Error('Failed to inject perf_hooks: module object missing')
  }

  context.setProp(context.global, PERF_BUNDLE_GLOBAL_KEY, context.undefined)
  return { handle: moduleHandle, dispose: disposeObservers }
}

export function buildPerfHooksModuleSource(builtinsGlobalKey: string): string {
  return (
    `const __m = globalThis.${builtinsGlobalKey}['perf_hooks'];\n` +
    `export const performance = __m.performance;\n` +
    `export const PerformanceObserver = __m.PerformanceObserver;\n` +
    `export default __m;\n`
  )
}
