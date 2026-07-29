import { createRef } from 'preact'
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import type { RefObject } from 'preact'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs, useWindowCloseGuard } from '../../os/os-context.tsx'
import { openDevTools } from '../../page-host/open-devtools.ts'
import { PageFaultView } from '../../page-host/page-fault-view.tsx'
import {
  resolveNavIntent,
  shouldCreateTab,
  shouldNavigateSameTab,
} from '../../page-host/page-nav.ts'
import { displayPageUrl, normalizePageUrl, pageTitleFromUrl } from '../../page-host/page-url.ts'
import { PageViewerFrame, type PageViewerHandle } from '../../page-host/page-viewer-frame.tsx'
import { DocumentTabBar } from '../../ui/document-tab-bar.tsx'
import {
  addWebViewTab,
  closeWebViewTab,
  destroyWebViewUnit,
  getWebViewUnit,
  onWebViewRegistryChanged,
  setWebViewUiDisplayedTab,
  setWebViewUnitVisible,
  updateWebViewTab,
} from './webview-registry.ts'
import '../chromo/chromo.css'
import './webview.css'

const APP_ID = 'webview' as const

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
    updateWebViewTab(unit.unitId, displayedTab.id, (tab) => ({
      ...tab,
      devtoolsUndocked: true,
      devtoolsOpen: false,
    }))
  }, [displayedTab, openApp, unit])

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
              updateWebViewTab(unit.unitId, tab.id, (entry) => ({
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
            onLoadFailed={(payload) => {
              updateWebViewTab(unit.unitId, tab.id, (entry) => ({
                ...entry,
                loading: false,
                pendingUrl: undefined,
                pageFault: {
                  severity: 'load',
                  code: payload.code,
                  message: payload.message || '页面加载失败',
                  url: payload.url,
                },
              }))
            }}
            onError={(payload) => {
              updateWebViewTab(unit.unitId, tab.id, (entry) => ({
                ...entry,
                loading: false,
                pageFault: {
                  severity: 'fatal',
                  code: payload.code,
                  message: payload.message,
                  bridgeBuild: payload.bridgeBuild,
                  swBuild: payload.swBuild,
                },
              }))
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
              updateWebViewTab(unit.unitId, tab.id, (entry) => ({
                ...entry,
                url: payload.url,
                pendingUrl: undefined,
                title: payload.title || pageTitleFromUrl(payload.url),
                inputUrl: displayPageUrl(payload.url),
                loading: false,
                pageFault: undefined,
              }))
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
  openApp: (appId: typeof APP_ID, options?: { documentId?: string }) => void,
  unitId: string,
): void {
  openApp(APP_ID, { documentId: unitId })
}

export function showWebViewWindow(
  options: {
    windows: { id: string; appId: string; documentId?: string; closing?: boolean; windowless?: boolean }[]
    openApp: (appId: typeof APP_ID, options?: { documentId?: string }) => void
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
  if (!existing) {
    options.openApp(APP_ID, { documentId: unitId })
    // reveal after open — poll briefly via microtask; caller may also call again
    queueMicrotask(() => {
      if (!getWebViewUnit(unitId)) return
      const created = options.windows.find(
        (window) =>
          window.appId === APP_ID && !window.closing && window.documentId === unitId,
      )
      if (created) {
        options.revealWindowlessPanel(created.id, {
          title: 'WebView',
          width: 960,
          height: 720,
          chromeKind: 'window',
        })
        setWebViewUnitVisible(unitId, true, created.id)
      }
    })
    return
  }
  options.revealWindowlessPanel(existing.id, {
    title: 'WebView',
    width: 960,
    height: 720,
    chromeKind: 'window',
  })
  options.focusWindow(existing.id)
  setWebViewUnitVisible(unitId, true, existing.id)
}
