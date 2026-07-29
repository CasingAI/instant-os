import type { QuickJSAsyncContext, QuickJSHandle } from 'quickjs-emscripten'
import type { QuickJsAsyncBridge } from '../../quickjs/quickjs-async-bridge.ts'
import type { ChromoScreenshotOptions } from '../../page-host/page-bridge.ts'
import { openDevTools } from '../../page-host/open-devtools.ts'
import { displayPageUrl, normalizePageUrl, pageTitleFromUrl } from '../../page-host/page-url.ts'
import type { PageViewerHandle } from '../../page-host/page-viewer-frame.tsx'
import {
  createWebViewUnit,
  destroyWebViewUnit,
  destroyWebViewUnitsForOwner,
  evalWebViewTab,
  getWebViewUnit,
  listWebViewTabs,
  listWebViewUnits,
  screenshotWebViewTab,
  subscribeWebViewRegistry,
  updateWebViewTab,
  type WebViewUnitEvent,
} from './webview-registry.ts'
import { ensureWebViewWindow, showWebViewWindow } from './webview-app.tsx'

export type WebViewHostBindings = {
  terminalSessionId: string
  openApp: (appId: 'webview', options?: { documentId?: string }) => void
  getWindows: () => {
    id: string
    appId: string
    documentId?: string
    closing?: boolean
    windowless?: boolean
  }[]
  revealWindowlessPanel: (
    windowId: string,
    opts?: {
      title?: string
      width?: number
      height?: number
      chromeKind?: 'window' | 'dialog'
    },
  ) => void
  focusWindow: (windowId: string) => void
  closeWindow: (windowId: string) => void
  openDevToolsApp: (documentId: string) => void
}

export type InjectWebViewOptions = {
  context: QuickJSAsyncContext
  asyncBridge: QuickJsAsyncBridge
  host: WebViewHostBindings
  isDestroyed: () => boolean
}

function guestError(context: QuickJSAsyncContext, error: unknown): QuickJSHandle {
  const message = error instanceof Error ? error.message : String(error)
  return context.unwrapResult(
    context.evalCode(
      `(function () { return new Error(${JSON.stringify(message)}); })()`,
      'webview-error.js',
    ),
  )
}

function encodeJsonValue(context: QuickJSAsyncContext, value: unknown): QuickJSHandle {
  return context.unwrapResult(context.evalCode(`(${JSON.stringify(value)})`, 'webview-json.js'))
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

function readObjectArg(
  context: QuickJSAsyncContext,
  handle: QuickJSHandle | undefined,
  label: string,
): Record<string, unknown> {
  if (handle === undefined || context.typeof(handle) === 'undefined') {
    throw new Error(`${label} 不能为空`)
  }
  const dumped = context.dump(handle)
  if (dumped === null || typeof dumped !== 'object' || Array.isArray(dumped)) {
    throw new Error(`${label} 必须是对象`)
  }
  return dumped as Record<string, unknown>
}

function getViewer(
  unitId: string,
  tabId: string,
): PageViewerHandle | null | undefined {
  return getWebViewUnit(unitId)?.viewerRefs[tabId]?.current
}

/**
 * Inject `globalThis.webview` into a QuickJS instance for the owning terminal session.
 */
export function injectWebView(options: InjectWebViewOptions): () => void {
  const { context, asyncBridge, host, isDestroyed } = options
  const eventUnsubs: Array<() => void> = []
  const guestListeners = new Map<string, Set<QuickJSHandle>>()

  const runAsync = (work: () => Promise<unknown>): QuickJSHandle => {
    const deferred = asyncBridge.createDeferredPromise()
    void (async () => {
      try {
        if (isDestroyed()) {
          throw new Error('QuickJS 实例已销毁')
        }
        const value = await work()
        if (isDestroyed()) {
          asyncBridge.abandonDeferred(deferred)
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
          asyncBridge.abandonDeferred(deferred)
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

  const webviewHandle = context.newObject()

  const bind = (name: string, impl: (...args: QuickJSHandle[]) => QuickJSHandle) => {
    const fn = context.newFunction(name, (...argHandles) => impl(...argHandles))
    context.setProp(webviewHandle, name, fn)
    fn.dispose()
  }

  bind('create', (optsHandle) =>
    runAsync(async () => {
      const opts = readObjectArg(context, optsHandle, 'options')
      const url = String(opts.url ?? '').trim()
      if (!url) throw new Error('url 不能为空')
      const created = createWebViewUnit(host.terminalSessionId, url)
      ensureWebViewWindow(host.openApp, created.unitId)
      return created
    }),
  )

  bind('destroy', (optsHandle) =>
    runAsync(async () => {
      const opts = readObjectArg(context, optsHandle, 'options')
      const unitId = String(opts.unitId ?? '')
      if (!unitId) throw new Error('unitId 不能为空')
      const unit = getWebViewUnit(unitId)
      if (unit?.windowId) {
        host.closeWindow(unit.windowId)
      }
      destroyWebViewUnit(unitId)
    }),
  )

  bind('show', (optsHandle) =>
    runAsync(async () => {
      const opts = readObjectArg(context, optsHandle, 'options')
      const unitId = String(opts.unitId ?? '')
      if (!unitId) throw new Error('unitId 不能为空')
      if (!getWebViewUnit(unitId)) {
        throw new Error(`浏览单元不存在: ${unitId}`)
      }
      const show = () =>
        showWebViewWindow(
          {
            windows: host.getWindows(),
            openApp: host.openApp,
            revealWindowlessPanel: host.revealWindowlessPanel,
            focusWindow: host.focusWindow,
          },
          unitId,
        )
      show()
      await new Promise((resolve) => setTimeout(resolve, 0))
      show()
    }),
  )

  bind('listUnits', () =>
    runAsync(async () =>
      listWebViewUnits()
        .filter((unit) => unit.ownerTerminalSessionId === host.terminalSessionId)
        .map((unit) => ({
          unitId: unit.unitId,
          visible: unit.visible,
          tabCount: unit.tabs.length,
          uiDisplayedTabId: unit.uiDisplayedTabId,
        })),
    ),
  )

  bind('listTabs', (optsHandle) =>
    runAsync(async () => {
      const opts = readObjectArg(context, optsHandle, 'options')
      const unitId = String(opts.unitId ?? '')
      if (!unitId) throw new Error('unitId 不能为空')
      return listWebViewTabs(unitId).map((tab) => ({
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
        loading: tab.loading,
        pendingUrl: tab.pendingUrl,
        fault: tab.pageFault
          ? { code: tab.pageFault.code, message: tab.pageFault.message }
          : undefined,
      }))
    }),
  )

  bind('navigate', (optsHandle) =>
    runAsync(async () => {
      const opts = readObjectArg(context, optsHandle, 'options')
      const unitId = String(opts.unitId ?? '')
      const tabId = String(opts.tabId ?? '')
      const url = String(opts.url ?? '')
      if (!unitId || !tabId || !url) {
        throw new Error('unitId、tabId、url 均不能为空')
      }
      const viewer = getViewer(unitId, tabId)
      if (!viewer) {
        throw new Error('网页尚未就绪')
      }
      const normalized = normalizePageUrl(url)
      updateWebViewTab(unitId, tabId, (tab) => ({
        ...tab,
        url: normalized,
        pendingUrl: normalized,
        title: pageTitleFromUrl(normalized),
        inputUrl: displayPageUrl(normalized),
        loading: true,
        pageFault: undefined,
      }))
      viewer.navigate(normalized)
    }),
  )

  bind('eval', (optsHandle) =>
    runAsync(async () => {
      const opts = readObjectArg(context, optsHandle, 'options')
      const unitId = String(opts.unitId ?? '')
      const tabId = String(opts.tabId ?? '')
      const code = String(opts.code ?? '')
      if (!unitId || !tabId) {
        throw new Error('unitId、tabId 不能为空')
      }
      return evalWebViewTab(unitId, tabId, code, getViewer)
    }),
  )

  bind('screenshot', (optsHandle) =>
    runAsync(async () => {
      const opts = readObjectArg(context, optsHandle, 'options')
      const unitId = String(opts.unitId ?? '')
      const tabId = String(opts.tabId ?? '')
      if (!unitId || !tabId) {
        throw new Error('unitId、tabId 不能为空')
      }
      return screenshotWebViewTab(
        unitId,
        tabId,
        opts.options as ChromoScreenshotOptions | undefined,
        getViewer,
      )
    }),
  )

  bind('openDevTools', (optsHandle) =>
    runAsync(async () => {
      const opts = readObjectArg(context, optsHandle, 'options')
      const unitId = String(opts.unitId ?? '')
      const tabId = String(opts.tabId ?? '')
      if (!unitId || !tabId) {
        throw new Error('unitId、tabId 不能为空')
      }
      if (!getWebViewUnit(unitId)?.tabs.some((tab) => tab.id === tabId)) {
        throw new Error(`标签页不存在: ${tabId}`)
      }
      openDevTools(
        {
          openApp: (_appId, openOptions) => {
            if (openOptions?.documentId) {
              host.openDevToolsApp(openOptions.documentId)
            }
          },
        },
        {
          hostId: unitId,
          tabId,
          mode: opts.mode === 'embedded' ? 'embedded' : 'undocked',
        },
      )
    }),
  )

  const onHandle = context.newFunction('on', (eventHandle, callbackHandle) => {
    const eventName = readStringArg(context, eventHandle, 'event')
    if (!callbackHandle || context.typeof(callbackHandle) !== 'function') {
      return guestError(context, new Error('callback 必须是函数'))
    }
    const dup = callbackHandle.dup()
    let set = guestListeners.get(eventName)
    if (!set) {
      set = new Set()
      guestListeners.set(eventName, set)
    }
    set.add(dup)
    return context.undefined
  })
  context.setProp(webviewHandle, 'on', onHandle)
  onHandle.dispose()

  const offHandle = context.newFunction('off', (eventHandle) => {
    const eventName = readStringArg(context, eventHandle, 'event')
    const set = guestListeners.get(eventName)
    if (!set) {
      return context.undefined
    }
    for (const fn of [...set]) {
      set.delete(fn)
      fn.dispose()
    }
    return context.undefined
  })
  context.setProp(webviewHandle, 'off', offHandle)
  offHandle.dispose()

  const unsubRegistry = subscribeWebViewRegistry((event: WebViewUnitEvent) => {
    if (isDestroyed()) return
    const unit = 'unitId' in event ? getWebViewUnit(event.unitId) : undefined
    if (unit && unit.ownerTerminalSessionId !== host.terminalSessionId) {
      return
    }
    const set = guestListeners.get(event.type)
    if (!set || set.size === 0) return
    for (const fn of [...set]) {
      try {
        const payload = encodeJsonValue(context, event)
        const result = context.callFunction(fn, context.undefined, payload)
        payload.dispose()
        if ('error' in result && result.error) {
          result.error.dispose()
        } else if ('value' in result) {
          result.value.dispose()
        }
      } catch {
        // ignore
      }
    }
  })
  eventUnsubs.push(unsubRegistry)

  context.setProp(context.global, 'webview', webviewHandle)
  webviewHandle.dispose()

  return () => {
    for (const unsub of eventUnsubs) {
      unsub()
    }
    for (const set of guestListeners.values()) {
      for (const fn of set) {
        fn.dispose()
      }
    }
    guestListeners.clear()
    destroyWebViewUnitsForOwner(host.terminalSessionId, host.closeWindow)
  }
}
