import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'

/** Temporary globalThis key set by the guest IIFE (cleared after inject). */
const CONSOLE_BUNDLE_GLOBAL_KEY = '__instantConsoleBundle'

/**
 * 薄 `console` 模块：re-export 已注入的 `globalThis.console`。
 * 须在 injectConsole 之后调用。
 */
const QUICKJS_CONSOLE_GUEST_SOURCE = `(function () {
  'use strict';

  var c = globalThis.console;
  if (!c || typeof c !== 'object') {
    throw new Error('globalThis.console is not available for Instant console builtin');
  }

  globalThis.${CONSOLE_BUNDLE_GLOBAL_KEY} = c;
})();
`

export function injectConsoleModule(context: QuickJSContext): QuickJSHandle {
  const evalResult = context.evalCode(QUICKJS_CONSOLE_GUEST_SOURCE, 'instant-console-module.js')
  if (evalResult.error) {
    const message = (() => {
      try {
        return String(context.dump(evalResult.error))
      } catch {
        return 'console module guest eval failed'
      } finally {
        evalResult.error.dispose()
      }
    })()
    throw new Error(`Failed to inject console module: ${message}`)
  }
  evalResult.value.dispose()

  const handle = context.getProp(context.global, CONSOLE_BUNDLE_GLOBAL_KEY)
  if (context.typeof(handle) !== 'object') {
    handle.dispose()
    throw new Error('Failed to inject console module: module object missing')
  }

  context.setProp(context.global, CONSOLE_BUNDLE_GLOBAL_KEY, context.undefined)
  return handle
}

const CONSOLE_EXPORT_KEYS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const

export function buildConsoleModuleSource(builtinsGlobalKey: string): string {
  const named = CONSOLE_EXPORT_KEYS.map((key) => `export const ${key} = __m.${key};`).join('\n')
  return (
    `const __m = globalThis.${builtinsGlobalKey}.console;\n` +
    `${named}\n` +
    `export default __m;\n`
  )
}
