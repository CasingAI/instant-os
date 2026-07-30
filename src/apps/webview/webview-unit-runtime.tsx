import { createRef, type RefObject } from 'preact'
import { createPortal } from 'preact/compat'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import {
  formatPageFault,
  pageFaultFromError,
  pageFaultFromLoadFailed,
} from '../../page-host/page-fault.ts'
import {
  resolveNavIntent,
  shouldCreateTab,
  shouldNavigateSameTab,
} from '../../page-host/page-nav.ts'
import {
  displayPageUrl,
  isSameDocumentHashLink,
  normalizePageUrl,
  pageTitleFromUrl,
} from '../../page-host/page-url.ts'
import { PageViewerFrame, type PageViewerHandle } from '../../page-host/page-viewer-frame.tsx'
import type { ChromoNetworkEntry } from '../../page-host/page-bridge.ts'
import {
  addWebViewTab,
  emitWebViewNavigated,
  emitWebViewTabFault,
  getWebViewUnit,
  injectWebViewFaultDocument,
  onWebViewRegistryChanged,
  updateWebViewTab,
} from './webview-registry.ts'

type WebViewUnitRuntimeProps = {
  unitId: string
}

export function WebViewUnitRuntime({ unitId }: WebViewUnitRuntimeProps) {
  const [tick, setTick] = useState(0)
  const [offscreenEl, setOffscreenEl] = useState<HTMLDivElement | null>(null)

  useEffect(() => onWebViewRegistryChanged(() => setTick((n) => n + 1)), [])

  const unit = getWebViewUnit(unitId)

  const getViewerRef = useCallback(
    (tabId: string): RefObject<PageViewerHandle> => {
      const current = getWebViewUnit(unitId)
      if (!current) {
        return createRef<PageViewerHandle>()
      }
      if (!current.viewerRefs[tabId]) {
        current.viewerRefs[tabId] = createRef<PageViewerHandle>()
      }
      return current.viewerRefs[tabId]
    },
    [unitId, tick],
  )

  const networkPullTimersRef = useRef<Record<string, number>>({})
  const clickNavigateTimersRef = useRef<Record<string, number>>({})

  const cancelClickNavigate = useCallback((tabId: string) => {
    const timer = clickNavigateTimersRef.current[tabId]
    if (timer) {
      window.clearTimeout(timer)
      delete clickNavigateTimersRef.current[tabId]
    }
  }, [])

  const pullConsoleDelta = useCallback(
    async (tabId: string) => {
      const viewer = getViewerRef(tabId).current
      if (!viewer?.isReady()) return
      const tab = getWebViewUnit(unitId)?.tabs.find((entry) => entry.id === tabId)
      if (!tab) return
      try {
        const result = await viewer.readConsole({ after: tab.lastConsoleId || undefined })
        if (!result.entries.length) {
          if (result.latestId) {
            updateWebViewTab(unitId, tabId, (entry) => ({
              ...entry,
              lastConsoleId: result.latestId!,
            }))
          }
          return
        }
        updateWebViewTab(unitId, tabId, (entry) => {
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
    [getViewerRef, unitId],
  )

  const pullNetworkDelta = useCallback(
    async (tabId: string, options?: { full?: boolean }) => {
      const viewer = getViewerRef(tabId).current
      if (!viewer?.isReady()) return
      const tab = getWebViewUnit(unitId)?.tabs.find((entry) => entry.id === tabId)
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
            updateWebViewTab(unitId, tabId, (entry) => ({
              ...entry,
              lastNetworkId: result.latestId!,
            }))
          }
          return
        }
        updateWebViewTab(unitId, tabId, (entry) => {
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
    [getViewerRef, unitId],
  )

  const ingestNetworkEntry = useCallback(
    (tabId: string, entry: ChromoNetworkEntry, latestId?: string) => {
      updateWebViewTab(unitId, tabId, (current) => {
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
    [unitId],
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
      for (const timer of Object.values(clickNavigateTimersRef.current)) {
        window.clearTimeout(timer)
      }
      clickNavigateTimersRef.current = {}
    }
  }, [])

  // DevTools 打开时预拉 console/network
  const pulledDevToolsKeysRef = useRef(new Set<string>())
  useEffect(() => {
    if (!unit) return
    const openTabs = unit.tabs.filter(
      (tab) => tab.devtoolsUndocked || (tab.devtoolsOpen && !tab.devtoolsUndocked),
    )
    const openKeys = new Set(openTabs.map((tab) => `${unit.unitId}:${tab.id}`))
    for (const key of [...pulledDevToolsKeysRef.current]) {
      if (!openKeys.has(key)) {
        pulledDevToolsKeysRef.current.delete(key)
      }
    }
    for (const tab of openTabs) {
      const key = `${unit.unitId}:${tab.id}`
      if (pulledDevToolsKeysRef.current.has(key)) continue
      pulledDevToolsKeysRef.current.add(key)
      void pullNetworkDelta(tab.id, { full: true })
      void pullConsoleDelta(tab.id)
    }
  }, [pullConsoleDelta, pullNetworkDelta, unit, tick])

  const navigateTab = useCallback(
    (tabId: string, url: string, options?: { method?: 'POST'; body?: string }) => {
      const current = getWebViewUnit(unitId)
      if (!current) return
      const normalized = normalizePageUrl(url)
      updateWebViewTab(unitId, tabId, (tab) => ({
        ...tab,
        url: normalized,
        pendingUrl: normalized,
        title: pageTitleFromUrl(normalized),
        inputUrl: displayPageUrl(normalized),
        loading: true,
        pageFault: undefined,
        bootstrapped: true,
      }))
      getViewerRef(tabId).current?.navigate(normalized, options)
    },
    [getViewerRef, unitId],
  )

  if (!unit) {
    return null
  }

  const portalTarget =
    unit.windowId && unit.viewportTarget ? unit.viewportTarget : offscreenEl

  const viewportContent = (
    <>
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
          onNavigating={() => {
            cancelClickNavigate(tab.id)
            updateWebViewTab(unit.unitId, tab.id, (entry) => ({
              ...entry,
              loading: true,
              pageFault: undefined,
              ...(entry.preserveConsole
                ? {}
                : {
                    consoleEntries: [],
                    lastConsoleId: '',
                    networkEntries: [],
                    lastNetworkId: '',
                    selectedNetworkId: '',
                  }),
            }))
          }}
          onNavigated={(payload) => {
            cancelClickNavigate(tab.id)
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
            const fault = pageFaultFromLoadFailed({
              url: payload.url,
              message: payload.message,
              code: payload.code,
            })
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
            const fault = pageFaultFromError(payload)
            if (!fault) {
              return
            }
            if (fault.code === 'VERSION_MISMATCH') {
              const entry = getWebViewUnit(unit.unitId)?.tabs.find(
                (item) => item.id === tab.id,
              )
              if (!entry?.url) {
                return
              }
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
            if (payload.method === 'submit' && payload.httpMethod === 'post') {
              if (
                payload.formFiles ||
                (payload.formEnctype &&
                  payload.formEnctype !== 'application/x-www-form-urlencoded')
              ) {
                const fault = {
                  severity: 'load' as const,
                  code: 'POST_FORM_UNSUPPORTED',
                  message:
                    '当前不支持带文件上传或非 urlencoded 的 POST 表单。请改用 GET 表单或 fetch API。',
                  url: payload.url,
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
                return
              }
              if (!payload.formBody) {
                const fault = {
                  severity: 'load' as const,
                  code: 'POST_FORM_UNSUPPORTED',
                  message: 'POST 表单缺少可提交的字段数据。',
                  url: payload.url,
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
                return
              }
              navigateTab(tab.id, payload.url, {
                method: 'POST',
                body: payload.formBody,
              })
              return
            }
            if (shouldNavigateSameTab(intent) && intent.action === 'sameTab') {
              navigateTab(tab.id, intent.url)
              return
            }
            if (intent.action === 'ignore') {
              return
            }
            navigateTab(tab.id, payload.url)
          }}
          onHistory={(payload) => {
            cancelClickNavigate(tab.id)
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
            if (
              !payload.href ||
              payload.href === '#' ||
              payload.href.startsWith('javascript:')
            ) {
              return
            }
            if (isSameDocumentHashLink(payload.href, tab.url)) {
              return
            }
            cancelClickNavigate(tab.id)
            clickNavigateTimersRef.current[tab.id] = window.setTimeout(() => {
              delete clickNavigateTimersRef.current[tab.id]
              navigateTab(tab.id, payload.href)
            }, 150)
          }}
        />
      ))}
    </>
  )

  return (
    <div class="webview-runtime" data-unit-id={unitId}>
      <div
        ref={setOffscreenEl}
        class="webview webview--offscreen"
        aria-hidden="true"
      />
      {portalTarget ? createPortal(viewportContent, portalTarget) : null}
    </div>
  )
}
