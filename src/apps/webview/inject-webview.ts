import type { QuickJSAsyncContext, QuickJSHandle } from 'quickjs-emscripten'
import type { QuickJsAsyncBridge } from '../../quickjs/quickjs-async-bridge.ts'
import { formatQuickJsBridgeErrorMessage } from '../../quickjs/quickjs-bridge-error.ts'
import type { ChromoScreenshotOptions } from '../../page-host/page-bridge.ts'
import { openDevTools } from '../../page-host/open-devtools.ts'
import { displayPageUrl, normalizePageUrl, pageTitleFromUrl } from '../../page-host/page-url.ts'
import type { PageViewerHandle } from '../../page-host/page-viewer-frame.tsx'
import {
  assertWebViewUnitOwner,
  closeWebViewUnitWindows,
  addWebViewTab,
  closeWebViewTab,
  createWebViewUnit,
  destroyWebViewUnit,
  destroyWebViewUnitsForOwner,
  evalWebViewTab,
  getWebViewUnit,
  listWebViewTabs,
  listWebViewUnits,
  markdownWebViewTab,
  requireLiveWebViewTab,
  resolveWebViewTabId,
  screenshotWebViewTab,
  snapshotWebViewTab,
  subscribeWebViewRegistry,
  updateWebViewTab,
  waitWebViewTab,
  type WebViewUnitEvent,
} from './webview-registry.ts'
import { hideWebViewWindow, showWebViewWindow } from './webview-window-service.ts'

export type WebViewHostBindings = {
  terminalSessionId: string
  openApp: (appId: 'webview', options?: { documentId?: string }) => string | undefined
  getWindows: () => {
    id: string
    appId: string
    documentId?: string
    closing?: boolean
    minimized?: boolean
  }[]
  focusWindow: (windowId: string) => void
  restoreWindow: (windowId: string) => void
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
  const message = formatQuickJsBridgeErrorMessage('webview', error)
  return context.unwrapResult(
    context.evalCode(
      `(function () { return new Error(${JSON.stringify(message)}); })()`,
      'webview-error.js',
    ),
  )
}

/** webview 桥接回传 guest 的 JSON 文本硬上限（避免大字符串打穿 QuickJS WASM）。 */
const WEBVIEW_ENCODE_MAX_JSON_CHARS = 2 * 1024 * 1024

function encodeJsonValue(context: QuickJSAsyncContext, value: unknown): QuickJSHandle {
  const json = JSON.stringify(value)
  if (json.length > WEBVIEW_ENCODE_MAX_JSON_CHARS) {
    throw new Error(
      `返回值过大（${json.length} 字符，上限 ${WEBVIEW_ENCODE_MAX_JSON_CHARS}）；请用 snapshot/markdown 或缩小 eval 结果，勿整页 innerText`,
    )
  }
  return context.unwrapResult(context.evalCode(`(${json})`, 'webview-json.js'))
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

function resolveOwnedTab(
  host: WebViewHostBindings,
  unitId: string,
  tabId: string,
): { unitId: string; tabId: string } {
  assertWebViewUnitOwner(unitId, host.terminalSessionId)
  return { unitId, tabId: resolveWebViewTabId(unitId, tabId) }
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
      return createWebViewUnit(host.terminalSessionId, url)
    }),
  )

  bind('destroy', (optsHandle) =>
    runAsync(async () => {
      const opts = readObjectArg(context, optsHandle, 'options')
      const unitId = String(opts.unitId ?? '')
      if (!unitId) throw new Error('unitId 不能为空')
      assertWebViewUnitOwner(unitId, host.terminalSessionId)
      closeWebViewUnitWindows(unitId, host.getWindows(), host.closeWindow)
      destroyWebViewUnit(unitId)
    }),
  )

  bind('show', (optsHandle) =>
    runAsync(async () => {
      const opts = readObjectArg(context, optsHandle, 'options')
      const unitId = String(opts.unitId ?? '')
      if (!unitId) throw new Error('unitId 不能为空')
      assertWebViewUnitOwner(unitId, host.terminalSessionId)
      showWebViewWindow(
        {
          openApp: host.openApp,
          getWindows: host.getWindows,
          focusWindow: host.focusWindow,
          restoreWindow: host.restoreWindow,
          closeWindow: host.closeWindow,
        },
        unitId,
      )
    }),
  )

  bind('hide', (optsHandle) =>
    runAsync(async () => {
      const opts = readObjectArg(context, optsHandle, 'options')
      const unitId = String(opts.unitId ?? '')
      if (!unitId) throw new Error('unitId 不能为空')
      assertWebViewUnitOwner(unitId, host.terminalSessionId)
      hideWebViewWindow(
        {
          openApp: host.openApp,
          getWindows: host.getWindows,
          focusWindow: host.focusWindow,
          restoreWindow: host.restoreWindow,
          closeWindow: host.closeWindow,
        },
        unitId,
      )
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
      assertWebViewUnitOwner(unitId, host.terminalSessionId)
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

  bind('wait', (optsHandle) =>
    runAsync(async () => {
      const opts = readObjectArg(context, optsHandle, 'options')
      const unitId = String(opts.unitId ?? '')
      const tabId = String(opts.tabId ?? 'default')
      if (!unitId) throw new Error('unitId 不能为空')
      const resolved = resolveOwnedTab(host, unitId, tabId)
      const timeoutMs =
        typeof opts.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs)
          ? opts.timeoutMs
          : undefined
      await waitWebViewTab(resolved.unitId, resolved.tabId, timeoutMs)
    }),
  )

  bind('openTab', (optsHandle) =>
    runAsync(async () => {
      const opts = readObjectArg(context, optsHandle, 'options')
      const unitId = String(opts.unitId ?? '')
      const url = String(opts.url ?? '').trim()
      if (!unitId || !url) {
        throw new Error('unitId、url 均不能为空')
      }
      assertWebViewUnitOwner(unitId, host.terminalSessionId)
      const tabId = addWebViewTab(unitId, url)
      return { unitId, tabId }
    }),
  )

  bind('closeTab', (optsHandle) =>
    runAsync(async () => {
      const opts = readObjectArg(context, optsHandle, 'options')
      const unitId = String(opts.unitId ?? '')
      const tabId = String(opts.tabId ?? 'default')
      if (!unitId) {
        throw new Error('unitId 不能为空')
      }
      const resolved = resolveOwnedTab(host, unitId, tabId)
      closeWebViewTab(resolved.unitId, resolved.tabId)
    }),
  )

  bind('navigate', (optsHandle) =>
    runAsync(async () => {
      const opts = readObjectArg(context, optsHandle, 'options')
      const unitId = String(opts.unitId ?? '')
      const tabId = String(opts.tabId ?? 'default')
      const url = String(opts.url ?? '')
      if (!unitId || !url) {
        throw new Error('unitId、url 均不能为空')
      }
      const resolved = resolveOwnedTab(host, unitId, tabId)
      requireLiveWebViewTab(resolved.unitId, resolved.tabId)
      const viewer = getViewer(resolved.unitId, resolved.tabId)
      if (!viewer) {
        throw new Error('网页尚未就绪')
      }
      const normalized = normalizePageUrl(url)
      updateWebViewTab(resolved.unitId, resolved.tabId, (tab) => ({
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
      const tabId = String(opts.tabId ?? 'default')
      const code = String(opts.code ?? '')
      if (!unitId) {
        throw new Error('unitId 不能为空')
      }
      const resolved = resolveOwnedTab(host, unitId, tabId)
      return evalWebViewTab(resolved.unitId, resolved.tabId, code, getViewer)
    }),
  )

  bind('screenshot', (optsHandle) =>
    runAsync(async () => {
      const opts = readObjectArg(context, optsHandle, 'options')
      const unitId = String(opts.unitId ?? '')
      const tabId = String(opts.tabId ?? 'default')
      if (!unitId) {
        throw new Error('unitId 不能为空')
      }
      const resolved = resolveOwnedTab(host, unitId, tabId)
      const nested =
        opts.options && typeof opts.options === 'object' && !Array.isArray(opts.options)
          ? (opts.options as ChromoScreenshotOptions)
          : undefined
      const flat: ChromoScreenshotOptions = {
        format:
          opts.format === 'jpeg' || opts.format === 'png'
            ? opts.format
            : undefined,
        quality: typeof opts.quality === 'number' ? opts.quality : undefined,
        fullPage: typeof opts.fullPage === 'boolean' ? opts.fullPage : undefined,
        scale: typeof opts.scale === 'number' ? opts.scale : undefined,
        timeout: typeof opts.timeout === 'number' ? opts.timeout : undefined,
      }
      const screenshotOptions: ChromoScreenshotOptions = {
        ...flat,
        ...nested,
      }
      const hasOptions =
        screenshotOptions.format !== undefined ||
        screenshotOptions.quality !== undefined ||
        screenshotOptions.fullPage !== undefined ||
        screenshotOptions.scale !== undefined ||
        screenshotOptions.timeout !== undefined
      return screenshotWebViewTab(
        resolved.unitId,
        resolved.tabId,
        hasOptions ? screenshotOptions : undefined,
        getViewer,
      )
    }),
  )

  bind('snapshot', (optsHandle) =>
    runAsync(async () => {
      const opts = readObjectArg(context, optsHandle, 'options')
      const unitId = String(opts.unitId ?? '')
      const tabId = String(opts.tabId ?? 'default')
      if (!unitId) {
        throw new Error('unitId 不能为空')
      }
      const resolved = resolveOwnedTab(host, unitId, tabId)
      return snapshotWebViewTab(resolved.unitId, resolved.tabId, getViewer)
    }),
  )

  bind('markdown', (optsHandle) =>
    runAsync(async () => {
      const opts = readObjectArg(context, optsHandle, 'options')
      const unitId = String(opts.unitId ?? '')
      const tabId = String(opts.tabId ?? 'default')
      if (!unitId) {
        throw new Error('unitId 不能为空')
      }
      const resolved = resolveOwnedTab(host, unitId, tabId)
      const ref =
        opts.ref === undefined || opts.ref === null || opts.ref === ''
          ? undefined
          : String(opts.ref)
      return markdownWebViewTab(resolved.unitId, resolved.tabId, ref, getViewer)
    }),
  )

  bind('openDevTools', (optsHandle) =>
    runAsync(async () => {
      const opts = readObjectArg(context, optsHandle, 'options')
      const unitId = String(opts.unitId ?? '')
      const tabId = String(opts.tabId ?? 'default')
      if (!unitId) {
        throw new Error('unitId 不能为空')
      }
      const resolved = resolveOwnedTab(host, unitId, tabId)
      const mode = opts.mode === 'embedded' ? 'embedded' : 'undocked'
      updateWebViewTab(resolved.unitId, resolved.tabId, (tab) =>
        mode === 'embedded'
          ? {
              ...tab,
              devtoolsOpen: true,
              devtoolsUndocked: false,
            }
          : {
              ...tab,
              devtoolsUndocked: true,
              devtoolsOpen: false,
            },
      )
      openDevTools(
        {
          openApp: (_appId, openOptions) => {
            if (openOptions?.documentId) {
              host.openDevToolsApp(openOptions.documentId)
            }
          },
        },
        {
          hostId: resolved.unitId,
          tabId: resolved.tabId,
          mode,
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

    const unsubscribe = context.newFunction('unsubscribe', () => {
      const current = guestListeners.get(eventName)
      if (current?.has(dup)) {
        current.delete(dup)
        if (dup.alive) {
          dup.dispose()
        }
        if (current.size === 0) {
          guestListeners.delete(eventName)
        }
      }
      return context.undefined
    })
    return unsubscribe
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
      if (fn.alive) {
        fn.dispose()
      }
    }
    guestListeners.delete(eventName)
    return context.undefined
  })
  context.setProp(webviewHandle, 'off', offHandle)
  offHandle.dispose()

  const unsubRegistry = subscribeWebViewRegistry((event: WebViewUnitEvent) => {
    if (isDestroyed()) return
    if (event.type === 'unitDestroyed') {
      if (event.ownerTerminalSessionId !== host.terminalSessionId) {
        return
      }
    } else {
      const unit = getWebViewUnit(event.unitId)
      if (unit && unit.ownerTerminalSessionId !== host.terminalSessionId) {
        return
      }
      // unit 已删的非 unitDestroyed 事件忽略
      if (!unit && event.type !== 'unitDestroyed') {
        return
      }
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
      for (const fn of [...set]) {
        set.delete(fn)
        if (fn.alive) {
          try {
            fn.dispose()
          } catch {
            // ignore
          }
        }
      }
    }
    guestListeners.clear()
    const ownedIds = new Set(
      listWebViewUnits()
        .filter((unit) => unit.ownerTerminalSessionId === host.terminalSessionId)
        .map((unit) => unit.unitId),
    )
    for (const unitId of ownedIds) {
      closeWebViewUnitWindows(unitId, host.getWindows(), host.closeWindow)
    }
    destroyWebViewUnitsForOwner(host.terminalSessionId, host.closeWindow)
  }
}
