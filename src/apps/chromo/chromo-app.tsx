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
import { ChromoDevToolsPanel } from './chromo-devtools-panel.tsx'
import { ChromoTabBar, type ChromoTabSummary } from './chromo-tab-bar.tsx'
import { ChromoViewerFrame, type ChromoViewerHandle } from './chromo-viewer-frame.tsx'
import './chromo.css'

type ChromoDevToolsTab = 'console' | 'elements' | 'network'

type ChromoTab = {
  id: string
  sessionId: string
  url: string
  title: string
  inputUrl: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  ready: boolean
  bootstrapped: boolean
  error?: string
  consoleEntries: ChromoConsoleEntry[]
  replEntries: ChromoConsoleDisplayEntry[]
  replHistory: string[]
  preserveConsole: boolean
  lastConsoleId: string
  networkEntries: ChromoNetworkEntry[]
  lastNetworkId: string
  selectedNetworkId: string
}

let nextTabId = 1

function createChromoTab(initialUrl = ''): ChromoTab {
  const id = `chromo-tab-${nextTabId++}`
  const sessionId = crypto.randomUUID()
  const url = initialUrl ? normalizeChromoUrl(initialUrl) : ''
  const title = url ? pageTitleFromUrl(url) : '新标签页'
  return {
    id,
    sessionId,
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

function siteInitialFromUrl(url: string): string | undefined {
  const host = hostnameFromUrl(url)
  return host ? host.charAt(0).toUpperCase() : undefined
}

export function ChromoApp() {
  const { closeWindowsForApp, minimizeWindow, windows, setAppWindowUrl } = useOs()
  const { setChromePinSource } = useFullscreenChromeReveal()
  const { showBuiltinAbout } = useAboutApp()
  const appWindow = windows.find((window) => window.appId === 'chromo' && !window.closing)
  const chromoWindow = windows.find((window) => window.appId === 'chromo' && !window.minimized)
  const chromoFullscreen = Boolean(chromoWindow?.fullscreen)
  const pendingUrl = appWindow?.url

  const [tabs, setTabs] = useState<ChromoTab[]>(() => [createChromoTab()])
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id ?? '')
  const [addressFocused, setAddressFocused] = useState(false)
  const [tabsOverflowOpen, setTabsOverflowOpen] = useState(false)
  const [hiddenTabIds, setHiddenTabIds] = useState<string[]>([])
  const [fullscreenToolbarRevealed, setFullscreenToolbarRevealed] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [devtoolsOpen, setDevtoolsOpen] = useState(false)
  const [devtoolsTab, setDevtoolsTab] = useState<ChromoDevToolsTab>('console')

  const viewerRefs = useRef<Record<string, RefObject<ChromoViewerHandle>>>({})
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeTabIdRef = useRef(activeTabId)
  activeTabIdRef.current = activeTabId
  const lastOpenedUrlRef = useRef<string | undefined>(undefined)
  const prevPendingUrlRef = useRef<string | undefined>(undefined)
  /** 每个标签页最近一次主动请求的 URL，用于忽略过期的 VC_NAVIGATED */
  const requestedUrlByTabRef = useRef<Record<string, string>>({})
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
    (tabId: string, url: string) => {
      const normalized = normalizeChromoUrl(url)
      requestedUrlByTabRef.current[tabId] = normalized
      lastOpenedUrlRef.current = normalized
      updateTab(tabId, (tab) => ({
        ...tab,
        url: normalized,
        title: pageTitleFromUrl(normalized),
        inputUrl: displayUrl(normalized),
        loading: true,
        error: undefined,
        bootstrapped: true,
      }))
      getViewerRef(tabId).current?.navigate(normalized)
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
      const closing = tabsRef.current.find((tab) => tab.id === tabId)
      if (closing) {
        getViewerRef(tabId).current?.destroySession(closing.sessionId)
      }

      setTabs((current) => {
        if (current.length <= 1) {
          const replacement = createChromoTab()
          setActiveTabId(replacement.id)
          delete viewerRefs.current[tabId]
          return [replacement]
        }

        const index = current.findIndex((tab) => tab.id === tabId)
        if (index === -1) {
          return current
        }

        const next = current.filter((tab) => tab.id !== tabId)
        delete viewerRefs.current[tabId]

        if (activeTabId === tabId) {
          const fallback = next[Math.max(0, index - 1)] ?? next[0]
          if (fallback) {
            setActiveTabId(fallback.id)
          }
        }

        return next
      })
    },
    [activeTabId, cancelClickNavigate, getViewerRef],
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
    updateTab(activeTab.id, (tab) => ({ ...tab, loading: true, error: undefined }))
    getViewerRef(activeTab.id).current?.reload()
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

        updateTab(tabId, (entry) => ({
          ...entry,
          consoleEntries: [...entry.consoleEntries, ...result.entries],
          lastConsoleId: result.latestId ?? entry.lastConsoleId,
        }))
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
          if (result.latestId) {
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
      updateTab(tabId, (entry) => ({
        ...entry,
        consoleEntries: [],
        replEntries: [],
        lastConsoleId: '',
      }))
    },
    [updateTab],
  )

  const clearTabNetwork = useCallback(
    (tabId: string) => {
      updateTab(tabId, (entry) => ({
        ...entry,
        networkEntries: [],
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

  useEffect(() => {
    if (!devtoolsOpen || devtoolsTab !== 'network' || !activeTabId) {
      return
    }
    void pullNetworkDelta(activeTabId)
  }, [devtoolsOpen, devtoolsTab, activeTabId, pullNetworkDelta])

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
    addressFocused || tabsOverflowOpen || sidebarOpen || devtoolsOpen

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
                devtoolsOpen ? 'chromo__btn--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setDevtoolsOpen((open) => !open)}
              aria-label="DevTools"
              aria-pressed={devtoolsOpen}
              title="DevTools"
            >
              DevTools
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
        <div class="chromo__main-column">
          <main class="chromo__viewport">
            {activeTab?.error && <div class="chromo__error-banner">{activeTab.error}</div>}
            {tabs.map((tab) => (
              <ChromoViewerFrame
              key={tab.id}
              sessionId={tab.sessionId}
              initialUrl={tab.url || undefined}
              ref={getViewerRef(tab.id)}
              active={tab.id === activeTabId}
              onReady={() => {
                updateTab(tab.id, (entry) => ({
                  ...entry,
                  ready: true,
                  bootstrapped: entry.url ? true : entry.bootstrapped,
                }))
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
                  error: undefined,
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
                  error: undefined,
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
                }, 300)
              }}
              onLoadFailed={({ url, message, code }) => {
                updateTab(tab.id, (entry) => ({
                  ...entry,
                  loading: false,
                  error: code
                    ? `${code}: ${message ?? '页面加载失败'} (${url})`
                    : `${message ?? '页面加载失败'} (${url})`,
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
              onError={({ message, code }) => {
                updateTab(tab.id, (entry) => ({
                  ...entry,
                  loading: false,
                  error: code ? `${code}: ${message}` : message,
                }))
              }}
              onLocation={({ url, method }) => {
                // window.open → 新标签；location.assign/replace 等 → 当前标签
                if (method === 'open' && url) {
                  addTab(url)
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
                  error: undefined,
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
                cancelClickNavigate(tab.id)
                clickNavigateTimersRef.current[tab.id] = window.setTimeout(() => {
                  delete clickNavigateTimersRef.current[tab.id]
                  navigateTab(tab.id, href)
                }, 150)
              }}
              />
            ))}
          </main>

          {devtoolsOpen && activeTab && (
            <ChromoDevToolsPanel
              activeTab={devtoolsTab}
              onTabChange={setDevtoolsTab}
              onClose={() => setDevtoolsOpen(false)}
              preserveLog={activeTab.preserveConsole}
              onPreserveLogChange={(preserve) => updateTabPreserveConsole(activeTab.id, preserve)}
              onClear={() => {
                if (devtoolsTab === 'network') {
                  clearTabNetwork(activeTab.id)
                  return
                }
                clearTabConsole(activeTab.id)
              }}
              entries={mergeConsoleDisplayEntries(
                activeTab.consoleEntries,
                activeTab.replEntries,
              )}
              pageReady={Boolean(activeTab.ready && activeTab.url && !activeTab.loading)}
              evalInPage={evalInActivePage}
              replHistory={activeTab.replHistory}
              onReplHistoryChange={(history) => updateTabReplHistory(activeTab.id, history)}
              onAppendEntries={(entries) => appendTabConsoleEntries(activeTab.id, entries)}
              networkEntries={activeTab.networkEntries}
              selectedNetworkId={activeTab.selectedNetworkId || undefined}
              onSelectNetwork={(entry) => selectTabNetwork(activeTab.id, entry)}
            />
          )}
        </div>

        {sidebarOpen && (
          <ChromoAgentSidebar
            pageUrl={activeTab?.url ?? ''}
            pageTitle={activeTab?.title ?? ''}
            pageReady={Boolean(activeTab?.ready && activeTab.url && !activeTab.loading)}
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
