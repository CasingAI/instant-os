import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'
import { QUICKJS_BUFFER_BUNDLE_SOURCE } from './quickjs-buffer-bundle-source.ts'
import { injectGuestBundle } from './quickjs-guest-bundle.ts'

const BUNDLE_GLOBAL_KEY = '__instantBufferBundle'

const BUFFER_MODULE_EXPORT_KEYS = [
  'Buffer',
  'SlowBuffer',
  'INSPECT_MAX_BYTES',
  'kMaxLength',
] as const

/**
 * Eval feross/buffer bundle into guest，挂全局 Buffer，并返回 buffer 模块对象（与全局同一 Buffer）。
 */
export function injectBuffer(context: QuickJSContext): QuickJSHandle {
  return injectGuestBundle(context, QUICKJS_BUFFER_BUNDLE_SOURCE, {
    evalFilename: 'instant-buffer-bundle.js',
    globalKey: BUNDLE_GLOBAL_KEY,
    globalCtorKey: 'Buffer',
    primaryExport: 'Buffer',
    exportKeys: BUFFER_MODULE_EXPORT_KEYS,
    label: 'Buffer',
  })
}

export function buildBufferModuleSource(builtinsGlobalKey: string): string {
  const named = BUFFER_MODULE_EXPORT_KEYS.map((key) => `export const ${key} = __m.${key};`).join(
    '\n',
  )
  return `const __m = globalThis.${builtinsGlobalKey}.buffer;\n${named}\nexport default __m;\n`
}
