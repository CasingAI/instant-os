import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'

/** Temporary globalThis key set by the guest IIFE (cleared after inject). */
const TIMERS_BUNDLE_GLOBAL_KEY = '__instantTimersBundle'

/**
 * 薄 `timers`：转发到 guest 全局定时器（由 async 桥注入）。
 * 使用运行时查找，以便在 injectNodeBuiltins 早于 injectGlobals 时仍可用。
 */
const QUICKJS_TIMERS_GUEST_SOURCE = `(function () {
  'use strict';

  function setTimeoutFn() {
    return globalThis.setTimeout.apply(globalThis, arguments);
  }
  function setIntervalFn() {
    return globalThis.setInterval.apply(globalThis, arguments);
  }
  function clearTimeoutFn() {
    return globalThis.clearTimeout.apply(globalThis, arguments);
  }
  function clearIntervalFn() {
    return globalThis.clearInterval.apply(globalThis, arguments);
  }

  function promiseSetTimeout(delay, value, options) {
    var ms = typeof delay === 'number' ? delay : 0;
    var signal = options && options.signal;
    return new Promise(function (resolve, reject) {
      if (signal) {
        if (signal.aborted) {
          reject(signal.reason || new Error('Aborted'));
          return;
        }
      }
      var id = globalThis.setTimeout(function () {
        resolve(value);
      }, ms);
      if (signal && typeof signal.addEventListener === 'function') {
        signal.addEventListener(
          'abort',
          function () {
            globalThis.clearTimeout(id);
            reject(signal.reason || new Error('Aborted'));
          },
          { once: true },
        );
      }
    });
  }

  function promiseSetInterval(delay, options) {
    var ms = typeof delay === 'number' ? delay : 0;
    var signal = options && options.signal;
    return new Promise(function (resolve, reject) {
      if (signal && signal.aborted) {
        reject(signal.reason || new Error('Aborted'));
        return;
      }
      var id = globalThis.setInterval(function () {
        resolve();
      }, ms);
      if (signal && typeof signal.addEventListener === 'function') {
        signal.addEventListener(
          'abort',
          function () {
            globalThis.clearInterval(id);
            reject(signal.reason || new Error('Aborted'));
          },
          { once: true },
        );
      }
    });
  }

  var promises = {
    setTimeout: promiseSetTimeout,
    setInterval: promiseSetInterval,
  };

  globalThis.${TIMERS_BUNDLE_GLOBAL_KEY} = {
    setTimeout: setTimeoutFn,
    setInterval: setIntervalFn,
    clearTimeout: clearTimeoutFn,
    clearInterval: clearIntervalFn,
    promises: promises,
  };
})();
`

export function injectTimers(context: QuickJSContext): QuickJSHandle {
  const evalResult = context.evalCode(QUICKJS_TIMERS_GUEST_SOURCE, 'instant-timers.js')
  if (evalResult.error) {
    const message = (() => {
      try {
        return String(context.dump(evalResult.error))
      } catch {
        return 'timers guest eval failed'
      } finally {
        evalResult.error.dispose()
      }
    })()
    throw new Error(`Failed to inject timers: ${message}`)
  }
  evalResult.value.dispose()

  const handle = context.getProp(context.global, TIMERS_BUNDLE_GLOBAL_KEY)
  if (context.typeof(handle) !== 'object') {
    handle.dispose()
    throw new Error('Failed to inject timers: module object missing')
  }

  context.setProp(context.global, TIMERS_BUNDLE_GLOBAL_KEY, context.undefined)
  return handle
}

const TIMERS_EXPORT_KEYS = [
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'promises',
] as const

export function buildTimersModuleSource(builtinsGlobalKey: string): string {
  const named = TIMERS_EXPORT_KEYS.map((key) => `export const ${key} = __m.${key};`).join('\n')
  return (
    `const __m = globalThis.${builtinsGlobalKey}.timers;\n` +
    `${named}\n` +
    `export default __m;\n`
  )
}
