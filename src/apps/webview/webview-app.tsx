import { createRef } from 'preact'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { RefObject } from 'preact'
import type { ChromoApplicationApi } from '../chromo/chromo-application-panel.tsx'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs, useWindowCloseGuard } from '../../os/os-context.tsx'
import { openDevTools } from '../../page-host/open-devtools.ts'
import {
  makePageDevToolsSessionKey,
  registerPageDevToolsSession,
  unregisterChromoDevToolsSession,
  type ChromoDevToolsHandlers,
  type PageDevToolsSnapshot,
} from '../../page-host/page-devtools-hub.ts'
import { formatPageFault } from '../../page-host/page-fault.ts'
import { PageFaultView } from '../../page-host/page-fault-view.tsx'
import {
  resolveNavIntent,
  shouldCreateTab,
  shouldNavigateSameTab,
} from '../../page-host/page-nav.ts'
import { displayPageUrl, normalizePageUrl, pageTitleFromUrl } from '../../page-host/page-url.ts'
import { PageViewerFrame, type PageViewerHandle } from '../../page-host/page-viewer-frame.tsx'
import type { ChromoNetworkEntry } from '../../page-host/page-bridge.ts'
import { DocumentTabBar } from '../../ui/document-tab-bar.tsx'
import {
  addWebViewTab,
  closeWebViewTab,
  destroyWebViewUnit,
  emitWebViewNavigated,
  emitWebViewTabFault,
  getWebViewUnit,
  injectWebViewFaultDocument,
  onWebViewRegistryChanged,
  setWebViewUiDisplayedTab,
  setWebViewUnitVisible,
  updateWebViewTab,
} from './webview-registry.ts'
import '../chromo/chromo.css'
import './webview.css'

const APP_ID = 'webview' as const

function makeWebViewApplicationApi(
  getViewer: () => PageViewerHandle | null | undefined,
): ChromoApplicationApi {
  const requireViewer = () => {
    const viewer = getViewer()
    if (!viewer?.isReady()) {
      throw new Error('网页尚未就绪')
    }
    return viewer
  }
  return {
    listCookies: () => requireViewer().listCookies(),
    deleteCookie: (cookieId) => requireViewer().deleteCookie(cookieId),
    clearCookies: (domain) => requireViewer().clearCookies(domain),
    clearAllCookies: () => requireViewer().clearAllCookies(),
    listStorage: (type) => requireViewer().listStorage(type),
    setStorageItem: (type, key, value) => requireViewer().setStorageItem(type, key, value),
    removeStorageItem: (type, key) => requireViewer().removeStorageItem(type, key),
    clearStorage: (type) => requireViewer().clearStorage(type),
    getSwInfo: () => requireViewer().getSwInfo(),
    getNetworkCacheStats: () => requireViewer().getNetworkCacheStats(),
    listNetworkCache: (layer) => requireViewer().listNetworkCache(layer),
    clearNetworkCache: (origin) => requireViewer().clearNetworkCache(origin),
    clearAllNetworkCache: (layer) => requireViewer().clearAllNetworkCache(layer),
    listIdb: () => requireViewer().listIdb(),
    deleteIdb: (name) => requireViewer().deleteIdb(name),
    listIdbStores: (name) => requireViewer().listIdbStores(name),
    getIdbAll: (name, store) => requireViewer().getIdbAll(name, store),
    listSiteCaches: () => requireViewer().listSiteCaches(),
    listSiteCacheKeys: (cache) => requireViewer().listSiteCacheKeys(cache),
    deleteSiteCache: (cache, url) => requireViewer().deleteSiteCache(cache, url),
  }
}

type WebViewAppProps = {
  windowId?: string
}

export function WebViewApp({ windowId }: WebViewAppProps) {
  const {
    windows,
    closeWindow,
    openApp,
    setWindowTitle,
  } = useOs()
  const { showBuiltinAbout } = useAboutApp()

  const appWindow = windowId
    ? windows.find((window) => window.id === windowId && !window.closing)
    : undefined
  const unitId = appWindow?.documentId ?? ''
  const [tick, setTick] = useState(0)

  useEffect(() => onWebViewRegistryChanged(() => setTick((n) => n + 1)), [])

  const unit = unitId ? getWebViewUnit(unitId) : undefined
  const visible = Boolean(appWindow && (!appWindow.windowless || appWindow.windowlessPanel))

  // 同步可见性；勿依赖 tick——setVisible 若 notify 会再 bump tick，形成死循环
  useEffect(() => {
    if (!unitId || !windowId) return
    if (!getWebViewUnit(unitId)) return
    setWebViewUnitVisible(unitId, visible, windowId)
  }, [unitId, windowId, visible])

  // 单元已被销毁时收掉孤儿窗（destroy 会 bump tick）
  useEffect(() => {
    if (!unitId || !windowId) return
    if (getWebViewUnit(unitId)) return
    closeWindow(windowId)
  }, [unitId, windowId, tick, closeWindow])

  useWindowCloseGuard(windowId, () => {
    if (unitId) {
      destroyWebViewUnit(unitId)
    }
    return true
  })

  useEffect(() => {
    if (!windowId || !unit) return
    const tab = unit.tabs.find((t) => t.id === unit.uiDisplayedTabId) ?? unit.tabs[0]
    const title = tab?.loading
      ? `正在加载 ${tab.pendingUrl || tab.url}`
      : tab?.title || 'WebView'
    setWindowTitle(windowId, title)
  }, [windowId, unit, tick, setWindowTitle])

  const getViewerRef = useCallback(
    (tabId: string): RefObject<PageViewerHandle> => {
      if (!unit) {
        return createRef<PageViewerHandle>()
      }
      if (!unit.viewerRefs[tabId]) {
        unit.viewerRefs[tabId] = createRef<PageViewerHandle>()
      }
      return unit.viewerRefs[tabId]
    },
    [unit, tick],
  )

  const unitIdForPull = unit?.unitId
  const networkPullTimersRef = useRef<Record<string, number>>({})

  const pullConsoleDelta = useCallback(
    async (tabId: string) => {
      if (!unitIdForPull) return
      const viewer = getViewerRef(tabId).current
      if (!viewer?.isReady()) return
      const tab = getWebViewUnit(unitIdForPull)?.tabs.find((entry) => entry.id === tabId)
      if (!tab) return
      try {
        const result = await viewer.readConsole({ after: tab.lastConsoleId || undefined })
        if (!result.entries.length) {
          if (result.latestId) {
            updateWebViewTab(unitIdForPull, tabId, (entry) => ({
              ...entry,
              lastConsoleId: result.latestId!,
            }))
          }
          return
        }
        updateWebViewTab(unitIdForPull, tabId, (entry) => {
          const seen = new Set(entry.consoleEntries.map((item) => item.id))
          const fresh = result.entries.filter((item) => item.id && !seen.has(item.id))
          if (!fresh.length) {
            return {
              ...entry,
              lastConsoleId: result.latestId ?? entry.lastConsoleId,
            }
          }
          return {
            ...entry,
            consoleEntries: [...entry.consoleEntries, ...fresh],
            lastConsoleId: result.latestId ?? entry.lastConsoleId,
          }
        })
      } catch (err) {
        console.error('[webview console read]', err)
      }
    },
    [getViewerRef, unitIdForPull],
  )

  const pullNetworkDelta = useCallback(
    async (tabId: string, options?: { full?: boolean }) => {
      if (!unitIdForPull) return
      const viewer = getViewerRef(tabId).current
      if (!viewer?.isReady()) return
      const tab = getWebViewUnit(unitIdForPull)?.tabs.find((entry) => entry.id === tabId)
      if (!tab) return
      const full = !!options?.full
      try {
        let result = await viewer.readNetwork(
          full ? { limit: 100 } : { after: tab.lastNetworkId || undefined },
        )
        if (
          !full &&
          !result.entries.length &&
          tab.networkEntries.length === 0 &&
          result.latestId &&
          result.latestId !== tab.lastNetworkId
        ) {
          result = await viewer.readNetwork({ limit: 100 })
        }
        if (!result.entries.length) {
          if (result.latestId && result.latestId !== tab.lastNetworkId) {
            updateWebViewTab(unitIdForPull, tabId, (entry) => ({
              ...entry,
              lastNetworkId: result.latestId!,
            }))
          }
          return
        }
        updateWebViewTab(unitIdForPull, tabId, (entry) => {
          const byId = new Map(entry.networkEntries.map((item) => [item.id, item]))
          for (const item of result.entries) {
            byId.set(item.id, item)
          }
          return {
            ...entry,
            networkEntries: Array.from(byId.values()),
            lastNetworkId: result.latestId ?? entry.lastNetworkId,
          }
        })
      } catch (err) {
        console.error('[webview network read]', err)
      }
    },
    [getViewerRef, unitIdForPull],
  )

  const ingestNetworkEntry = useCallback(
    (tabId: string, entry: ChromoNetworkEntry, latestId?: string) => {
      if (!unitIdForPull) return
      updateWebViewTab(unitIdForPull, tabId, (current) => {
        const idx = current.networkEntries.findIndex((item) => item.id === entry.id)
        const networkEntries =
          idx >= 0
            ? current.networkEntries.map((item, i) => (i === idx ? entry : item))
            : [...current.networkEntries, entry]
        return {
          ...current,
          networkEntries,
          lastNetworkId: latestId || entry.id || current.lastNetworkId,
        }
      })
    },
    [unitIdForPull],
  )

  const scheduleNetworkPull = useCallback(
    (tabId: string) => {
      const existing = networkPullTimersRef.current[tabId]
      if (existing) {
        window.clearTimeout(existing)
      }
      networkPullTimersRef.current[tabId] = window.setTimeout(() => {
        delete networkPullTimersRef.current[tabId]
        void pullNetworkDelta(tabId)
      }, 50)
    },
    [pullNetworkDelta],
  )

  useEffect(() => {
    return () => {
      for (const timer of Object.values(networkPullTimersRef.current)) {
        window.clearTimeout(timer)
      }
      networkPullTimersRef.current = {}
    }
  }, [])

  const unitTabsRef = useRef(unit?.tabs)
  unitTabsRef.current = unit?.tabs
  const windowsRef = useRef(windows)
  windowsRef.current = windows

  // 独立 DevTools 窗依赖 hub session；WebView 此前只 openApp 未 register →「已断开」
  useEffect(() => {
    if (!unit) return
    const hostId = unit.unitId
    const undocked = unit.tabs.filter((tab) => tab.devtoolsUndocked)
    for (const tab of undocked) {
      const key = makePageDevToolsSessionKey(hostId, tab.id)
      const snapshot: PageDevToolsSnapshot = {
        hostId,
        parentWindowId: hostId,
        tabId: tab.id,
        pageTitle: tab.title,
        pageUrl: tab.url,
        pageReady: Boolean(tab.ready && tab.url),
        pageLoading: tab.loading,
        pageError: formatPageFault(tab.pageFault),
        pageFault: tab.pageFault,
        panelTab: tab.devtoolsTab,
        dockSide: tab.devtoolsDockSide,
        preserveLog: tab.preserveConsole,
        consoleEntries: tab.consoleEntries,
        replEntries: [],
        replHistory: [],
        networkEntries: tab.networkEntries,
        selectedNetworkId: tab.selectedNetworkId,
        disableNetworkCache: tab.disableNetworkCache,
        vConsoleEnabled: false,
        vConsoleBusy: false,
        debugPanelEnabled: false,
        viewerReady: tab.ready,
      }
      const handlers: ChromoDevToolsHandlers = {
        evalInPage: (code) => {
          const viewer = getViewerRef(tab.id).current
          if (!viewer?.isReady()) {
            return Promise.reject(new Error('网页尚未就绪'))
          }
          return viewer.evalInPage(code)
        },
        readNetworkBody: (entryId) => {
          const viewer = getViewerRef(tab.id).current
          if (!viewer?.isReady()) {
            return Promise.reject(new Error('网页尚未就绪'))
          }
          return viewer.readNetworkBody(entryId)
        },
        readNetworkBodyLines: (entryId, options) => {
          const viewer = getViewerRef(tab.id).current
          if (!viewer?.isReady()) {
            return Promise.reject(new Error('网页尚未就绪'))
          }
          return viewer.readNetworkBodyLines(entryId, options)
        },
        probeNetworkHot: (method, url) => {
          const viewer = getViewerRef(tab.id).current
          if (!viewer?.isReady()) {
            return Promise.reject(new Error('网页尚未就绪'))
          }
          return viewer.probeNetworkHot(method, url)
        },
        setNetworkOptions: (options) => {
          getViewerRef(tab.id).current?.setNetworkOptions(options)
        },
        application: makeWebViewApplicationApi(() => getViewerRef(tab.id).current),
        onPanelTabChange: (panelTab) => {
          updateWebViewTab(hostId, tab.id, (entry) => ({ ...entry, devtoolsTab: panelTab }))
        },
        onPreserveLogChange: (preserve) => {
          updateWebViewTab(hostId, tab.id, (entry) => ({
            ...entry,
            preserveConsole: preserve,
          }))
        },
        onClear: () => {
          const current = getWebViewUnit(hostId)?.tabs.find((entry) => entry.id === tab.id)
          if (current?.devtoolsTab === 'network') {
            updateWebViewTab(hostId, tab.id, (entry) => ({
              ...entry,
              networkEntries: [],
              lastNetworkId: '',
              selectedNetworkId: '',
            }))
            return
          }
          updateWebViewTab(hostId, tab.id, (entry) => ({
            ...entry,
            consoleEntries: [],
            lastConsoleId: '',
          }))
        },
        onAppendEntries: () => {
          // WebView 暂未接 REPL 回写；独立窗仍可用 evalInPage
        },
        onReplHistoryChange: () => {},
        onSelectNetwork: (entry) => {
          updateWebViewTab(hostId, tab.id, (t) => ({
            ...t,
            selectedNetworkId: entry.id,
          }))
        },
        onCloseNetworkDetail: () => {
          updateWebViewTab(hostId, tab.id, (t) => ({ ...t, selectedNetworkId: '' }))
        },
        onDisableNetworkCacheChange: (disable) => {
          updateWebViewTab(hostId, tab.id, (t) => ({
            ...t,
            disableNetworkCache: disable,
          }))
          getViewerRef(tab.id).current?.setNetworkOptions({ disableCache: disable })
        },
        onVConsoleEnabledChange: () => {},
        onDebugPanelEnabledChange: (enabled) => {
          getViewerRef(tab.id).current?.setDebugPanelEnabled(enabled)
        },
        onClearBrowsingData: async () => {
          const viewer = getViewerRef(tab.id).current
          if (!viewer?.isReady()) return
          await viewer.clearState({})
        },
        onRedock: (side) => {
          updateWebViewTab(hostId, tab.id, (entry) => ({
            ...entry,
            devtoolsUndocked: false,
            devtoolsOpen: true,
            devtoolsDockSide: side,
          }))
          unregisterChromoDevToolsSession(key)
        },
        onDetachedClosed: () => {
          updateWebViewTab(hostId, tab.id, (entry) => ({
            ...entry,
            devtoolsUndocked: false,
            devtoolsOpen: false,
          }))
          unregisterChromoDevToolsSession(key)
        },
      }
      registerPageDevToolsSession(key, snapshot, handlers)
    }
    for (const tab of unit.tabs) {
      if (tab.devtoolsUndocked) continue
      unregisterChromoDevToolsSession(makePageDevToolsSessionKey(hostId, tab.id))
    }
  }, [getViewerRef, unit, tick])

  useEffect(() => {
    const capturedHostId = unitId
    return () => {
      if (!capturedHostId) return
      for (const tab of unitTabsRef.current ?? []) {
        unregisterChromoDevToolsSession(makePageDevToolsSessionKey(capturedHostId, tab.id))
      }
      for (const window of windowsRef.current) {
        if (
          window.appId === 'page-devtools' &&
          !window.closing &&
          window.documentId?.startsWith(`${capturedHostId}:`)
        ) {
          closeWindow(window.id)
        }
      }
    }
  }, [closeWindow, unitId])

  const displayedTab =
    unit?.tabs.find((tab) => tab.id === unit.uiDisplayedTabId) ?? unit?.tabs[0]

  const addressText = useMemo(() => {
    if (!displayedTab) return ''
    if (displayedTab.loading) {
      return `正在加载 ${displayedTab.pendingUrl || displayedTab.url}`
    }
    return displayedTab.url ? displayPageUrl(displayedTab.url) : ''
  }, [displayedTab, tick])

  const tabItems = useMemo(
    () =>
      (unit?.tabs ?? []).map((tab) => ({
        id: tab.id,
        title: tab.loading ? '正在加载…' : tab.title,
        pathTitle: tab.url,
      })),
    [unit, tick],
  )

  const openCurrentDevTools = useCallback(() => {
    if (!unit || !displayedTab) return
    updateWebViewTab(unit.unitId, displayedTab.id, (tab) => ({
      ...tab,
      devtoolsUndocked: true,
      devtoolsOpen: false,
    }))
    void pullNetworkDelta(displayedTab.id, { full: true })
    void pullConsoleDelta(displayedTab.id)
    openDevTools(
      {
        openApp: (appId, options) => openApp(appId as never, options),
        requestEmbedded: ({ tabId, dockSide }) => {
          updateWebViewTab(unit.unitId, tabId, (tab) => ({
            ...tab,
            devtoolsOpen: true,
            devtoolsUndocked: false,
            devtoolsDockSide: dockSide,
          }))
        },
      },
      { hostId: unit.unitId, tabId: displayedTab.id, mode: 'undocked' },
    )
  }, [displayedTab, openApp, pullConsoleDelta, pullNetworkDelta, unit])

  const menuBar = useMemo((): MenuDefinition[] => {
    if (!visible) {
      return []
    }
    return [
      {
        label: 'WebView',
        items: [
          ...aboutAppMenuPrefix('关于 WebView', () => showBuiltinAbout(APP_ID)),
          {
            type: 'action',
            label: '关闭',
            shortcut: '⌘W',
            onClick: () => windowId && closeWindow(windowId),
          },
        ],
      },
      {
        label: '开发',
        items: [
          {
            type: 'action',
            label: '开发者工具',
            shortcut: '⌥⌘I',
            onClick: openCurrentDevTools,
            disabled: !displayedTab,
          },
        ],
      },
    ]
  }, [closeWindow, displayedTab, openCurrentDevTools, showBuiltinAbout, visible, windowId])

  useAppMenuBar(APP_ID, menuBar)

  const navigateTab = useCallback(
    (tabId: string, url: string) => {
      if (!unit) return
      const normalized = normalizePageUrl(url)
      updateWebViewTab(unit.unitId, tabId, (tab) => ({
        ...tab,
        url: normalized,
        pendingUrl: normalized,
        title: pageTitleFromUrl(normalized),
        inputUrl: displayPageUrl(normalized),
        loading: true,
        pageFault: undefined,
        bootstrapped: true,
      }))
      getViewerRef(tabId).current?.navigate(normalized)
    },
    [getViewerRef, unit],
  )

  if (!unitId || !unit) {
    return <div class="webview webview--empty">WebView 会话不存在</div>
  }

  const showChrome = visible
  const embeddedDevtools =
    displayedTab?.devtoolsOpen && !displayedTab.devtoolsUndocked

  return (
    <div
      class={[
        'webview',
        showChrome ? '' : 'webview--offscreen',
        embeddedDevtools ? 'webview--devtools' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {showChrome ? (
        <>
          <DocumentTabBar
            tabs={tabItems}
            activeTabId={unit.uiDisplayedTabId}
            ariaLabel="WebView 标签页"
            minTabsToShow={2}
            onActivate={(tabId) => setWebViewUiDisplayedTab(unit.unitId, tabId)}
            onClose={(tabId) => closeWebViewTab(unit.unitId, tabId)}
          />
          <div class="webview__toolbar">
            <input
              class="webview__omnibox"
              type="text"
              readOnly
              value={addressText}
              aria-label="当前地址（只读）"
              title={displayedTab?.url || ''}
            />
          </div>
        </>
      ) : null}

      <main class="webview__viewport">
        {displayedTab?.pageFault && showChrome ? (
          <PageFaultView
            fault={displayedTab.pageFault}
            variant="viewport"
            onRetry={() => {
              if (!displayedTab) return
              updateWebViewTab(unit.unitId, displayedTab.id, (tab) => ({
                ...tab,
                pageFault: undefined,
                loading: true,
              }))
              if (displayedTab.pageFault?.severity === 'fatal') {
                getViewerRef(displayedTab.id).current?.recoverFromFatal()
              } else {
                getViewerRef(displayedTab.id).current?.reload()
              }
            }}
          />
        ) : null}
        {unit.tabs.map((tab) => (
          <PageViewerFrame
            key={tab.id}
            ref={getViewerRef(tab.id)}
            devtoolsId={tab.devtoolsId}
            initialUrl={tab.url || undefined}
            active={tab.id === unit.uiDisplayedTabId}
            disableNetworkCache={tab.disableNetworkCache}
            onReady={() => {
              updateWebViewTab(unit.unitId, tab.id, (entry) => ({
                ...entry,
                ready: true,
              }))
              if (tab.url && !tab.bootstrapped) {
                navigateTab(tab.id, tab.url)
              }
            }}
            onNavigated={(payload) => {
              const title = payload.title || pageTitleFromUrl(payload.url)
              updateWebViewTab(unit.unitId, tab.id, (entry) => ({
                ...entry,
                url: payload.url,
                pendingUrl: undefined,
                title,
                inputUrl: displayPageUrl(payload.url),
                loading: false,
                canGoBack: payload.canGoBack,
                canGoForward: payload.canGoForward,
                pageFault: undefined,
              }))
              emitWebViewNavigated(unit.unitId, tab.id, payload.url, title)
              void pullNetworkDelta(tab.id)
              void pullConsoleDelta(tab.id)
            }}
            onLoading={(payload) => {
              updateWebViewTab(unit.unitId, tab.id, (entry) => ({
                ...entry,
                loading: payload.loading,
                pendingUrl: payload.loading
                  ? payload.url || entry.pendingUrl || entry.url
                  : undefined,
              }))
            }}
            onConsoleUpdated={() => {
              void pullConsoleDelta(tab.id)
            }}
            onNetworkUpdated={(payload) => {
              if (payload.entry) {
                ingestNetworkEntry(tab.id, payload.entry, payload.latestId)
                return
              }
              scheduleNetworkPull(tab.id)
            }}
            onLoadFailed={(payload) => {
              const fault = {
                severity: 'load' as const,
                code: payload.code,
                message: payload.message || '页面加载失败',
                url: payload.url,
              }
              updateWebViewTab(unit.unitId, tab.id, (entry) => ({
                ...entry,
                loading: false,
                pendingUrl: undefined,
                pageFault: fault,
              }))
              emitWebViewTabFault(
                unit.unitId,
                tab.id,
                formatPageFault(fault) || fault.message,
              )
              injectWebViewFaultDocument(getViewerRef(tab.id).current, fault)
              void pullNetworkDelta(tab.id, { full: true })
            }}
            onError={(payload) => {
              const fault = {
                severity: 'fatal' as const,
                code: payload.code,
                message: payload.message,
                bridgeBuild: payload.bridgeBuild,
                swBuild: payload.swBuild,
              }
              updateWebViewTab(unit.unitId, tab.id, (entry) => ({
                ...entry,
                loading: false,
                pageFault: fault,
              }))
              emitWebViewTabFault(
                unit.unitId,
                tab.id,
                formatPageFault(fault) || fault.message,
              )
              injectWebViewFaultDocument(getViewerRef(tab.id).current, fault)
            }}
            onLocation={(payload) => {
              const intent = resolveNavIntent(
                {
                  kind: 'LOCATION',
                  method: payload.method,
                  url: payload.url,
                  target: payload.target,
                  httpMethod: payload.httpMethod,
                },
                { currentUrl: tab.url },
              )
              if (shouldCreateTab(intent) && intent.action === 'newTab') {
                addWebViewTab(unit.unitId, intent.url)
                return
              }
              if (shouldNavigateSameTab(intent) && intent.action === 'sameTab') {
                navigateTab(tab.id, intent.url)
              }
            }}
            onHistory={(payload) => {
              const title = payload.title || pageTitleFromUrl(payload.url)
              updateWebViewTab(unit.unitId, tab.id, (entry) => ({
                ...entry,
                url: payload.url,
                pendingUrl: undefined,
                title,
                inputUrl: displayPageUrl(payload.url),
                loading: false,
                pageFault: undefined,
              }))
              emitWebViewNavigated(unit.unitId, tab.id, payload.url, title)
              void pullNetworkDelta(tab.id)
              void pullConsoleDelta(tab.id)
            }}
            onClick={(payload) => {
              const intent = resolveNavIntent(
                {
                  kind: 'CLICK',
                  href: payload.href,
                  target: payload.target,
                  url: payload.href,
                },
                { currentUrl: tab.url },
              )
              if (shouldCreateTab(intent) && intent.action === 'newTab') {
                addWebViewTab(unit.unitId, intent.url)
                return
              }
              if (payload.href && !payload.href.startsWith('javascript:')) {
                navigateTab(tab.id, payload.href)
              }
            }}
          />
        ))}
      </main>
    </div>
  )
}

/** Ensure a windowless OS window exists for the unit (offscreen host). */
export function ensureWebViewWindow(
  openApp: (appId: typeof APP_ID, options?: { documentId?: string }) => string | undefined,
  unitId: string,
): string | undefined {
  return openApp(APP_ID, { documentId: unitId })
}

export function showWebViewWindow(
  options: {
    windows: { id: string; appId: string; documentId?: string; closing?: boolean; windowless?: boolean }[]
    openApp: (appId: typeof APP_ID, options?: { documentId?: string }) => string | undefined
    revealWindowlessPanel: (
      windowId: string,
      opts?: { title?: string; width?: number; height?: number; chromeKind?: 'window' | 'dialog' },
    ) => void
    focusWindow: (windowId: string) => void
  },
  unitId: string,
): void {
  const existing = options.windows.find(
    (window) =>
      window.appId === APP_ID && !window.closing && window.documentId === unitId,
  )
  const windowId =
    existing?.id ?? options.openApp(APP_ID, { documentId: unitId })
  if (!windowId) {
    throw new Error(`无法打开 WebView 窗口: ${unitId}`)
  }
  if (!getWebViewUnit(unitId)) {
    return
  }
  options.revealWindowlessPanel(windowId, {
    title: 'WebView',
    width: 960,
    height: 720,
    chromeKind: 'window',
  })
  options.focusWindow(windowId)
  setWebViewUnitVisible(unitId, true, windowId)
}
