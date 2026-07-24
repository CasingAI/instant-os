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
 *
 * ## 明确不做（本层）
 * - `PerformanceObserver` / `PerformanceObserverEntryList`
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

function installHostBridges(context: QuickJSContext): void {
  const hostPerf = requireHostPerformance()

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

  // 模块导出面（与 Node 常用路径对齐）；不含 Observer / Node 专有 API。
  globalThis.${PERF_BUNDLE_GLOBAL_KEY} = {
    performance: performance,
  };
})();
`

/**
 * Eval 薄 perf_hooks 进 guest；返回模块 handle（含 `performance`）。
 */
export function injectPerfHooks(context: QuickJSContext): QuickJSHandle {
  installHostBridges(context)

  const evalResult = context.evalCode(QUICKJS_PERF_HOOKS_GUEST_SOURCE, 'instant-perf-hooks.js')
  if (evalResult.error) {
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
    moduleHandle.dispose()
    throw new Error('Failed to inject perf_hooks: module object missing')
  }

  context.setProp(context.global, PERF_BUNDLE_GLOBAL_KEY, context.undefined)
  return moduleHandle
}

export function buildPerfHooksModuleSource(builtinsGlobalKey: string): string {
  return (
    `const __m = globalThis.${builtinsGlobalKey}['perf_hooks'];\n` +
    `export const performance = __m.performance;\n` +
    `export default __m;\n`
  )
}
