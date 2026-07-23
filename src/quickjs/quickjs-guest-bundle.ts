import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'

export type InjectGuestBundleOptions = {
  /** Source filename shown in QuickJS stack / eval diagnostics */
  evalFilename: string
  /** Temporary globalThis key set by the IIFE bundle */
  globalKey: string
  /** Guest global to assign from bundle[primaryExport] (e.g. Buffer) */
  globalCtorKey: string
  primaryExport: string
  exportKeys: readonly string[]
  label: string
}

/**
 * Eval a vendored IIFE bundle, hoist primary ctor to globalThis, return module object, clear temp global.
 */
export function injectGuestBundle(
  context: QuickJSContext,
  source: string,
  options: InjectGuestBundleOptions,
): QuickJSHandle {
  const { evalFilename, globalKey, globalCtorKey, primaryExport, exportKeys, label } = options

  const evalResult = context.evalCode(source, evalFilename)
  if (evalResult.error) {
    const message = (() => {
      try {
        return String(context.dump(evalResult.error))
      } catch {
        return `${label} bundle eval failed`
      } finally {
        evalResult.error.dispose()
      }
    })()
    throw new Error(`Failed to inject ${label}: ${message}`)
  }
  evalResult.value.dispose()

  const bundle = context.getProp(context.global, globalKey)
  if (context.typeof(bundle) !== 'object') {
    bundle.dispose()
    throw new Error(`Failed to inject ${label}: bundle global missing`)
  }

  try {
    const ctor = context.getProp(bundle, primaryExport)
    if (context.typeof(ctor) !== 'function') {
      ctor.dispose()
      throw new Error(`Failed to inject ${label}: ${primaryExport} constructor missing`)
    }
    context.setProp(context.global, globalCtorKey, ctor)
    ctor.dispose()

    const moduleObject = context.newObject()
    for (const key of exportKeys) {
      const prop = context.getProp(bundle, key)
      context.setProp(moduleObject, key, prop)
      prop.dispose()
    }

    context.setProp(context.global, globalKey, context.undefined)

    return moduleObject
  } finally {
    bundle.dispose()
  }
}
