import { createRef, type RefObject } from 'preact'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ChromoApplicationApi } from '../chromo/chromo-application-panel.tsx'
import { mergeConsoleDisplayEntries } from '../chromo/chromo-console-types.ts'
import { ChromoDevToolsPanel } from '../chromo/chromo-devtools-panel.tsx'
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
import { displayPageUrl } from '../../page-host/page-url.ts'
import type { PageViewerHandle } from '../../page-host/page-viewer-frame.tsx'
import { DocumentTabBar } from '../../ui/document-tab-bar.tsx'
import {
  bindWebViewWindow,
  closeWebViewTab,
  getWebViewUnit,
  onWebViewRegistryChanged,
  setWebViewUiDisplayedTab,
  setWebViewViewportTarget,
  updateWebViewTab,
} from './webview-registry.ts'
import { detachWebViewWindow } from './webview-window-service.ts'
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

function getViewerRef(
  unitId: string,
  tabId: string,
): RefObject<PageViewerHandle> {
  const unit = getWebViewUnit(unitId)
  if (!unit) {
    return createRef<PageViewerHandle>()
  }
  if (!unit.viewerRefs[tabId]) {
    unit.viewerRefs[tabId] = createRef<PageViewerHandle>()
  }
  return unit.viewerRefs[tabId]
}

type WebViewAppProps = {
  windowId?: string
}

/**
 * WebView Window 壳：标题栏/标签/DevTools UI + viewport portal 目标。
 * iframe 由 WebViewOffscreenPool / WebViewUnitRuntime 持有，关窗不卸载页面。
 */
export function WebViewApp({ windowId }: WebViewAppProps) {
  const {
    windows,
    activeWindowId,
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
  const isActiveWindow = windowId !== undefined && activeWindowId === windowId

  useEffect(() => onWebViewRegistryChanged(() => setTick((n) => n + 1)), [])

  const unit = unitId ? getWebViewUnit(unitId) : undefined
  const unitTabsRef = useRef(unit?.tabs)
  unitTabsRef.current = unit?.tabs
  const windowsRef = useRef(windows)
  windowsRef.current = windows

  // 绑定 window 壳 ↔ session
  useEffect(() => {
    if (!unitId || !windowId) return
    if (!getWebViewUnit(unitId)) return
    bindWebViewWindow(unitId, windowId)
  }, [unitId, windowId])

  // 单元已被销毁时收掉孤儿窗
  useEffect(() => {
    if (!unitId || !windowId) return
    if (getWebViewUnit(unitId)) return
    closeWindow(windowId)
  }, [unitId, windowId, tick, closeWindow])

  // 关窗 = detach，不 destroy session
  useWindowCloseGuard(windowId, () => {
    if (unitId) {
      detachWebViewWindow(
        {
          getWindows: () => windowsRef.current,
          closeWindow,
        },
        unitId,
      )
    }
    return true
  })

  // viewport portal 目标
  const viewportSlotRef = useCallback(
    (el: HTMLElement | null) => {
      if (!unitId) return
      setWebViewViewportTarget(unitId, el)
    },
    [unitId],
  )

  useEffect(() => {
    return () => {
      if (unitId) {
        setWebViewViewportTarget(unitId, null)
      }
    }
  }, [unitId])

  useEffect(() => {
    if (!windowId || !unit) return
    const tab = unit.tabs.find((t) => t.id === unit.uiDisplayedTabId) ?? unit.tabs[0]
    const title = tab?.loading
      ? `正在加载 ${tab.pendingUrl || tab.url}`
      : tab?.title || 'WebView'
    setWindowTitle(windowId, title)
  }, [windowId, unit, tick, setWindowTitle])

  // 独立 DevTools 窗依赖 hub session
  useEffect(() => {
    if (!unit) return
    const hostId = unit.unitId
    const parentWindowId = windowId || hostId
    const undocked = unit.tabs.filter((tab) => tab.devtoolsUndocked)
    for (const tab of undocked) {
      const key = makePageDevToolsSessionKey(hostId, tab.id)
      const snapshot: PageDevToolsSnapshot = {
        hostId,
        parentWindowId,
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
          const viewer = getViewerRef(hostId, tab.id).current
          if (!viewer?.isReady()) {
            return Promise.reject(new Error('网页尚未就绪'))
          }
          return viewer.evalInPage(code)
        },
        readNetworkBody: (entryId) => {
          const viewer = getViewerRef(hostId, tab.id).current
          if (!viewer?.isReady()) {
            return Promise.reject(new Error('网页尚未就绪'))
          }
          return viewer.readNetworkBody(entryId)
        },
        readNetworkBodyLines: (entryId, options) => {
          const viewer = getViewerRef(hostId, tab.id).current
          if (!viewer?.isReady()) {
            return Promise.reject(new Error('网页尚未就绪'))
          }
          return viewer.readNetworkBodyLines(entryId, options)
        },
        probeNetworkHot: (method, url) => {
          const viewer = getViewerRef(hostId, tab.id).current
          if (!viewer?.isReady()) {
            return Promise.reject(new Error('网页尚未就绪'))
          }
          return viewer.probeNetworkHot(method, url)
        },
        setNetworkOptions: (options) => {
          getViewerRef(hostId, tab.id).current?.setNetworkOptions(options)
        },
        application: makeWebViewApplicationApi(
          () => getViewerRef(hostId, tab.id).current,
        ),
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
        onAppendEntries: () => {},
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
          getViewerRef(hostId, tab.id).current?.setNetworkOptions({ disableCache: disable })
        },
        onVConsoleEnabledChange: () => {},
        onDebugPanelEnabledChange: (enabled) => {
          getViewerRef(hostId, tab.id).current?.setDebugPanelEnabled(enabled)
        },
        onClearBrowsingData: async () => {
          const viewer = getViewerRef(hostId, tab.id).current
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
  }, [unit, tick, windowId])

  useEffect(() => {
    const capturedHostId = unitId
    return () => {
      if (!capturedHostId) return
      for (const tab of unitTabsRef.current ?? []) {
        unregisterChromoDevToolsSession(makePageDevToolsSessionKey(capturedHostId, tab.id))
      }
    }
  }, [unitId])

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
  }, [displayedTab, openApp, unit])

  const undockDisplayedDevTools = useCallback(() => {
    if (!unit || !displayedTab) return
    updateWebViewTab(unit.unitId, displayedTab.id, (tab) => ({
      ...tab,
      devtoolsUndocked: true,
      devtoolsOpen: false,
    }))
    openDevTools(
      {
        openApp: (appId, options) => openApp(appId as never, options),
      },
      { hostId: unit.unitId, tabId: displayedTab.id, mode: 'undocked' },
    )
  }, [displayedTab, openApp, unit])

  const menuBar = useMemo((): MenuDefinition[] => {
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
  }, [closeWindow, displayedTab, openCurrentDevTools, showBuiltinAbout, windowId])

  useAppMenuBar(APP_ID, menuBar, isActiveWindow)

  if (!unitId || !unit) {
    return <div class="webview webview--empty">WebView 会话不存在</div>
  }

  const embeddedDevtools =
    Boolean(displayedTab?.devtoolsOpen && !displayedTab.devtoolsUndocked)
  const embeddedDockSide = displayedTab?.devtoolsDockSide ?? 'bottom'

  return (
    <div
      class={['webview', embeddedDevtools ? 'webview--devtools' : '']
        .filter(Boolean)
        .join(' ')}
    >
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

      <div class="webview__body chromo__body">
        <div
          class={[
            'chromo__main-column',
            embeddedDevtools ? `chromo__main-column--devtools-${embeddedDockSide}` : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <div
            class={[
              'chromo__devtools-area',
              embeddedDevtools ? `chromo__devtools-area--${embeddedDockSide}` : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <main class="webview__viewport chromo__viewport">
              {displayedTab?.pageFault ? (
                <PageFaultView
                  fault={displayedTab.pageFault}
                  variant="viewport"
                  showOmniboxHint={false}
                />
              ) : null}
              {/* Runtime 将 iframe portal 到此节点 */}
              <div ref={viewportSlotRef} class="webview__viewport-slot" />
            </main>

            {embeddedDevtools && displayedTab ? (
              <ChromoDevToolsPanel
                mode="embedded"
                activeTab={displayedTab.devtoolsTab}
                onTabChange={(panelTab) =>
                  updateWebViewTab(unit.unitId, displayedTab.id, (entry) => ({
                    ...entry,
                    devtoolsTab: panelTab,
                  }))
                }
                onClose={() =>
                  updateWebViewTab(unit.unitId, displayedTab.id, (entry) => ({
                    ...entry,
                    devtoolsOpen: false,
                  }))
                }
                dockSide={displayedTab.devtoolsDockSide}
                onDockSideChange={(side) =>
                  updateWebViewTab(unit.unitId, displayedTab.id, (entry) => ({
                    ...entry,
                    devtoolsDockSide: side,
                  }))
                }
                onUndock={undockDisplayedDevTools}
                preserveLog={displayedTab.preserveConsole}
                onPreserveLogChange={(preserve) =>
                  updateWebViewTab(unit.unitId, displayedTab.id, (entry) => ({
                    ...entry,
                    preserveConsole: preserve,
                  }))
                }
                onClear={() => {
                  if (displayedTab.devtoolsTab === 'network') {
                    updateWebViewTab(unit.unitId, displayedTab.id, (entry) => ({
                      ...entry,
                      networkEntries: [],
                      lastNetworkId: '',
                      selectedNetworkId: '',
                    }))
                    return
                  }
                  updateWebViewTab(unit.unitId, displayedTab.id, (entry) => ({
                    ...entry,
                    consoleEntries: [],
                    lastConsoleId: '',
                  }))
                }}
                entries={mergeConsoleDisplayEntries(displayedTab.consoleEntries, [])}
                pageReady={Boolean(
                  displayedTab.ready && displayedTab.url && !displayedTab.pageFault,
                )}
                evalInPage={(code) => {
                  const viewer = getViewerRef(unit.unitId, displayedTab.id).current
                  if (!viewer?.isReady()) {
                    return Promise.reject(new Error('网页尚未就绪'))
                  }
                  return viewer.evalInPage(code)
                }}
                replHistory={[]}
                onReplHistoryChange={() => {}}
                onAppendEntries={() => {}}
                networkEntries={displayedTab.networkEntries}
                selectedNetworkId={displayedTab.selectedNetworkId || undefined}
                disableNetworkCache={displayedTab.disableNetworkCache}
                onDisableNetworkCacheChange={(disable) => {
                  updateWebViewTab(unit.unitId, displayedTab.id, (entry) => ({
                    ...entry,
                    disableNetworkCache: disable,
                  }))
                  getViewerRef(unit.unitId, displayedTab.id).current?.setNetworkOptions({
                    disableCache: disable,
                  })
                }}
                readNetworkBody={(entryId) => {
                  const viewer = getViewerRef(unit.unitId, displayedTab.id).current
                  if (!viewer?.isReady()) {
                    return Promise.reject(new Error('网页尚未就绪'))
                  }
                  return viewer.readNetworkBody(entryId)
                }}
                readNetworkBodyLines={(entryId, options) => {
                  const viewer = getViewerRef(unit.unitId, displayedTab.id).current
                  if (!viewer?.isReady()) {
                    return Promise.reject(new Error('网页尚未就绪'))
                  }
                  return viewer.readNetworkBodyLines(entryId, options)
                }}
                probeNetworkHot={(method, url) => {
                  const viewer = getViewerRef(unit.unitId, displayedTab.id).current
                  if (!viewer?.isReady()) {
                    return Promise.reject(new Error('网页尚未就绪'))
                  }
                  return viewer.probeNetworkHot(method, url)
                }}
                pageLoading={displayedTab.loading}
                pageError={formatPageFault(displayedTab.pageFault)}
                pageFault={displayedTab.pageFault}
                onSelectNetwork={(entry) =>
                  updateWebViewTab(unit.unitId, displayedTab.id, (t) => ({
                    ...t,
                    selectedNetworkId: entry.id,
                  }))
                }
                onCloseNetworkDetail={() =>
                  updateWebViewTab(unit.unitId, displayedTab.id, (t) => ({
                    ...t,
                    selectedNetworkId: '',
                  }))
                }
                pageUrl={displayedTab.url}
                viewerReady={displayedTab.ready}
                onClearBrowsingData={async () => {
                  const viewer = getViewerRef(unit.unitId, displayedTab.id).current
                  if (!viewer?.isReady()) return
                  await viewer.clearState({})
                }}
                applicationApi={makeWebViewApplicationApi(
                  () => getViewerRef(unit.unitId, displayedTab.id).current,
                )}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
