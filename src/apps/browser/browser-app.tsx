import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useOpenAiReady } from '../../ai/use-openai-ready.ts'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { registerFileOpenHandler } from '../../os/file-open-registry.ts'
import { registerUrlOpenHandler } from '../../os/url-open-registry.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { useFullscreenChromeReveal } from '../../os/fullscreen-chrome-reveal-context.tsx'
import {
  BackIcon,
  BookmarksIcon,
  ForwardIcon,
  LockIcon,
  HistoryIcon,
  ReloadIcon,
  StopIcon,
} from '../../icons/app-icons.tsx'
import {
  generatePageHtmlStreaming,
  BrowserPageSiteNotFoundError,
  type PageGenerationContext,
} from './generate-page-stream.ts'
import { extractTitleFromPartialHtml } from './extract-partial-html.ts'
import {
  buildFileDocumentUrl,
  htmlForFileDocument,
  isFileDocumentUrl,
  resolveDocumentIdFromFileUrl,
} from './browser-file-document.ts'
import { htmlForViewSource } from './browser-view-source.ts'
import {
  loadBrowserTokenUsage,
  recordBrowserTokenUsage,
  type BrowserTokenUsageRecord,
} from './browser-token-usage.ts'
import {
  clearBrowserHistory,
  clearBrowserHistoryByHostname,
  recordBrowserHistoryVisit,
} from './browser-history.ts'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import {
  addBrowserBookmark,
  bookmarkAccentColor,
  bookmarkDisplayGlyph,
  insertBookmarkAt,
  isBrowserBookmarked,
  loadBookmarksBarVisible,
  moveBookmark,
  removeBrowserBookmark,
  setBookmarksBarVisible,
  toggleBrowserBookmark,
  updateBrowserBookmarkTitle,
} from './browser-bookmarks.ts'
import { formatCompactTokenCount } from './format-token-count.ts'
import {
  buildPageGenerationContext,
  readBrowserViewportSize,
} from './build-page-generation-context.ts'
import {
  clearSitePageCache,
  getCachedPage,
  initBrowserPageCache,
  removeCachedPage,
  saveCachedPage,
} from './browser-page-cache.ts'
import {
  loadBrowserSettings,
  patchBrowserSettings,
} from './browser-settings-storage.ts'
import {
  addressBarDisplayUrl,
  hostnameFromUrl,
  isSameSite,
  isStartPageUrl,
  isViewSourceUrl,
  normalizeBrowserUrl,
  pageTitleFromUrl,
  START_PAGE_URL,
  toViewSourceUrl,
  unwrapViewSourceUrl,
} from './normalize-browser-url.ts'
import { SafariTabPane } from './safari-tab-pane.tsx'
import { isEmbeddedAppOrigin, isSameDocumentUrl } from './resolve-browser-navigation-url.ts'
import { SafariHistoryPanel } from './safari-history-panel.tsx'
import { SafariBookmarksPanel } from './safari-bookmarks-panel.tsx'
import { SafariAddressSuggestions } from './safari-address-suggestions.tsx'
import { searchBrowserHistory } from './search-browser-history.ts'
import { SafariTabBar } from './safari-tab-bar.tsx'
import { SafariTabsPanel } from './safari-tabs-panel.tsx'
import {
  SafariBookmarksBar,
  SAFARI_URL_MIME,
  type SafariBookmarkContextRequest,
} from './safari-bookmarks-bar.tsx'
import { beginSafariDrag, endSafariDrag } from './safari-drag-bridge.ts'
import { setSafariBookmarkDragImage } from './safari-drag-ghost.ts'
import { AdaptiveActionMenu } from '../../ui/adaptive-action-menu.tsx'
import { useAppNarrowLayout } from '../../ui/use-app-narrow-layout.ts'
import {
  type SafariContextMenuItem,
  type SafariContextMenuTarget,
} from './safari-context-menu.tsx'
import { readTextFile, resolveFilesAbsolutePath } from '../files/files-vfs.ts'
import './browser.css'

registerFileOpenHandler({
  appId: 'browser',
  extensions: ['html', 'htm', 'xhtml', 'svg'],
  rank: 10,
})

registerUrlOpenHandler({ appId: 'browser', rank: 20 })

type HistoryEntry = {
  url: string
  title: string
  html: string | undefined
  pageTokens: number | undefined
  /** 本机 file:// 页面对应的全局绝对路径 */
  documentId?: string
}

type PageState = {
  loading: boolean
  streaming: boolean
  html: string
  rawText: string
  reasoningText: string
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
  /** 打开 view-source: 时注入的页面原文（非包装后的展示 HTML） */
  sourceHtml?: string
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
    reasoningText: '',
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

/** 解析 view-source 页：用原文包装成展示 HTML；无原文则返回错误文案 */
function resolveViewSourceFrame(
  viewSourceUrl: string,
  seedHtml?: string,
): { innerUrl: string; title: string; frameHtml: string } | { error: string } {
  const innerUrl = unwrapViewSourceUrl(viewSourceUrl)
  if (!innerUrl || isStartPageUrl(innerUrl) || isViewSourceUrl(innerUrl)) {
    return { error: '无法查看源代码' }
  }

  const sourceHtml = seedHtml || getCachedPage(innerUrl)?.html
  if (!sourceHtml) {
    return { error: '没有可查看的页面源代码' }
  }

  const title = pageTitleFromUrl(viewSourceUrl)
  return {
    innerUrl,
    title,
    frameHtml: htmlForViewSource(sourceHtml, innerUrl),
  }
}

export function BrowserApp() {
  const {
    closeWindowsForApp,
    minimizeWindow,
    windows,
    focusWindow,
    setAppWindowDocumentId,
    setAppWindowUrl,
  } = useOs()
  const { setChromePinSource } = useFullscreenChromeReveal()
  const { showBuiltinAbout } = useAboutApp()
  const modal = useWindowModal()
  const appWindow = windows.find((window) => window.appId === 'browser' && !window.closing)
  const browserWindow = windows.find((window) => window.appId === 'browser' && !window.minimized)
  const browserWindowId = browserWindow?.id
  const browserFullscreen = Boolean(browserWindow?.fullscreen)
  const pendingDocumentId = appWindow?.documentId
  const pendingUrl = appWindow?.url
  const apiReady = useOpenAiReady()
  const [tabs, setTabs] = useState<SafariTab[]>(() => [createSafariTab()])
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id ?? '')
  const [addressFocused, setAddressFocused] = useState(false)
  const [addressSuggestionIndex, setAddressSuggestionIndex] = useState(-1)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [tabsOverflowOpen, setTabsOverflowOpen] = useState(false)
  const [hiddenTabIds, setHiddenTabIds] = useState<string[]>([])
  const [bookmarksOverflowOpen, setBookmarksOverflowOpen] = useState(false)
  const [historyRevision, setHistoryRevision] = useState(0)
  const [bookmarksRevision, setBookmarksRevision] = useState(0)
  const [bookmarksBarVisible, setBookmarksBarVisibleState] = useState(() => loadBookmarksBarVisible())
  const [alwaysShowToolbarInFullscreen, setAlwaysShowToolbarInFullscreen] = useState(
    () => loadBrowserSettings().alwaysShowToolbarInFullscreen,
  )
  const [alwaysShowFullUrl, setAlwaysShowFullUrl] = useState(
    () => loadBrowserSettings().alwaysShowFullUrl,
  )
  const [fullscreenToolbarRevealed, setFullscreenToolbarRevealed] = useState(false)
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
  const lastOpenedDocumentIdRef = useRef<string | undefined>(undefined)
  const lastOpenedUrlRef = useRef<string | undefined>(undefined)
  const openingUrlRef = useRef<string | undefined>(undefined)
  const openingDocumentIdRef = useRef<string | undefined>(undefined)
  const safariRootRef = useRef<HTMLDivElement>(null)
  const { hostRef: narrowLayoutHostRef, narrowLayout } = useAppNarrowLayout()

  const attachSafariRoot = useCallback(
    (node: HTMLDivElement | null) => {
      safariRootRef.current = node
      narrowLayoutHostRef(node)
    },
    [narrowLayoutHostRef],
  )
  const viewportRef = useRef<HTMLElement>(null)
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

  useEffect(() => {
    void initBrowserPageCache()
  }, [])

  const formatAddressInput = useCallback(
    (url: string) => addressBarDisplayUrl(url, alwaysShowFullUrl),
    [alwaysShowFullUrl],
  )

  const bumpBookmarksRevision = useCallback(() => {
    setBookmarksRevision((value) => value + 1)
  }, [])

  const buildGenContext = useCallback(
    (targetUrl: string, fromUrl?: string, fromHtml?: string) =>
      buildPageGenerationContext(
        targetUrl,
        fromUrl,
        fromHtml,
        readBrowserViewportSize(viewportRef.current ?? undefined),
      ),
    [],
  )

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

  const addBookmarkAt = useCallback(
    (url: string, index: number, title?: string) => {
      const resolvedTitle = title?.trim() || pageTitleFromUrl(url)
      if (insertBookmarkAt({ url, title: resolvedTitle }, index)) {
        bumpBookmarksRevision()
      }
    },
    [bumpBookmarksRevision],
  )

  const reorderBookmark = useCallback(
    (fromUrl: string, toIndex: number) => {
      moveBookmark(fromUrl, toIndex)
      bumpBookmarksRevision()
    },
    [bumpBookmarksRevision],
  )

  // 地址栏可作为整体被拖拽：未聚焦、非起始页、未加载时启用。
  // 输入框在可拖拽时禁用指针事件，由外层容器承接拖拽；点击仍通过外层 onClick 进入编辑。
  const addressDraggable = !addressFocused && !onStartPage && !showProgress

  const handleAddressDragStart = useCallback(
    (event: DragEvent) => {
      if (!addressDraggable) {
        event.preventDefault()
        return
      }

      const url = current.url
      const title = current.title || pageTitleFromUrl(current.url)
      beginSafariDrag({ kind: 'url', url, title })
      if (event.dataTransfer) {
        event.dataTransfer.setData(SAFARI_URL_MIME, url)
        event.dataTransfer.setData('text/uri-list', url)
        event.dataTransfer.setData('text/plain', url)
        event.dataTransfer.effectAllowed = 'copyMove'
      }
      setSafariBookmarkDragImage(event, {
        glyph: bookmarkDisplayGlyph(url, title),
        label: title,
        color: bookmarkAccentColor(url),
      })
    },
    [addressDraggable, current.title, current.url],
  )

  const handleAddressDragEnd = useCallback(() => {
    endSafariDrag()
  }, [])

  // 未聚焦时点击（按下并松开且未拖动）：手动聚焦输入框。
  const handleAddressClickToFocus = useCallback(
    (event: MouseEvent) => {
      if (!addressDraggable) {
        return
      }
      const root = event.currentTarget as HTMLElement
      const input = root.querySelector?.('.safari__address-input') as HTMLInputElement | null
      input?.focus()
      input?.select()
    },
    [addressDraggable],
  )

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
        reasoningText: '',
        pageTokens: cached.pageTokens,
        error: undefined,
      })
      commitPageVisit(url, cached.title)
    },
    [patchHistoryEntry, setTabPageState],
  )

  const loadFileDocumentPage = useCallback(
    async (tabId: string, url: string, targetIndex: number, hintDocumentId?: string) => {
      cancelGeneration(tabId)
      setTabPageState(tabId, {
        loading: true,
        streaming: false,
        html: '',
        rawText: '',
        reasoningText: '',
        pageTokens: undefined,
        error: undefined,
      })

      try {
        const documentPath =
          hintDocumentId ?? (await resolveDocumentIdFromFileUrl(url))
        if (!documentPath) {
          setTabPageState(tabId, {
            loading: false,
            streaming: false,
            html: '',
            rawText: '',
            reasoningText: '',
            pageTokens: undefined,
            error: '找不到对应的本机文件',
          })
          return
        }

        const { node, text } = await readTextFile(documentPath)
        const frameHtml = htmlForFileDocument(node, text)
        const resolvedUrl = await buildFileDocumentUrl(node)
        const absolutePath = await resolveFilesAbsolutePath(node)
        const title = node.name
        patchHistoryEntry(tabId, targetIndex, {
          url: resolvedUrl,
          title,
          html: frameHtml,
          pageTokens: undefined,
          documentId: absolutePath,
        })
        updateTab(tabId, (tab) => ({
          ...tab,
          inputUrl: formatAddressInput(resolvedUrl),
        }))
        setTabPageState(tabId, {
          loading: false,
          streaming: false,
          html: frameHtml,
          rawText: '',
          reasoningText: '',
          pageTokens: undefined,
          error: undefined,
        })
        setAppWindowDocumentId('browser', absolutePath)
      } catch (error) {
        setTabPageState(tabId, {
          loading: false,
          streaming: false,
          html: '',
          rawText: '',
          reasoningText: '',
          pageTokens: undefined,
          error: error instanceof Error ? error.message : '无法打开本机文件',
        })
      }
    },
    [
      cancelGeneration,
      formatAddressInput,
      patchHistoryEntry,
      setAppWindowDocumentId,
      setTabPageState,
      updateTab,
    ],
  )

  const loadRemotePage = useCallback(
    async (
      tabId: string,
      url: string,
      targetIndex: number,
      options?: Partial<PageGenerationContext> & {
        cachedHtml?: string
        force?: boolean
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
    reasoningText: '',
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
    reasoningText: '',
    pageTokens: undefined,
          error: '缺少 API Key，无法生成网页。请在系统设置 → 账户中配置。',
        })
        return
      }

      setTabPageState(tabId, {
        loading: true,
        streaming: false,
        html: '',
    rawText: '',
    reasoningText: '',
    pageTokens: undefined,
        error: undefined,
      })

      try {
        const { cachedHtml: _cachedHtml, force: _force, ...generationContext } = options ?? {}
        const result = await generatePageHtmlStreaming(
          {
            ...generationContext,
            url: pageUrl,
            userAgent: generationContext.userAgent ?? navigator.userAgent,
          },
          (update) => {
            if (!isGenerationCurrent(tabId, genId)) {
              return
            }

            const hasStreamText =
              update.reasoningText.length > 0 || update.rawText.length > 0 || update.html.length > 0
            setTabPageState(tabId, {
              loading: !hasStreamText,
              streaming: hasStreamText,
              html: update.html,
              rawText: update.rawText,
              reasoningText: update.reasoningText,
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
          reasoningText: '',
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
          reasoningText: '',
          pageTokens: undefined,
          error:
            error instanceof BrowserPageSiteNotFoundError
              ? error.message
              : error instanceof Error
                ? error.message
                : '网页生成失败',
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
      updateTab(tabId, (tab) => ({ ...tab, inputUrl: formatAddressInput(entry.url) }))

      if (isStartPageUrl(entry.url)) {
        cancelGeneration(tabId)
        setTabPageState(tabId, createInitialPageState())
        return
      }

      if (isViewSourceUrl(entry.url)) {
        cancelGeneration(tabId)
        if (entry.html) {
          setTabPageState(tabId, {
            loading: false,
            streaming: false,
            html: entry.html,
            rawText: '',
            reasoningText: '',
            pageTokens: entry.pageTokens,
            error: undefined,
          })
          return
        }

        const resolved = resolveViewSourceFrame(entry.url)
        if ('error' in resolved) {
          setTabPageState(tabId, {
            loading: false,
            streaming: false,
            html: '',
            rawText: '',
            reasoningText: '',
            pageTokens: undefined,
            error: resolved.error,
          })
          return
        }

        patchHistoryEntry(tabId, index, {
          title: resolved.title,
          html: resolved.frameHtml,
          pageTokens: undefined,
        })
        setTabPageState(tabId, {
          loading: false,
          streaming: false,
          html: resolved.frameHtml,
          rawText: '',
          reasoningText: '',
          pageTokens: undefined,
          error: undefined,
        })
        commitPageVisit(entry.url, resolved.title)
        return
      }

      if (isFileDocumentUrl(entry.url)) {
        if (entry.html) {
          cancelGeneration(tabId)
          setTabPageState(tabId, {
            loading: false,
            streaming: false,
            html: entry.html,
            rawText: '',
            reasoningText: '',
            pageTokens: entry.pageTokens,
            error: undefined,
          })
          return
        }
        void loadFileDocumentPage(tabId, entry.url, index, entry.documentId)
        return
      }

      if (entry.html) {
        cancelGeneration(tabId)
        setTabPageState(tabId, {
          loading: false,
          streaming: false,
          html: entry.html,
          rawText: '',
          reasoningText: '',
          pageTokens: entry.pageTokens,
          error: undefined,
        })
        return
      }

      const persisted = getCachedPage(entry.url)
      if (persisted) {
        cancelGeneration(tabId)
        applyCachedPage(tabId, index, entry.url, persisted)
        return
      }

      void loadRemotePage(
        tabId,
        entry.url,
        index,
        buildGenContext(entry.url),
      )
    },
    [
      applyCachedPage,
      buildGenContext,
      cancelGeneration,
      formatAddressInput,
      loadFileDocumentPage,
      loadRemotePage,
      patchHistoryEntry,
      setTabPageState,
      updateTab,
    ],
  )

  const navigate = useCallback(
    (tabId: string, rawUrl: string, context?: NavigateContext) => {
      const url = normalizeBrowserUrl(rawUrl)
      const title = pageTitleFromUrl(url)

      const tab = tabs.find((item) => item.id === tabId)
      if (!tab) {
        return
      }

      cancelGeneration(tabId)

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
            inputUrl: formatAddressInput(url),
          }
        }),
      )

      if (isStartPageUrl(url)) {
        setTabPageState(tabId, createInitialPageState())
        return
      }

      if (isViewSourceUrl(url)) {
        const resolved = resolveViewSourceFrame(url, context?.sourceHtml)
        if ('error' in resolved) {
          setTabPageState(tabId, {
            loading: false,
            streaming: false,
            html: '',
            rawText: '',
            reasoningText: '',
            pageTokens: undefined,
            error: resolved.error,
          })
          return
        }

        patchHistoryEntry(tabId, targetIndex, {
          title: resolved.title,
          html: resolved.frameHtml,
          pageTokens: undefined,
        })
        setTabPageState(tabId, {
          loading: false,
          streaming: false,
          html: resolved.frameHtml,
          rawText: '',
          reasoningText: '',
          pageTokens: undefined,
          error: undefined,
        })
        pageHtmlByTabRef.current[tabId] = resolved.frameHtml
        commitPageVisit(url, resolved.title)
        return
      }

      if (isFileDocumentUrl(url)) {
        void loadFileDocumentPage(tabId, url, targetIndex)
        return
      }

      const persisted = context?.skipCache ? undefined : getCachedPage(url)
      if (persisted) {
        applyCachedPage(tabId, targetIndex, url, persisted)
        return
      }

      const genContext = buildGenContext(url, fromUrl, fromHtml)
      void loadRemotePage(tabId, url, targetIndex, genContext)
    },
    [
      applyCachedPage,
      buildGenContext,
      cancelGeneration,
      formatAddressInput,
      loadFileDocumentPage,
      loadRemotePage,
      patchHistoryEntry,
      setTabPageState,
      tabs,
    ],
  )

  const navigateActive = useCallback(
    (rawUrl: string, context?: NavigateContext) => {
      navigate(activeTabId, rawUrl, context)
    },
    [activeTabId, navigate],
  )

  const openLocalDocument = useCallback(
    async (documentRef: string) => {
      if (openingDocumentIdRef.current === documentRef) {
        return
      }
      openingDocumentIdRef.current = documentRef

      try {
        const { node, text } = await readTextFile(documentRef)
        const frameHtml = htmlForFileDocument(node, text)
        const url = await buildFileDocumentUrl(node)
        const absolutePath = await resolveFilesAbsolutePath(node)
        const title = node.name
        const entry: HistoryEntry = {
          url,
          title,
          html: frameHtml,
          pageTokens: undefined,
          documentId: absolutePath,
        }
        const pageState: PageState = {
          loading: false,
          streaming: false,
          html: frameHtml,
          rawText: '',
          reasoningText: '',
          pageTokens: undefined,
          error: undefined,
        }

        const soleStartTab =
          tabs.length === 1 &&
          tabs[0] &&
          isStartPageUrl(tabs[0].history[tabs[0].historyIndex]?.url ?? START_PAGE_URL)
            ? tabs[0]
            : undefined

        if (soleStartTab) {
          cancelGeneration(soleStartTab.id)
          pageHtmlByTabRef.current[soleStartTab.id] = frameHtml
          setTabs([
            {
              ...soleStartTab,
              history: [entry],
              historyIndex: 0,
              inputUrl: formatAddressInput(url),
              pageState,
            },
          ])
          setActiveTabId(soleStartTab.id)
        } else {
          const tab = createSafariTab()
          pageHtmlByTabRef.current[tab.id] = frameHtml
          setTabs((prev) => [
            ...prev,
            {
              ...tab,
              history: [entry],
              historyIndex: 0,
              inputUrl: formatAddressInput(url),
              pageState,
            },
          ])
          setActiveTabId(tab.id)
        }

        setAddressFocused(false)
        setAppWindowDocumentId('browser', absolutePath)
        lastOpenedDocumentIdRef.current = absolutePath
      } catch (error) {
        lastOpenedDocumentIdRef.current = undefined
        await modal.alert({
          title: '无法打开',
          message: error instanceof Error ? error.message : '无法打开本机文件',
          themeColor: '#007aff',
        })
      } finally {
        if (openingDocumentIdRef.current === documentRef) {
          openingDocumentIdRef.current = undefined
        }
      }
    },
    [cancelGeneration, formatAddressInput, modal, setAppWindowDocumentId, tabs],
  )

  useEffect(() => {
    if (!pendingDocumentId) {
      return
    }
    if (lastOpenedDocumentIdRef.current === pendingDocumentId) {
      return
    }
    void openLocalDocument(pendingDocumentId)
  }, [openLocalDocument, pendingDocumentId])

  useEffect(() => {
    if (!pendingUrl) {
      return
    }
    if (lastOpenedUrlRef.current === pendingUrl) {
      return
    }
    if (openingUrlRef.current === pendingUrl) {
      return
    }
    openingUrlRef.current = pendingUrl
    lastOpenedUrlRef.current = pendingUrl
    lastOpenedDocumentIdRef.current = undefined
    navigateActive(pendingUrl)
    setAppWindowUrl('browser', pendingUrl)
    openingUrlRef.current = undefined
  }, [navigateActive, pendingUrl, setAppWindowUrl])

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

  // 起始空白页（新建标签）始终露出工具栏，便于输入网址
  const toolbarAutoHide =
    browserFullscreen && !alwaysShowToolbarInFullscreen && !onStartPage
  const toolbarInteractionPinned =
    addressFocused ||
    historyOpen ||
    tabsOverflowOpen ||
    bookmarksOverflowOpen ||
    showAddressSuggestions ||
    contextMenu !== undefined ||
    bookmarkContextMenu !== undefined
  const toolbarVisible = !toolbarAutoHide || fullscreenToolbarRevealed || toolbarInteractionPinned

  useEffect(() => {
    if (!toolbarAutoHide) {
      setFullscreenToolbarRevealed(false)
    }
  }, [toolbarAutoHide])

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

  useEffect(() => {
    setChromePinSource(
      'browser-panels',
      showAddressSuggestions ||
        contextMenu !== undefined ||
        bookmarkContextMenu !== undefined,
    )
  }, [bookmarkContextMenu, contextMenu, setChromePinSource, showAddressSuggestions])

  const navigateFromPageForTab = useCallback(
    (tabId: string, rawUrl: string) => {
      const url = normalizeBrowserUrl(rawUrl)

      if (isEmbeddedAppOrigin(url)) {
        return
      }

      const tab = tabs.find((item) => item.id === tabId)
      const fromEntry = tab?.history[tab?.historyIndex ?? 0] ?? INITIAL_ENTRY

      // 页内锚点 / 同文档链接不应触发重新加载（AI 页常写 href="#"，会被 <base> 解析成当前站 URL）
      if (isSameDocumentUrl(url, fromEntry.url)) {
        return
      }

      // 防抖必须用单调真实时钟：osNowMs() 在虚拟历史时间下精度/回拨不可靠
      const now = performance.now()
      const last = lastPageNavByTabRef.current[tabId] ?? { url: '', at: 0 }
      if (last.url === url && now - last.at < 600) {
        return
      }
      lastPageNavByTabRef.current[tabId] = { url, at: now }

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

      if (isViewSourceUrl(entry.url)) {
        const resolved = resolveViewSourceFrame(entry.url)
        if ('error' in resolved) {
          patchHistoryEntry(tabId, tab.historyIndex, { html: undefined, pageTokens: undefined })
          setTabPageState(tabId, {
            loading: false,
            streaming: false,
            html: '',
            rawText: '',
            reasoningText: '',
            pageTokens: undefined,
            error: resolved.error,
          })
          return
        }
        patchHistoryEntry(tabId, tab.historyIndex, {
          title: resolved.title,
          html: resolved.frameHtml,
          pageTokens: undefined,
        })
        setTabPageState(tabId, {
          loading: false,
          streaming: false,
          html: resolved.frameHtml,
          rawText: '',
          reasoningText: '',
          pageTokens: undefined,
          error: undefined,
        })
        pageHtmlByTabRef.current[tabId] = resolved.frameHtml
        return
      }

      patchHistoryEntry(tabId, tab.historyIndex, { html: undefined, pageTokens: undefined })
      const genContext = buildGenContext(entry.url, entry.url, tab.pageState.html || entry.html)
      void loadRemotePage(tabId, entry.url, tab.historyIndex, { ...genContext, force: true })
    },
    [buildGenContext, loadRemotePage, patchHistoryEntry, setTabPageState, tabs],
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

    if (isViewSourceUrl(current.url)) {
      const resolved = resolveViewSourceFrame(current.url)
      if ('error' in resolved) {
        patchHistoryEntry(activeTabId, historyIndex, { html: undefined, pageTokens: undefined })
        setTabPageState(activeTabId, {
          loading: false,
          streaming: false,
          html: '',
          rawText: '',
          reasoningText: '',
          pageTokens: undefined,
          error: resolved.error,
        })
        return
      }
      patchHistoryEntry(activeTabId, historyIndex, {
        title: resolved.title,
        html: resolved.frameHtml,
        pageTokens: undefined,
      })
      setTabPageState(activeTabId, {
        loading: false,
        streaming: false,
        html: resolved.frameHtml,
        rawText: '',
        reasoningText: '',
        pageTokens: undefined,
        error: undefined,
      })
      pageHtmlByTabRef.current[activeTabId] = resolved.frameHtml
      return
    }

    if (isFileDocumentUrl(current.url)) {
      patchHistoryEntry(activeTabId, historyIndex, { html: undefined, pageTokens: undefined })
      void loadFileDocumentPage(activeTabId, current.url, historyIndex, current.documentId)
      return
    }

    patchHistoryEntry(activeTabId, historyIndex, { html: undefined, pageTokens: undefined })
    const genContext = buildGenContext(current.url, current.url, pageState.html || current.html)
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

  const currentHostname = onStartPage ? undefined : hostnameFromUrl(current.url)
  const storedDomainTokens = currentHostname
    ? (tokenUsage.byDomain[currentHostname]?.totalTokens ?? 0)
    : 0
  const domainTokens =
    showProgress && pageState.pageTokens !== undefined
      ? storedDomainTokens + pageState.pageTokens
      : storedDomainTokens

  const scrubSiteHtmlFromTabs = useCallback((hostname: string) => {
    setTabs((prev) =>
      prev.map((tab) => {
        let changed = false
        const nextHistory = tab.history.map((entry) => {
          if (isStartPageUrl(entry.url) || !isSameSite(entry.url, `https://${hostname}/`)) {
            return entry
          }
          if (entry.html === undefined && entry.pageTokens === undefined) {
            return entry
          }
          changed = true
          return { ...entry, html: undefined, pageTokens: undefined }
        })

        const entry = nextHistory[tab.historyIndex] ?? INITIAL_ENTRY
        const onSite = !isStartPageUrl(entry.url) && isSameSite(entry.url, `https://${hostname}/`)
        if (onSite) {
          delete pageHtmlByTabRef.current[tab.id]
        }

        const nextPageState =
          onSite && (tab.pageState.html || tab.pageState.rawText || tab.pageState.reasoningText)
            ? {
                ...tab.pageState,
                html: '',
                rawText: '',
                reasoningText: '',
                pageTokens: undefined,
                error: undefined,
                loading: false,
                streaming: false,
              }
            : tab.pageState

        if (nextPageState !== tab.pageState) {
          changed = true
        }

        return changed ? { ...tab, history: nextHistory, pageState: nextPageState } : tab
      }),
    )
  }, [])

  const clearCurrentPageCache = useCallback(async () => {
    if (isStartPageUrl(current.url) || isViewSourceUrl(current.url)) {
      return
    }

    const confirmed = await modal.confirm({
      title: '清除当前页面缓存？',
      message: '将删除此页面的已生成内容，并重新生成当前页。',
      confirmLabel: '清除并重新加载',
      confirmTone: 'danger',
    })
    if (!confirmed) {
      return
    }

    removeCachedPage(current.url)
    patchHistoryEntry(activeTabId, historyIndex, { html: undefined, pageTokens: undefined })
    delete pageHtmlByTabRef.current[activeTabId]
    const genContext = buildGenContext(current.url, current.url, undefined)
    void loadRemotePage(activeTabId, current.url, historyIndex, { ...genContext, force: true })
  }, [
    activeTabId,
    buildGenContext,
    current.url,
    historyIndex,
    loadRemotePage,
    modal,
    patchHistoryEntry,
  ])

  const clearCurrentSiteData = useCallback(async () => {
    const hostname = hostnameFromUrl(current.url)
    if (!hostname || isStartPageUrl(current.url) || isViewSourceUrl(current.url)) {
      return
    }

    const confirmed = await modal.confirm({
      title: `清除「${hostname}」的网站数据？`,
      message: '将删除该网站的网页缓存与浏览记录。书签不受影响。打开中的相关标签页会重新生成。',
      confirmLabel: '清除',
      confirmTone: 'danger',
    })
    if (!confirmed) {
      return
    }

    clearSitePageCache(hostname)
    clearBrowserHistoryByHostname(hostname)
    setHistoryRevision((value) => value + 1)
    scrubSiteHtmlFromTabs(hostname)

    const stillOnSite = isSameSite(current.url, `https://${hostname}/`)
    if (stillOnSite) {
      patchHistoryEntry(activeTabId, historyIndex, { html: undefined, pageTokens: undefined })
      delete pageHtmlByTabRef.current[activeTabId]
      const genContext = buildGenContext(current.url, current.url, undefined)
      void loadRemotePage(activeTabId, current.url, historyIndex, { ...genContext, force: true })
    }
  }, [
    activeTabId,
    buildGenContext,
    current.url,
    historyIndex,
    loadRemotePage,
    modal,
    patchHistoryEntry,
    scrubSiteHtmlFromTabs,
  ])

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

      if (isViewSourceUrl(url)) {
        const resolved = resolveViewSourceFrame(url, options?.context?.sourceHtml)
        if ('error' in resolved) {
          setTabs((prev) => [
            ...prev,
            {
              ...tab,
              history: [{ url, title, html: undefined, pageTokens: undefined }],
              historyIndex: 0,
              inputUrl: formatAddressInput(url),
              pageState: {
                loading: false,
                streaming: false,
                html: '',
                rawText: '',
                reasoningText: '',
                pageTokens: undefined,
                error: resolved.error,
              },
            },
          ])
        } else {
          const entry: HistoryEntry = {
            url,
            title: resolved.title,
            html: resolved.frameHtml,
            pageTokens: undefined,
          }
          pageHtmlByTabRef.current[tabId] = resolved.frameHtml
          setTabs((prev) => [
            ...prev,
            {
              ...tab,
              history: [entry],
              historyIndex: 0,
              inputUrl: formatAddressInput(url),
              pageState: {
                loading: false,
                streaming: false,
                html: resolved.frameHtml,
                rawText: '',
                reasoningText: '',
                pageTokens: undefined,
                error: undefined,
              },
            },
          ])
          commitPageVisit(url, resolved.title)
        }
        if (!options?.background) {
          setActiveTabId(tabId)
          setAddressFocused(false)
        }
        return
      }

      if (isFileDocumentUrl(url)) {
        setTabs((prev) => [
          ...prev,
          {
            ...tab,
            history: [{ url, title, html: undefined, pageTokens: undefined }],
            historyIndex: 0,
            inputUrl: formatAddressInput(url),
            pageState: {
              loading: true,
              streaming: false,
              html: '',
              rawText: '',
              reasoningText: '',
              pageTokens: undefined,
              error: undefined,
            },
          },
        ])
        if (!options?.background) {
          setActiveTabId(tabId)
          setAddressFocused(false)
        }
        void loadFileDocumentPage(tabId, url, 0)
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
          inputUrl: formatAddressInput(url),
          pageState: cachedHtml
            ? {
                loading: false,
                streaming: false,
                html: cachedHtml,
                rawText: '',
                reasoningText: '',
                pageTokens: persisted?.pageTokens,
                error: undefined,
              }
            : {
                loading: true,
                streaming: false,
                html: '',
                rawText: '',
                reasoningText: '',
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

      const genContext = buildGenContext(url, fromUrl)
      void loadRemotePage(tabId, url, 0, genContext)
    },
    [buildGenContext, formatAddressInput, loadFileDocumentPage, loadRemotePage],
  )

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // clipboard unavailable
    }
  }, [])

  const copyCurrentPageUrl = useCallback(() => {
    if (isStartPageUrl(current.url)) {
      return
    }
    void copyToClipboard(current.url)
  }, [copyToClipboard, current.url])

  const canViewPageSource =
    !onStartPage &&
    !isViewSourceUrl(current.url) &&
    Boolean(pageState.html || pageHtmlByTabRef.current[activeTabId] || getCachedPage(current.url)?.html)

  const viewSourceCurrentPage = useCallback(() => {
    if (isStartPageUrl(current.url) || isViewSourceUrl(current.url)) {
      return
    }

    const sourceHtml =
      pageState.html ||
      pageHtmlByTabRef.current[activeTabId] ||
      getCachedPage(current.url)?.html
    if (!sourceHtml) {
      return
    }

    navigateInNewTab(toViewSourceUrl(current.url), {
      context: { sourceHtml },
    })
  }, [activeTabId, current.url, navigateInNewTab, pageState.html])

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
        label: currentBookmarked ? '移除书签' : '添加书签',
        onClick: toggleBookmarkForCurrentPage,
      })
      items.push({
        type: 'action',
        label: '在新标签页中打开此页',
        onClick: () => openInNewTab(referrerUrl),
      })
      items.push({
        type: 'action',
        label: '查看网页源代码',
        disabled: !canViewPageSource,
        onClick: viewSourceCurrentPage,
      })
    }

    return items
  }, [
    canViewPageSource,
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
    viewSourceCurrentPage,
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
        onClick: () => {
          setBookmarksOverflowOpen(false)
          navigateActive(bookmark.url)
        },
      },
      {
        type: 'action',
        label: '在新标签页中打开',
        onClick: () => {
          setBookmarksOverflowOpen(false)
          navigateInNewTab(bookmark.url)
        },
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
  }, [bookmarkContextMenu, bumpBookmarksRevision, navigateActive, navigateInNewTab, setBookmarksOverflowOpen])

  // 未聚焦且未勾选「完整网址」时只显示域名（与 Safari 一致）；聚焦后再展示可编辑的路径文本
  // view-source: 始终展示完整地址（对齐 Chrome）
  const addressValue = addressFocused
    ? inputUrl
    : onStartPage
      ? ''
      : alwaysShowFullUrl || isViewSourceUrl(current.url)
        ? current.url
        : hostnameFromUrl(current.url)

  const tabSummaries = useMemo(
    () =>
      tabs.map((tab) => {
        const entry = tab.history[tab.historyIndex] ?? INITIAL_ENTRY
        const start = isStartPageUrl(entry.url)
        return {
          id: tab.id,
          title: tabDisplayTitle(tab),
          url: start ? undefined : entry.url,
          loading: tab.pageState.loading || tab.pageState.streaming,
          isStartPage: start,
          siteInitial: start ? undefined : hostnameFromUrl(entry.url).charAt(0).toUpperCase(),
        }
      }),
    [tabs],
  )

  const hiddenTabSummaries = useMemo(
    () => tabSummaries.filter((tab) => hiddenTabIds.includes(tab.id)),
    [hiddenTabIds, tabSummaries],
  )

  useEffect(() => {
    if (hiddenTabIds.length === 0) {
      setTabsOverflowOpen(false)
    }
  }, [hiddenTabIds.length])

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
    viewSource: () => {},
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
    viewSource: viewSourceCurrentPage,
  }

  const toggleAlwaysShowToolbarInFullscreen = useCallback(() => {
    const next = !alwaysShowToolbarInFullscreen
    if (!patchBrowserSettings({ alwaysShowToolbarInFullscreen: next })) {
      return
    }
    setAlwaysShowToolbarInFullscreen(next)
  }, [alwaysShowToolbarInFullscreen])

  const toggleAlwaysShowFullUrl = useCallback(() => {
    const next = !alwaysShowFullUrl
    if (!patchBrowserSettings({ alwaysShowFullUrl: next })) {
      return
    }
    setAlwaysShowFullUrl(next)
    if (!addressFocused && !onStartPage) {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTabId
            ? { ...tab, inputUrl: addressBarDisplayUrl(current.url, next) }
            : tab,
        ),
      )
    }
  }, [activeTabId, addressFocused, alwaysShowFullUrl, current.url, onStartPage])

  const menuBar = useMemo((): MenuDefinition[] => {
    const run = (action: keyof typeof menuActionsRef.current) => {
      menuActionsRef.current[action]()
    }

    const check = (active: boolean) => (active ? '✓ ' : '')

    return [
      {
        label: '网络浏览器',
        items: [
          ...aboutAppMenuPrefix('关于网络浏览器', () => showBuiltinAbout('browser')),
          { type: 'action', label: '隐藏网络浏览器', shortcut: '⌘H', onClick: () => run('hideSafari') },
          { type: 'separator' },
          { type: 'action', label: '退出网络浏览器', shortcut: '⌘Q', onClick: () => run('quitSafari') },
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
            label: currentBookmarked ? '移除书签' : '添加书签…',
            shortcut: '⌘D',
            onClick: () => run('toggleBookmark'),
            disabled: onStartPage,
          },
          { type: 'separator' },
          {
            type: 'action',
            label: bookmarksBarVisible ? '隐藏书签栏' : '显示书签栏',
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
        label: '网页',
        items: [
          {
            type: 'action',
            label: '复制页面地址',
            onClick: () => copyCurrentPageUrl(),
            disabled: onStartPage,
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '清除当前页面缓存…',
            onClick: () => void clearCurrentPageCache(),
            disabled: onStartPage || isViewSourceUrl(current.url),
          },
          {
            type: 'action',
            label: currentHostname ? `清除「${currentHostname}」的数据…` : '清除该网站数据…',
            onClick: () => void clearCurrentSiteData(),
            disabled: onStartPage || isViewSourceUrl(current.url),
          },
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
          {
            type: 'action',
            label: '查看网页源代码',
            shortcut: '⌥⌘U',
            onClick: () => run('viewSource'),
            disabled: !canViewPageSource,
          },
          { type: 'separator' },
          {
            type: 'action',
            label: `${check(alwaysShowToolbarInFullscreen)}在全屏模式下始终显示工具栏`,
            shortcut: '⇧⌘F',
            onClick: () => toggleAlwaysShowToolbarInFullscreen(),
          },
          {
            type: 'action',
            label: `${check(alwaysShowFullUrl)}始终显示完整网址`,
            onClick: () => toggleAlwaysShowFullUrl(),
          },
        ],
      },
    ]
  }, [
    alwaysShowFullUrl,
    alwaysShowToolbarInFullscreen,
    bookmarksBarVisible,
    canViewPageSource,
    clearCurrentPageCache,
    clearCurrentSiteData,
    copyCurrentPageUrl,
    current.url,
    currentBookmarked,
    currentHostname,
    history.length,
    historyIndex,
    historyOpen,
    onStartPage,
    showBuiltinAbout,
    showProgress,
    toggleAlwaysShowFullUrl,
    toggleAlwaysShowToolbarInFullscreen,
  ])

  useAppMenuBar('browser', menuBar)

  return (
    <div
      class={[
        'safari',
        toolbarAutoHide ? 'safari--toolbar-autohide' : '',
        toolbarAutoHide && toolbarVisible ? 'safari--toolbar-revealed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      ref={attachSafariRoot}
    >
      {toolbarAutoHide && !toolbarVisible && (
        <div
          class="safari__toolbar-reveal-sensor"
          aria-hidden="true"
          onPointerEnter={() => setFullscreenToolbarRevealed(true)}
          onPointerMove={() => setFullscreenToolbarRevealed(true)}
        />
      )}
      <header
        class="safari__chrome"
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
        <SafariTabBar
          tabs={tabSummaries}
          activeTabId={activeTabId}
          overflowOpen={tabsOverflowOpen}
          onSelectTab={selectTab}
          onCloseTab={closeTab}
          onNewTab={addTab}
          onToggleOverflow={() =>
            setTabsOverflowOpen((open) => {
              const next = !open
              if (next) {
                setHistoryOpen(false)
                setBookmarksOverflowOpen(false)
              }
              return next
            })
          }
          onHiddenTabsChange={setHiddenTabIds}
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
              class={`safari__address ${addressFocused ? 'safari__address--focused' : ''} ${showProgress ? 'safari__address--loading' : ''} ${addressDraggable ? 'safari__address--draggable' : ''}`}
              draggable={addressDraggable}
              onDragStart={handleAddressDragStart}
              onDragEnd={handleAddressDragEnd}
              onClick={handleAddressClickToFocus}
            >
              <span class="safari__address-leading" aria-hidden="true">
                {showProgress ? undefined : !onStartPage ? (
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
                    inputUrl: formatAddressInput(current.url),
                  }))
                }}
                onBlur={() => {
                  setAddressFocused(false)
                  if (!onStartPage) {
                    updateTab(activeTabId, (tab) => ({
                      ...tab,
                      inputUrl: formatAddressInput(current.url),
                    }))
                  }
                }}
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
              aria-label={currentBookmarked ? '移除书签' : '添加书签'}
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
              onClick={() =>
                setHistoryOpen((open) => {
                  const next = !open
                  if (next) {
                    setTabsOverflowOpen(false)
                    setBookmarksOverflowOpen(false)
                  }
                  return next
                })
              }
              aria-label="历史记录"
              aria-pressed={historyOpen}
            >
              <HistoryIcon />
            </button>
          </div>
        </div>

        {bookmarksBarVisible && (
          <SafariBookmarksBar
            revision={bookmarksRevision}
            overflowOpen={bookmarksOverflowOpen}
            onToggleOverflow={() => {
              setBookmarksOverflowOpen((open) => {
                const next = !open
                if (next) {
                  setHistoryOpen(false)
                  setTabsOverflowOpen(false)
                }
                return next
              })
            }}
            onNavigate={navigateActive}
            onContextMenu={setBookmarkContextMenu}
            onAddBookmark={addBookmarkAt}
            onReorder={reorderBookmark}
          />
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

      <main class="safari__viewport" ref={viewportRef}>
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
              reasoningText={tabPageState.reasoningText}
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
              onDismissOverlay={
                isActive
                  ? () => {
                      setContextMenu(undefined)
                      setBookmarkContextMenu(undefined)
                    }
                  : undefined
              }
            />
          )
        })}
        <AdaptiveActionMenu
          open={contextMenu !== undefined}
          title="页面"
          items={contextMenuItems}
          narrowLayout={narrowLayout}
          anchor={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : undefined}
          mount="portal"
          onClose={() => setContextMenu(undefined)}
        />
      </main>

      {(livePageTokens !== undefined && livePageTokens > 0) || domainTokens > 0 ? (
        <div class="safari__dev-badge" title="本页 / 本站累计（开发信息）">
          {livePageTokens !== undefined && livePageTokens > 0 ? (
            <span>
              {tokensEstimated ? '~' : ''}
              {formatCompactTokenCount(livePageTokens)}
            </span>
          ) : undefined}
          {livePageTokens !== undefined && livePageTokens > 0 && domainTokens > 0 ? (
            <span>/</span>
          ) : undefined}
          {domainTokens > 0 ? <span>{formatCompactTokenCount(domainTokens)}</span> : undefined}
        </div>
      ) : undefined}

      <SafariHistoryPanel
        open={historyOpen}
        revision={historyRevision}
        onClose={() => setHistoryOpen(false)}
        onNavigate={navigateActive}
        onHistoryChange={() => setHistoryRevision((value) => value + 1)}
      />

      <SafariTabsPanel
        open={tabsOverflowOpen}
        tabs={hiddenTabSummaries}
        activeTabId={activeTabId}
        onClose={() => setTabsOverflowOpen(false)}
        onSelectTab={selectTab}
        onCloseTab={closeTab}
      />

      <SafariBookmarksPanel
        open={bookmarksOverflowOpen}
        revision={bookmarksRevision}
        contextMenuOpen={bookmarkContextMenu !== undefined && !narrowLayout}
        onClose={() => setBookmarksOverflowOpen(false)}
        onDismissContextMenu={() => setBookmarkContextMenu(undefined)}
        onNavigate={navigateActive}
        onContextMenu={setBookmarkContextMenu}
        onReorder={reorderBookmark}
        onAddBookmark={addBookmarkAt}
      />

      <AdaptiveActionMenu
        open={bookmarkContextMenu !== undefined}
        title={
          bookmarkContextMenu
            ? bookmarkContextMenu.bookmark.title ||
              hostnameFromUrl(bookmarkContextMenu.bookmark.url)
            : '书签'
        }
        items={bookmarkContextMenuItems}
        narrowLayout={narrowLayout}
        anchor={
          bookmarkContextMenu
            ? { x: bookmarkContextMenu.x, y: bookmarkContextMenu.y }
            : undefined
        }
        mount="portal"
        onClose={() => setBookmarkContextMenu(undefined)}
      />
    </div>
  )
}
