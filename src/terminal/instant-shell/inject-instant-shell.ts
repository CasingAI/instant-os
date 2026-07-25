import type { QuickJSAsyncContext, QuickJSHandle } from 'quickjs-emscripten'
import type { QuickJsAsyncBridge } from '../../quickjs/quickjs-async-bridge.ts'
import { createInstantShellApi } from './instant-shell-host.ts'
import type { InstantShellHost, InstantShellOpenAppOptions } from './instant-shell-types.ts'

export type InjectInstantShellOptions = {
  context: QuickJSAsyncContext
  asyncBridge: QuickJsAsyncBridge
  host: InstantShellHost
  isDestroyed: () => boolean
}

function guestError(context: QuickJSAsyncContext, error: unknown): QuickJSHandle {
  const message = error instanceof Error ? error.message : String(error)
  return context.unwrapResult(
    context.evalCode(
      `(function () { return new Error(${JSON.stringify(message)}); })()`,
      'instant-shell-error.js',
    ),
  )
}

function encodeJsonValue(context: QuickJSAsyncContext, value: unknown): QuickJSHandle {
  return context.unwrapResult(context.evalCode(`(${JSON.stringify(value)})`, 'instant-shell-json.js'))
}

function readStringArg(
  context: QuickJSAsyncContext,
  handle: QuickJSHandle | undefined,
  label: string,
): string {
  if (handle === undefined) {
    throw new Error(`${label} 不能为空`)
  }
  const dumped = context.dump(handle)
  if (typeof dumped !== 'string') {
    throw new Error(`${label} 必须是字符串`)
  }
  return dumped
}

function readOpenAppOptions(
  context: QuickJSAsyncContext,
  handle: QuickJSHandle | undefined,
): InstantShellOpenAppOptions | undefined {
  if (handle === undefined || context.typeof(handle) === 'undefined') {
    return undefined
  }
  const dumped = context.dump(handle)
  if (dumped === null || typeof dumped !== 'object' || Array.isArray(dumped)) {
    throw new Error('openApp 选项必须是对象')
  }
  const record = dumped as Record<string, unknown>
  const options: InstantShellOpenAppOptions = {}
  if (record.documentId !== undefined) {
    if (typeof record.documentId !== 'string') {
      throw new Error('documentId 必须是字符串')
    }
    options.documentId = record.documentId
  }
  if (record.url !== undefined) {
    if (typeof record.url !== 'string') {
      throw new Error('url 必须是字符串')
    }
    options.url = record.url
  }
  return options
}

/**
 * 将 `globalThis.instant` 注入 QuickJS（终端专用壳层 API）。
 * 须在 asyncBridge.injectGlobals() 之后调用。
 */
export function injectInstantShell(options: InjectInstantShellOptions): void {
  const { context, asyncBridge, host, isDestroyed } = options
  const api = createInstantShellApi(host)

  const runAsync = (
    work: () => Promise<unknown>,
  ): QuickJSHandle => {
    const deferred = asyncBridge.createDeferredPromise()
    void (async () => {
      try {
        if (isDestroyed()) {
          throw new Error('QuickJS 实例已销毁')
        }
        const value = await work()
        if (isDestroyed()) {
          if (deferred.alive) {
            deferred.dispose()
          }
          return
        }
        if (value === undefined) {
          asyncBridge.settleGuestPromise(deferred, { ok: true, value: context.undefined })
          return
        }
        const encoded = encodeJsonValue(context, value)
        asyncBridge.settleGuestPromise(deferred, { ok: true, value: encoded })
      } catch (error) {
        if (isDestroyed()) {
          if (deferred.alive) {
            deferred.dispose()
          }
          return
        }
        asyncBridge.settleGuestPromise(deferred, {
          ok: false,
          error: guestError(context, error),
        })
      }
    })()
    return deferred.handle
  }

  const instant = context.newObject()

  const bind = (name: string, impl: (...args: QuickJSHandle[]) => QuickJSHandle) => {
    const fn = context.newFunction(name, (...argHandles) => impl(...argHandles))
    context.setProp(instant, name, fn)
    fn.dispose()
  }

  bind('openApp', (appIdHandle, optionsHandle) =>
    runAsync(async () => {
      const appId = readStringArg(context, appIdHandle, 'appId')
      const openOptions = readOpenAppOptions(context, optionsHandle)
      await api.openApp(appId, openOptions)
    }),
  )

  bind('openPath', (pathHandle) =>
    runAsync(async () => {
      await api.openPath(readStringArg(context, pathHandle, 'path'))
    }),
  )

  bind('openUrl', (urlHandle) =>
    runAsync(async () => {
      await api.openUrl(readStringArg(context, urlHandle, 'url'))
    }),
  )

  bind('listApps', () => runAsync(async () => api.listApps()))

  bind('listWindows', () => runAsync(async () => api.listWindows()))

  bind('focus', (targetHandle) =>
    runAsync(async () => {
      await api.focus(readStringArg(context, targetHandle, 'target'))
    }),
  )

  bind('close', (targetHandle) =>
    runAsync(async () => {
      await api.close(readStringArg(context, targetHandle, 'target'))
    }),
  )

  bind('minimize', (targetHandle) =>
    runAsync(async () => {
      await api.minimize(readStringArg(context, targetHandle, 'target'))
    }),
  )

  bind('restore', (targetHandle) =>
    runAsync(async () => {
      await api.restore(readStringArg(context, targetHandle, 'target'))
    }),
  )

  bind('toggleFullscreen', (targetHandle) =>
    runAsync(async () => {
      await api.toggleFullscreen(readStringArg(context, targetHandle, 'target'))
    }),
  )

  bind('toggleMaximize', (targetHandle) =>
    runAsync(async () => {
      await api.toggleMaximize(readStringArg(context, targetHandle, 'target'))
    }),
  )

  context.setProp(context.global, 'instant', instant)
  instant.dispose()
}
