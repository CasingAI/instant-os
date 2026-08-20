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
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { useFullscreenChromeReveal } from '../../os/fullscreen-chrome-reveal-context.tsx'
import { AdaptiveActionMenu, type AdaptiveActionMenuItem } from '../../ui/adaptive-action-menu.tsx'
import { useAppNarrowLayout } from '../../ui/use-app-narrow-layout.ts'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { useSystemOpenDialog } from '../../window/system-open-dialog.tsx'
import {
  displayUrl,
  hostnameFromUrl,
  isStartPageUrl,
  pageTitleFromUrl,
} from '../browser/normalize-browser-url.ts'
import type { ChromoConsoleEntry, ChromoContextMenuPayload, ChromoNetworkEntry, ChromoScreenshotOptions } from './chromo-bridge.ts'
import { CHROMO_DEFAULT_NEW_TAB_URL } from './chromo-config.ts'
import {
  resolveNavIntent,
  shouldCreateTab,
  shouldNavigateSameTab,
} from '../../page-host/page-nav.ts'
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
import {
  isChromoBookmarked,
  loadChromoBookmarksBarVisible,
  removeChromoBookmark,
  setChromoBookmarksBarVisible,
  toggleChromoBookmark,
} from './chromo-bookmarks.ts'
import {
  ChromoBookmarksBar,
  type ChromoBookmarkContextRequest,
} from './chromo-bookmarks-bar.tsx'
import { ChromoBookmarksPage } from './chromo-bookmarks-panel.tsx'
import {
  clearChromoHistory,
  recordChromoHistoryVisit,
} from './chromo-history.ts'
import { ChromoHistoryPage } from './chromo-history-panel.tsx'
import {
  chromoInternalPageTitle,
  chromoInternalUrl,
  isChromoInternalUrl,
  normalizeChromoInternalUrl,
  parseChromoInternalPage,
  shouldIgnoreChromoViewerNavigation,
  canUseChromoPageChrome,
  type ChromoInternalPage,
} from './chromo-internal.ts'
import { ChromoNewTabPage } from './chromo-new-tab-page.tsx'
import { searchChromoOmniboxSuggestions } from './chromo-omnibox-suggestions.ts'
import { ChromoOmniboxSuggestionsList } from './chromo-omnibox-suggestions-list.tsx'
import { ChromoSettingsPage } from './chromo-settings-page.tsx'
import {
  chromoSessionHasPages,
  loadChromoSession,
  saveChromoBlankSession,
  saveChromoSession,
} from './chromo-session.ts'
import { ChromoTabBar, type ChromoTabSummary } from './chromo-tab-bar.tsx'
import { ChromoMoreIcon, ChromoSparkleIcon, ChromoStarIcon } from './chromo-toolbar-icons.tsx'
import { ChromoViewerFrame, type ChromoViewerHandle } from './chromo-viewer-frame.tsx'
import type { ChromoApplicationApi } from './chromo-application-panel.tsx'
import { ChromoPageFindBar } from './chromo-page-find-bar.tsx'
import {
  buildChromoFindSearchEval,
  buildChromoFindStepEval,
  CHROMO_FIND_CLEAR_SCRIPT,
  parseChromoFindResult,
} from './chromo-page-find.ts'
import { CHROMO_PAGE_CHROME_INJECT_SCRIPT } from './chromo-page-chrome-inject.ts'
import {
  CHROMO_DEFAULT_ZOOM,
  formatChromoZoom,
  nextChromoZoom,
} from './chromo-page-zoom.ts'
import { base64JpegToPdf } from './chromo-export-pdf.ts'
import {
  CHROMO_SERIALIZE_PAGE_SCRIPT,
  formatSavePageSummary,
  parsePageSerializeResult,
  sanitizePageFileBaseName,
  saveImageUrlToPath,
  saveSerializedPageToPath,
  suggestedSaveNameFromUrl,
  writeUniqueFile,
} from './chromo-save-page.ts'
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
  /** Extensions：Viewer 内置 Debug Panel（绿色「调」） */
  debugPanelEnabled: boolean
  zoom: number
}

/** DevTools 可用：viewer 已启动且目标 URL 已知（不等整页 load 完成）。 */
function computeChromoPageReady(tab: Pick<ChromoTab, 'ready' | 'url'> | null | undefined): boolean {
  return Boolean(tab?.ready && tab.url)
}

let nextTabId = 1

function restoreChromoWindowTabs(pendingUrl?: string): { tabs: ChromoTab[]; activeTabId: string } {
  const session = loadChromoSession()
  if (!chromoSessionHasPages(session)) {
    const tab = createChromoTab(pendingUrl ?? '')
    return { tabs: [tab], activeTabId: tab.id }
  }

  const tabs = session.tabs.map((item) => {
    const tab = createChromoTab(item.url)
    if (item.url && item.title.trim()) {
      tab.title = item.title.trim()
    }
    return tab
  })
  const activeIndex = Math.min(Math.max(0, session.activeIndex), tabs.length - 1)
  return { tabs, activeTabId: tabs[activeIndex]?.id ?? tabs[0]!.id }
}

function persistChromoWindowSession(tabs: ChromoTab[], activeTabId: string): void {
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId)
  saveChromoSession({
    tabs: tabs.map((tab) => ({ url: tab.url, title: tab.title })),
    activeIndex: Math.max(0, activeIndex),
  })
}

function chromoTabTitle(url: string): string {
  const page = parseChromoInternalPage(url)
  if (page) {
    return chromoInternalPageTitle(page)
  }
  return url ? pageTitleFromUrl(url) : '新标签页'
}

function chromoTabInputUrl(url: string): string {
  if (!url || isChromoInternalUrl(url)) {
    return url
  }
  return displayUrl(url)
}

function createChromoTab(initialUrl = ''): ChromoTab {
  const id = `chromo-tab-${nextTabId++}`
  const devtoolsId = crypto.randomUUID()
  const url = initialUrl ? normalizeChromoUrl(initialUrl) : ''
  const internal = isChromoInternalUrl(url)
  const title = chromoTabTitle(url)
  return {
    id,
    devtoolsId,
    url,
    title,
    inputUrl: chromoTabInputUrl(url),
    loading: Boolean(url) && !internal,
    canGoBack: false,
    canGoForward: false,
    ready: false,
    bootstrapped: internal || !url,
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
    debugPanelEnabled: false,
    zoom: CHROMO_DEFAULT_ZOOM,
  }
}

function normalizeChromoUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    return CHROMO_DEFAULT_NEW_TAB_URL
  }

  const internal = normalizeChromoInternalUrl(trimmed)
  if (internal) {
    return internal
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
  const { closeWindowsForApp, closeWindow, windows, setAppWindowUrl, openApp, activeWindowId } = useOs()
  const { setChromePinSource } = useFullscreenChromeReveal()
  const appWindow = windowId
    ? windows.find((window) => window.id === windowId && !window.closing)
    : windows.find((window) => window.appId === 'chromo' && !window.closing)
  const chromoWindow = windowId
    ? windows.find((window) => window.id === windowId && !window.minimized)
    : windows.find((window) => window.appId === 'chromo' && !window.minimized)
  const chromoFullscreen = Boolean(chromoWindow?.fullscreen)
  const pendingUrl = appWindow?.url
  const parentWindowId = appWindow?.id ?? windowId ?? ''

  const restoredWindowRef = useRef<ReturnType<typeof restoreChromoWindowTabs>>()
  if (!restoredWindowRef.current) {
    restoredWindowRef.current = restoreChromoWindowTabs(pendingUrl)
  }
  const [tabs, setTabs] = useState<ChromoTab[]>(() => restoredWindowRef.current!.tabs)
  const [activeTabId, setActiveTabId] = useState(() => restoredWindowRef.current!.activeTabId)
  const [addressFocused, setAddressFocused] = useState(false)
  const [addressSuggestionIndex, setAddressSuggestionIndex] = useState(-1)
  const [tabsOverflowOpen, setTabsOverflowOpen] = useState(false)
  const [hiddenTabIds, setHiddenTabIds] = useState<string[]>([])
  const [fullscreenToolbarRevealed, setFullscreenToolbarRevealed] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [bookmarksRevision, setBookmarksRevision] = useState(0)
  const [historyRevision, setHistoryRevision] = useState(0)
  const [bookmarksBarVisible, setBookmarksBarVisibleState] = useState(() =>
    loadChromoBookmarksBarVisible(),
  )
  const [bookmarksOverflowOpen, setBookmarksOverflowOpen] = useState(false)
  const [bookmarkContextMenu, setBookmarkContextMenu] = useState<ChromoBookmarkContextRequest>()
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [moreMenuAnchor, setMoreMenuAnchor] = useState<{ x: number; y: number }>()
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findCount, setFindCount] = useState(0)
  const [findIndex, setFindIndex] = useState(-1)
  const [findBusy, setFindBusy] = useState(false)
  const [findError, setFindError] = useState<string | undefined>()
  const [findFocusEpoch, setFindFocusEpoch] = useState(0)
  const [pageContextMenu, setPageContextMenu] = useState<
    { x: number; y: number; tabId: string; payload: ChromoContextMenuPayload } | undefined
  >()
  const modal = useWindowModal()
  const { showSystemOpenDialog, dialog: saveDialog } = useSystemOpenDialog()
  const findTimerRef = useRef<number | undefined>(undefined)
  const savingRef = useRef(false)
  const ignoreViewerClickUntilRef = useRef(0)
  const findQueryRef = useRef(findQuery)
  findQueryRef.current = findQuery
  const findOpenRef = useRef(findOpen)
  findOpenRef.current = findOpen

  const viewerRefs = useRef<Record<string, RefObject<ChromoViewerHandle>>>({})
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeTabIdRef = useRef(activeTabId)
  activeTabIdRef.current = activeTabId
  const lastOpenedUrlRef = useRef<string | undefined>(undefined)
  const prevPendingUrlRef = useRef<string | undefined>(undefined)
  const sessionBlankedRef = useRef(false)
  const sessionSnapshotRef = useRef({ tabs, activeTabId })
  sessionSnapshotRef.current = { tabs, activeTabId }
  /** 每个标签页最近一次主动请求的 URL，用于忽略过期的 VC_NAVIGATED */
  const requestedUrlByTabRef = useRef<Record<string, string>>({})
  /** After fatal viewer remount/reload, re-navigate to this URL on next VC_READY. */
  const pendingRecoverNavigateRef = useRef<Record<string, string>>({})
  /** VC_CLICK 后延迟整页导航；若随后收到 VC_HISTORY（SPA）则取消 */
  const clickNavigateTimersRef = useRef<Record<string, number>>({})
  const networkPullTimersRef = useRef<Record<string, number>>({})
  const chromoRootRef = useRef<HTMLDivElement>(null)
  const omniboxInputRef = useRef<HTMLInputElement>(null)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
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

  const shouldIgnoreViewerEvent = (tabId: string) => {
    const current = tabsRef.current.find((entry) => entry.id === tabId)
    return shouldIgnoreChromoViewerNavigation(
      current?.url ?? '',
      requestedUrlByTabRef.current[tabId],
    )
  }

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
      const internal = isChromoInternalUrl(normalized)
      requestedUrlByTabRef.current[tabId] = normalized
      lastOpenedUrlRef.current = normalized
      updateTab(tabId, (tab) => ({
        ...tab,
        url: normalized,
        title: chromoTabTitle(normalized),
        inputUrl: chromoTabInputUrl(normalized),
        loading: !internal,
        pageFault: undefined,
        bootstrapped: true,
        ...(internal ? { canGoBack: false, canGoForward: false } : {}),
      }))
      if (!internal) {
        getViewerRef(tabId).current?.navigate(normalized, options)
      }
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
        if (isChromoInternalUrl(tab.url)) {
          updateTab(tabId, (entry) => ({
            ...entry,
            bootstrapped: true,
            loading: false,
            title: chromoTabTitle(tab.url),
            inputUrl: chromoTabInputUrl(tab.url),
          }))
          return
        }
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
            window.appId === 'page-devtools' &&
            !window.closing &&
            window.documentId === sessionKey,
        )
        for (const window of linked) {
          closeWindow(window.id)
        }
      }

      if (tabsRef.current.length <= 1) {
        saveChromoBlankSession()
        if (parentWindowId) {
          sessionBlankedRef.current = true
          closeWindow(parentWindowId)
          return
        }
        const replacement = createChromoTab()
        setActiveTabId(replacement.id)
        delete viewerRefs.current[tabId]
        delete pendingRecoverNavigateRef.current[tabId]
        setTabs([replacement])
        return
      }

      setTabs((current) => {
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
    [activeTabId, cancelClickNavigate, closeWindow, parentWindowId, windows],
  )

  const selectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId)
    setTabsOverflowOpen(false)
  }, [])

  const goBack = useCallback(() => {
    if (!activeTab || isChromoInternalUrl(activeTab.url)) {
      return
    }
    getViewerRef(activeTab.id).current?.back()
  }, [activeTab, getViewerRef])

  const goForward = useCallback(() => {
    if (!activeTab || isChromoInternalUrl(activeTab.url)) {
      return
    }
    getViewerRef(activeTab.id).current?.forward()
  }, [activeTab, getViewerRef])

  const reload = useCallback(() => {
    if (!activeTab) {
      return
    }
    if (isChromoInternalUrl(activeTab.url) || !activeTab.url) {
      setHistoryRevision((value) => value + 1)
      setBookmarksRevision((value) => value + 1)
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

  const bumpBookmarksRevision = useCallback(() => {
    setBookmarksRevision((value) => value + 1)
  }, [])

  const bumpHistoryRevision = useCallback(() => {
    setHistoryRevision((value) => value + 1)
  }, [])

  const recordVisit = useCallback(
    (url: string, title: string) => {
      if (!url || isChromoInternalUrl(url)) {
        return
      }
      recordChromoHistoryVisit({ url, title })
      bumpHistoryRevision()
    },
    [bumpHistoryRevision],
  )

  const openInternalPage = useCallback(
    (page: ChromoInternalPage) => {
      const url = chromoInternalUrl(page)
      const existing = tabsRef.current.find((tab) => parseChromoInternalPage(tab.url) === page)
      if (existing) {
        setActiveTabId(existing.id)
      } else {
        addTab(url)
      }
      setMoreMenuOpen(false)
      setBookmarksOverflowOpen(false)
    },
    [addTab],
  )

  const clearBrowsingHistory = useCallback(() => {
    clearChromoHistory()
    bumpHistoryRevision()
  }, [bumpHistoryRevision])

  const currentBookmarked = useMemo(
    () => Boolean(activeTab?.url && isChromoBookmarked(activeTab.url)),
    [activeTab?.url, bookmarksRevision],
  )
  const canBookmarkPage = Boolean(activeTab?.url && !isChromoInternalUrl(activeTab.url))

  const toggleBookmarkForCurrentPage = useCallback(() => {
    if (!activeTab?.url || isChromoInternalUrl(activeTab.url)) {
      return
    }
    toggleChromoBookmark({ url: activeTab.url, title: activeTab.title })
    bumpBookmarksRevision()
  }, [activeTab, bumpBookmarksRevision])

  const toggleBookmarksBar = useCallback(() => {
    setBookmarksOverflowOpen(false)
    setBookmarksBarVisibleState((visible) => {
      const next = !visible
      setChromoBookmarksBarVisible(next)
      return next
    })
  }, [])

  const copyCurrentPageUrl = useCallback(() => {
    if (!activeTab?.url) {
      return
    }
    void navigator.clipboard?.writeText(activeTab.url)
  }, [activeTab?.url])

  const focusOmnibox = useCallback(() => {
    const input = omniboxInputRef.current
    if (!input) {
      return
    }
    input.focus()
    input.select()
  }, [])

  const closeMoreMenu = useCallback(() => setMoreMenuOpen(false), [])

  const openMoreMenu = useCallback(() => {
    const button = moreButtonRef.current
    if (button) {
      const rect = button.getBoundingClientRect()
      setMoreMenuAnchor({ x: Math.max(4, rect.right - 240), y: rect.bottom + 4 })
    }
    setMoreMenuOpen((open) => !open)
    setBookmarksOverflowOpen(false)
  }, [])

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

  const isViewerPage = useCallback((tab: ChromoTab | undefined) => {
    return canUseChromoPageChrome(tab?.url ?? '', Boolean(tab?.ready))
  }, [])

  const injectPageChrome = useCallback(
    (tabId: string) => {
      const viewer = getViewerRef(tabId).current
      if (!viewer?.isReady()) {
        return
      }
      void viewer.evalInPage(CHROMO_PAGE_CHROME_INJECT_SCRIPT).catch(() => undefined)
    },
    [getViewerRef],
  )

  const closeFind = useCallback(() => {
    if (findTimerRef.current !== undefined) {
      window.clearTimeout(findTimerRef.current)
      findTimerRef.current = undefined
    }
    setFindOpen(false)
    setFindError(undefined)
    const tab = tabsRef.current.find((entry) => entry.id === activeTabIdRef.current)
    if (isViewerPage(tab)) {
      const viewer = getViewerRef(tab!.id).current
      void viewer?.evalInPage(CHROMO_FIND_CLEAR_SCRIPT).catch(() => undefined)
    }
  }, [getViewerRef, isViewerPage])

  const runFindSearch = useCallback(
    async (query: string, tabId?: string) => {
      const tab = tabsRef.current.find((entry) => entry.id === (tabId ?? activeTabIdRef.current))
      if (!isViewerPage(tab)) {
        setFindCount(0)
        setFindIndex(-1)
        setFindError(undefined)
        return
      }
      const viewer = getViewerRef(tab!.id).current
      if (!viewer?.isReady()) {
        return
      }
      setFindBusy(true)
      try {
        await viewer.evalInPage(CHROMO_PAGE_CHROME_INJECT_SCRIPT)
        const result = parseChromoFindResult(await viewer.evalInPage(buildChromoFindSearchEval(query)))
        setFindCount(result.count)
        setFindIndex(result.index)
        setFindError(result.error)
      } catch (error) {
        setFindCount(0)
        setFindIndex(-1)
        setFindError(error instanceof Error ? error.message : String(error))
      } finally {
        setFindBusy(false)
      }
    },
    [getViewerRef, isViewerPage],
  )

  const scheduleFindSearch = useCallback(
    (query: string) => {
      setFindQuery(query)
      if (findTimerRef.current !== undefined) {
        window.clearTimeout(findTimerRef.current)
      }
      findTimerRef.current = window.setTimeout(() => {
        findTimerRef.current = undefined
        void runFindSearch(query)
      }, 160)
    },
    [runFindSearch],
  )

  const stepFind = useCallback(
    async (direction: 'next' | 'prev') => {
      const tab = tabsRef.current.find((entry) => entry.id === activeTabIdRef.current)
      if (!isViewerPage(tab) || !findQuery) {
        return
      }
      const viewer = getViewerRef(tab!.id).current
      if (!viewer?.isReady()) {
        return
      }
      try {
        const result = parseChromoFindResult(await viewer.evalInPage(buildChromoFindStepEval(direction)))
        setFindCount(result.count)
        setFindIndex(result.index)
        setFindError(result.error)
      } catch (error) {
        setFindError(error instanceof Error ? error.message : String(error))
      }
    },
    [findQuery, getViewerRef, isViewerPage],
  )

  const openFind = useCallback(() => {
    const tab = tabsRef.current.find((entry) => entry.id === activeTabIdRef.current)
    if (!isViewerPage(tab)) {
      return
    }
    setFindOpen(true)
    setFindFocusEpoch((epoch) => epoch + 1)
    setPageContextMenu(undefined)
    setAddressFocused(false)
    omniboxInputRef.current?.blur()
    if (findQuery) {
      void runFindSearch(findQuery)
    }
  }, [findQuery, isViewerPage, runFindSearch])

  useEffect(() => {
    if (!findOpenRef.current) {
      return
    }
    const tab = tabsRef.current.find((entry) => entry.id === activeTabId)
    if (!tab?.url || isChromoInternalUrl(tab.url)) {
      closeFind()
      return
    }
    const query = findQueryRef.current
    if (query && tab.ready) {
      void runFindSearch(query, tab.id)
    }
  }, [activeTabId, closeFind, runFindSearch])

  const changeZoom = useCallback(
    (direction: 1 | -1 | 0) => {
      const tab = tabsRef.current.find((entry) => entry.id === activeTabIdRef.current)
      if (!tab?.url || isChromoInternalUrl(tab.url)) {
        return
      }
      updateTab(tab.id, (entry) => ({
        ...entry,
        zoom: direction === 0 ? CHROMO_DEFAULT_ZOOM : nextChromoZoom(entry.zoom, direction),
      }))
    },
    [updateTab],
  )

  const pickSavePath = useCallback(
    async (options: { defaultFileName: string; acceptExtensions: string[]; title: string }) => {
      return showSystemOpenDialog({
        intent: 'save',
        title: options.title,
        defaultFileName: options.defaultFileName,
        acceptExtensions: options.acceptExtensions,
        initialPath: '/user/Downloads',
      })
    },
    [showSystemOpenDialog],
  )

  const saveCurrentPage = useCallback(async () => {
    const tab = tabsRef.current.find((entry) => entry.id === activeTabIdRef.current)
    if (!isViewerPage(tab) || savingRef.current) {
      return
    }
    const viewer = getViewerRef(tab!.id).current
    if (!viewer?.isReady()) {
      await modal.alert({ title: '无法另存网页', message: '网页尚未就绪' })
      return
    }
    const defaultName = `${sanitizePageFileBaseName(tab!.title || 'page')}.html`
    const dest = await pickSavePath({
      title: '另存网页',
      defaultFileName: defaultName,
      acceptExtensions: ['html', 'htm'],
    })
    if (!dest) {
      return
    }
    savingRef.current = true
    try {
      const serialized = parsePageSerializeResult(await viewer.evalInPage(CHROMO_SERIALIZE_PAGE_SCRIPT))
      const summary = await saveSerializedPageToPath(dest, serialized)
      const extra =
        summary.skipped > 0 || summary.failed > 0 ? `\n\n${formatSavePageSummary(summary)}` : ''
      if (extra) {
        await modal.alert({ title: '已另存网页', message: formatSavePageSummary(summary) })
      }
    } catch (error) {
      await modal.alert({
        title: '无法另存网页',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      savingRef.current = false
    }
  }, [getViewerRef, isViewerPage, modal, pickSavePath])

  const exportCurrentPagePdf = useCallback(async () => {
    const tab = tabsRef.current.find((entry) => entry.id === activeTabIdRef.current)
    if (!isViewerPage(tab) || savingRef.current) {
      return
    }
    const viewer = getViewerRef(tab!.id).current
    if (!viewer?.isReady()) {
      await modal.alert({ title: '无法导出 PDF', message: '网页尚未就绪' })
      return
    }
    const dest = await pickSavePath({
      title: '导出 PDF',
      defaultFileName: `${sanitizePageFileBaseName(tab!.title || 'page')}.pdf`,
      acceptExtensions: ['pdf'],
    })
    if (!dest) {
      return
    }
    savingRef.current = true
    try {
      const shot = await viewer.screenshot({ format: 'jpeg', quality: 0.85, fullPage: true })
      const pdf = base64JpegToPdf(shot.data, shot.width, shot.height)
      await writeUniqueFile(dest, pdf, 'application/pdf')
    } catch (error) {
      await modal.alert({
        title: '无法导出 PDF',
        message: `${error instanceof Error ? error.message : String(error)}\n\n这是整页截图 PDF，不能选文字。超长页可能因截图超时或尺寸限制失败。`,
      })
    } finally {
      savingRef.current = false
    }
  }, [getViewerRef, isViewerPage, modal, pickSavePath])

  const saveImageFromUrl = useCallback(
    async (imageUrl: string) => {
      if (savingRef.current) {
        return
      }
      const dest = await pickSavePath({
        title: '保存图片',
        defaultFileName: suggestedSaveNameFromUrl(imageUrl, 'image', 'png'),
        acceptExtensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'],
      })
      if (!dest) {
        return
      }
      savingRef.current = true
      try {
        const tab = tabsRef.current.find((entry) => entry.id === activeTabIdRef.current)
        const viewer = tab ? getViewerRef(tab.id).current : undefined
        await saveImageUrlToPath(dest, imageUrl, viewer?.isReady() ? (code) => viewer.evalInPage(code) : undefined)
      } catch (error) {
        await modal.alert({
          title: '无法保存图片',
          message: error instanceof Error ? error.message : String(error),
        })
      } finally {
        savingRef.current = false
      }
    },
    [getViewerRef, modal, pickSavePath],
  )

  const handlePageContextMenu = useCallback(
    (tabId: string, payload: ChromoContextMenuPayload) => {
      const viewer = getViewerRef(tabId).current
      const rect = viewer?.getFrameRect()
      const tab = tabsRef.current.find((entry) => entry.id === tabId)
      const zoom = tab?.zoom ?? 1
      const x = (rect?.left ?? 0) + payload.x * zoom
      const y = (rect?.top ?? 0) + payload.y * zoom
      ignoreViewerClickUntilRef.current = performance.now() + 700
      setMoreMenuOpen(false)
      setBookmarkContextMenu(undefined)
      setPageContextMenu({ x, y, tabId, payload })
    },
    [getViewerRef],
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
    async (tabId: string, options?: { full?: boolean }) => {
      const viewer = getViewerRef(tabId).current
      if (!viewer?.isReady()) {
        return
      }

      const tab = tabsRef.current.find((entry) => entry.id === tabId)
      if (!tab) {
        return
      }

      const full = !!options?.full

      try {
        let result = await viewer.readNetwork(
          full ? { limit: 100 } : { after: tab.lastNetworkId || undefined },
        )

        // Cursor may have jumped past local state while UI list is empty —
        // resync once without `after` so LOAD_TIMEOUT / rotated buffer recover.
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
      updateTab(tabId, (entry) => ({
        ...entry,
        networkEntries: [],
        // Reset cursor so the next pull can resync from bridge buffer (same as onNavigating).
        lastNetworkId: '',
        selectedNetworkId: '',
      }))
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

  const setTabDebugPanelEnabled = useCallback(
    (tabId: string, enabled: boolean) => {
      updateTab(tabId, (entry) => ({
        ...entry,
        debugPanelEnabled: enabled,
      }))
      getViewerRef(tabId).current?.setDebugPanelEnabled(enabled)
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
        hostId: parentWindowId,
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
        debugPanelEnabled: tab.debugPanelEnabled,
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
        onDebugPanelEnabledChange: (enabled) => setTabDebugPanelEnabled(tab.id, enabled),
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
    setTabDebugPanelEnabled,
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
          window.appId === 'page-devtools' &&
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
          window.appId === 'page-devtools' &&
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
        hostId: parentWindowId,
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
        debugPanelEnabled: tab.debugPanelEnabled,
        viewerReady: tab.ready,
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
        onDebugPanelEnabledChange: (enabled) => setTabDebugPanelEnabled(tabId, enabled),
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
      openApp('page-devtools', { documentId: key })
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
      setTabDebugPanelEnabled,
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

  const addressSuggestions = useMemo(() => {
    if (!addressFocused || !activeTab?.inputUrl.trim()) {
      return []
    }
    return searchChromoOmniboxSuggestions(activeTab.inputUrl)
  }, [activeTab?.inputUrl, addressFocused, bookmarksRevision, historyRevision])

  const showAddressSuggestions =
    addressFocused && Boolean(activeTab?.inputUrl.trim()) && addressSuggestions.length > 0

  const selectAddressSuggestion = useCallback(
    (url: string) => {
      navigateActive(url)
      setAddressFocused(false)
      setAddressSuggestionIndex(-1)
      omniboxInputRef.current?.blur()
    },
    [navigateActive],
  )

  useEffect(() => {
    setAddressSuggestionIndex(-1)
  }, [activeTab?.inputUrl])

  const handleAddressKeyDown = (event: KeyboardEvent) => {
    if (addressSuggestions.length === 0) {
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setAddressSuggestionIndex((index) => {
        const next = index + 1
        return next >= addressSuggestions.length ? addressSuggestions.length - 1 : next
      })
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setAddressSuggestionIndex((index) => (index <= 0 ? -1 : index - 1))
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setAddressSuggestionIndex(-1)
    }
  }

  const submitUrl = useCallback(
    (event: Event) => {
      event.preventDefault()
      if (!activeTab) {
        return
      }
      const form = event.currentTarget as HTMLFormElement
      const input = form.querySelector('input') as HTMLInputElement | null
      const selected = addressSuggestions[addressSuggestionIndex]
      if (selected) {
        selectAddressSuggestion(selected.url)
        return
      }
      const value = input?.value.trim() ?? activeTab.inputUrl.trim()
      if (!value) {
        return
      }
      navigateActive(value)
      input?.blur()
    },
    [activeTab, addressSuggestionIndex, addressSuggestions, navigateActive, selectAddressSuggestion],
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
    const active = tabsRef.current.find((tab) => tab.id === activeId)
    if (
      (requested && chromoUrlsMatch(requested, pendingUrl)) ||
      (active?.url && chromoUrlsMatch(active.url, pendingUrl))
    ) {
      lastOpenedUrlRef.current = pendingUrl
      return
    }

    lastOpenedUrlRef.current = pendingUrl
    if (activeId) {
      navigateTab(activeId, pendingUrl)
    }
  }, [pendingUrl, navigateTab])

  useEffect(() => {
    if (sessionBlankedRef.current) {
      return
    }
    const timer = window.setTimeout(() => {
      persistChromoWindowSession(tabs, activeTabId)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [activeTabId, tabs])

  useEffect(() => {
    return () => {
      if (sessionBlankedRef.current) {
        return
      }
      persistChromoWindowSession(
        sessionSnapshotRef.current.tabs,
        sessionSnapshotRef.current.activeTabId,
      )
    }
  }, [])

  useEffect(() => {
    setChromePinSource('chromo', chromoFullscreen)
    return () => setChromePinSource('chromo', false)
  }, [chromoFullscreen, setChromePinSource])

  const toolbarAutoHide = chromoFullscreen
  const toolbarVisible = !toolbarAutoHide || fullscreenToolbarRevealed
  const toolbarInteractionPinned =
    addressFocused ||
    showAddressSuggestions ||
    tabsOverflowOpen ||
    sidebarOpen ||
    bookmarksOverflowOpen ||
    moreMenuOpen ||
    bookmarkContextMenu !== undefined ||
    pageContextMenu !== undefined ||
    findOpen ||
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

  const addressValue = addressFocused
    ? activeTab?.inputUrl ?? ''
    : chromoTabInputUrl(activeTab?.url ?? '')
  const showProgress = Boolean(activeTab?.loading && !isChromoInternalUrl(activeTab.url))
  const activeInternalPage = activeTab ? parseChromoInternalPage(activeTab.url) : undefined
  const chromoFocused = Boolean(parentWindowId && activeWindowId === parentWindowId)
  const canUsePageChrome = isViewerPage(activeTab)
  const activeZoom = activeTab?.zoom ?? CHROMO_DEFAULT_ZOOM

  const moreMenuItems = useMemo((): AdaptiveActionMenuItem[] => {
    return [
      { type: 'action', label: '新建标签页', shortcut: '⌘T', onClick: () => addTab() },
      { type: 'separator' },
      {
        type: 'action',
        label: currentBookmarked ? '取消书签' : '为此页添加书签',
        shortcut: '⌘D',
        disabled: !canBookmarkPage,
        onClick: toggleBookmarkForCurrentPage,
      },
      {
        type: 'action',
        label: bookmarksBarVisible ? '隐藏书签栏' : '显示书签栏',
        shortcut: '⌘⇧B',
        onClick: toggleBookmarksBar,
      },
      { type: 'action', label: '书签管理器', onClick: () => openInternalPage('bookmarks') },
      {
        type: 'action',
        label: '历史记录',
        shortcut: '⌘Y',
        onClick: () => openInternalPage('history'),
      },
      { type: 'action', label: '设置', onClick: () => openInternalPage('settings') },
      { type: 'separator' },
      {
        type: 'action',
        label: '查找…',
        shortcut: '⌘F',
        disabled: !canUsePageChrome,
        onClick: openFind,
      },
      {
        type: 'action',
        label: '另存为…',
        shortcut: '⌘S',
        disabled: !canUsePageChrome,
        onClick: () => void saveCurrentPage(),
      },
      {
        type: 'action',
        label: '导出 PDF…',
        shortcut: '⌘P',
        disabled: !canUsePageChrome,
        onClick: () => void exportCurrentPagePdf(),
      },
      { type: 'separator' },
      {
        type: 'action',
        label: '复制页面地址',
        disabled: !activeTab?.url,
        onClick: copyCurrentPageUrl,
      },
      {
        type: 'action',
        label: '重新加载',
        shortcut: '⌘R',
        disabled: !activeTab,
        onClick: reload,
      },
      { type: 'separator' },
      {
        type: 'action',
        label: activeDevtoolsActive ? '关闭开发者工具' : '开发者工具',
        shortcut: '⌥⌘I',
        onClick: toggleDevTools,
      },
      {
        type: 'action',
        label: sidebarOpen ? '隐藏 AI 助手' : 'AI 助手',
        onClick: () => setSidebarOpen((open) => !open),
      },
    ]
  }, [
    activeDevtoolsActive,
    activeTab,
    addTab,
    bookmarksBarVisible,
    canBookmarkPage,
    canUsePageChrome,
    copyCurrentPageUrl,
    currentBookmarked,
    exportCurrentPagePdf,
    openFind,
    openInternalPage,
    reload,
    saveCurrentPage,
    sidebarOpen,
    toggleBookmarkForCurrentPage,
    toggleBookmarksBar,
    toggleDevTools,
  ])

  const bookmarkContextMenuItems = useMemo((): AdaptiveActionMenuItem[] => {
    if (!bookmarkContextMenu) {
      return []
    }
    const { bookmark } = bookmarkContextMenu
    return [
      {
        type: 'action',
        label: '打开',
        onClick: () => navigateActive(bookmark.url),
      },
      {
        type: 'action',
        label: '在新标签页中打开',
        onClick: () => addTab(bookmark.url),
      },
      { type: 'separator' },
      {
        type: 'action',
        label: '删除',
        onClick: () => {
          removeChromoBookmark(bookmark.url)
          bumpBookmarksRevision()
        },
      },
    ]
  }, [addTab, bookmarkContextMenu, bumpBookmarksRevision, navigateActive])

  const pageContextMenuItems = useMemo((): AdaptiveActionMenuItem[] => {
    if (!pageContextMenu) {
      return []
    }
    const { payload } = pageContextMenu
    const items: AdaptiveActionMenuItem[] = []
    if (payload.selection) {
      items.push({
        type: 'action',
        label: '复制',
        onClick: () => void navigator.clipboard?.writeText(payload.selection!),
      })
    }
    if (payload.linkUrl) {
      items.push(
        {
          type: 'action',
          label: '在新标签页中打开',
          onClick: () => addTab(payload.linkUrl),
        },
        {
          type: 'action',
          label: '在后台新标签页中打开',
          onClick: () => addTab(payload.linkUrl, { activate: false }),
        },
        {
          type: 'action',
          label: '复制链接',
          onClick: () => void navigator.clipboard?.writeText(payload.linkUrl!),
        },
      )
    }
    if (payload.imageUrl) {
      if (items.length > 0) {
        items.push({ type: 'separator' })
      }
      items.push(
        {
          type: 'action',
          label: '在新标签页中打开图片',
          onClick: () => addTab(payload.imageUrl),
        },
        {
          type: 'action',
          label: '保存图片…',
          onClick: () => void saveImageFromUrl(payload.imageUrl!),
        },
        {
          type: 'action',
          label: '复制图片地址',
          onClick: () => void navigator.clipboard?.writeText(payload.imageUrl!),
        },
      )
    }
    if (items.length > 0) {
      items.push({ type: 'separator' })
    }
    items.push(
      {
        type: 'action',
        label: '后退',
        disabled: !activeTab?.canGoBack,
        onClick: goBack,
      },
      {
        type: 'action',
        label: '前进',
        disabled: !activeTab?.canGoForward,
        onClick: goForward,
      },
      {
        type: 'action',
        label: '重新加载',
        onClick: reload,
      },
      { type: 'separator' },
      {
        type: 'action',
        label: '另存为…',
        disabled: !canUsePageChrome,
        onClick: () => void saveCurrentPage(),
      },
      {
        type: 'action',
        label: '导出 PDF…',
        disabled: !canUsePageChrome,
        onClick: () => void exportCurrentPagePdf(),
      },
      {
        type: 'action',
        label: '查找…',
        disabled: !canUsePageChrome,
        onClick: openFind,
      },
      {
        type: 'action',
        label: '复制页面地址',
        disabled: !activeTab?.url,
        onClick: copyCurrentPageUrl,
      },
      {
        type: 'action',
        label: currentBookmarked ? '取消书签' : '添加书签',
        disabled: !canBookmarkPage,
        onClick: toggleBookmarkForCurrentPage,
      },
    )
    return items
  }, [
    activeTab?.canGoBack,
    activeTab?.canGoForward,
    activeTab?.url,
    addTab,
    canBookmarkPage,
    canUsePageChrome,
    copyCurrentPageUrl,
    currentBookmarked,
    exportCurrentPagePdf,
    goBack,
    goForward,
    openFind,
    pageContextMenu,
    reload,
    saveCurrentPage,
    saveImageFromUrl,
    toggleBookmarkForCurrentPage,
  ])

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindowEntry = windows.find((window) => window.appId === 'chromo' && !window.minimized)

    return [
      {
        label: '文件',
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
            shortcut: '⌘W',
            disabled: !activeTab,
            onClick: () => activeTab && closeTab(activeTab.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '另存为…',
            shortcut: '⌘S',
            disabled: !canUsePageChrome,
            onClick: () => void saveCurrentPage(),
          },
          {
            type: 'action',
            label: '导出 PDF…',
            shortcut: '⌘P',
            disabled: !canUsePageChrome,
            onClick: () => void exportCurrentPagePdf(),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '关闭窗口',
            onClick: () => appWindowEntry && closeWindowsForApp('chromo'),
          },
        ],
      },
      {
        label: '书签',
        items: [
          {
            type: 'action',
            label: currentBookmarked ? '取消书签' : '添加书签',
            shortcut: '⌘D',
            disabled: !canBookmarkPage,
            onClick: toggleBookmarkForCurrentPage,
          },
          {
            type: 'action',
            label: bookmarksBarVisible ? '隐藏书签栏' : '显示书签栏',
            shortcut: '⌘⇧B',
            onClick: toggleBookmarksBar,
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '书签管理器',
            onClick: () => openInternalPage('bookmarks'),
          },
        ],
      },
      {
        label: '历史记录',
        items: [
          {
            type: 'action',
            label: '显示历史记录',
            shortcut: '⌘Y',
            onClick: () => openInternalPage('history'),
          },
          {
            type: 'action',
            label: '后退',
            shortcut: '⌘[',
            disabled: !activeTab?.canGoBack,
            onClick: goBack,
          },
          {
            type: 'action',
            label: '前进',
            shortcut: '⌘]',
            disabled: !activeTab?.canGoForward,
            onClick: goForward,
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '清空历史记录…',
            onClick: clearBrowsingHistory,
          },
        ],
      },
      {
        label: '查看',
        items: [
          {
            type: 'action',
            label: '重新加载',
            shortcut: '⌘R',
            disabled: !activeTab || showProgress,
            onClick: reload,
          },
          {
            type: 'action',
            label: '停止',
            disabled: !showProgress,
            onClick: stopLoading,
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '查找…',
            shortcut: '⌘F',
            disabled: !canUsePageChrome,
            onClick: openFind,
          },
          {
            type: 'action',
            label: '放大',
            shortcut: '⌘+',
            disabled: !canUsePageChrome,
            onClick: () => changeZoom(1),
          },
          {
            type: 'action',
            label: '缩小',
            shortcut: '⌘-',
            disabled: !canUsePageChrome,
            onClick: () => changeZoom(-1),
          },
          {
            type: 'action',
            label: '实际大小',
            shortcut: '⌘0',
            disabled: !canUsePageChrome || activeZoom === CHROMO_DEFAULT_ZOOM,
            onClick: () => changeZoom(0),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: activeDevtoolsActive ? '关闭开发者工具' : '开发者工具',
            shortcut: '⌥⌘I',
            onClick: toggleDevTools,
          },
          {
            type: 'action',
            label: sidebarOpen ? '隐藏 AI 助手' : 'AI 助手',
            onClick: () => setSidebarOpen((open) => !open),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '设置',
            onClick: () => openInternalPage('settings'),
          },
        ],
      },
    ]
  }, [
    activeDevtoolsActive,
    activeTab,
    activeZoom,
    addTab,
    bookmarksBarVisible,
    canBookmarkPage,
    canUsePageChrome,
    changeZoom,
    closeTab,
    closeWindowsForApp,
    clearBrowsingHistory,
    currentBookmarked,
    exportCurrentPagePdf,
    goBack,
    goForward,
    openFind,
    openInternalPage,
    reload,
    saveCurrentPage,
    showProgress,
    sidebarOpen,
    stopLoading,
    toggleBookmarkForCurrentPage,
    toggleBookmarksBar,
    toggleDevTools,
    windows,
  ])

  useAppMenuBar('chromo', menuBar)

  useEffect(() => {
    if (!chromoFocused) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) {
        return
      }
      const inFindBar =
        event.target instanceof Element && Boolean(event.target.closest('.chromo-findbar'))
      if (event.key === 'Escape') {
        if (pageContextMenu) {
          setPageContextMenu(undefined)
          event.preventDefault()
          return
        }
        if (findOpen) {
          closeFind()
          event.preventDefault()
        }
        return
      }
      const meta = event.metaKey || event.ctrlKey
      if (!meta) {
        return
      }
      const key = event.key.toLowerCase()
      if (key === 'f' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        openFind()
        return
      }
      if (key === 'g' && !event.altKey) {
        event.preventDefault()
        if (!findOpen) {
          openFind()
        }
        void stepFind(event.shiftKey ? 'prev' : 'next')
        return
      }
      if (inFindBar && (key === 'l' || key === 'k')) {
        event.preventDefault()
        return
      }
      if (key === 's' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        void saveCurrentPage()
        return
      }
      if (key === 'p' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        void exportCurrentPagePdf()
        return
      }
      if ((key === '=' || key === '+') && !event.altKey) {
        event.preventDefault()
        changeZoom(1)
        return
      }
      if (key === '-' && !event.altKey) {
        event.preventDefault()
        changeZoom(-1)
        return
      }
      if (key === '0' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        changeZoom(0)
        return
      }
      if (key === 't' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        addTab()
        return
      }
      if (key === 'w' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        if (activeTab) {
          closeTab(activeTab.id)
        }
        return
      }
      if (key === 'r' && !event.altKey) {
        event.preventDefault()
        reload()
        return
      }
      if (key === 'l' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        focusOmnibox()
        return
      }
      if (key === 'd' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        toggleBookmarkForCurrentPage()
        return
      }
      if (key === 'y' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        openInternalPage('history')
        return
      }
      if (key === '[' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        goBack()
        return
      }
      if (key === ']' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        goForward()
        return
      }
      if (key === 'b' && event.shiftKey && !event.altKey) {
        event.preventDefault()
        toggleBookmarksBar()
        return
      }
      if (key === 'i' && event.altKey && !event.shiftKey) {
        event.preventDefault()
        toggleDevTools()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    activeTab,
    addTab,
    changeZoom,
    chromoFocused,
    closeFind,
    closeTab,
    exportCurrentPagePdf,
    findOpen,
    focusOmnibox,
    goBack,
    goForward,
    openFind,
    openInternalPage,
    pageContextMenu,
    reload,
    saveCurrentPage,
    stepFind,
    toggleBookmarkForCurrentPage,
    toggleBookmarksBar,
    toggleDevTools,
  ])

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
                {showProgress || !activeTab?.url || isChromoInternalUrl(activeTab.url) ? undefined : <LockIcon />}
              </span>
              <input
                ref={omniboxInputRef}
                type="text"
                class="chromo__omnibox-input"
                value={addressValue}
                placeholder="搜索或输入网址"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={showAddressSuggestions}
                aria-controls={showAddressSuggestions ? 'chromo-omnibox-suggestions' : undefined}
                aria-activedescendant={
                  addressSuggestionIndex >= 0
                    ? `chromo-omnibox-suggestion-${addressSuggestionIndex}`
                    : undefined
                }
                onKeyDown={handleAddressKeyDown}
                onFocus={() => {
                  setAddressFocused(true)
                  if (activeTab) {
                    updateTab(activeTab.id, (tab) => ({
                      ...tab,
                      inputUrl: chromoTabInputUrl(tab.url),
                    }))
                  }
                }}
                onBlur={() => {
                  setAddressFocused(false)
                  if (activeTab) {
                    updateTab(activeTab.id, (tab) => ({
                      ...tab,
                      inputUrl: chromoTabInputUrl(tab.url),
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
              <button
                type="button"
                class={[
                  'chromo__omnibox-star',
                  currentBookmarked ? 'chromo__omnibox-star--active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={!canBookmarkPage}
                onClick={toggleBookmarkForCurrentPage}
                aria-label={currentBookmarked ? '取消书签' : '添加书签'}
                aria-pressed={currentBookmarked}
                title={currentBookmarked ? '取消书签' : '添加书签'}
              >
                <ChromoStarIcon filled={currentBookmarked} />
              </button>
            </div>
            {showAddressSuggestions ? (
              <ChromoOmniboxSuggestionsList
                suggestions={addressSuggestions}
                activeIndex={addressSuggestionIndex}
                onSelect={selectAddressSuggestion}
                onHover={setAddressSuggestionIndex}
              />
            ) : null}
          </form>

          <div class="chromo__actions">
            {canUsePageChrome && Math.abs(activeZoom - CHROMO_DEFAULT_ZOOM) >= 0.001 ? (
              <button
                type="button"
                class="chromo__btn chromo__zoom-indicator"
                onClick={() => changeZoom(0)}
                title="恢复实际大小"
                aria-label={`缩放 ${formatChromoZoom(activeZoom)}，点击恢复实际大小`}
              >
                {formatChromoZoom(activeZoom)}
              </button>
            ) : null}
            <button
              type="button"
              class={['chromo__btn', sidebarOpen ? 'chromo__btn--active' : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => setSidebarOpen((open) => !open)}
              aria-label="AI 助手"
              aria-pressed={sidebarOpen}
              title="AI 助手"
            >
              <ChromoSparkleIcon />
            </button>
            <button
              ref={moreButtonRef}
              type="button"
              class={['chromo__btn', moreMenuOpen ? 'chromo__btn--active' : '']
                .filter(Boolean)
                .join(' ')}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={openMoreMenu}
              aria-label="自定义及控制 Chromo"
              aria-haspopup="menu"
              aria-expanded={moreMenuOpen}
              title="自定义及控制 Chromo"
            >
              <ChromoMoreIcon />
            </button>
          </div>
        </div>

        {bookmarksBarVisible ? (
          <ChromoBookmarksBar
            revision={bookmarksRevision}
            overflowOpen={bookmarksOverflowOpen}
            onToggleOverflow={() => {
              setBookmarksOverflowOpen((open) => !open)
              setMoreMenuOpen(false)
            }}
            onNavigate={(url) => {
              setBookmarksOverflowOpen(false)
              navigateActive(url)
            }}
            onContextMenu={setBookmarkContextMenu}
          />
        ) : null}
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
              {findOpen && canUsePageChrome ? (
                <ChromoPageFindBar
                  query={findQuery}
                  count={findCount}
                  index={findIndex}
                  busy={findBusy}
                  error={findError}
                  focusEpoch={findFocusEpoch}
                  onQueryChange={scheduleFindSearch}
                  onNext={() => void stepFind('next')}
                  onPrev={() => void stepFind('prev')}
                  onClose={closeFind}
                />
              ) : null}
              {activeTab?.pageFault && (
                <ChromoPageFaultView
                  fault={activeTab.pageFault}
                  variant="viewport"
                  onRetry={reload}
                />
              )}
              {activeTab && !activeTab.url && !activeTab.pageFault ? (
                <ChromoNewTabPage
                  bookmarksRevision={bookmarksRevision}
                  historyRevision={historyRevision}
                  onNavigate={navigateActive}
                />
              ) : null}
              {activeInternalPage === 'history' ? (
                <ChromoHistoryPage
                  revision={historyRevision}
                  onNavigate={navigateActive}
                  onHistoryChange={bumpHistoryRevision}
                />
              ) : null}
              {activeInternalPage === 'bookmarks' ? (
                <ChromoBookmarksPage
                  revision={bookmarksRevision}
                  onNavigate={navigateActive}
                  onDelete={(url) => {
                    removeChromoBookmark(url)
                    bumpBookmarksRevision()
                  }}
                  onContextMenu={setBookmarkContextMenu}
                />
              ) : null}
              {activeInternalPage === 'settings' ? (
                <ChromoSettingsPage
                  bookmarksBarVisible={bookmarksBarVisible}
                  onToggleBookmarksBar={toggleBookmarksBar}
                  onClearHistory={clearBrowsingHistory}
                />
              ) : null}
              {tabs
                .filter((tab) => !isChromoInternalUrl(tab.url))
                .map((tab) => (
                <ChromoViewerFrame
              key={tab.id}
              devtoolsId={tab.devtoolsId}
              initialUrl={tab.url || undefined}
              disableNetworkCache={tab.disableNetworkCache}
              ref={getViewerRef(tab.id)}
              active={
                tab.id === activeTabId && Boolean(tab.url) && !isChromoInternalUrl(tab.url)
              }
              zoom={tab.zoom}
              onReady={() => {
                updateTab(tab.id, (entry) => ({
                  ...entry,
                  ready: true,
                  bootstrapped: entry.url ? true : entry.bootstrapped,
                }))
                injectPageChrome(tab.id)
                const current = tabsRef.current.find((entry) => entry.id === tab.id)
                // Re-apply after viewer remount / VC_READY (bridge state resets).
                if (current?.debugPanelEnabled) {
                  getViewerRef(tab.id).current?.setDebugPanelEnabled(true)
                }
                const recoverUrl = pendingRecoverNavigateRef.current[tab.id]
                if (recoverUrl) {
                  delete pendingRecoverNavigateRef.current[tab.id]
                  if (!isChromoInternalUrl(recoverUrl)) {
                    getViewerRef(tab.id).current?.navigate(recoverUrl)
                  }
                  return
                }
                if (current?.url) {
                  if (!isChromoInternalUrl(current.url)) {
                    getViewerRef(tab.id).current?.navigate(current.url)
                  }
                  return
                }
                ensureInitialTabLoad(tab.id)
              }}
              onNavigating={() => {
                if (shouldIgnoreViewerEvent(tab.id)) {
                  return
                }
                setPageContextMenu(undefined)
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
                if (shouldIgnoreViewerEvent(tab.id)) {
                  return
                }
                updateTab(tab.id, (entry) => ({ ...entry, loading }))
              }}
              onNavigated={({ url, title, canGoBack, canGoForward }) => {
                if (shouldIgnoreViewerEvent(tab.id)) {
                  return
                }
                // Worker /blank.html start page: keep new-tab chrome (empty omnibox).
                if (!url) {
                  updateTab(tab.id, (entry) => ({
                    ...entry,
                    url: '',
                    title: title || '新标签页',
                    inputUrl: '',
                    loading: false,
                    canGoBack: false,
                    canGoForward: false,
                    pageFault: undefined,
                    bootstrapped: true,
                  }))
                  return
                }
                const requested = requestedUrlByTabRef.current[tab.id]
                if (
                  requested &&
                  !chromoUrlsMatch(requested, url) &&
                  chromoUrlsMatch(url, CHROMO_DEFAULT_NEW_TAB_URL)
                ) {
                  return
                }
                requestedUrlByTabRef.current[tab.id] = url
                const nextTitle = title || pageTitleFromUrl(url)
                updateTab(tab.id, (entry) => ({
                  ...entry,
                  url,
                  title: nextTitle,
                  inputUrl: displayUrl(url),
                  loading: false,
                  canGoBack,
                  canGoForward,
                  pageFault: undefined,
                }))
                recordVisit(url, nextTitle)
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
                  injectPageChrome(tab.id)
                  if (findOpen && tab.id === activeTabIdRef.current && findQuery) {
                    void runFindSearch(findQuery, tab.id)
                  }
                }, 300)
              }}
              onLoadFailed={(payload) => {
                if (shouldIgnoreViewerEvent(tab.id)) {
                  return
                }
                const { url, message, code, networkCount, latestNetworkId } = payload
                updateTab(tab.id, (entry) => {
                  if (
                    typeof networkCount === 'number' &&
                    networkCount > 0 &&
                    entry.networkEntries.length === 0
                  ) {
                    console.warn(
                      '[chromo network] load failed with bridge networkCount=%s latestId=%s but UI list empty; pulling full',
                      networkCount,
                      latestNetworkId ?? '',
                    )
                  }
                  return {
                    ...entry,
                    loading: false,
                    pageFault: pageFaultFromLoadFailed({ url, message, code }),
                  }
                })
                // Success path pulls after onNavigated; failure must resync explicitly.
                void pullNetworkDelta(tab.id, { full: true })
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
                if (shouldIgnoreViewerEvent(tab.id)) {
                  return
                }
                const fault = pageFaultFromError(payload)
                if (!fault) {
                  return
                }
                // Blank / new tab: viewer silently recovers VERSION_MISMATCH; ignore stray
                // reports while the tab still has no real page URL.
                if (fault.code === 'VERSION_MISMATCH') {
                  const entry = tabsRef.current.find((item) => item.id === tab.id)
                  if (!entry?.url) {
                    return
                  }
                }
                updateTab(tab.id, (entry) => ({
                  ...entry,
                  loading: false,
                  pageFault: fault,
                }))
              }}
              onLocation={({ url, method, httpMethod, formBody, formFiles, formEnctype, target }) => {
                if (shouldIgnoreViewerEvent(tab.id)) {
                  return
                }
                if (performance.now() < ignoreViewerClickUntilRef.current) {
                  return
                }
                const intent = resolveNavIntent(
                  { kind: 'LOCATION', method, url, target, httpMethod },
                  { currentUrl: tab.url },
                )
                if (shouldCreateTab(intent) && intent.action === 'newTab') {
                  addTab(intent.url)
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
                if (shouldNavigateSameTab(intent) && intent.action === 'sameTab') {
                  navigateTab(tab.id, intent.url)
                  return
                }
                if (intent.action === 'ignore') {
                  return
                }
                navigateTab(tab.id, url)
              }}
                onHistory={({ url, title }) => {
                if (shouldIgnoreViewerEvent(tab.id)) {
                  return
                }
                cancelClickNavigate(tab.id)
                requestedUrlByTabRef.current[tab.id] = url
                const nextTitle = title || pageTitleFromUrl(url)
                updateTab(tab.id, (entry) => ({
                  ...entry,
                  url,
                  title: nextTitle,
                  inputUrl: displayUrl(url),
                  loading: false,
                  pageFault: undefined,
                }))
                if (url) {
                  recordVisit(url, nextTitle)
                }
                if (tab.id === activeTabIdRef.current) {
                  lastOpenedUrlRef.current = url
                  setAppWindowUrl('chromo', url)
                }
              }}
              onClick={({ href, target }) => {
                if (shouldIgnoreViewerEvent(tab.id)) {
                  return
                }
                if (performance.now() < ignoreViewerClickUntilRef.current) {
                  return
                }
                setPageContextMenu(undefined)
                const intent = resolveNavIntent(
                  { kind: 'CLICK', href, target, url: href },
                  { currentUrl: tab.url },
                )
                if (shouldCreateTab(intent) && intent.action === 'newTab') {
                  addTab(intent.url)
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
              onContextMenu={(payload) => {
                if (shouldIgnoreViewerEvent(tab.id)) {
                  return
                }
                handlePageContextMenu(tab.id, payload)
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
                debugPanelEnabled={activeTab.debugPanelEnabled}
                onDebugPanelEnabledChange={(enabled) =>
                  setTabDebugPanelEnabled(activeTab.id, enabled)
                }
                viewerReady={activeTab.ready}
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

      <AdaptiveActionMenu
        open={moreMenuOpen}
        title="Chromo"
        items={moreMenuItems}
        narrowLayout={narrowLayout}
        anchor={moreMenuAnchor}
        mount="portal"
        onClose={closeMoreMenu}
      />

      <AdaptiveActionMenu
        open={bookmarkContextMenu !== undefined}
        title={bookmarkContextMenu?.bookmark.title || '书签'}
        items={bookmarkContextMenuItems}
        narrowLayout={narrowLayout}
        anchor={
          bookmarkContextMenu
            ? { x: bookmarkContextMenu.x, y: bookmarkContextMenu.y }
            : undefined
        }
        mount="portal"
        dismissAfterPointerUp
        onClose={() => setBookmarkContextMenu(undefined)}
      />

      <AdaptiveActionMenu
        open={pageContextMenu !== undefined}
        title="Chromo"
        items={pageContextMenuItems}
        narrowLayout={narrowLayout}
        anchor={pageContextMenu ? { x: pageContextMenu.x, y: pageContextMenu.y } : undefined}
        mount="portal"
        dismissAfterPointerUp
        onClose={() => setPageContextMenu(undefined)}
      />

      {saveDialog}
    </div>
  )
}
