import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useOpenAiReady } from '../../ai/use-openai-ready.ts'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import {
  BackIcon,
  BookmarksIcon,
  ForwardIcon,
  LockIcon,
  ReloadIcon,
  SidebarIcon,
  StopIcon,
} from '../../icons/app-icons.tsx'
import { generatePageHtmlStreaming } from './generate-page-stream.ts'
import { extractTitleFromPartialHtml } from './extract-partial-html.ts'
import {
  loadBrowserTokenUsage,
  recordBrowserTokenUsage,
  type BrowserTokenUsageRecord,
} from './browser-token-usage.ts'
import { clearBrowserHistory, recordBrowserHistoryVisit } from './browser-history.ts'
import {
  addBrowserBookmark,
  isBrowserBookmarked,
  loadBookmarksBarVisible,
  removeBrowserBookmark,
  setBookmarksBarVisible,
  toggleBrowserBookmark,
  updateBrowserBookmarkTitle,
} from './browser-bookmarks.ts'
import { formatTokenCount } from './format-token-count.ts'
import { buildPageGenerationContext } from './build-page-generation-context.ts'
import { getCachedPage, saveCachedPage } from './browser-page-cache.ts'
import {
  displayUrl,
  hostnameFromUrl,
  isStartPageUrl,
  normalizeBrowserUrl,
  pageTitleFromUrl,
  START_PAGE_URL,
} from './normalize-browser-url.ts'
import { SafariTabPane } from './safari-tab-pane.tsx'
import { isEmbeddedAppOrigin, isSameDocumentUrl } from './resolve-browser-navigation-url.ts'
import { SafariHistoryPanel } from './safari-history-panel.tsx'
import { SafariAddressSuggestions } from './safari-address-suggestions.tsx'
import { searchBrowserHistory } from './search-browser-history.ts'
import { SafariTabBar } from './safari-tab-bar.tsx'
import {
  SafariBookmarksBar,
  type SafariBookmarkContextRequest,
} from './safari-bookmarks-bar.tsx'
import {
  SafariContextMenu,
  type SafariContextMenuItem,
  type SafariContextMenuTarget,
} from './safari-context-menu.tsx'
import './browser.css'

type HistoryEntry = {
  url: string
  title: string
  html: string | undefined
  pageTokens: number | undefined
}

type PageState = {
  loading: boolean
  streaming: boolean
  html: string
  rawText: string
  pageTokens: number | undefined
  error: string | undefined
}

type SafariTab = {
  id: string
  history: HistoryEntry[]
  historyIndex: number
  pageState: PageState
  inputUrl: string
}

type NavigateContext = {
  referrerUrl?: string
  referrerHtml?: string
  skipCache?: boolean
}

const INITIAL_ENTRY: HistoryEntry = {
  url: START_PAGE_URL,
  title: '起始页',
  html: undefined,
  pageTokens: undefined,
}

function createInitialPageState(): PageState {
  return {
    loading: false,
    streaming: false,
    html: '',
    rawText: '',
    pageTokens: undefined,
    error: undefined,
  }
}

function createSafariTab(): SafariTab {
  return {
    id: crypto.randomUUID(),
    history: [INITIAL_ENTRY],
    historyIndex: 0,
    pageState: createInitialPageState(),
    inputUrl: '',
  }
}

function tabDisplayTitle(tab: SafariTab): string {
  const entry = tab.history[tab.historyIndex] ?? INITIAL_ENTRY
  if (isStartPageUrl(entry.url)) {
    return '起始页'
  }
  return entry.title || pageTitleFromUrl(entry.url)
}

function commitPageVisit(url: string, title: string): void {
  recordBrowserHistoryVisit({ url, title })
}

export function BrowserApp() {
  const { closeWindowsForApp, minimizeWindow, windows, focusWindow } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const browserWindowId = windows.find((window) => window.appId === 'browser' && !window.minimized)?.id
  const apiReady = useOpenAiReady()
  const [tabs, setTabs] = useState<SafariTab[]>(() => [createSafariTab()])
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id ?? '')
  const [addressFocused, setAddressFocused] = useState(false)
  const [addressSuggestionIndex, setAddressSuggestionIndex] = useState(-1)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyRevision, setHistoryRevision] = useState(0)
  const [bookmarksRevision, setBookmarksRevision] = useState(0)
  const [bookmarksBarVisible, setBookmarksBarVisibleState] = useState(() => loadBookmarksBarVisible())
  const [tokenUsage, setTokenUsage] = useState<BrowserTokenUsageRecord>(() => loadBrowserTokenUsage())
  const [contextMenu, setContextMenu] = useState<
    { x: number; y: number; target: SafariContextMenuTarget; referrerUrl: string } | undefined
  >(undefined)
  const [bookmarkContextMenu, setBookmarkContextMenu] = useState<
    SafariBookmarkContextRequest | undefined
  >(undefined)

  const generationSeqRef = useRef<Record<string, number>>({})
  const pageHtmlByTabRef = useRef<Record<string, string>>({})
  const lastPageNavByTabRef = useRef<Record<string, { url: string; at: number }>>({})
  const safariRootRef = useRef<HTMLDivElement>(null)
  const addressWrapRef = useRef<HTMLFormElement>(null)
  const [suggestionAnchor, setSuggestionAnchor] = useState<
    { top: number; left: number; width: number } | undefined
  >(undefined)

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]
  const current = activeTab?.history[activeTab.historyIndex] ?? INITIAL_ENTRY
  const pageState = activeTab?.pageState ?? createInitialPageState()
  const historyIndex = activeTab?.historyIndex ?? 0
  const history = activeTab?.history ?? [INITIAL_ENTRY]
  const inputUrl = activeTab?.inputUrl ?? ''

  const onStartPage = isStartPageUrl(current.url)
  const currentBookmarked = !onStartPage && isBrowserBookmarked(current.url)
  const showProgress = pageState.loading || pageState.streaming
  const livePageTokens = pageState.pageTokens ?? current.pageTokens
  const tokensEstimated = showProgress && pageState.pageTokens !== undefined
  const cumulativeTokens =
    showProgress && pageState.pageTokens !== undefined
      ? tokenUsage.totalTokens + pageState.pageTokens
      : tokenUsage.totalTokens

  const bumpBookmarksRevision = useCallback(() => {
    setBookmarksRevision((value) => value + 1)
  }, [])

  const toggleBookmarkForCurrentPage = useCallback(() => {
    if (onStartPage) {
      return
    }

    const title = current.title || pageTitleFromUrl(current.url)
    toggleBrowserBookmark({ url: current.url, title })
    bumpBookmarksRevision()
  }, [bumpBookmarksRevision, current.title, current.url, onStartPage])

  const addCurrentPageToBookmarks = useCallback(() => {
    if (onStartPage) {
      return
    }

    const title = current.title || pageTitleFromUrl(current.url)
    if (addBrowserBookmark({ url: current.url, title })) {
      bumpBookmarksRevision()
    }
  }, [bumpBookmarksRevision, current.title, current.url, onStartPage])

  const removeCurrentPageFromBookmarks = useCallback(() => {
    removeBrowserBookmark(current.url)
    bumpBookmarksRevision()
  }, [bumpBookmarksRevision, current.url])

  const toggleBookmarksBar = useCallback(() => {
    setBookmarksBarVisibleState((visible) => {
      const next = !visible
      setBookmarksBarVisible(next)
      return next
    })
  }, [])

  const updateTab = useCallback((tabId: string, updater: (tab: SafariTab) => SafariTab) => {
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? updater(tab) : tab)))
  }, [])

  const bumpGeneration = useCallback((tabId: string): number => {
    const next = (generationSeqRef.current[tabId] ?? 0) + 1
    generationSeqRef.current[tabId] = next
    return next
  }, [])

  const isGenerationCurrent = useCallback((tabId: string, genId: number): boolean => {
    return generationSeqRef.current[tabId] === genId
  }, [])

  const cancelGeneration = useCallback(
    (tabId: string) => {
      bumpGeneration(tabId)
    },
    [bumpGeneration],
  )

  const patchHistoryEntry = useCallback(
    (tabId: string, index: number, patch: Partial<HistoryEntry>) => {
      updateTab(tabId, (tab) => ({
        ...tab,
        history: tab.history.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
      }))
    },
    [updateTab],
  )

  const setTabPageState = useCallback(
    (tabId: string, next: PageState | ((prev: PageState) => PageState)) => {
      updateTab(tabId, (tab) => ({
        ...tab,
        pageState: typeof next === 'function' ? next(tab.pageState) : next,
      }))
    },
    [updateTab],
  )

  useEffect(() => {
    for (const tab of tabs) {
      pageHtmlByTabRef.current[tab.id] = tab.pageState.html
    }
  }, [tabs])

  const applyCachedPage = useCallback(
    (tabId: string, targetIndex: number, url: string, cached: ReturnType<typeof getCachedPage>) => {
      if (!cached) {
        return
      }

      patchHistoryEntry(tabId, targetIndex, {
        html: cached.html,
        title: cached.title,
        pageTokens: cached.pageTokens,
      })
      setTabPageState(tabId, {
        loading: false,
        streaming: false,
        html: cached.html,
        rawText: '',
        pageTokens: cached.pageTokens,
        error: undefined,
      })
      commitPageVisit(url, cached.title)
    },
    [patchHistoryEntry, setTabPageState],
  )

  const loadRemotePage = useCallback(
    async (
      tabId: string,
      url: string,
      targetIndex: number,
      options?: {
        cachedHtml?: string
        force?: boolean
        url?: string
        referrerUrl?: string
        referrerHtml?: string
        siteRootUrl?: string
        siteRootHtml?: string
      },
    ) => {
      const cachedHtml = options?.cachedHtml
      const force = options?.force ?? false
      const pageUrl = options?.url ?? url
      const genId = bumpGeneration(tabId)

      if (!force && cachedHtml) {
        setTabPageState(tabId, {
          loading: false,
          streaming: false,
          html: cachedHtml,
          rawText: '',
          pageTokens: undefined,
          error: undefined,
        })
        return
      }

      if (!apiReady) {
        setTabPageState(tabId, {
          loading: false,
          streaming: false,
          html: '',
          rawText: '',
          pageTokens: undefined,
          error: '缺少 API Key，无法生成网页。请在系统偏好设置 → 账户中配置。',
        })
        return
      }

      setTabPageState(tabId, {
        loading: true,
        streaming: false,
        html: '',
        rawText: '',
        pageTokens: undefined,
        error: undefined,
      })

      try {
        const result = await generatePageHtmlStreaming(
          {
            url: pageUrl,
            referrerUrl: options?.referrerUrl,
            referrerHtml: options?.referrerHtml,
            siteRootUrl: options?.siteRootUrl,
            siteRootHtml: options?.siteRootHtml,
          },
          (update) => {
            if (!isGenerationCurrent(tabId, genId)) {
              return
            }

            setTabPageState(tabId, {
              loading: update.html.length === 0,
              streaming: update.html.length > 0,
              html: update.html,
              rawText: update.rawText,
              pageTokens: update.usage.totalTokens,
              error: undefined,
            })

            if (update.title) {
              patchHistoryEntry(tabId, targetIndex, { title: update.title })
            }
          },
        )

        if (!isGenerationCurrent(tabId, genId)) {
          return
        }

        const { html, usage } = result
        const pageTokens = usage?.totalTokens
        const title = extractTitleFromPartialHtml(html) ?? pageTitleFromUrl(pageUrl)

        if (usage && usage.totalTokens > 0) {
          setTokenUsage(recordBrowserTokenUsage(pageUrl, usage))
        }

        saveCachedPage({
          url: pageUrl,
          title,
          html,
          pageTokens,
        })

        patchHistoryEntry(tabId, targetIndex, { html, title, pageTokens })
        setTabPageState(tabId, {
          loading: false,
          streaming: false,
          html,
          rawText: '',
          pageTokens,
          error: undefined,
        })
        commitPageVisit(pageUrl, title)
      } catch (error) {
        if (!isGenerationCurrent(tabId, genId)) {
          return
        }

        setTabPageState(tabId, {
          loading: false,
          streaming: false,
          html: '',
          rawText: '',
          pageTokens: undefined,
          error: error instanceof Error ? error.message : '网页生成失败',
        })
      }
    },
    [
      apiReady,
      bumpGeneration,
      isGenerationCurrent,
      patchHistoryEntry,
      setTabPageState,
    ],
  )

  const showEntry = useCallback(
    (tabId: string, entry: HistoryEntry, index: number) => {
      updateTab(tabId, (tab) => ({ ...tab, inputUrl: displayUrl(entry.url) }))

      if (isStartPageUrl(entry.url)) {
        setTabPageState(tabId, createInitialPageState())
        return
      }

      if (entry.html) {
        setTabPageState(tabId, {
          loading: false,
          streaming: false,
          html: entry.html,
          rawText: '',
          pageTokens: entry.pageTokens,
          error: undefined,
        })
        return
      }

      const persisted = getCachedPage(entry.url)
      if (persisted) {
        applyCachedPage(tabId, index, entry.url, persisted)
        return
      }

      void loadRemotePage(
        tabId,
        entry.url,
        index,
        buildPageGenerationContext(entry.url, undefined, undefined),
      )
    },
    [applyCachedPage, loadRemotePage, setTabPageState, updateTab],
  )

  const navigate = useCallback(
    (tabId: string, rawUrl: string, context?: NavigateContext) => {
      const url = normalizeBrowserUrl(rawUrl)
      const title = pageTitleFromUrl(url)

      const tab = tabs.find((item) => item.id === tabId)
      if (!tab) {
        return
      }

      const fromEntry = tab.history[tab.historyIndex] ?? INITIAL_ENTRY
      const fromUrl = context?.referrerUrl ?? fromEntry.url
      const fromHtml =
        context?.referrerHtml ??
        (isStartPageUrl(fromEntry.url)
          ? undefined
          : pageHtmlByTabRef.current[tabId] || fromEntry.html)

      let targetIndex = 0

      setTabs((prev) =>
        prev.map((item) => {
          if (item.id !== tabId) {
            return item
          }

          const nextHistory = [
            ...item.history.slice(0, item.historyIndex + 1),
            { url, title, html: undefined, pageTokens: undefined },
          ]
          targetIndex = nextHistory.length - 1

          return {
            ...item,
            history: nextHistory,
            historyIndex: targetIndex,
            inputUrl: displayUrl(url),
          }
        }),
      )

      if (isStartPageUrl(url)) {
        cancelGeneration(tabId)
        setTabPageState(tabId, createInitialPageState())
        return
      }

      const persisted = context?.skipCache ? undefined : getCachedPage(url)
      if (persisted) {
        applyCachedPage(tabId, targetIndex, url, persisted)
        return
      }

      const genContext = buildPageGenerationContext(url, fromUrl, fromHtml)
      void loadRemotePage(tabId, url, targetIndex, genContext)
    },
    [applyCachedPage, cancelGeneration, loadRemotePage, setTabPageState, tabs],
  )

  const navigateActive = useCallback(
    (rawUrl: string, context?: NavigateContext) => {
      navigate(activeTabId, rawUrl, context)
    },
    [activeTabId, navigate],
  )

  const addressSuggestions = useMemo(() => {
    if (!addressFocused || !inputUrl.trim()) {
      return []
    }
    return searchBrowserHistory(inputUrl)
  }, [addressFocused, inputUrl, historyRevision])

  const selectAddressSuggestion = useCallback(
    (url: string) => {
      navigateActive(url)
      setAddressFocused(false)
      setAddressSuggestionIndex(-1)
    },
    [navigateActive],
  )

  useEffect(() => {
    setAddressSuggestionIndex(-1)
  }, [inputUrl])

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

  const showAddressSuggestions =
    addressFocused && inputUrl.trim().length > 0 && addressSuggestions.length > 0

  const updateSuggestionAnchor = useCallback(() => {
    if (!showAddressSuggestions || !addressWrapRef.current || !safariRootRef.current) {
      setSuggestionAnchor(undefined)
      return
    }

    const wrapRect = addressWrapRef.current.getBoundingClientRect()
    const rootRect = safariRootRef.current.getBoundingClientRect()
    setSuggestionAnchor({
      top: wrapRect.bottom - rootRect.top + 6,
      left: wrapRect.left - rootRect.left,
      width: wrapRect.width,
    })
  }, [showAddressSuggestions])

  useLayoutEffect(() => {
    updateSuggestionAnchor()
  }, [
    updateSuggestionAnchor,
    inputUrl,
    addressSuggestions.length,
    bookmarksBarVisible,
    showProgress,
    tabs.length,
  ])

  useEffect(() => {
    if (!showAddressSuggestions) {
      return
    }

    const handleLayoutChange = () => updateSuggestionAnchor()
    window.addEventListener('resize', handleLayoutChange)
    return () => window.removeEventListener('resize', handleLayoutChange)
  }, [showAddressSuggestions, updateSuggestionAnchor])

  const navigateFromPageForTab = useCallback(
    (tabId: string, rawUrl: string) => {
      const url = normalizeBrowserUrl(rawUrl)

      if (isEmbeddedAppOrigin(url)) {
        return
      }

      const now = Date.now()
      const last = lastPageNavByTabRef.current[tabId] ?? { url: '', at: 0 }
      if (last.url === url && now - last.at < 600) {
        return
      }
      lastPageNavByTabRef.current[tabId] = { url, at: now }

      const tab = tabs.find((item) => item.id === tabId)
      const fromEntry = tab?.history[tab?.historyIndex ?? 0] ?? INITIAL_ENTRY

      navigate(tabId, url, {
        referrerUrl: fromEntry.url,
        referrerHtml: pageHtmlByTabRef.current[tabId] || fromEntry.html,
      })
    },
    [navigate, tabs],
  )

  const reloadTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((item) => item.id === tabId)
      if (!tab) {
        return
      }

      const entry = tab.history[tab.historyIndex] ?? INITIAL_ENTRY
      if (isStartPageUrl(entry.url)) {
        return
      }

      patchHistoryEntry(tabId, tab.historyIndex, { html: undefined, pageTokens: undefined })
      const genContext = buildPageGenerationContext(
        entry.url,
        entry.url,
        tab.pageState.html || entry.html,
      )
      void loadRemotePage(tabId, entry.url, tab.historyIndex, { ...genContext, force: true })
    },
    [loadRemotePage, patchHistoryEntry, tabs],
  )

  const goBack = () => {
    if (historyIndex <= 0) {
      return
    }

    cancelGeneration(activeTabId)
    const nextIndex = historyIndex - 1
    updateTab(activeTabId, (tab) => ({ ...tab, historyIndex: nextIndex }))
    showEntry(activeTabId, history[nextIndex], nextIndex)
  }

  const goForward = () => {
    if (historyIndex >= history.length - 1) {
      return
    }

    cancelGeneration(activeTabId)
    const nextIndex = historyIndex + 1
    updateTab(activeTabId, (tab) => ({ ...tab, historyIndex: nextIndex }))
    showEntry(activeTabId, history[nextIndex], nextIndex)
  }

  const reload = () => {
    if (onStartPage) {
      return
    }

    patchHistoryEntry(activeTabId, historyIndex, { html: undefined, pageTokens: undefined })
    const genContext = buildPageGenerationContext(
      current.url,
      current.url,
      pageState.html || current.html,
    )
    void loadRemotePage(activeTabId, current.url, historyIndex, { ...genContext, force: true })
  }

  const stopLoading = () => {
    cancelGeneration(activeTabId)
    setTabPageState(activeTabId, (prev) => ({
      ...prev,
      loading: false,
      streaming: false,
    }))
  }

  const submitUrl = (event: Event) => {
    event.preventDefault()
    const selected = addressSuggestions[addressSuggestionIndex]
    if (selected) {
      selectAddressSuggestion(selected.url)
      return
    }
    navigateActive(inputUrl.trim() ? inputUrl : START_PAGE_URL)
    setAddressFocused(false)
    setAddressSuggestionIndex(-1)
  }

  const addTab = () => {
    const tab = createSafariTab()
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
    setAddressFocused(false)
  }

  const navigateInNewTab = useCallback(
    (rawUrl: string, options?: { background?: boolean; context?: NavigateContext }) => {
      const url = normalizeBrowserUrl(rawUrl)
      const title = pageTitleFromUrl(url)
      const tab = createSafariTab()
      const tabId = tab.id
      const fromUrl = options?.context?.referrerUrl

      if (isStartPageUrl(url)) {
        setTabs((prev) => [...prev, tab])
        if (!options?.background) {
          setActiveTabId(tabId)
          setAddressFocused(false)
        }
        return
      }

      const persisted = options?.context?.skipCache ? undefined : getCachedPage(url)
      const cachedHtml = persisted?.html
      const entry: HistoryEntry = {
        url,
        title,
        html: cachedHtml,
        pageTokens: persisted?.pageTokens,
      }

      setTabs((prev) => [
        ...prev,
        {
          ...tab,
          history: [entry],
          historyIndex: 0,
          inputUrl: displayUrl(url),
          pageState: cachedHtml
            ? {
                loading: false,
                streaming: false,
                html: cachedHtml,
                rawText: '',
                pageTokens: persisted?.pageTokens,
                error: undefined,
              }
            : {
                loading: true,
                streaming: false,
                html: '',
                rawText: '',
                pageTokens: undefined,
                error: undefined,
              },
        },
      ])

      if (!options?.background) {
        setActiveTabId(tabId)
        setAddressFocused(false)
      }

      if (cachedHtml) {
        pageHtmlByTabRef.current[tabId] = cachedHtml
        commitPageVisit(url, persisted?.title ?? title)
        return
      }

      const genContext = buildPageGenerationContext(url, fromUrl, undefined)
      void loadRemotePage(tabId, url, 0, genContext)
    },
    [loadRemotePage],
  )

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // clipboard unavailable
    }
  }, [])

  const closeTab = (tabId: string) => {
    setTabs((prev) => {
      if (prev.length <= 1) {
        const reset = createSafariTab()
        setActiveTabId(reset.id)
        delete generationSeqRef.current[tabId]
        delete pageHtmlByTabRef.current[tabId]
        return [reset]
      }

      const index = prev.findIndex((tab) => tab.id === tabId)
      const next = prev.filter((tab) => tab.id !== tabId)

      if (tabId === activeTabId) {
        const fallback = next[Math.min(index, next.length - 1)]
        setActiveTabId(fallback.id)
      }

      delete generationSeqRef.current[tabId]
      delete pageHtmlByTabRef.current[tabId]
      return next
    })
  }

  const selectTab = (tabId: string) => {
    setActiveTabId(tabId)
    setAddressFocused(false)
  }

  useEffect(() => {
    setContextMenu(undefined)
    setBookmarkContextMenu(undefined)
  }, [activeTabId, current.url])

  useEffect(() => {
    if (onStartPage || !currentBookmarked || showProgress) {
      return
    }

    const title = current.title.trim()
    if (!title) {
      return
    }

    updateBrowserBookmarkTitle(current.url, title)
    bumpBookmarksRevision()
  }, [bumpBookmarksRevision, current.title, current.url, currentBookmarked, onStartPage, showProgress])

  const contextMenuItems = useMemo((): SafariContextMenuItem[] => {
    if (!contextMenu) {
      return []
    }

    const { target } = contextMenu
    const menuTarget = target
    const referrerUrl = contextMenu.referrerUrl
    const linkMatchesCurrent =
      menuTarget.kind === 'link' && isSameDocumentUrl(menuTarget.url, current.url)

    const openInNewTab = (url: string, background = false) => {
      navigateInNewTab(url, {
        background,
        context: {
          referrerUrl,
        },
      })
    }

    if (menuTarget.kind === 'link') {
      const linkUrl = menuTarget.url
      return [
        {
          type: 'action',
          label: '在新标签页中打开',
          disabled: linkMatchesCurrent,
          onClick: () => openInNewTab(linkUrl),
        },
        {
          type: 'action',
          label: '在后台新标签页中打开',
          disabled: linkMatchesCurrent,
          onClick: () => openInNewTab(linkUrl, true),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: '复制链接',
          onClick: () => void copyToClipboard(linkUrl),
        },
      ]
    }

    if (menuTarget.kind === 'image') {
      const imageUrl = menuTarget.url
      return [
        {
          type: 'action',
          label: '在新标签页中打开',
          onClick: () => openInNewTab(imageUrl),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: '复制图片地址',
          onClick: () => void copyToClipboard(imageUrl),
        },
      ]
    }

    const items: SafariContextMenuItem[] = [
      {
        type: 'action',
        label: '重新加载',
        disabled: onStartPage,
        onClick: reload,
      },
      {
        type: 'action',
        label: '后退',
        disabled: historyIndex <= 0,
        onClick: goBack,
      },
      {
        type: 'action',
        label: '前进',
        disabled: historyIndex >= history.length - 1,
        onClick: goForward,
      },
    ]

    if (!onStartPage) {
      items.push({ type: 'separator' })
      items.push({
        type: 'action',
        label: currentBookmarked ? '从个人收藏中移除' : '添加到个人收藏',
        onClick: toggleBookmarkForCurrentPage,
      })
      items.push({
        type: 'action',
        label: '在新标签页中打开此页',
        onClick: () => openInNewTab(referrerUrl),
      })
    }

    return items
  }, [
    contextMenu,
    copyToClipboard,
    current.url,
    currentBookmarked,
    goBack,
    goForward,
    history.length,
    historyIndex,
    navigateInNewTab,
    onStartPage,
    reload,
    toggleBookmarkForCurrentPage,
  ])

  const bookmarkContextMenuItems = useMemo((): SafariContextMenuItem[] => {
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
        onClick: () => navigateInNewTab(bookmark.url),
      },
      { type: 'separator' },
      {
        type: 'action',
        label: '删除',
        onClick: () => {
          removeBrowserBookmark(bookmark.url)
          bumpBookmarksRevision()
        },
      },
    ]
  }, [bookmarkContextMenu, bumpBookmarksRevision, navigateActive, navigateInNewTab])

  const addressValue = addressFocused
    ? inputUrl
    : inputUrl ||
      (onStartPage ? '' : current.title || displayUrl(current.url))

  const tabSummaries = tabs.map((tab) => {
    const entry = tab.history[tab.historyIndex] ?? INITIAL_ENTRY
    const start = isStartPageUrl(entry.url)
    return {
      id: tab.id,
      title: tabDisplayTitle(tab),
      loading: tab.pageState.loading || tab.pageState.streaming,
      isStartPage: start,
      siteInitial: start ? undefined : hostnameFromUrl(entry.url).charAt(0).toUpperCase(),
    }
  })

  const statusHint =
    showProgress && pageState.streaming
      ? '正在生成页面…'
      : showProgress
        ? '正在连接…'
        : undefined

  const menuActionsRef = useRef({
    hideSafari: () => {},
    quitSafari: () => {},
    addTab: () => {},
    closeTab: () => {},
    toggleHistory: () => {},
    toggleBookmarksBar: () => {},
    toggleBookmark: () => {},
    addBookmark: () => {},
    removeBookmark: () => {},
    goBack: () => {},
    goForward: () => {},
    clearHistory: () => {},
    reload: () => {},
    stopLoading: () => {},
  })

  menuActionsRef.current = {
    hideSafari: () => {
      const browserWindow = windows.find((window) => window.appId === 'browser' && !window.minimized)
      if (browserWindow) {
        minimizeWindow(browserWindow.id)
      }
    },
    quitSafari: () => closeWindowsForApp('browser'),
    addTab,
    closeTab: () => closeTab(activeTabId),
    toggleHistory: () => setHistoryOpen((open) => !open),
    toggleBookmarksBar,
    toggleBookmark: toggleBookmarkForCurrentPage,
    addBookmark: addCurrentPageToBookmarks,
    removeBookmark: removeCurrentPageFromBookmarks,
    goBack,
    goForward,
    clearHistory: () => {
      clearBrowserHistory()
      setHistoryRevision((value) => value + 1)
      setHistoryOpen(false)
    },
    reload,
    stopLoading,
  }

  const menuBar = useMemo((): MenuDefinition[] => {
    const run = (action: keyof typeof menuActionsRef.current) => {
      menuActionsRef.current[action]()
    }

    return [
      {
        label: 'Safari',
        items: [
          ...aboutAppMenuPrefix('关于 Safari', () => showBuiltinAbout('browser')),
          { type: 'action', label: '隐藏 Safari', shortcut: '⌘H', onClick: () => run('hideSafari') },
          { type: 'separator' },
          { type: 'action', label: '退出 Safari', shortcut: '⌘Q', onClick: () => run('quitSafari') },
        ],
      },
      {
        label: '文件',
        items: [
          { type: 'action', label: '新建标签页', shortcut: '⌘T', onClick: () => run('addTab') },
          { type: 'action', label: '关闭标签页', shortcut: '⌘W', onClick: () => run('closeTab') },
        ],
      },
      {
        label: '书签',
        items: [
          {
            type: 'action',
            label: currentBookmarked ? '从个人收藏中移除' : '添加书签…',
            shortcut: '⌘D',
            onClick: () => run('toggleBookmark'),
            disabled: onStartPage,
          },
          { type: 'separator' },
          {
            type: 'action',
            label: bookmarksBarVisible ? '隐藏收藏栏' : '显示收藏栏',
            shortcut: '⌘⇧B',
            onClick: () => run('toggleBookmarksBar'),
          },
        ],
      },
      {
        label: '历史记录',
        items: [
          {
            type: 'action',
            label: historyOpen ? '隐藏历史记录' : '显示历史记录',
            shortcut: '⌘Y',
            onClick: () => run('toggleHistory'),
          },
          {
            type: 'action',
            label: '后退',
            shortcut: '⌘[',
            onClick: () => run('goBack'),
            disabled: historyIndex <= 0,
          },
          {
            type: 'action',
            label: '前进',
            shortcut: '⌘]',
            onClick: () => run('goForward'),
            disabled: historyIndex >= history.length - 1,
          },
          { type: 'separator' },
          { type: 'action', label: '清空历史记录…', onClick: () => run('clearHistory') },
        ],
      },
      {
        label: '显示',
        items: [
          {
            type: 'action',
            label: '重新加载页面',
            shortcut: '⌘R',
            onClick: () => run('reload'),
            disabled: onStartPage,
          },
          {
            type: 'action',
            label: '停止加载',
            shortcut: '⌘.',
            onClick: () => run('stopLoading'),
            disabled: !showProgress,
          },
        ],
      },
    ]
  }, [
    bookmarksBarVisible,
    currentBookmarked,
    history.length,
    historyIndex,
    historyOpen,
    onStartPage,
    showBuiltinAbout,
    showProgress,
  ])

  useAppMenuBar('browser', menuBar)

  return (
    <div class="safari" ref={safariRootRef}>
      <header class="safari__chrome">
        <SafariTabBar
          tabs={tabSummaries}
          activeTabId={activeTabId}
          onSelectTab={selectTab}
          onCloseTab={closeTab}
          onNewTab={addTab}
        />

        <div class="safari__toolbar">
          <div class="safari__nav">
            <button
              type="button"
              class="safari__btn"
              disabled={historyIndex <= 0}
              onClick={goBack}
              aria-label="后退"
            >
              <BackIcon />
            </button>
            <button
              type="button"
              class="safari__btn"
              disabled={historyIndex >= history.length - 1}
              onClick={goForward}
              aria-label="前进"
            >
              <ForwardIcon />
            </button>
          </div>

          <form class="safari__address-wrap" ref={addressWrapRef} onSubmit={submitUrl}>
            <div
              class={`safari__address ${addressFocused ? 'safari__address--focused' : ''} ${showProgress ? 'safari__address--loading' : ''}`}
            >
              <span class="safari__address-leading" aria-hidden="true">
                {showProgress ? (
                  <span class="safari__address-spinner" />
                ) : !onStartPage ? (
                  <LockIcon />
                ) : undefined}
              </span>
              <input
                type="text"
                class="safari__address-input"
                value={addressValue}
                placeholder="搜索或输入网站名称"
                onFocus={() => {
                  setAddressFocused(true)
                  setAddressSuggestionIndex(-1)
                  updateTab(activeTabId, (tab) => ({
                    ...tab,
                    inputUrl: displayUrl(current.url),
                  }))
                }}
                onBlur={() => setAddressFocused(false)}
                onKeyDown={handleAddressKeyDown}
                onInput={(event) => {
                  const value = (event.currentTarget as HTMLInputElement).value
                  updateTab(activeTabId, (tab) => ({ ...tab, inputUrl: value }))
                }}
                spellcheck={false}
                aria-label="地址栏"
                aria-expanded={showAddressSuggestions}
                aria-autocomplete="list"
                aria-controls={showAddressSuggestions ? 'safari-address-suggestions' : undefined}
                aria-activedescendant={
                  showAddressSuggestions && addressSuggestionIndex >= 0
                    ? `safari-address-suggestion-${addressSuggestionIndex}`
                    : undefined
                }
              />
              {statusHint && !addressFocused && (
                <span class="safari__address-status">{statusHint}</span>
              )}
            </div>
          </form>

          <div class="safari__actions">
            <button
              type="button"
              class={`safari__btn ${currentBookmarked ? 'safari__btn--bookmarked' : ''}`}
              onClick={toggleBookmarkForCurrentPage}
              aria-label={currentBookmarked ? '从个人收藏中移除' : '添加到个人收藏'}
              aria-pressed={currentBookmarked}
              disabled={onStartPage}
            >
              <BookmarksIcon />
            </button>
            {showProgress ? (
              <button type="button" class="safari__btn" onClick={stopLoading} aria-label="停止">
                <StopIcon />
              </button>
            ) : (
              <button
                type="button"
                class="safari__btn"
                onClick={reload}
                aria-label="刷新"
                disabled={onStartPage}
              >
                <ReloadIcon />
              </button>
            )}
            <button
              type="button"
              class={`safari__btn ${historyOpen ? 'safari__btn--active' : ''}`}
              onClick={() => setHistoryOpen((open) => !open)}
              aria-label="历史记录"
              aria-pressed={historyOpen}
            >
              <SidebarIcon />
            </button>
          </div>
        </div>

        {bookmarksBarVisible && (
          <SafariBookmarksBar
            revision={bookmarksRevision}
            onNavigate={navigateActive}
            onContextMenu={setBookmarkContextMenu}
          />
        )}

        {showProgress && (
          <div class="safari__progress" role="progressbar" aria-busy="true">
            <div class="safari__progress-bar" />
          </div>
        )}
      </header>

      {showAddressSuggestions && suggestionAnchor && (
        <div
          class="safari-address-suggestions-anchor"
          style={{
            top: `${suggestionAnchor.top}px`,
            left: `${suggestionAnchor.left}px`,
            width: `${suggestionAnchor.width}px`,
          }}
        >
          <SafariAddressSuggestions
            suggestions={addressSuggestions}
            activeIndex={addressSuggestionIndex}
            onSelect={selectAddressSuggestion}
            onHover={setAddressSuggestionIndex}
          />
        </div>
      )}

      <main class="safari__viewport">
        {tabs.map((tab) => {
          const entry = tab.history[tab.historyIndex] ?? INITIAL_ENTRY
          const isActive = tab.id === activeTabId
          const tabPageState = tab.pageState

          return (
            <SafariTabPane
              key={tab.id}
              active={isActive}
              tabId={tab.id}
              url={entry.url}
              title={entry.title}
              historyIndex={tab.historyIndex}
              html={tabPageState.html}
              loading={tabPageState.loading}
              streaming={tabPageState.streaming}
              rawText={tabPageState.rawText}
              error={tabPageState.error}
              bookmarksRevision={bookmarksRevision}
              onStartPageNavigate={(url) => navigate(tab.id, url)}
              onPageNavigate={(url) => navigateFromPageForTab(tab.id, url)}
              onReload={() => reloadTab(tab.id)}
              onFocusWindow={
                browserWindowId ? () => focusWindow(browserWindowId) : undefined
              }
              onContextMenu={
                isActive
                  ? (request) => {
                      setContextMenu({
                        x: request.x,
                        y: request.y,
                        target: request.target,
                        referrerUrl: entry.url,
                      })
                    }
                  : undefined
              }
            />
          )
        })}
        {contextMenu && (
          <SafariContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextMenuItems}
            onClose={() => setContextMenu(undefined)}
          />
        )}
      </main>

      {(livePageTokens !== undefined && livePageTokens > 0) || cumulativeTokens > 0 ? (
        <div class="safari__dev-badge" title="AI 生成用量（开发信息）">
          {livePageTokens !== undefined && livePageTokens > 0 && (
            <span>
              {tokensEstimated ? '~' : ''}
              {formatTokenCount(livePageTokens)}
            </span>
          )}
          {cumulativeTokens > 0 && (
            <span>Σ {formatTokenCount(cumulativeTokens)}</span>
          )}
        </div>
      ) : undefined}

      <SafariHistoryPanel
        open={historyOpen}
        revision={historyRevision}
        onClose={() => setHistoryOpen(false)}
        onNavigate={navigateActive}
        onHistoryChange={() => setHistoryRevision((value) => value + 1)}
      />

      {bookmarkContextMenu && (
        <SafariContextMenu
          x={bookmarkContextMenu.x}
          y={bookmarkContextMenu.y}
          items={bookmarkContextMenuItems}
          onClose={() => setBookmarkContextMenu(undefined)}
        />
      )}
    </div>
  )
}
