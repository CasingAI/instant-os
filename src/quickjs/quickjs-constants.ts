import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'
import { INSTANT_FS_CONSTANTS } from './quickjs-fs.ts'

/** Temporary globalThis key set by the guest IIFE (cleared after inject). */
const CONSTANTS_BUNDLE_GLOBAL_KEY = '__instantConstantsBundle'

/** os.constants 假值（与 quickjs-os.ts 对齐，避免双份漂移）。 */
export const INSTANT_OS_CONSTANTS = {
  UV_UDP_REUSEADDR: 4,
  dlopen: {},
  errno: {},
  signals: {},
  priority: {},
} as const

/**
 * 薄 `constants`：聚合 fs + os 常量。Node 已废弃该模块；只做 require 不崩。
 */
function buildConstantsGuestSource(): string {
  const fsLiteral = JSON.stringify(INSTANT_FS_CONSTANTS)
  const osLiteral = JSON.stringify(INSTANT_OS_CONSTANTS)
  return `(function () {
  'use strict';

  var fs = ${fsLiteral};
  var os = ${osLiteral};
  var merged = {};
  var fk = Object.keys(fs);
  for (var i = 0; i < fk.length; i++) {
    merged[fk[i]] = fs[fk[i]];
  }
  var ok = Object.keys(os);
  for (var j = 0; j < ok.length; j++) {
    merged[ok[j]] = os[ok[j]];
  }

  globalThis.${CONSTANTS_BUNDLE_GLOBAL_KEY} = merged;
})();
`
}

export function injectConstants(context: QuickJSContext): QuickJSHandle {
  const evalResult = context.evalCode(buildConstantsGuestSource(), 'instant-constants.js')
  if (evalResult.error) {
    const message = (() => {
      try {
        return String(context.dump(evalResult.error))
      } catch {
        return 'constants guest eval failed'
      } finally {
        evalResult.error.dispose()
      }
    })()
    throw new Error(`Failed to inject constants: ${message}`)
  }
  evalResult.value.dispose()

  const handle = context.getProp(context.global, CONSTANTS_BUNDLE_GLOBAL_KEY)
  if (context.typeof(handle) !== 'object') {
    handle.dispose()
    throw new Error('Failed to inject constants: module object missing')
  }

  context.setProp(context.global, CONSTANTS_BUNDLE_GLOBAL_KEY, context.undefined)
  return handle
}

export function buildConstantsModuleSource(builtinsGlobalKey: string): string {
  return (
    `const __m = globalThis.${builtinsGlobalKey}.constants;\n` +
    `export default __m;\n`
  )
}
