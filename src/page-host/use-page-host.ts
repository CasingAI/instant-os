import { createRef } from 'preact'
import { useCallback, useRef, useState } from 'preact/hooks'
import type { RefObject } from 'preact'
import type {
  ChromoClickPayload,
  ChromoLocationPayload,
  ChromoNavigateOptions,
  ChromoScreenshotOptions,
  ChromoScreenshotResult,
} from './page-bridge.ts'
import {
  formatPageFault,
  pageFaultFromError,
  pageFaultFromLoadFailed,
  type ChromoPageFault,
} from './page-fault.ts'
import {
  resolveNavIntent,
  shouldCreateTab,
  shouldNavigateSameTab,
} from './page-nav.ts'
import type { PageDevToolsDockSide, PageDevToolsPanelTab, PageTab } from './page-tab-types.ts'
import { displayPageUrl, isSameDocumentHashLink, normalizePageUrl, pageTitleFromUrl } from './page-url.ts'
import type { PageViewerHandle } from './page-viewer-frame.tsx'

export type UsePageHostOptions = {
  hostId: string
  /** When true (Chromo), newly opened tabs become UI-active. WebView should pass false. */
  defaultActivateNewTab?: boolean
  /** Initial URL for the first tab (empty = blank). */
  initialUrl?: string
  defaultDockSide?: PageDevToolsDockSide
  tabIdPrefix?: string
}

export type PageHostApi = {
  hostId: string
  tabs: PageTab[]
  /** UI-displayed tab id (address bar / viewport). Not an API "active tab". */
  displayedTabId: string
  setDisplayedTabId: (tabId: string) => void
  displayedTab: PageTab | undefined
  getViewerRef: (tabId: string) => RefObject<PageViewerHandle>
  updateTab: (tabId: string, updater: (tab: PageTab) => PageTab) => void
  addTab: (url?: string, options?: { activate?: boolean }) => string
  closeTab: (tabId: string) => void
  navigateTab: (tabId: string, url: string, options?: ChromoNavigateOptions) => void
  evalInTab: (tabId: string, code: string) => Promise<unknown>
  screenshotTab: (tabId: string, options?: ChromoScreenshotOptions) => Promise<ChromoScreenshotResult>
  requireLiveTab: (tabId: string) => PageTab
  handleLocation: (tabId: string, payload: ChromoLocationPayload) => void
  handleClick: (tabId: string, payload: ChromoClickPayload) => void
  handleNavigated: (
    tabId: string,
    payload: { url: string; title: string; canGoBack: boolean; canGoForward: boolean },
  ) => void
  handleLoading: (tabId: string, loading: boolean, url?: string) => void
  handleLoadFailed: (tabId: string, payload: { url: string; message?: string; code?: string }) => void
  handleError: (tabId: string, payload: { message: string; code?: string; bridgeBuild?: string; swBuild?: string }) => void
  handleHistory: (tabId: string, payload: { url: string; title?: string }) => void
  reloadTab: (tabId: string) => void
  stopTab: (tabId: string) => void
  tabsRef: { current: PageTab[] }
  displayedTabIdRef: { current: string }
  requestedUrlByTabRef: { current: Record<string, string> }
}

let nextPageTabSeq = 1

function createPageTab(
  initialUrl: string,
  options: { prefix: string; dockSide: PageDevToolsDockSide },
): PageTab {
  const id = `${options.prefix}${nextPageTabSeq++}`
  const url = initialUrl ? normalizePageUrl(initialUrl) : ''
  return {
    id,
    devtoolsId: crypto.randomUUID(),
    url,
    title: url ? pageTitleFromUrl(url) : '新标签页',
    inputUrl: url ? displayPageUrl(url) : '',
    pendingUrl: url || undefined,
    loading: Boolean(url),
    canGoBack: false,
    canGoForward: false,
    ready: false,
    bootstrapped: Boolean(url),
    consoleEntries: [],
    networkEntries: [],
    lastConsoleId: '',
    lastNetworkId: '',
    selectedNetworkId: '',
    disableNetworkCache: false,
    preserveConsole: false,
    devtoolsOpen: false,
    devtoolsTab: 'console' as PageDevToolsPanelTab,
    devtoolsDockSide: options.dockSide,
    devtoolsUndocked: false,
  }
}

/**
 * Shared page-host tab / navigation / fault state for Chromo and WebView.
 */
export function usePageHost(options: UsePageHostOptions): PageHostApi {
  const {
    hostId,
    defaultActivateNewTab = true,
    initialUrl = '',
    defaultDockSide = 'bottom',
    tabIdPrefix = 'page-tab-',
  } = options

  const [tabs, setTabs] = useState<PageTab[]>(() => [
    createPageTab(initialUrl, { prefix: tabIdPrefix, dockSide: defaultDockSide }),
  ])
  const [displayedTabId, setDisplayedTabId] = useState(() => tabs[0]?.id ?? '')

  const viewerRefs = useRef<Record<string, RefObject<PageViewerHandle>>>({})
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const displayedTabIdRef = useRef(displayedTabId)
  displayedTabIdRef.current = displayedTabId
  const requestedUrlByTabRef = useRef<Record<string, string>>({})
  const clickNavigateTimersRef = useRef<Record<string, number>>({})

  const displayedTab = tabs.find((tab) => tab.id === displayedTabId) ?? tabs[0]

  const getViewerRef = useCallback((tabId: string): RefObject<PageViewerHandle> => {
    if (!viewerRefs.current[tabId]) {
      viewerRefs.current[tabId] = createRef<PageViewerHandle>()
    }
    return viewerRefs.current[tabId]
  }, [])

  const updateTab = useCallback((tabId: string, updater: (tab: PageTab) => PageTab) => {
    setTabs((current) => current.map((tab) => (tab.id === tabId ? updater(tab) : tab)))
  }, [])

  const cancelClickNavigate = useCallback((tabId: string) => {
    const timer = clickNavigateTimersRef.current[tabId]
    if (timer) {
      window.clearTimeout(timer)
      delete clickNavigateTimersRef.current[tabId]
    }
  }, [])

  const requireLiveTab = useCallback(
    (tabId: string): PageTab => {
      const tab = tabsRef.current.find((entry) => entry.id === tabId)
      if (!tab) {
        throw new Error(`标签页不存在: ${tabId}`)
      }
      if (tab.pageFault) {
        throw new Error(formatPageFault(tab.pageFault) || tab.pageFault.message)
      }
      return tab
    },
    [],
  )

  const navigateTab = useCallback(
    (tabId: string, url: string, navOptions?: ChromoNavigateOptions) => {
      const normalized = normalizePageUrl(url)
      requestedUrlByTabRef.current[tabId] = normalized
      updateTab(tabId, (tab) => ({
        ...tab,
        url: normalized,
        pendingUrl: normalized,
        title: pageTitleFromUrl(normalized),
        inputUrl: displayPageUrl(normalized),
        loading: true,
        pageFault: undefined,
        bootstrapped: true,
      }))
      getViewerRef(tabId).current?.navigate(normalized, navOptions)
    },
    [getViewerRef, updateTab],
  )

  const addTab = useCallback(
    (url = '', addOptions?: { activate?: boolean }) => {
      const tab = createPageTab(url, { prefix: tabIdPrefix, dockSide: defaultDockSide })
      if (tab.url) {
        requestedUrlByTabRef.current[tab.id] = tab.url
      }
      setTabs((current) => [...current, tab])
      const activate = addOptions?.activate ?? defaultActivateNewTab
      if (activate) {
        setDisplayedTabId(tab.id)
      }
      return tab.id
    },
    [defaultActivateNewTab, defaultDockSide, tabIdPrefix],
  )

  const closeTab = useCallback(
    (tabId: string) => {
      cancelClickNavigate(tabId)
      setTabs((current) => {
        if (current.length <= 1) {
          const replacement = createPageTab('', { prefix: tabIdPrefix, dockSide: defaultDockSide })
          setDisplayedTabId(replacement.id)
          delete viewerRefs.current[tabId]
          return [replacement]
        }
        const index = current.findIndex((tab) => tab.id === tabId)
        if (index === -1) {
          return current
        }
        const next = current.filter((tab) => tab.id !== tabId)
        delete viewerRefs.current[tabId]
        if (displayedTabIdRef.current === tabId) {
          const fallback = next[Math.max(0, index - 1)] ?? next[0]
          if (fallback) {
            setDisplayedTabId(fallback.id)
          }
        }
        return next
      })
    },
    [cancelClickNavigate, defaultDockSide, tabIdPrefix],
  )

  const evalInTab = useCallback(
    async (tabId: string, code: string): Promise<unknown> => {
      requireLiveTab(tabId)
      const viewer = getViewerRef(tabId).current
      if (!viewer?.isReady()) {
        throw new Error('网页尚未就绪')
      }
      return viewer.evalInPage(code)
    },
    [getViewerRef, requireLiveTab],
  )

  const screenshotTab = useCallback(
    async (tabId: string, shotOptions?: ChromoScreenshotOptions): Promise<ChromoScreenshotResult> => {
      requireLiveTab(tabId)
      const viewer = getViewerRef(tabId).current
      if (!viewer?.isReady()) {
        throw new Error('网页尚未就绪')
      }
      return viewer.screenshot(shotOptions)
    },
    [getViewerRef, requireLiveTab],
  )

  const handleLocation = useCallback(
    (tabId: string, payload: ChromoLocationPayload) => {
      const tab = tabsRef.current.find((entry) => entry.id === tabId)
      const intent = resolveNavIntent(
        {
          kind: 'LOCATION',
          method: payload.method,
          url: payload.url,
          target: payload.target,
          httpMethod: payload.httpMethod,
        },
        { currentUrl: tab?.url },
      )

      if (shouldCreateTab(intent) && intent.action === 'newTab') {
        addTab(intent.url, { activate: defaultActivateNewTab })
        return
      }

      if (payload.method === 'submit' && payload.httpMethod === 'post') {
        if (
          payload.formFiles ||
          (payload.formEnctype && payload.formEnctype !== 'application/x-www-form-urlencoded')
        ) {
          updateTab(tabId, (entry) => ({
            ...entry,
            loading: false,
            pageFault: {
              severity: 'load',
              code: 'POST_FORM_UNSUPPORTED',
              message:
                '当前不支持带文件上传或非 urlencoded 的 POST 表单。请改用 GET 表单或 fetch API。',
              url: payload.url,
            },
          }))
          return
        }
        if (!payload.formBody) {
          updateTab(tabId, (entry) => ({
            ...entry,
            loading: false,
            pageFault: {
              severity: 'load',
              code: 'POST_FORM_UNSUPPORTED',
              message: 'POST 表单缺少可提交的字段数据。',
              url: payload.url,
            },
          }))
          return
        }
        navigateTab(tabId, payload.url, { method: 'POST', body: payload.formBody })
        return
      }

      if (shouldNavigateSameTab(intent) && intent.action === 'sameTab') {
        navigateTab(tabId, intent.url)
      }
    },
    [addTab, defaultActivateNewTab, navigateTab, updateTab],
  )

  const handleClick = useCallback(
    (tabId: string, payload: ChromoClickPayload) => {
      const tab = tabsRef.current.find((entry) => entry.id === tabId)
      const intent = resolveNavIntent(
        {
          kind: 'CLICK',
          href: payload.href,
          target: payload.target,
          url: payload.href,
        },
        { currentUrl: tab?.url },
      )

      if (shouldCreateTab(intent) && intent.action === 'newTab') {
        addTab(intent.url, { activate: defaultActivateNewTab })
        return
      }

      const href = payload.href
      if (!href || href === '#' || href.startsWith('javascript:')) {
        return
      }
      if (tab?.url && isSameDocumentHashLink(href, tab.url)) {
        return
      }
      cancelClickNavigate(tabId)
      clickNavigateTimersRef.current[tabId] = window.setTimeout(() => {
        delete clickNavigateTimersRef.current[tabId]
        navigateTab(tabId, href)
      }, 150)
    },
    [addTab, cancelClickNavigate, defaultActivateNewTab, navigateTab],
  )

  const handleNavigated = useCallback(
    (
      tabId: string,
      payload: { url: string; title: string; canGoBack: boolean; canGoForward: boolean },
    ) => {
      cancelClickNavigate(tabId)
      updateTab(tabId, (entry) => ({
        ...entry,
        url: payload.url,
        pendingUrl: undefined,
        title: payload.title || pageTitleFromUrl(payload.url),
        inputUrl: displayPageUrl(payload.url),
        loading: false,
        canGoBack: payload.canGoBack,
        canGoForward: payload.canGoForward,
        pageFault: undefined,
      }))
    },
    [cancelClickNavigate, updateTab],
  )

  const handleLoading = useCallback(
    (tabId: string, loading: boolean, url?: string) => {
      updateTab(tabId, (entry) => ({
        ...entry,
        loading,
        pendingUrl: loading ? url || entry.pendingUrl || entry.url : undefined,
      }))
    },
    [updateTab],
  )

  const handleLoadFailed = useCallback(
    (tabId: string, payload: { url: string; message?: string; code?: string }) => {
      const fault = pageFaultFromLoadFailed(payload)
      updateTab(tabId, (entry) => ({
        ...entry,
        loading: false,
        pendingUrl: undefined,
        pageFault: fault,
      }))
    },
    [updateTab],
  )

  const handleError = useCallback(
    (
      tabId: string,
      payload: { message: string; code?: string; bridgeBuild?: string; swBuild?: string },
    ) => {
      const fault = pageFaultFromError(payload)
      if (!fault) {
        return
      }
      if (fault.code === 'VERSION_MISMATCH') {
        const entry = tabsRef.current.find((item) => item.id === tabId)
        if (!entry?.url) {
          return
        }
      }
      updateTab(tabId, (entry) => ({
        ...entry,
        loading: false,
        pendingUrl: undefined,
        pageFault: fault,
      }))
    },
    [updateTab],
  )

  const handleHistory = useCallback(
    (tabId: string, payload: { url: string; title?: string }) => {
      cancelClickNavigate(tabId)
      requestedUrlByTabRef.current[tabId] = payload.url
      updateTab(tabId, (entry) => ({
        ...entry,
        url: payload.url,
        pendingUrl: undefined,
        title: payload.title || pageTitleFromUrl(payload.url),
        inputUrl: displayPageUrl(payload.url),
        loading: false,
        pageFault: undefined,
      }))
    },
    [cancelClickNavigate, updateTab],
  )

  const reloadTab = useCallback(
    (tabId: string) => {
      const tab = tabsRef.current.find((entry) => entry.id === tabId)
      if (!tab) return
      if (tab.pageFault?.severity === 'fatal') {
        updateTab(tabId, (entry) => ({ ...entry, pageFault: undefined, loading: true }))
        getViewerRef(tabId).current?.recoverFromFatal()
        return
      }
      updateTab(tabId, (entry) => ({ ...entry, pageFault: undefined, loading: true }))
      getViewerRef(tabId).current?.reload()
    },
    [getViewerRef, updateTab],
  )

  const stopTab = useCallback(
    (tabId: string) => {
      getViewerRef(tabId).current?.stop()
      updateTab(tabId, (entry) => ({ ...entry, loading: false, pendingUrl: undefined }))
    },
    [getViewerRef, updateTab],
  )

  return {
    hostId,
    tabs,
    displayedTabId,
    setDisplayedTabId,
    displayedTab,
    getViewerRef,
    updateTab,
    addTab,
    closeTab,
    navigateTab,
    evalInTab,
    screenshotTab,
    requireLiveTab,
    handleLocation,
    handleClick,
    handleNavigated,
    handleLoading,
    handleLoadFailed,
    handleError,
    handleHistory,
    reloadTab,
    stopTab,
    tabsRef,
    displayedTabIdRef,
    requestedUrlByTabRef,
  }
}

export type { ChromoPageFault }
