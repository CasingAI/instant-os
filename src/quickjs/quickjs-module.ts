import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'

/** Temporary globalThis key set by the guest IIFE (cleared after inject). */
const MODULE_BUNDLE_GLOBAL_KEY = '__instantModuleBundle'

/**
 * 薄 `module`：供 ESM CLI（如 vite）加载 `node:module`。
 * 覆盖入口常用的可选 compile-cache API；`createRequire` / `Module` 仍为占位。
 */
const QUICKJS_MODULE_GUEST_SOURCE = `(function () {
  'use strict';

  function noop() {}

  function createRequire() {
    throw new Error(
      'module.createRequire is not implemented in Instant Node yet',
    );
  }

  function isBuiltin(name) {
    return typeof name === 'string' && name.length > 0;
  }

  var builtinModules = [];

  var mod = {
    createRequire: createRequire,
    enableCompileCache: noop,
    flushCompileCache: noop,
    getCompileCacheDir: function getCompileCacheDir() {
      return undefined;
    },
    isBuiltin: isBuiltin,
    builtinModules: builtinModules,
    register: noop,
    syncBuiltinESMExports: noop,
    Module: function Module() {
      throw new Error('module.Module is not implemented in Instant Node yet');
    },
  };

  globalThis.${MODULE_BUNDLE_GLOBAL_KEY} = mod;
})();
`

export function injectModule(context: QuickJSContext): QuickJSHandle {
  const evalResult = context.evalCode(QUICKJS_MODULE_GUEST_SOURCE, 'instant-module-bundle.js')
  if (evalResult.error) {
    const message = (() => {
      try {
        return String(context.dump(evalResult.error))
      } finally {
        evalResult.error.dispose()
      }
    })()
    throw new Error(`Failed to inject module: ${message}`)
  }
  evalResult.value.dispose()

  const handle = context.getProp(context.global, MODULE_BUNDLE_GLOBAL_KEY)
  if (context.typeof(handle) !== 'object') {
    handle.dispose()
    throw new Error('Failed to inject module: module object missing')
  }

  context.setProp(context.global, MODULE_BUNDLE_GLOBAL_KEY, context.undefined)
  return handle
}

const MODULE_EXPORT_KEYS = [
  'createRequire',
  'enableCompileCache',
  'flushCompileCache',
  'getCompileCacheDir',
  'isBuiltin',
  'builtinModules',
  'register',
  'syncBuiltinESMExports',
  'Module',
] as const

export function buildModuleModuleSource(builtinsGlobalKey: string): string {
  const named = MODULE_EXPORT_KEYS.map((key) => `export const ${key} = __m.${key};`).join('\n')
  return (
    `const __m = globalThis.${builtinsGlobalKey}.module;\n` +
    `${named}\n` +
    `export default __m;\n`
  )
}
