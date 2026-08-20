import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'
import { CJS_MAKE_REQUIRE_GLOBAL_KEY } from './quickjs-cjs-guest-require.ts'

/** Temporary globalThis key set by the guest IIFE (cleared after inject). */
const MODULE_BUNDLE_GLOBAL_KEY = '__instantModuleBundle'

/** Instance-private builtins namespace (same key as quickjs-node-builtins). */
const BUILTINS_GLOBAL_KEY = '__instantNodeBuiltins'

/**
 * 薄 `module`：供 ESM CLI（如 vite）加载 `node:module`。
 * `createRequire` 接到 guest CJS `makeRequire`；`Module` 仍未实现。
 */
function buildModuleGuestSource(implementedBuiltinIds: string[]): string {
  const idsLiteral = JSON.stringify(implementedBuiltinIds)
  return `(function () {
  'use strict';

  function noop() {}

  var implementedIds = ${idsLiteral};
  var implementedSet = Object.create(null);
  for (var i = 0; i < implementedIds.length; i++) {
    implementedSet[implementedIds[i]] = true;
  }

  function normalizeBuiltinName(name) {
    if (typeof name !== 'string') {
      return '';
    }
    var trimmed = name.trim();
    if (trimmed.indexOf('node:') === 0) {
      trimmed = trimmed.slice(5);
    }
    if (trimmed === 'path/posix') {
      return 'path';
    }
    return trimmed;
  }

  function createRequire(filename) {
    var make = globalThis.${CJS_MAKE_REQUIRE_GLOBAL_KEY};
    if (typeof make !== 'function') {
      throw new Error('Instant CJS require is not installed');
    }
    if (typeof filename !== 'string' || filename.trim() === '') {
      throw new TypeError('The "filename" argument must be of type string. Received ' + typeof filename);
    }
    var parent = filename.trim();
    var builtins = globalThis.${BUILTINS_GLOBAL_KEY};
    var pathMod = builtins && builtins.path;
    if (pathMod && typeof pathMod.resolve === 'function') {
      parent = pathMod.isAbsolute(parent) ? pathMod.normalize(parent) : pathMod.resolve(parent);
    }
    return make(parent);
  }

  function isBuiltin(name) {
    var id = normalizeBuiltinName(name);
    return id !== '' && implementedSet[id] === true;
  }

  var mod = {
    createRequire: createRequire,
    enableCompileCache: noop,
    flushCompileCache: noop,
    getCompileCacheDir: function getCompileCacheDir() {
      return undefined;
    },
    isBuiltin: isBuiltin,
    builtinModules: implementedIds.slice(),
    register: noop,
    syncBuiltinESMExports: noop,
    Module: function Module() {
      throw new Error('module.Module is not implemented in Instant Node yet');
    },
  };

  globalThis.${MODULE_BUNDLE_GLOBAL_KEY} = mod;
})();
`
}

export type InjectModuleOptions = {
  /** Instant 已实现的 Node 内建 id（写入 `builtinModules` / `isBuiltin`）。 */
  implementedBuiltinIds: string[]
}

export function injectModule(
  context: QuickJSContext,
  options: InjectModuleOptions,
): QuickJSHandle {
  const source = buildModuleGuestSource(options.implementedBuiltinIds)
  const evalResult = context.evalCode(source, 'instant-module-bundle.js')
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
