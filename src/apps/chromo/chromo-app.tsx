import { createRef } from 'preact'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { RefObject } from 'preact'
import {
  BackIcon,
  ForwardIcon,
  LockIcon,
  ReloadIcon,
  StopIcon,
} from '../../icons/app-icons.tsx'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { useFullscreenChromeReveal } from '../../os/fullscreen-chrome-reveal-context.tsx'
import { useAppNarrowLayout } from '../../ui/use-app-narrow-layout.ts'
import {
  displayUrl,
  hostnameFromUrl,
  isStartPageUrl,
  pageTitleFromUrl,
} from '../browser/normalize-browser-url.ts'
import type { ChromoConsoleEntry, ChromoNetworkEntry, ChromoScreenshotOptions } from './chromo-bridge.ts'
import { CHROMO_DEFAULT_NEW_TAB_URL } from './chromo-config.ts'
import { ChromoAgentSidebar } from './chromo-agent-sidebar.tsx'
import type { ChromoConsoleDisplayEntry } from './chromo-console-types.ts'
import { mergeConsoleDisplayEntries } from './chromo-console-types.ts'
import {
  makeChromoDevToolsSessionKey,
  registerChromoDevToolsSession,
  unregisterChromoDevToolsSession,
  type ChromoDevToolsDockSide,
  type ChromoDevToolsHandlers,
  type ChromoDevToolsPanelTab,
  type ChromoDevToolsSnapshot,
} from './chromo-devtools-hub.ts'
import {
  ChromoDevToolsPanel,
  readChromoDevToolsDockSide,
} from './chromo-devtools-panel.tsx'
import {
  destroyVConsole,
  injectVConsole,
} from './chromo-vconsole.ts'
import {
  formatPageFault,
  pageFaultFromError,
  pageFaultFromLoadFailed,
  type ChromoPageFault,
} from './chromo-page-fault.ts'
import { ChromoPageFaultView } from './chromo-page-fault-view.tsx'
import { ChromoTabBar, type ChromoTabSummary } from './chromo-tab-bar.tsx'
import { ChromoViewerFrame, type ChromoViewerHandle } from './chromo-viewer-frame.tsx'
import type { ChromoApplicationApi } from './chromo-application-panel.tsx'
import './chromo.css'

function makeChromoApplicationApi(
  getViewer: () => ChromoViewerHandle | null | undefined,
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

type ChromoTab = {
  id: string
  /** Parent-tab id for Disable cache isolation only (not a Worker session). */
  devtoolsId: string
  url: string
  title: string
  inputUrl: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  ready: boolean
  bootstrapped: boolean
  pageFault?: ChromoPageFault
  consoleEntries: ChromoConsoleEntry[]
  replEntries: ChromoConsoleDisplayEntry[]
  replHistory: string[]
  preserveConsole: boolean
  lastConsoleId: string
  networkEntries: ChromoNetworkEntry[]
  lastNetworkId: string
  selectedNetworkId: string
  disableNetworkCache: boolean
  /** 该 tab 内嵌 DevTools 是否打开（undock 时为 false） */
  devtoolsOpen: boolean
  /** 该 tab 当前 DevTools 面板 */
  devtoolsTab: ChromoDevToolsPanelTab
  /** 该 tab 停靠方向（bottom/left/right） */
  devtoolsDockSide: ChromoDevToolsDockSide
  /** 该 tab 是否已在独立 OS 窗中打开 DevTools */
  devtoolsUndocked: boolean
  /** Extensions：页内 vConsole 开关（导航后自动重注入） */
  vConsoleEnabled: boolean
  vConsoleBusy: boolean
  vConsoleError?: string
}

/** DevTools 可用：viewer 已启动且目标 URL 已知（不等整页 load 完成）。 */
function computeChromoPageReady(tab: Pick<ChromoTab, 'ready' | 'url'> | null | undefined): boolean {
  return Boolean(tab?.ready && tab.url)
}

let nextTabId = 1

function createChromoTab(initialUrl = ''): ChromoTab {
  const id = `chromo-tab-${nextTabId++}`
  const devtoolsId = crypto.randomUUID()
  const url = initialUrl ? normalizeChromoUrl(initialUrl) : ''
  const title = url ? pageTitleFromUrl(url) : '新标签页'
  return {
    id,
    devtoolsId,
    url,
    title,
    inputUrl: url ? displayUrl(url) : '',
    loading: Boolean(url),
    canGoBack: false,
    canGoForward: false,
    ready: false,
    bootstrapped: false,
    consoleEntries: [],
    replEntries: [],
    replHistory: [],
    preserveConsole: false,
    lastConsoleId: '',
    networkEntries: [],
    lastNetworkId: '',
    selectedNetworkId: '',
    disableNetworkCache: false,
    devtoolsOpen: false,
    devtoolsTab: 'console',
    devtoolsDockSide: readChromoDevToolsDockSide(),
    devtoolsUndocked: false,
    vConsoleEnabled: false,
    vConsoleBusy: false,
  }
}

function normalizeChromoUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    return CHROMO_DEFAULT_NEW_TAB_URL
  }

  // Chromo 导航保留 www（normalizeBrowserUrl 会剥掉，导致 ithome 等站失败/误报）
  let candidate = trimmed
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    const looksLikeDomain =
      candidate.includes('.') ||
      candidate.startsWith('localhost') ||
      /^\d{1,3}(\.\d{1,3}){3}(:\d+)?/.test(candidate)
    candidate = looksLikeDomain
      ? `https://${candidate}`
      : `https://www.google.com/search?q=${encodeURIComponent(candidate)}`
  }

  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return CHROMO_DEFAULT_NEW_TAB_URL
    }
    // ithome 裸域名会 302 到 www；代理场景下易逃出/误报，统一补 www
    if (parsed.hostname === 'ithome.com') {
      parsed.hostname = 'www.ithome.com'
    }
    const href = parsed.href
    if (isStartPageUrl(href) || href.startsWith('view-source:')) {
      return CHROMO_DEFAULT_NEW_TAB_URL
    }
    return href
  } catch {
    return CHROMO_DEFAULT_NEW_TAB_URL
  }
}

function chromoUrlsMatch(expected: string, actual: string): boolean {
  try {
    const a = new URL(expected)
    const b = new URL(actual)
    const stripPath = (path: string) => (path === '/' ? '' : path.replace(/\/$/, ''))
    return (
      a.origin === b.origin &&
      stripPath(a.pathname) === stripPath(b.pathname) &&
      a.search === b.search
    )
  } catch {
    return expected === actual
  }
}

function isSameDocumentHashLink(href: string, currentUrl: string): boolean {
  if (!href || !currentUrl) {
    return false
  }
  try {
    const target = new URL(href)
    const current = new URL(currentUrl)
    return (
      target.origin === current.origin &&
      target.pathname === current.pathname &&
      target.search === current.search &&
      Boolean(target.hash)
    )
  } catch {
    return false
  }
}

function siteInitialFromUrl(url: string): string | undefined {
  const host = hostnameFromUrl(url)
  return host ? host.charAt(0).toUpperCase() : undefined
}

export function ChromoApp({ windowId }: { windowId?: string }) {
  const { closeWindowsForApp, closeWindow, minimizeWindow, windows, setAppWindowUrl, openApp, focusWindow, restoreWindow } =
    useOs()
  const { setChromePinSource } = useFullscreenChromeReveal()
  const { showBuiltinAbout } = useAboutApp()
  const appWindow = windowId
    ? windows.find((window) => window.id === windowId && !window.closing)
    : windows.find((window) => window.appId === 'chromo' && !window.closing)
  const chromoWindow = windowId
    ? windows.find((window) => window.id === windowId && !window.minimized)
    : windows.find((window) => window.appId === 'chromo' && !window.minimized)
  const chromoFullscreen = Boolean(chromoWindow?.fullscreen)
  const pendingUrl = appWindow?.url
  const parentWindowId = appWindow?.id ?? windowId ?? ''

  const [tabs, setTabs] = useState<ChromoTab[]>(() => [createChromoTab()])
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id ?? '')
  const [addressFocused, setAddressFocused] = useState(false)
  const [tabsOverflowOpen, setTabsOverflowOpen] = useState(false)
  const [hiddenTabIds, setHiddenTabIds] = useState<string[]>([])
  const [fullscreenToolbarRevealed, setFullscreenToolbarRevealed] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const viewerRefs = useRef<Record<string, RefObject<ChromoViewerHandle>>>({})
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeTabIdRef = useRef(activeTabId)
  activeTabIdRef.current = activeTabId
  const lastOpenedUrlRef = useRef<string | undefined>(undefined)
  const prevPendingUrlRef = useRef<string | undefined>(undefined)
  /** 每个标签页最近一次主动请求的 URL，用于忽略过期的 VC_NAVIGATED */
  const requestedUrlByTabRef = useRef<Record<string, string>>({})
  /** After fatal viewer remount/reload, re-navigate to this URL on next VC_READY. */
  const pendingRecoverNavigateRef = useRef<Record<string, string>>({})
  /** VC_CLICK 后延迟整页导航；若随后收到 VC_HISTORY（SPA）则取消 */
  const clickNavigateTimersRef = useRef<Record<string, number>>({})
  const networkPullTimersRef = useRef<Record<string, number>>({})
  const chromoRootRef = useRef<HTMLDivElement>(null)
  const { hostRef: narrowLayoutHostRef, narrowLayout } = useAppNarrowLayout()

  const attachChromoRoot = useCallback(
    (node: HTMLDivElement | null) => {
      chromoRootRef.current = node
      narrowLayoutHostRef(node)
    },
    [narrowLayoutHostRef],
  )

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]

  const getViewerRef = useCallback((tabId: string): RefObject<ChromoViewerHandle> => {
    if (!viewerRefs.current[tabId]) {
      viewerRefs.current[tabId] = createRef<ChromoViewerHandle>()
    }
    return viewerRefs.current[tabId]
  }, [])

  const updateTab = useCallback((tabId: string, updater: (tab: ChromoTab) => ChromoTab) => {
    setTabs((current) => current.map((tab) => (tab.id === tabId ? updater(tab) : tab)))
  }, [])

  const cancelClickNavigate = useCallback((tabId: string) => {
    const timer = clickNavigateTimersRef.current[tabId]
    if (timer) {
      window.clearTimeout(timer)
      delete clickNavigateTimersRef.current[tabId]
    }
  }, [])

  const navigateTab = useCallback(
    (tabId: string, url: string, options?: { method?: 'POST'; body?: string }) => {
      const normalized = normalizeChromoUrl(url)
      requestedUrlByTabRef.current[tabId] = normalized
      lastOpenedUrlRef.current = normalized
      updateTab(tabId, (tab) => ({
        ...tab,
        url: normalized,
        title: pageTitleFromUrl(normalized),
        inputUrl: displayUrl(normalized),
        loading: true,
        pageFault: undefined,
        bootstrapped: true,
      }))
      getViewerRef(tabId).current?.navigate(normalized, options)
    },
    [getViewerRef, updateTab],
  )

  const ensureInitialTabLoad = useCallback(
    (tabId: string) => {
      const tab = tabsRef.current.find((entry) => entry.id === tabId)
      if (!tab || tab.bootstrapped) {
        return
      }
      if (tab.url) {
        navigateTab(tabId, tab.url)
        return
      }
      updateTab(tabId, (entry) => ({ ...entry, bootstrapped: true, loading: false }))
    },
    [navigateTab, updateTab],
  )

  const navigateActive = useCallback(
    (url: string) => {
      if (!activeTab) {
        return
      }
      navigateTab(activeTab.id, url)
    },
    [activeTab, navigateTab],
  )

  const addTab = useCallback(
    (url = '', options?: { activate?: boolean }) => {
      const tab = createChromoTab(url)
      if (tab.url) {
        requestedUrlByTabRef.current[tab.id] = tab.url
      }
      setTabs((current) => [...current, tab])
      if (options?.activate !== false) {
        setActiveTabId(tab.id)
      }
      return tab.id
    },
    [],
  )

  const closeTab = useCallback(
    (tabId: string) => {
      cancelClickNavigate(tabId)
      // Do not VC_CLEAR_STATE on tab close — cookie/storage/hot are global.

      if (parentWindowId) {
        const sessionKey = makeChromoDevToolsSessionKey(parentWindowId, tabId)
        unregisterChromoDevToolsSession(sessionKey)
        const linked = windows.filter(
          (window) =>
            window.appId === 'chromo-devtools' &&
            !window.closing &&
            window.documentId === sessionKey,
        )
        for (const window of linked) {
          closeWindow(window.id)
        }
      }

      setTabs((current) => {
        if (current.length <= 1) {
          const replacement = createChromoTab()
          setActiveTabId(replacement.id)
          delete viewerRefs.current[tabId]
          delete pendingRecoverNavigateRef.current[tabId]
          return [replacement]
        }

        const index = current.findIndex((tab) => tab.id === tabId)
        if (index === -1) {
          return current
        }

        const next = current.filter((tab) => tab.id !== tabId)
        delete viewerRefs.current[tabId]
        delete pendingRecoverNavigateRef.current[tabId]

        if (activeTabId === tabId) {
          const fallback = next[Math.max(0, index - 1)] ?? next[0]
          if (fallback) {
            setActiveTabId(fallback.id)
          }
        }

        return next
      })
    },
    [activeTabId, cancelClickNavigate, closeWindow, getViewerRef, parentWindowId, windows],
  )

  const selectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId)
    setTabsOverflowOpen(false)
  }, [])

  const goBack = useCallback(() => {
    if (!activeTab) {
      return
    }
    getViewerRef(activeTab.id).current?.back()
  }, [activeTab, getViewerRef])

  const goForward = useCallback(() => {
    if (!activeTab) {
      return
    }
    getViewerRef(activeTab.id).current?.forward()
  }, [activeTab, getViewerRef])

  const reload = useCallback(() => {
    if (!activeTab) {
      return
    }
    const wasFatal = activeTab.pageFault?.severity === 'fatal'
    const recoverUrl = activeTab.url
    updateTab(activeTab.id, (tab) => ({
      ...tab,
      loading: true,
      pageFault: undefined,
      ...(tab.preserveConsole
        ? {}
        : {
            consoleEntries: [],
            replEntries: [],
            lastConsoleId: '',
            networkEntries: [],
            lastNetworkId: '',
            selectedNetworkId: '',
          }),
    }))
    const viewer = getViewerRef(activeTab.id).current
    if (wasFatal) {
      if (recoverUrl) {
        pendingRecoverNavigateRef.current[activeTab.id] = recoverUrl
      }
      viewer?.recoverFromFatal()
      return
    }
    viewer?.reload()
  }, [activeTab, getViewerRef, updateTab])

  const stopLoading = useCallback(() => {
    if (!activeTab) {
      return
    }
    getViewerRef(activeTab.id).current?.stop()
    updateTab(activeTab.id, (tab) => ({ ...tab, loading: false }))
  }, [activeTab, getViewerRef, updateTab])

  const evalInActivePage = useCallback(
    (code: string) => {
      if (!activeTab) {
        return Promise.reject(new Error('没有活动标签页'))
      }
      const viewer = getViewerRef(activeTab.id).current
      if (!viewer?.isReady()) {
        return Promise.reject(new Error('网页尚未就绪'))
      }
      return viewer.evalInPage(code)
    },
    [activeTab, getViewerRef],
  )

  const screenshotInActivePage = useCallback(
    (options?: ChromoScreenshotOptions) => {
      if (!activeTab) {
        return Promise.reject(new Error('没有活动标签页'))
      }
      const viewer = getViewerRef(activeTab.id).current
      if (!viewer?.isReady()) {
        return Promise.reject(new Error('网页尚未就绪'))
      }
      return viewer.screenshot(options)
    },
    [activeTab, getViewerRef],
  )

  const pullConsoleDelta = useCallback(
    async (tabId: string) => {
      const viewer = getViewerRef(tabId).current
      if (!viewer?.isReady()) {
        return
      }

      const tab = tabsRef.current.find((entry) => entry.id === tabId)
      if (!tab) {
        return
      }

      try {
        const result = await viewer.readConsole({ after: tab.lastConsoleId || undefined })
        if (!result.entries.length) {
          if (result.latestId) {
            updateTab(tabId, (entry) => ({ ...entry, lastConsoleId: result.latestId! }))
          }
          return
        }

        updateTab(tabId, (entry) => {
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
        console.error('[chromo console read]', err)
      }
    },
    [getViewerRef, updateTab],
  )

  const pullNetworkDelta = useCallback(
    async (tabId: string) => {
      const viewer = getViewerRef(tabId).current
      if (!viewer?.isReady()) {
        return
      }

      const tab = tabsRef.current.find((entry) => entry.id === tabId)
      if (!tab) {
        return
      }

      try {
        const result = await viewer.readNetwork({ after: tab.lastNetworkId || undefined })
        if (!result.entries.length) {
          if (result.latestId && result.latestId !== tab.lastNetworkId) {
            updateTab(tabId, (entry) => ({ ...entry, lastNetworkId: result.latestId! }))
          }
          return
        }

        updateTab(tabId, (entry) => {
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
        console.error('[chromo network read]', err)
      }
    },
    [getViewerRef, updateTab],
  )

  const ingestNetworkEntry = useCallback(
    (tabId: string, entry: ChromoNetworkEntry, latestId?: string) => {
      updateTab(tabId, (current) => {
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
    [updateTab],
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

  const clearTabConsole = useCallback(
    (tabId: string) => {
      updateTab(tabId, (entry) => {
        const lastFromList =
          entry.consoleEntries.length > 0
            ? entry.consoleEntries[entry.consoleEntries.length - 1]?.id
            : ''
        return {
          ...entry,
          consoleEntries: [],
          replEntries: [],
          lastConsoleId: lastFromList || entry.lastConsoleId,
        }
      })
    },
    [updateTab],
  )

  const clearTabNetwork = useCallback(
    (tabId: string) => {
      updateTab(tabId, (entry) => {
        const lastFromList =
          entry.networkEntries.length > 0
            ? entry.networkEntries[entry.networkEntries.length - 1]?.id
            : ''
        return {
          ...entry,
          networkEntries: [],
          lastNetworkId: lastFromList || entry.lastNetworkId,
          selectedNetworkId: '',
        }
      })
    },
    [updateTab],
  )

  const selectTabNetwork = useCallback(
    (tabId: string, entry: ChromoNetworkEntry) => {
      updateTab(tabId, (current) => ({
        ...current,
        selectedNetworkId: entry.id,
      }))
    },
    [updateTab],
  )

  const clearTabNetworkSelection = useCallback(
    (tabId: string) => {
      updateTab(tabId, (current) => ({
        ...current,
        selectedNetworkId: '',
      }))
    },
    [updateTab],
  )

  const updateTabDisableNetworkCache = useCallback(
    (tabId: string, disableNetworkCache: boolean) => {
      updateTab(tabId, (entry) => ({ ...entry, disableNetworkCache }))
      getViewerRef(tabId).current?.setNetworkOptions({ disableCache: disableNetworkCache })
    },
    [getViewerRef, updateTab],
  )

  const clearTabBrowsingData = useCallback(
    async (tabId: string) => {
      const viewer = getViewerRef(tabId).current
      if (!viewer?.isReady()) {
        throw new Error('网页尚未就绪')
      }
      await viewer.clearState()
      clearTabNetwork(tabId)
      viewer.reload()
    },
    [clearTabNetwork, getViewerRef],
  )

  const reinjectVConsoleIfEnabled = useCallback(
    (tabId: string) => {
      const tab = tabsRef.current.find((entry) => entry.id === tabId)
      if (!tab?.vConsoleEnabled) {
        return
      }
      const viewer = getViewerRef(tabId).current
      if (!viewer?.isReady()) {
        return
      }
      updateTab(tabId, (entry) => ({
        ...entry,
        vConsoleBusy: true,
        vConsoleError: undefined,
      }))
      void injectVConsole((code) => viewer.evalInPage(code)).then((result) => {
        updateTab(tabId, (entry) => {
          if (!entry.vConsoleEnabled) {
            return { ...entry, vConsoleBusy: false }
          }
          return {
            ...entry,
            vConsoleBusy: false,
            vConsoleError: result.ok ? undefined : result.error,
          }
        })
      })
    },
    [getViewerRef, updateTab],
  )

  const setTabVConsoleEnabled = useCallback(
    (tabId: string, enabled: boolean) => {
      const viewer = getViewerRef(tabId).current
      if (!viewer?.isReady()) {
        updateTab(tabId, (entry) => ({
          ...entry,
          vConsoleEnabled: enabled,
          vConsoleBusy: false,
          vConsoleError: enabled ? '网页尚未就绪' : undefined,
        }))
        return
      }

      updateTab(tabId, (entry) => ({
        ...entry,
        vConsoleEnabled: enabled,
        vConsoleBusy: true,
        vConsoleError: undefined,
      }))

      const run = enabled
        ? injectVConsole((code) => viewer.evalInPage(code))
        : destroyVConsole((code) => viewer.evalInPage(code))

      void run.then((result) => {
        updateTab(tabId, (entry) => {
          // Ignore stale results if the user toggled again.
          if (entry.vConsoleEnabled !== enabled) {
            return entry
          }
          if (!result.ok) {
            return {
              ...entry,
              vConsoleEnabled: enabled ? false : entry.vConsoleEnabled,
              vConsoleBusy: false,
              vConsoleError: result.error,
            }
          }
          return {
            ...entry,
            vConsoleBusy: false,
            vConsoleError: undefined,
          }
        })
      })
    },
    [getViewerRef, updateTab],
  )

  const readActiveNetworkBody = useCallback(
    (entryId: string) => {
      const tabId = activeTabIdRef.current
      const tab = tabsRef.current.find((entry) => entry.id === tabId)
      if (!tab) {
        return Promise.reject(new Error('没有活动标签页'))
      }
      const viewer = getViewerRef(tabId).current
      if (!viewer?.isReady()) {
        return Promise.reject(new Error('网页尚未就绪'))
      }
      return viewer.readNetworkBody(entryId)
    },
    [getViewerRef],
  )

  const readActiveNetworkBodyLines = useCallback(
    (
      entryId: string,
      options?: { fromLine?: number; toLine?: number; metaOnly?: boolean },
    ) => {
      const tabId = activeTabIdRef.current
      const tab = tabsRef.current.find((entry) => entry.id === tabId)
      if (!tab) {
        return Promise.reject(new Error('没有活动标签页'))
      }
      const viewer = getViewerRef(tabId).current
      if (!viewer?.isReady()) {
        return Promise.reject(new Error('网页尚未就绪'))
      }
      return viewer.readNetworkBodyLines(entryId, options)
    },
    [getViewerRef],
  )

  const probeActiveNetworkHot = useCallback(
    (method: string, url: string) => {
      const tabId = activeTabIdRef.current
      const tab = tabsRef.current.find((entry) => entry.id === tabId)
      if (!tab) {
        return Promise.reject(new Error('没有活动标签页'))
      }
      const viewer = getViewerRef(tabId).current
      if (!viewer?.isReady()) {
        return Promise.reject(new Error('网页尚未就绪'))
      }
      return viewer.probeNetworkHot(method, url)
    },
    [getViewerRef],
  )

  const activeDevtoolsTab = activeTab?.devtoolsTab
  const activeDevtoolsUndocked = activeTab?.devtoolsUndocked

  useEffect(() => {
    if (!activeTabId || activeDevtoolsTab !== 'network') {
      return
    }
    if (!activeTab?.devtoolsOpen && !activeDevtoolsUndocked) {
      return
    }
    void pullNetworkDelta(activeTabId)
  }, [
    activeTab?.devtoolsOpen,
    activeDevtoolsTab,
    activeDevtoolsUndocked,
    activeTabId,
    pullNetworkDelta,
  ])

  const appendTabConsoleEntries = useCallback(
    (tabId: string, entries: ChromoConsoleDisplayEntry[]) => {
      updateTab(tabId, (entry) => ({
        ...entry,
        replEntries: [...entry.replEntries, ...entries],
      }))
    },
    [updateTab],
  )

  const updateTabReplHistory = useCallback(
    (tabId: string, history: string[]) => {
      updateTab(tabId, (entry) => ({
        ...entry,
        replHistory: history,
      }))
    },
    [updateTab],
  )

  const updateTabPreserveConsole = useCallback(
    (tabId: string, preserveConsole: boolean) => {
      updateTab(tabId, (entry) => ({
        ...entry,
        preserveConsole,
      }))
    },
    [updateTab],
  )

  // Keep undocked DevTools sessions in sync for every undocked tab
  useEffect(() => {
    if (!parentWindowId) {
      return
    }

    const undockedTabs = tabs.filter((tab) => tab.devtoolsUndocked)
    for (const tab of undockedTabs) {
      const key = makeChromoDevToolsSessionKey(parentWindowId, tab.id)
      const snapshot: ChromoDevToolsSnapshot = {
        parentWindowId,
        tabId: tab.id,
        pageTitle: tab.title,
        pageUrl: tab.url,
        pageReady: computeChromoPageReady(tab),
        pageLoading: tab.loading,
        pageError: formatPageFault(tab.pageFault),
        pageFault: tab.pageFault,
        panelTab: tab.devtoolsTab,
        dockSide: tab.devtoolsDockSide,
        preserveLog: tab.preserveConsole,
        consoleEntries: tab.consoleEntries,
        replEntries: tab.replEntries,
        replHistory: tab.replHistory,
        networkEntries: tab.networkEntries,
        selectedNetworkId: tab.selectedNetworkId,
        disableNetworkCache: tab.disableNetworkCache,
        vConsoleEnabled: tab.vConsoleEnabled,
        vConsoleBusy: tab.vConsoleBusy,
        vConsoleError: tab.vConsoleError,
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
        application: makeChromoApplicationApi(() => getViewerRef(tab.id).current),
        onPanelTabChange: (panelTab) => {
          updateTab(tab.id, (entry) => ({ ...entry, devtoolsTab: panelTab }))
        },
        onPreserveLogChange: (preserve) => {
          updateTab(tab.id, (entry) => ({ ...entry, preserveConsole: preserve }))
        },
        onClear: () => {
          const current = tabsRef.current.find((entry) => entry.id === tab.id)
          if (current?.devtoolsTab === 'network') {
            clearTabNetwork(tab.id)
            return
          }
          clearTabConsole(tab.id)
        },
        onAppendEntries: (entries) => appendTabConsoleEntries(tab.id, entries),
        onReplHistoryChange: (history) => updateTabReplHistory(tab.id, history),
        onSelectNetwork: (entry) => selectTabNetwork(tab.id, entry),
        onCloseNetworkDetail: () => clearTabNetworkSelection(tab.id),
        onDisableNetworkCacheChange: (disable) =>
          updateTabDisableNetworkCache(tab.id, disable),
        onVConsoleEnabledChange: (enabled) => setTabVConsoleEnabled(tab.id, enabled),
        onClearBrowsingData: () => clearTabBrowsingData(tab.id),
        onRedock: (side) => {
          updateTab(tab.id, (entry) => ({
            ...entry,
            devtoolsUndocked: false,
            devtoolsOpen: true,
            devtoolsDockSide: side,
          }))
          unregisterChromoDevToolsSession(key)
        },
        onDetachedClosed: () => {
          updateTab(tab.id, (entry) => ({
            ...entry,
            devtoolsUndocked: false,
            devtoolsOpen: false,
          }))
          unregisterChromoDevToolsSession(key)
        },
      }

      registerChromoDevToolsSession(key, snapshot, handlers)
    }

    for (const tab of tabs) {
      if (tab.devtoolsUndocked) {
        continue
      }
      const key = makeChromoDevToolsSessionKey(parentWindowId, tab.id)
      unregisterChromoDevToolsSession(key)
    }
  }, [
    appendTabConsoleEntries,
    clearTabBrowsingData,
    clearTabConsole,
    clearTabNetwork,
    clearTabNetworkSelection,
    getViewerRef,
    parentWindowId,
    selectTabNetwork,
    setTabVConsoleEnabled,
    tabs,
    updateTab,
    updateTabDisableNetworkCache,
    updateTabReplHistory,
  ])

  const windowsRef = useRef(windows)
  windowsRef.current = windows

  // Close linked DevTools windows when Chromo main window unmounts
  useEffect(() => {
    const capturedParentId = parentWindowId
    return () => {
      if (!capturedParentId) {
        return
      }
      for (const tab of tabsRef.current) {
        const key = makeChromoDevToolsSessionKey(capturedParentId, tab.id)
        unregisterChromoDevToolsSession(key)
      }
      for (const window of windowsRef.current) {
        if (
          window.appId === 'chromo-devtools' &&
          !window.closing &&
          window.documentId?.startsWith(`${capturedParentId}:`)
        ) {
          closeWindow(window.id)
        }
      }
    }
  }, [closeWindow, parentWindowId])

  const findDevToolsWindow = useCallback(
    (tabId: string) => {
      if (!parentWindowId) {
        return undefined
      }
      const key = makeChromoDevToolsSessionKey(parentWindowId, tabId)
      return windows.find(
        (window) =>
          window.appId === 'chromo-devtools' &&
          !window.closing &&
          window.documentId === key,
      )
    },
    [parentWindowId, windows],
  )

  const undockDevTools = useCallback(
    (tabId: string) => {
      if (!parentWindowId) {
        return
      }
      const tab = tabsRef.current.find((entry) => entry.id === tabId)
      if (!tab) {
        return
      }
      const key = makeChromoDevToolsSessionKey(parentWindowId, tabId)
      const snapshot: ChromoDevToolsSnapshot = {
        parentWindowId,
        tabId: tab.id,
        pageTitle: tab.title,
        pageUrl: tab.url,
        pageReady: computeChromoPageReady(tab),
        pageLoading: tab.loading,
        pageError: formatPageFault(tab.pageFault),
        pageFault: tab.pageFault,
        panelTab: tab.devtoolsTab,
        dockSide: tab.devtoolsDockSide,
        preserveLog: tab.preserveConsole,
        consoleEntries: tab.consoleEntries,
        replEntries: tab.replEntries,
        replHistory: tab.replHistory,
        networkEntries: tab.networkEntries,
        selectedNetworkId: tab.selectedNetworkId,
        disableNetworkCache: tab.disableNetworkCache,
        vConsoleEnabled: tab.vConsoleEnabled,
        vConsoleBusy: tab.vConsoleBusy,
        vConsoleError: tab.vConsoleError,
      }
      // Handlers will be replaced by the sync effect; provide a stub so the window can mount.
      registerChromoDevToolsSession(key, snapshot, {
        evalInPage: (code) => {
          const viewer = getViewerRef(tabId).current
          if (!viewer?.isReady()) {
            return Promise.reject(new Error('网页尚未就绪'))
          }
          return viewer.evalInPage(code)
        },
        readNetworkBody: (entryId) => {
          const viewer = getViewerRef(tabId).current
          if (!viewer?.isReady()) {
            return Promise.reject(new Error('网页尚未就绪'))
          }
          return viewer.readNetworkBody(entryId)
        },
        readNetworkBodyLines: (entryId, options) => {
          const viewer = getViewerRef(tabId).current
          if (!viewer?.isReady()) {
            return Promise.reject(new Error('网页尚未就绪'))
          }
          return viewer.readNetworkBodyLines(entryId, options)
        },
        probeNetworkHot: (method, url) => {
          const viewer = getViewerRef(tabId).current
          if (!viewer?.isReady()) {
            return Promise.reject(new Error('网页尚未就绪'))
          }
          return viewer.probeNetworkHot(method, url)
        },
        setNetworkOptions: (options) => {
          getViewerRef(tabId).current?.setNetworkOptions(options)
        },
        application: makeChromoApplicationApi(() => getViewerRef(tabId).current),
        onPanelTabChange: (panelTab) => {
          updateTab(tabId, (entry) => ({ ...entry, devtoolsTab: panelTab }))
        },
        onPreserveLogChange: (preserve) => {
          updateTab(tabId, (entry) => ({ ...entry, preserveConsole: preserve }))
        },
        onClear: () => {
          const current = tabsRef.current.find((entry) => entry.id === tabId)
          if (current?.devtoolsTab === 'network') {
            clearTabNetwork(tabId)
            return
          }
          clearTabConsole(tabId)
        },
        onAppendEntries: (entries) => appendTabConsoleEntries(tabId, entries),
        onReplHistoryChange: (history) => updateTabReplHistory(tabId, history),
        onSelectNetwork: (entry) => selectTabNetwork(tabId, entry),
        onCloseNetworkDetail: () => clearTabNetworkSelection(tabId),
        onDisableNetworkCacheChange: (disable) =>
          updateTabDisableNetworkCache(tabId, disable),
        onVConsoleEnabledChange: (enabled) => setTabVConsoleEnabled(tabId, enabled),
        onClearBrowsingData: () => clearTabBrowsingData(tabId),
        onRedock: (side) => {
          updateTab(tabId, (entry) => ({
            ...entry,
            devtoolsUndocked: false,
            devtoolsOpen: true,
            devtoolsDockSide: side,
          }))
          unregisterChromoDevToolsSession(key)
        },
        onDetachedClosed: () => {
          updateTab(tabId, (entry) => ({
            ...entry,
            devtoolsUndocked: false,
            devtoolsOpen: false,
          }))
          unregisterChromoDevToolsSession(key)
        },
      })
      updateTab(tabId, (entry) => ({
        ...entry,
        devtoolsUndocked: true,
        devtoolsOpen: false,
      }))
      openApp('chromo-devtools', { documentId: key })
    },
    [
      appendTabConsoleEntries,
      clearTabBrowsingData,
      clearTabConsole,
      clearTabNetwork,
      clearTabNetworkSelection,
      getViewerRef,
      openApp,
      parentWindowId,
      selectTabNetwork,
      setTabVConsoleEnabled,
      updateTab,
      updateTabDisableNetworkCache,
      updateTabReplHistory,
    ],
  )

  const toggleDevTools = useCallback(() => {
    if (!activeTab) {
      return
    }
    if (activeTab.devtoolsUndocked) {
      const linked = findDevToolsWindow(activeTab.id)
      if (linked) {
        closeWindow(linked.id)
      }
      updateTab(activeTab.id, (entry) => ({
        ...entry,
        devtoolsUndocked: false,
        devtoolsOpen: false,
      }))
      if (parentWindowId) {
        unregisterChromoDevToolsSession(
          makeChromoDevToolsSessionKey(parentWindowId, activeTab.id),
        )
      }
      return
    }
    if (activeTab.devtoolsOpen) {
      updateTab(activeTab.id, (entry) => ({ ...entry, devtoolsOpen: false }))
      return
    }
    updateTab(activeTab.id, (entry) => ({ ...entry, devtoolsOpen: true }))
  }, [activeTab, closeWindow, findDevToolsWindow, parentWindowId, updateTab])

  const submitUrl = useCallback(
    (event: Event) => {
      event.preventDefault()
      if (!activeTab) {
        return
      }
      const form = event.currentTarget as HTMLFormElement
      const input = form.querySelector('input') as HTMLInputElement | null
      const value = input?.value.trim() ?? activeTab.inputUrl.trim()
      if (!value) {
        return
      }
      navigateActive(value)
      input?.blur()
    },
    [activeTab, navigateActive],
  )

  // 仅响应 OS openApp({ url }) 变更；勿依赖 navigateActive（否则用户导航后会误触发）
  useEffect(() => {
    if (!pendingUrl) {
      return
    }
    if (pendingUrl === prevPendingUrlRef.current) {
      return
    }
    prevPendingUrlRef.current = pendingUrl

    const activeId = activeTabIdRef.current
    const requested = activeId ? requestedUrlByTabRef.current[activeId] : undefined
    if (requested && chromoUrlsMatch(requested, pendingUrl)) {
      lastOpenedUrlRef.current = pendingUrl
      return
    }

    lastOpenedUrlRef.current = pendingUrl
    if (activeId) {
      navigateTab(activeId, pendingUrl)
    }
  }, [pendingUrl, navigateTab])

  useEffect(() => {
    setChromePinSource(chromoFullscreen ? chromoRootRef.current : null)
    return () => setChromePinSource(null)
  }, [chromoFullscreen, setChromePinSource])

  const toolbarAutoHide = chromoFullscreen
  const toolbarVisible = !toolbarAutoHide || fullscreenToolbarRevealed
  const toolbarInteractionPinned =
    addressFocused ||
    tabsOverflowOpen ||
    sidebarOpen ||
    Boolean(activeTab?.devtoolsOpen || activeTab?.devtoolsUndocked)

  const activeDevtoolsOpen = Boolean(activeTab?.devtoolsOpen && !activeTab?.devtoolsUndocked)
  const activeDevtoolsDockSide = activeTab?.devtoolsDockSide ?? 'bottom'
  const activeDevtoolsActive = Boolean(activeTab?.devtoolsOpen || activeTab?.devtoolsUndocked)

  const tabSummaries = useMemo((): ChromoTabSummary[] => {
    return tabs.map((tab) => ({
      id: tab.id,
      title: tab.loading && tab.title === pageTitleFromUrl(tab.url) ? '正在加载…' : tab.title,
      url: tab.url,
      loading: tab.loading,
      siteInitial: siteInitialFromUrl(tab.url),
    }))
  }, [tabs])

  const addressValue = addressFocused ? activeTab?.inputUrl ?? '' : displayUrl(activeTab?.url ?? '')
  const showProgress = Boolean(activeTab?.loading)

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindowEntry = windows.find((window) => window.appId === 'chromo' && !window.minimized)

    return [
      {
        label: 'Chromo',
        items: [
          ...aboutAppMenuPrefix('关于 Chromo', () => showBuiltinAbout('chromo')),
          {
            type: 'action',
            label: '隐藏 Chromo',
            shortcut: '⌘H',
            onClick: () => appWindowEntry && minimizeWindow(appWindowEntry.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出 Chromo',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp('chromo'),
          },
        ],
      },
      {
        label: '文件',
        items: [
          {
            type: 'action',
            label: '关闭窗口',
            shortcut: '⌘W',
            onClick: () => appWindowEntry && closeWindowsForApp('chromo'),
          },
        ],
      },
      {
        label: '标签页',
        items: [
          {
            type: 'action',
            label: '新建标签页',
            shortcut: '⌘T',
            onClick: () => addTab(),
          },
          {
            type: 'action',
            label: '关闭标签页',
            shortcut: '⌘⇧W',
            onClick: () => activeTab && closeTab(activeTab.id),
          },
        ],
      },
    ]
  }, [
    activeTab,
    addTab,
    closeTab,
    closeWindowsForApp,
    minimizeWindow,
    showBuiltinAbout,
    windows,
  ])

  useAppMenuBar('chromo', menuBar)

  return (
    <div
      class={[
        'chromo',
        toolbarAutoHide ? 'chromo--toolbar-autohide' : '',
        toolbarAutoHide && toolbarVisible ? 'chromo--toolbar-revealed' : '',
        narrowLayout ? 'chromo--narrow' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      ref={attachChromoRoot}
    >
      {toolbarAutoHide && !toolbarVisible && (
        <div
          class="chromo__toolbar-reveal-sensor"
          aria-hidden="true"
          onPointerEnter={() => setFullscreenToolbarRevealed(true)}
          onPointerMove={() => setFullscreenToolbarRevealed(true)}
        />
      )}

      <header
        class="chromo__chrome"
        onPointerLeave={(event) => {
          if (!toolbarAutoHide || toolbarInteractionPinned) {
            return
          }
          const next = event.relatedTarget
          if (next instanceof Node && event.currentTarget.contains(next)) {
            return
          }
          setFullscreenToolbarRevealed(false)
        }}
      >
        <ChromoTabBar
          tabs={tabSummaries}
          activeTabId={activeTabId}
          overflowOpen={tabsOverflowOpen}
          onSelectTab={selectTab}
          onCloseTab={closeTab}
          onNewTab={() => addTab()}
          onToggleOverflow={() => setTabsOverflowOpen((open) => !open)}
          onHiddenTabsChange={setHiddenTabIds}
        />

        <div class="chromo__toolbar">
          <div class="chromo__nav">
            <button
              type="button"
              class="chromo__btn"
              disabled={!activeTab?.canGoBack}
              onClick={goBack}
              aria-label="后退"
            >
              <BackIcon />
            </button>
            <button
              type="button"
              class="chromo__btn"
              disabled={!activeTab?.canGoForward}
              onClick={goForward}
              aria-label="前进"
            >
              <ForwardIcon />
            </button>
          </div>

          <form class="chromo__omnibox-wrap" onSubmit={submitUrl}>
            <div
              class={[
                'chromo__omnibox',
                addressFocused ? 'chromo__omnibox--focused' : '',
                showProgress ? 'chromo__omnibox--loading' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span class="chromo__omnibox-leading" aria-hidden="true">
                {showProgress ? undefined : <LockIcon />}
              </span>
              <input
                type="text"
                class="chromo__omnibox-input"
                value={addressValue}
                placeholder="搜索或输入网址"
                onFocus={() => {
                  setAddressFocused(true)
                  if (activeTab) {
                    updateTab(activeTab.id, (tab) => ({
                      ...tab,
                      inputUrl: displayUrl(tab.url),
                    }))
                  }
                }}
                onBlur={() => {
                  setAddressFocused(false)
                  if (activeTab) {
                    updateTab(activeTab.id, (tab) => ({
                      ...tab,
                      inputUrl: displayUrl(tab.url),
                    }))
                  }
                }}
                onInput={(event) => {
                  const value = (event.currentTarget as HTMLInputElement).value
                  if (activeTab) {
                    updateTab(activeTab.id, (tab) => ({ ...tab, inputUrl: value }))
                  }
                }}
                spellcheck={false}
                aria-label="地址栏"
              />
            </div>
          </form>

          <div class="chromo__actions">
            <button
              type="button"
              class={[
                'chromo__btn',
                'chromo__btn--sidebar',
                sidebarOpen ? 'chromo__btn--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setSidebarOpen((open) => !open)}
              aria-label="AI 助手"
              aria-pressed={sidebarOpen}
              title="AI 助手"
            >
              AI
            </button>
            <button
              type="button"
              class={[
                'chromo__btn',
                'chromo__btn--sidebar',
                activeDevtoolsActive ? 'chromo__btn--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={toggleDevTools}
              aria-label="开发者工具"
              aria-pressed={activeDevtoolsActive}
              title="开发者工具"
            >
              开发者工具
            </button>
            {showProgress ? (
              <button type="button" class="chromo__btn" onClick={stopLoading} aria-label="停止">
                <StopIcon />
              </button>
            ) : (
              <button type="button" class="chromo__btn" onClick={reload} aria-label="刷新">
                <ReloadIcon />
              </button>
            )}
          </div>
        </div>
      </header>

      <div class="chromo__body">
        <div
          class={[
            'chromo__main-column',
            activeDevtoolsOpen ? `chromo__main-column--devtools-${activeDevtoolsDockSide}` : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <div
            class={[
              'chromo__devtools-area',
              activeDevtoolsOpen ? `chromo__devtools-area--${activeDevtoolsDockSide}` : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <main class="chromo__viewport">
              {activeTab?.pageFault && (
                <ChromoPageFaultView
                  fault={activeTab.pageFault}
                  variant="viewport"
                  onRetry={reload}
                />
              )}
              {tabs.map((tab) => (
                <ChromoViewerFrame
              key={tab.id}
              devtoolsId={tab.devtoolsId}
              initialUrl={tab.url || undefined}
              disableNetworkCache={tab.disableNetworkCache}
              ref={getViewerRef(tab.id)}
              active={tab.id === activeTabId}
              onReady={() => {
                updateTab(tab.id, (entry) => ({
                  ...entry,
                  ready: true,
                  bootstrapped: entry.url ? true : entry.bootstrapped,
                }))
                const recoverUrl = pendingRecoverNavigateRef.current[tab.id]
                if (recoverUrl) {
                  delete pendingRecoverNavigateRef.current[tab.id]
                  getViewerRef(tab.id).current?.navigate(recoverUrl)
                  return
                }
                // 有 initialUrl 时 viewer 已入队导航；空 tab 才走 ensure
                const current = tabsRef.current.find((entry) => entry.id === tab.id)
                if (!current?.url) {
                  ensureInitialTabLoad(tab.id)
                }
              }}
              onNavigating={() => {
                updateTab(tab.id, (entry) => ({
                  ...entry,
                  loading: true,
                  pageFault: undefined,
                  ...(entry.preserveConsole
                    ? {}
                    : {
                        consoleEntries: [],
                        replEntries: [],
                        lastConsoleId: '',
                        networkEntries: [],
                        lastNetworkId: '',
                        selectedNetworkId: '',
                      }),
                }))
              }}
              onLoading={({ loading }) => {
                updateTab(tab.id, (entry) => ({ ...entry, loading }))
              }}
              onNavigated={({ url, title, canGoBack, canGoForward }) => {
                const requested = requestedUrlByTabRef.current[tab.id]
                if (
                  requested &&
                  !chromoUrlsMatch(requested, url) &&
                  chromoUrlsMatch(url, CHROMO_DEFAULT_NEW_TAB_URL)
                ) {
                  return
                }
                requestedUrlByTabRef.current[tab.id] = url
                updateTab(tab.id, (entry) => ({
                  ...entry,
                  url,
                  title: title || pageTitleFromUrl(url),
                  inputUrl: displayUrl(url),
                  loading: false,
                  canGoBack,
                  canGoForward,
                  pageFault: undefined,
                }))
                if (tab.id === activeTabId) {
                  // 同步 OS 窗口 URL，同时标记已处理，避免 pendingUrl effect 二次导航
                  lastOpenedUrlRef.current = url
                  setAppWindowUrl('chromo', url)
                }
                // inject.js 在 load 后可能仍在异步执行，延迟拉取 console
                window.setTimeout(() => {
                  void pullConsoleDelta(tab.id)
                  void pullNetworkDelta(tab.id)
                  reinjectVConsoleIfEnabled(tab.id)
                }, 300)
              }}
              onLoadFailed={({ url, message, code }) => {
                updateTab(tab.id, (entry) => ({
                  ...entry,
                  loading: false,
                  pageFault: pageFaultFromLoadFailed({ url, message, code }),
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
              onError={(payload) => {
                const fault = pageFaultFromError(payload)
                if (!fault) {
                  return
                }
                updateTab(tab.id, (entry) => ({
                  ...entry,
                  loading: false,
                  pageFault: fault,
                }))
              }}
              onLocation={({ url, method, httpMethod, formBody, formFiles, formEnctype }) => {
                // window.open → 新标签；location.assign/replace 等 → 当前标签
                if (method === 'open' && url) {
                  addTab(url)
                  return
                }
                if (method === 'submit' && httpMethod === 'post') {
                  if (
                    formFiles ||
                    (formEnctype && formEnctype !== 'application/x-www-form-urlencoded')
                  ) {
                    updateTab(tab.id, (entry) => ({
                      ...entry,
                      loading: false,
                      pageFault: {
                        severity: 'load',
                        code: 'POST_FORM_UNSUPPORTED',
                        message:
                          '当前不支持带文件上传或非 urlencoded 的 POST 表单。请改用 GET 表单或 fetch API。',
                        url,
                      },
                    }))
                    return
                  }
                  if (!formBody) {
                    updateTab(tab.id, (entry) => ({
                      ...entry,
                      loading: false,
                      pageFault: {
                        severity: 'load',
                        code: 'POST_FORM_UNSUPPORTED',
                        message: 'POST 表单缺少可提交的字段数据。',
                        url,
                      },
                    }))
                    return
                  }
                  navigateTab(tab.id, url, { method: 'POST', body: formBody })
                  return
                }
                navigateTab(tab.id, url)
              }}
              onHistory={({ url, title }) => {
                cancelClickNavigate(tab.id)
                requestedUrlByTabRef.current[tab.id] = url
                updateTab(tab.id, (entry) => ({
                  ...entry,
                  url,
                  title: title || pageTitleFromUrl(url),
                  inputUrl: displayUrl(url),
                  loading: false,
                  pageFault: undefined,
                }))
                if (tab.id === activeTabIdRef.current) {
                  lastOpenedUrlRef.current = url
                  setAppWindowUrl('chromo', url)
                }
              }}
              onClick={({ href, target }) => {
                if ((target === '_blank' || target === '_new') && href) {
                  addTab(href)
                  return
                }
                if (!href || href === '#' || href.startsWith('javascript:')) {
                  return
                }
                if (isSameDocumentHashLink(href, tab.url)) {
                  return
                }
                cancelClickNavigate(tab.id)
                clickNavigateTimersRef.current[tab.id] = window.setTimeout(() => {
                  delete clickNavigateTimersRef.current[tab.id]
                  navigateTab(tab.id, href)
                }, 150)
              }}
                />
              ))}
            </main>

            {activeDevtoolsOpen && activeTab && (
              <ChromoDevToolsPanel
                mode="embedded"
                narrowLayout={narrowLayout}
                activeTab={activeTab.devtoolsTab}
                onTabChange={(panelTab) =>
                  updateTab(activeTab.id, (entry) => ({ ...entry, devtoolsTab: panelTab }))
                }
                onClose={() =>
                  updateTab(activeTab.id, (entry) => ({ ...entry, devtoolsOpen: false }))
                }
                dockSide={activeTab.devtoolsDockSide}
                onDockSideChange={(side) =>
                  updateTab(activeTab.id, (entry) => ({ ...entry, devtoolsDockSide: side }))
                }
                onUndock={() => undockDevTools(activeTab.id)}
                preserveLog={activeTab.preserveConsole}
                onPreserveLogChange={(preserve) => updateTabPreserveConsole(activeTab.id, preserve)}
                onClear={() => {
                  if (activeTab.devtoolsTab === 'network') {
                    clearTabNetwork(activeTab.id)
                    return
                  }
                  clearTabConsole(activeTab.id)
                }}
                entries={mergeConsoleDisplayEntries(
                  activeTab.consoleEntries,
                  activeTab.replEntries,
                )}
                pageReady={computeChromoPageReady(activeTab)}
                evalInPage={evalInActivePage}
                replHistory={activeTab.replHistory}
                onReplHistoryChange={(history) => updateTabReplHistory(activeTab.id, history)}
                onAppendEntries={(entries) => appendTabConsoleEntries(activeTab.id, entries)}
                networkEntries={activeTab.networkEntries}
                selectedNetworkId={activeTab.selectedNetworkId || undefined}
                disableNetworkCache={activeTab.disableNetworkCache}
                onDisableNetworkCacheChange={(disable) =>
                  updateTabDisableNetworkCache(activeTab.id, disable)
                }
                readNetworkBody={readActiveNetworkBody}
                readNetworkBodyLines={readActiveNetworkBodyLines}
                probeNetworkHot={probeActiveNetworkHot}
                pageLoading={activeTab.loading}
                pageError={formatPageFault(activeTab.pageFault)}
                pageFault={activeTab.pageFault}
                onSelectNetwork={(entry) => selectTabNetwork(activeTab.id, entry)}
                onCloseNetworkDetail={() => clearTabNetworkSelection(activeTab.id)}
                pageUrl={activeTab.url}
                vConsoleEnabled={activeTab.vConsoleEnabled}
                vConsoleBusy={activeTab.vConsoleBusy}
                vConsoleError={activeTab.vConsoleError}
                onVConsoleEnabledChange={(enabled) =>
                  setTabVConsoleEnabled(activeTab.id, enabled)
                }
                onClearBrowsingData={() => clearTabBrowsingData(activeTab.id)}
                applicationApi={makeChromoApplicationApi(
                  () => getViewerRef(activeTab.id).current,
                )}
              />
            )}
          </div>
        </div>

        {sidebarOpen && (
          <ChromoAgentSidebar
            pageUrl={activeTab?.url ?? ''}
            pageTitle={activeTab?.title ?? ''}
            pageReady={computeChromoPageReady(activeTab)}
            evalInPage={evalInActivePage}
            screenshotInPage={screenshotInActivePage}
          />
        )}
      </div>

      {tabsOverflowOpen && hiddenTabIds.length > 0 && (
        <div class="chromo__overflow-panel" role="menu">
          {tabs
            .filter((tab) => hiddenTabIds.includes(tab.id))
            .map((tab) => (
              <button
                key={tab.id}
                type="button"
                class="chromo__overflow-item"
                onClick={() => selectTab(tab.id)}
              >
                {tab.title}
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
