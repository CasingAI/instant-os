import { createRef, type RefObject } from 'preact'
import type { ChromoApplicationApi } from '../chromo/chromo-application-panel.tsx'
import {
  makePageDevToolsSessionKey,
  registerPageDevToolsSession,
  unregisterChromoDevToolsSession,
  type ChromoDevToolsHandlers,
  type PageDevToolsSnapshot,
} from '../../page-host/page-devtools-hub.ts'
import { formatPageFault } from '../../page-host/page-fault.ts'
import type { PageTab } from '../../page-host/page-tab-types.ts'
import type { PageViewerHandle } from '../../page-host/page-viewer-frame.tsx'
import {
  getWebViewUnit,
  updateWebViewTab,
} from './webview-registry.ts'
import type { WebViewUnitRecord } from './webview-registry.ts'

export function makeWebViewApplicationApi(
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

export function getViewerRef(
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

export function buildWebViewDevToolsSnapshot(
  unit: WebViewUnitRecord,
  tab: PageTab,
  parentWindowId: string,
): PageDevToolsSnapshot {
  return {
    hostId: unit.unitId,
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
}

export function buildWebViewDevToolsHandlers(
  unitId: string,
  tabId: string,
  getViewerRefFn: (tabId: string) => RefObject<PageViewerHandle>,
): ChromoDevToolsHandlers {
  const key = makePageDevToolsSessionKey(unitId, tabId)

  return {
    evalInPage: (code) => {
      const viewer = getViewerRefFn(tabId).current
      if (!viewer?.isReady()) {
        return Promise.reject(new Error('网页尚未就绪'))
      }
      return viewer.evalInPage(code)
    },
    readNetworkBody: (entryId) => {
      const viewer = getViewerRefFn(tabId).current
      if (!viewer?.isReady()) {
        return Promise.reject(new Error('网页尚未就绪'))
      }
      return viewer.readNetworkBody(entryId)
    },
    readNetworkBodyLines: (entryId, options) => {
      const viewer = getViewerRefFn(tabId).current
      if (!viewer?.isReady()) {
        return Promise.reject(new Error('网页尚未就绪'))
      }
      return viewer.readNetworkBodyLines(entryId, options)
    },
    probeNetworkHot: (method, url) => {
      const viewer = getViewerRefFn(tabId).current
      if (!viewer?.isReady()) {
        return Promise.reject(new Error('网页尚未就绪'))
      }
      return viewer.probeNetworkHot(method, url)
    },
    setNetworkOptions: (options) => {
      getViewerRefFn(tabId).current?.setNetworkOptions(options)
    },
    application: makeWebViewApplicationApi(
      () => getViewerRefFn(tabId).current,
    ),
    onPanelTabChange: (panelTab) => {
      updateWebViewTab(unitId, tabId, (entry) => ({ ...entry, devtoolsTab: panelTab }))
    },
    onPreserveLogChange: (preserve) => {
      updateWebViewTab(unitId, tabId, (entry) => ({
        ...entry,
        preserveConsole: preserve,
      }))
    },
    onClear: () => {
      const current = getWebViewUnit(unitId)?.tabs.find((entry) => entry.id === tabId)
      if (current?.devtoolsTab === 'network') {
        updateWebViewTab(unitId, tabId, (entry) => ({
          ...entry,
          networkEntries: [],
          lastNetworkId: '',
          selectedNetworkId: '',
        }))
        return
      }
      updateWebViewTab(unitId, tabId, (entry) => ({
        ...entry,
        consoleEntries: [],
        lastConsoleId: '',
      }))
    },
    onAppendEntries: () => {},
    onReplHistoryChange: () => {},
    onSelectNetwork: (entry) => {
      updateWebViewTab(unitId, tabId, (t) => ({
        ...t,
        selectedNetworkId: entry.id,
      }))
    },
    onCloseNetworkDetail: () => {
      updateWebViewTab(unitId, tabId, (t) => ({ ...t, selectedNetworkId: '' }))
    },
    onDisableNetworkCacheChange: (disable) => {
      updateWebViewTab(unitId, tabId, (t) => ({
        ...t,
        disableNetworkCache: disable,
      }))
      getViewerRefFn(tabId).current?.setNetworkOptions({ disableCache: disable })
    },
    onVConsoleEnabledChange: () => {},
    onDebugPanelEnabledChange: (enabled) => {
      getViewerRefFn(tabId).current?.setDebugPanelEnabled(enabled)
    },
    onClearBrowsingData: async () => {
      const viewer = getViewerRefFn(tabId).current
      if (!viewer?.isReady()) return
      await viewer.clearState({})
    },
    onRedock: (side) => {
      updateWebViewTab(unitId, tabId, (entry) => ({
        ...entry,
        devtoolsUndocked: false,
        devtoolsOpen: true,
        devtoolsDockSide: side,
      }))
      unregisterChromoDevToolsSession(key)
    },
    onDetachedClosed: () => {
      updateWebViewTab(unitId, tabId, (entry) => ({
        ...entry,
        devtoolsUndocked: false,
        devtoolsOpen: false,
      }))
      unregisterChromoDevToolsSession(key)
    },
  }
}

/**
 * 同步当前 unit 所有 undocked DevTools hub session。
 * - devtoolsUndocked === true 的 tab → registerPageDevToolsSession
 * - 其余 tab → unregisterChromoDevToolsSession
 * - parentWindowId 使用 windowId ?? unitId（离屏时用 unitId）
 */
export function syncWebViewUndockedDevToolsSessions(
  unitId: string,
  options: {
    getViewerRef: (tabId: string) => RefObject<PageViewerHandle>
    windowId?: string
  },
): void {
  const unit = getWebViewUnit(unitId)
  if (!unit) return

  const hostId = unit.unitId
  const parentWindowId = options.windowId || hostId

  for (const tab of unit.tabs) {
    const key = makePageDevToolsSessionKey(hostId, tab.id)
    if (tab.devtoolsUndocked) {
      const snapshot = buildWebViewDevToolsSnapshot(unit, tab, parentWindowId)
      const handlers = buildWebViewDevToolsHandlers(unitId, tab.id, options.getViewerRef)
      registerPageDevToolsSession(key, snapshot, handlers)
    } else {
      unregisterChromoDevToolsSession(key)
    }
  }
}

/**
 * 注销 unit 所有 tab 的 DevTools hub session。
 * 用于 Runtime unmount 或 Shell 清理。
 */
export function unregisterWebViewUnitDevToolsSessions(unitId: string): void {
  const unit = getWebViewUnit(unitId)
  // unit 可能已被销毁（destroy 先于 unmount），此时遍历 tabs 已不可靠；
  // 但 unregisterChromoDevToolsSession 对不存在的 key 是 no-op，安全。
  if (!unit) return
  for (const tab of unit.tabs) {
    unregisterChromoDevToolsSession(makePageDevToolsSessionKey(unitId, tab.id))
  }
}