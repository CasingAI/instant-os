import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { getAppDefinition } from '../../os/app-registry.tsx'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { DocumentTabBar } from '../../ui/document-tab-bar.tsx'
import { SpaceSnifferStartDialog } from './space-sniffer-start-dialog.tsx'
import { SpaceSnifferView } from './space-sniffer-view.tsx'
import './space-sniffer.css'

const APP_ID = 'space-sniffer' as const
const DEFAULT_TITLE = '空间嗅探'
const DRAFT_TAB_TITLE = '新扫描'

type SpaceSnifferTab = {
  id: string
  /** 空字符串表示尚未选定路径的草稿标签 */
  rootPath: string
  draft?: boolean
}

type SpaceSnifferAppProps = {
  windowId?: string
}

let tabCounter = 0

function nextTabId(): string {
  tabCounter += 1
  return `space-sniffer-tab-${tabCounter}`
}

function normalizeScanPath(path: string | undefined): string | undefined {
  if (!path) return undefined
  const trimmed = path.trim().replace(/\/+$/, '') || '/'
  if (!trimmed.startsWith('/') || trimmed === '/') return undefined
  return trimmed
}

function tabTitle(tab: SpaceSnifferTab): string {
  if (tab.draft || !tab.rootPath) return DRAFT_TAB_TITLE
  const name = tab.rootPath.split('/').filter(Boolean).pop()
  return name || tab.rootPath
}

export function SpaceSnifferApp({ windowId }: SpaceSnifferAppProps) {
  const {
    windows,
    activeWindowId,
    setWindowTitle,
    setWindowDocumentId,
    closeWindow,
    closeWindowsForApp,
    minimizeWindow,
    bypassWindowCloseGuard,
  } = useOs()
  const { showBuiltinAbout } = useAboutApp()

  const appWindow = windowId
    ? windows.find((window) => window.id === windowId && !window.closing)
    : undefined
  const pendingDocumentId = normalizeScanPath(appWindow?.documentId)
  const isActiveWindow = windowId !== undefined && activeWindowId === windowId

  const [tabs, setTabs] = useState<SpaceSnifferTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | undefined>(undefined)
  const [showStart, setShowStart] = useState(true)
  /** 开始扫描时写入该标签（新建草稿 / 重新选路径） */
  const [targetTabId, setTargetTabId] = useState<string | undefined>(undefined)

  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)
  const consumedPendingRef = useRef<string | undefined>(undefined)
  tabsRef.current = tabs
  activeTabIdRef.current = activeTabId

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]

  const syncWindowToTab = useCallback(
    (tab: SpaceSnifferTab | undefined) => {
      if (!windowId) return
      if (!tab || tab.draft || !tab.rootPath) {
        setWindowTitle(windowId, DEFAULT_TITLE)
        setWindowDocumentId(windowId, undefined)
        return
      }
      setWindowTitle(windowId, `${DEFAULT_TITLE} — ${tab.rootPath}`)
      setWindowDocumentId(windowId, tab.rootPath)
    },
    [setWindowDocumentId, setWindowTitle, windowId],
  )

  useEffect(() => {
    if (showStart && tabs.length === 0) {
      if (windowId) setWindowTitle(windowId, DEFAULT_TITLE)
      return
    }
    if (!showStart) {
      syncWindowToTab(activeTab)
    }
  }, [activeTab, showStart, syncWindowToTab, tabs.length, windowId, setWindowTitle])

  const removeTab = useCallback(
    (tabId: string, { closeWindowIfEmpty }: { closeWindowIfEmpty: boolean }) => {
      const current = tabsRef.current
      const index = current.findIndex((tab) => tab.id === tabId)
      if (index < 0) return
      const nextTabs = current.filter((tab) => tab.id !== tabId)
      tabsRef.current = nextTabs
      setTabs(nextTabs)

      if (nextTabs.length === 0) {
        setActiveTabId(undefined)
        setTargetTabId(undefined)
        if (closeWindowIfEmpty && windowId) {
          setShowStart(true)
          bypassWindowCloseGuard(windowId)
          closeWindow(windowId)
        } else {
          setShowStart(true)
        }
        return
      }

      if (activeTabIdRef.current === tabId) {
        const neighbor = nextTabs[Math.min(index, nextTabs.length - 1)]
        setActiveTabId(neighbor?.id)
        activeTabIdRef.current = neighbor?.id
      }
      setTargetTabId((currentTarget) => (currentTarget === tabId ? undefined : currentTarget))
    },
    [bypassWindowCloseGuard, closeWindow, windowId],
  )

  const beginScan = useCallback((path: string, intoTabId?: string) => {
    const normalized = normalizeScanPath(path)
    if (!normalized) return

    const targetId = intoTabId
    setTargetTabId(undefined)

    if (targetId) {
      setTabs((current) => {
        const next = current.map((tab) =>
          tab.id === targetId ? { id: tab.id, rootPath: normalized, draft: false } : tab,
        )
        tabsRef.current = next
        return next
      })
      setActiveTabId(targetId)
      activeTabIdRef.current = targetId
      setShowStart(false)
      return
    }

    const tab: SpaceSnifferTab = { id: nextTabId(), rootPath: normalized }
    setTabs((current) => {
      const next = [...current, tab]
      tabsRef.current = next
      return next
    })
    setActiveTabId(tab.id)
    activeTabIdRef.current = tab.id
    setShowStart(false)
  }, [])

  useEffect(() => {
    if (!pendingDocumentId) return
    if (consumedPendingRef.current === pendingDocumentId) return

    const existing = tabsRef.current.find(
      (tab) => !tab.draft && tab.rootPath === pendingDocumentId,
    )
    if (existing) {
      consumedPendingRef.current = pendingDocumentId
      setActiveTabId(existing.id)
      activeTabIdRef.current = existing.id
      setShowStart(false)
      setTargetTabId(undefined)
      return
    }

    consumedPendingRef.current = pendingDocumentId
    const draft = tabsRef.current.find((tab) => tab.draft)
    beginScan(pendingDocumentId, draft?.id)
  }, [beginScan, pendingDocumentId])

  /** 新建：立刻开一个「新扫描」标签，再弹出选路径 */
  const requestNewScan = useCallback(() => {
    const existingDraft = tabsRef.current.find((tab) => tab.draft)
    if (existingDraft) {
      setActiveTabId(existingDraft.id)
      activeTabIdRef.current = existingDraft.id
      setTargetTabId(existingDraft.id)
      setShowStart(true)
      return
    }

    const tab: SpaceSnifferTab = { id: nextTabId(), rootPath: '', draft: true }
    setTabs((current) => {
      const next = [...current, tab]
      tabsRef.current = next
      return next
    })
    setActiveTabId(tab.id)
    activeTabIdRef.current = tab.id
    setTargetTabId(tab.id)
    setShowStart(true)
  }, [])

  const requestRepath = useCallback(() => {
    const tabId = activeTabIdRef.current
    if (!tabId) return
    const tab = tabsRef.current.find((item) => item.id === tabId)
    if (!tab || tab.draft) return
    setTargetTabId(tabId)
    setShowStart(true)
  }, [])

  const focusTab = useCallback((tabId: string) => {
    const tab = tabsRef.current.find((item) => item.id === tabId)
    setActiveTabId(tabId)
    activeTabIdRef.current = tabId
    if (tab?.draft) {
      setTargetTabId(tabId)
      setShowStart(true)
      return
    }
    setShowStart(false)
    setTargetTabId(undefined)
  }, [])

  const closeTab = useCallback(
    (tabId: string) => {
      if (!windowId) return
      removeTab(tabId, { closeWindowIfEmpty: true })
    },
    [removeTab, windowId],
  )

  const cancelStart = useCallback(() => {
    const targetId = targetTabId
    const target = targetId
      ? tabsRef.current.find((tab) => tab.id === targetId)
      : undefined

    setTargetTabId(undefined)

    if (target?.draft) {
      removeTab(target.id, { closeWindowIfEmpty: false })
      if (tabsRef.current.length === 0) {
        setShowStart(true)
      } else {
        setShowStart(false)
      }
      return
    }

    setShowStart(false)
  }, [removeTab, targetTabId])

  const handleStart = useCallback(
    (path: string) => {
      beginScan(path, targetTabId)
    },
    [beginScan, targetTabId],
  )

  const tabItems = useMemo(
    () =>
      tabs.map((tab) => ({
        id: tab.id,
        title: tabTitle(tab),
        pathTitle: tab.draft ? DRAFT_TAB_TITLE : tab.rootPath,
      })),
    [tabs],
  )

  const readyTabs = useMemo(() => tabs.filter((tab) => !tab.draft && tab.rootPath), [tabs])

  const definition = getAppDefinition(APP_ID)
  const canRepath = Boolean(activeTab && !activeTab.draft && !showStart)

  const menuBar = useMemo((): MenuDefinition[] => {
    return [
      {
        label: definition?.name ?? DEFAULT_TITLE,
        items: [
          ...aboutAppMenuPrefix(`关于 ${definition?.name ?? DEFAULT_TITLE}`, () =>
            showBuiltinAbout(APP_ID),
          ),
          {
            type: 'action',
            label: '新建扫描',
            shortcut: '⌘N',
            onClick: requestNewScan,
          },
          {
            type: 'action',
            label: '重新选择路径…',
            disabled: !canRepath,
            onClick: requestRepath,
          },
          { type: 'separator' },
          {
            type: 'action',
            label: `隐藏${definition?.name ?? DEFAULT_TITLE}`,
            shortcut: '⌘H',
            onClick: () => windowId && minimizeWindow(windowId),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: `退出${definition?.name ?? DEFAULT_TITLE}`,
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp(APP_ID),
          },
        ],
      },
      {
        label: '文件',
        items: [
          {
            type: 'action',
            label: '新建扫描',
            shortcut: '⌘N',
            onClick: requestNewScan,
          },
          {
            type: 'action',
            label: '重新选择路径…',
            disabled: !canRepath,
            onClick: requestRepath,
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '关闭标签',
            shortcut: '⌘W',
            disabled: !activeTab,
            onClick: () => activeTab && closeTab(activeTab.id),
          },
        ],
      },
    ]
  }, [
    activeTab,
    canRepath,
    closeTab,
    closeWindowsForApp,
    definition?.name,
    minimizeWindow,
    requestNewScan,
    requestRepath,
    showBuiltinAbout,
    windowId,
  ])

  useAppMenuBar(APP_ID, menuBar, isActiveWindow)

  const targetTab = targetTabId
    ? tabs.find((tab) => tab.id === targetTabId)
    : undefined
  const startInitialPath =
    targetTab && !targetTab.draft && targetTab.rootPath
      ? targetTab.rootPath
      : undefined

  return (
    <div class="space-sniffer">
      {tabs.length > 0 ? (
        <DocumentTabBar
          class="space-sniffer__doc-tabs"
          tabs={tabItems}
          activeTabId={activeTab?.id}
          ariaLabel="打开的扫描"
          onActivate={focusTab}
          onClose={closeTab}
        />
      ) : undefined}

      {readyTabs.length > 0 ? (
        <div class="space-sniffer__tab-panes" hidden={showStart}>
          {readyTabs.map((tab) => (
            <div
              key={`${tab.id}:${tab.rootPath}`}
              class={`space-sniffer__tab-pane${tab.id === activeTab?.id ? ' space-sniffer__tab-pane--active' : ''}`}
              hidden={tab.id !== activeTab?.id}
            >
              <SpaceSnifferView
                rootPath={tab.rootPath}
                onNewScan={requestNewScan}
                onRequestClose={() => closeTab(tab.id)}
              />
            </div>
          ))}
        </div>
      ) : undefined}

      {showStart ? (
        <SpaceSnifferStartDialog
          initialPath={startInitialPath}
          onStart={handleStart}
          onCancel={tabs.length > 0 ? cancelStart : undefined}
        />
      ) : undefined}
    </div>
  )
}
