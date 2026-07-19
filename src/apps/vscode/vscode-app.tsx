import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { MonacoEditor } from '../../monaco/monaco-editor.tsx'
import {
  MONACO_SELECTABLE_LANGUAGES,
  monacoLanguageLabel,
  parentDirFromPath,
} from '../../monaco/monaco-language.ts'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { registerFileOpenHandler } from '../../os/file-open-registry.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs, useWindowCloseGuard } from '../../os/os-context.tsx'
import {
  createTerminalSession,
  TerminalPanel,
  TERMINAL_COLORS_DARK,
  TERMINAL_COLORS_HIGH_CONTRAST,
  TERMINAL_COLORS_LIGHT,
  type TerminalColors,
} from '../../terminal/terminal-public.ts'
import type { TerminalSession } from '../../terminal/terminal-session.ts'
import { useSystemOpenDialog } from '../../window/system-open-dialog.tsx'
import { WindowModal } from '../../window/window-modal.tsx'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { FilesStorageFullError } from '../files/files-storage.ts'
import { isFilesNodeWritable } from '../files/files-types.ts'
import {
  readTextFile,
  resolveFilesAbsolutePath,
  writeTextFile,
} from '../files/files-vfs.ts'
import { VscodeExplorer } from './vscode-explorer.tsx'
import { loadVscodePrefs, saveVscodePrefs, type VscodePrefs } from './vscode-prefs.ts'
import { VscodeQuickPick } from './vscode-quick-pick.tsx'
import {
  buildVscodeTab,
  isVscodeTabDirty,
  VSCODE_OPEN_EXTENSIONS,
  VSCODE_OPTIONAL_OPEN_EXTENSIONS,
  type VscodeTab,
} from './vscode-tabs.ts'
import './vscode.css'

const APP_ID = 'vscode' as const
const THEME = '#0078d4'
const DEFAULT_TITLE = 'Virtual Studio Code'

registerFileOpenHandler({
  appId: APP_ID,
  extensions: [...VSCODE_OPEN_EXTENSIONS, ...VSCODE_OPTIONAL_OPEN_EXTENSIONS],
  rank: 10,
})

type DirtyChoice = 'save' | 'discard' | 'cancel'

type DirtyPromptState = {
  fileName: string
  writable: boolean
  resolve: (choice: DirtyChoice) => void
}

type SidebarView = 'explorer' | 'search' | 'settings'

type VscodeAppProps = {
  windowId?: string
}

function formatError(error: unknown): string {
  if (error instanceof FilesStorageFullError) return error.message
  if (error instanceof Error && error.message) return error.message
  return '操作失败'
}

function menuCheckPrefix(active: boolean): string {
  return active ? '✓ ' : ''
}

function terminalColorsForTheme(theme: VscodePrefs['theme']): TerminalColors {
  if (theme === 'vs') return TERMINAL_COLORS_LIGHT
  if (theme === 'hc-black') return TERMINAL_COLORS_HIGH_CONTRAST
  return TERMINAL_COLORS_DARK
}

export function VscodeApp({ windowId }: VscodeAppProps) {
  const {
    windows,
    activeWindowId,
    setWindowTitle,
    setWindowDocumentId,
    setWindowDocumentEdited,
    setWindowDocumentReadOnly,
    closeWindow,
    closeWindowsForApp,
    minimizeWindow,
    bypassWindowCloseGuard,
    cancelPendingAppQuit,
  } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const modal = useWindowModal()
  const { showSystemOpenDialog, dialog: openDialog, isOpen: openDialogOpen } = useSystemOpenDialog()

  const appWindow = windowId
    ? windows.find((window) => window.id === windowId && !window.closing)
    : undefined
  const pendingDocumentId = appWindow?.documentId
  const isActiveWindow = windowId !== undefined && activeWindowId === windowId

  const [prefs, setPrefs] = useState<VscodePrefs>(() => loadVscodePrefs())
  const [sidebarView, setSidebarView] = useState<SidebarView>('explorer')
  const [tabs, setTabs] = useState<VscodeTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false)
  const [dirtyPrompt, setDirtyPrompt] = useState<DirtyPromptState | undefined>(undefined)
  const [revealPath, setRevealPath] = useState<string | undefined>(undefined)

  const terminalSessionRef = useRef<TerminalSession | undefined>(undefined)
  if (!terminalSessionRef.current) {
    terminalSessionRef.current = createTerminalSession({
      usageActor: APP_ID,
      initialCwd: '/user',
    })
  }
  const terminalSession = terminalSessionRef.current

  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)
  const loadingPathRef = useRef<string | undefined>(undefined)
  const mountedRef = useRef(true)

  tabsRef.current = tabs
  activeTabIdRef.current = activeTabId

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]
  const dirty = activeTab ? isVscodeTabDirty(activeTab) : false
  const anyDirty = tabs.some(isVscodeTabDirty)
  const writable = activeTab?.writable ?? false

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      terminalSessionRef.current?.destroy()
      terminalSessionRef.current = undefined
    }
  }, [])

  useEffect(() => {
    saveVscodePrefs(prefs)
  }, [prefs])

  const updatePrefs = useCallback((patch: Partial<VscodePrefs>) => {
    setPrefs((current) => ({ ...current, ...patch }))
  }, [])

  const syncWindowToTab = useCallback(
    (tab: VscodeTab | undefined) => {
      if (!windowId) return
      if (!tab) {
        setWindowTitle(windowId, DEFAULT_TITLE)
        setWindowDocumentId(windowId, undefined)
        setWindowDocumentEdited(windowId, false)
        setWindowDocumentReadOnly(windowId, false)
        return
      }
      setWindowTitle(windowId, tab.name)
      setWindowDocumentId(windowId, tab.path)
      setWindowDocumentEdited(windowId, isVscodeTabDirty(tab))
      setWindowDocumentReadOnly(windowId, !tab.writable)
    },
    [setWindowDocumentEdited, setWindowDocumentId, setWindowDocumentReadOnly, setWindowTitle, windowId],
  )

  useEffect(() => {
    syncWindowToTab(activeTab)
  }, [activeTab, syncWindowToTab])

  useEffect(() => {
    if (!activeTab) return
    const dir = parentDirFromPath(activeTab.path)
    if (terminalSession.getCwd() === dir) return
    void terminalSession.cd(dir).catch(() => undefined)
  }, [activeTab, terminalSession])

  useEffect(() => {
    const folder = prefs.workspaceFolder
    if (!folder || activeTab) return
    if (terminalSession.getCwd() === folder) return
    void terminalSession.cd(folder).catch(() => undefined)
  }, [activeTab, prefs.workspaceFolder, terminalSession])

  const openDocument = useCallback(
    async (documentRef: string): Promise<boolean> => {
      const existing = tabsRef.current.find((tab) => tab.path === documentRef)
      if (existing) {
        setActiveTabId(existing.id)
        setRevealPath(documentRef)
        return true
      }

      if (loadingPathRef.current === documentRef) {
        return true
      }

      loadingPathRef.current = documentRef
      setLoading(true)
      try {
        const result = await readTextFile(documentRef)
        const path = await resolveFilesAbsolutePath(result.node)
        if (!mountedRef.current) return false
        const tab = buildVscodeTab({
          path,
          text: result.text,
          node: result.node,
          writable: isFilesNodeWritable(result.node),
        })
        setTabs((prev) => [...prev, tab])
        setActiveTabId(tab.id)
        setRevealPath(path)
        return true
      } catch (err) {
        await modal.alert({
          title: '无法打开',
          message: formatError(err),
          themeColor: THEME,
        })
        return false
      } finally {
        if (loadingPathRef.current === documentRef) {
          loadingPathRef.current = undefined
        }
        setLoading(false)
      }
    },
    [modal],
  )

  const saveTab = useCallback(
    async (tabId: string): Promise<boolean> => {
      const tab = tabsRef.current.find((item) => item.id === tabId)
      if (!tab || !tab.writable) return false
      setLoading(true)
      try {
        const updated = await writeTextFile(tab.path, tab.text)
        const nextPath = await resolveFilesAbsolutePath(updated)
        if (!mountedRef.current) return false
        setTabs((prev) =>
          prev.map((item) =>
            item.id === tabId
              ? {
                  ...item,
                  path: nextPath,
                  name: updated.name,
                  savedText: item.text,
                  node: updated,
                  writable: isFilesNodeWritable(updated),
                }
              : item,
          ),
        )
        return true
      } catch (err) {
        await modal.alert({
          title: '无法保存',
          message: formatError(err),
          themeColor: THEME,
        })
        return false
      } finally {
        setLoading(false)
      }
    },
    [modal],
  )

  const handleSave = useCallback(async () => {
    const tabId = activeTabIdRef.current
    if (!tabId) return
    await saveTab(tabId)
  }, [saveTab])

  const askDirtyChoice = useCallback((tab: VscodeTab): Promise<DirtyChoice> => {
    if (!isVscodeTabDirty(tab)) return Promise.resolve('discard')
    return new Promise((resolve) => {
      setDirtyPrompt({
        fileName: tab.name,
        writable: tab.writable,
        resolve,
      })
    })
  }, [])

  const resolveDirtyPrompt = useCallback((choice: DirtyChoice) => {
    setDirtyPrompt((current) => {
      current?.resolve(choice)
      return undefined
    })
  }, [])

  const ensureTabCleanOrConfirm = useCallback(
    async (tabId: string): Promise<boolean> => {
      const tab = tabsRef.current.find((item) => item.id === tabId)
      if (!tab) return true
      const choice = await askDirtyChoice(tab)
      if (choice === 'cancel') return false
      if (choice === 'save') return saveTab(tabId)
      return true
    },
    [askDirtyChoice, saveTab],
  )

  const pickAndOpen = useCallback(async (): Promise<boolean> => {
    const path = await showSystemOpenDialog({
      title: '打开文件',
      acceptExtensions: [...VSCODE_OPEN_EXTENSIONS, ...VSCODE_OPTIONAL_OPEN_EXTENSIONS],
      allowCreate: true,
      createExtension: 'ts',
      presentation: 'modal',
    })
    if (!path) return false
    return openDocument(path)
  }, [openDocument, showSystemOpenDialog])

  const pickAndOpenFolder = useCallback(async (): Promise<boolean> => {
    const path = await showSystemOpenDialog({
      title: '打开文件夹',
      selectionMode: 'folder',
      presentation: 'modal',
    })
    if (!path) return false
    updatePrefs({ workspaceFolder: path, sidebarVisible: true })
    setSidebarView('explorer')
    setRevealPath(path)
    if (terminalSession.getCwd() !== path) {
      void terminalSession.cd(path).catch(() => undefined)
    }
    return true
  }, [showSystemOpenDialog, terminalSession, updatePrefs])

  const closeWorkspaceFolder = useCallback(() => {
    updatePrefs({ workspaceFolder: undefined })
  }, [updatePrefs])

  useEffect(() => {
    if (!windowId || !pendingDocumentId) return
    if (loadingPathRef.current === pendingDocumentId) return
    const existing = tabsRef.current.find((tab) => tab.path === pendingDocumentId)
    if (existing) {
      if (existing.id !== activeTabIdRef.current) {
        setActiveTabId(existing.id)
      }
      return
    }
    void openDocument(pendingDocumentId)
  }, [openDocument, pendingDocumentId, windowId])

  const removeTab = useCallback((tabId: string) => {
    const current = tabsRef.current
    const index = current.findIndex((tab) => tab.id === tabId)
    if (index < 0) return
    const nextTabs = current.filter((tab) => tab.id !== tabId)
    setTabs(nextTabs)
    if (activeTabIdRef.current === tabId) {
      const neighbor = nextTabs[Math.min(index, nextTabs.length - 1)]
      setActiveTabId(neighbor?.id)
    }
  }, [])

  const closeTab = useCallback(
    async (tabId: string) => {
      const proceed = await ensureTabCleanOrConfirm(tabId)
      if (!proceed) return
      removeTab(tabId)
    },
    [ensureTabCleanOrConfirm, removeTab],
  )

  const handleCloseTab = useCallback(() => {
    const tabId = activeTabIdRef.current
    if (!tabId) return
    void closeTab(tabId)
  }, [closeTab])

  const requestClose = useCallback(() => {
    if (!windowId) return true
    const dirtyTabs = tabsRef.current.filter(isVscodeTabDirty)
    if (dirtyTabs.length === 0) return true

    void (async () => {
      const choice = await new Promise<DirtyChoice>((resolve) => {
        setDirtyPrompt({
          fileName:
            dirtyTabs.length === 1
              ? dirtyTabs[0]!.name
              : `${dirtyTabs.length} 个文件`,
          writable: dirtyTabs.every((tab) => tab.writable),
          resolve,
        })
      })

      if (choice === 'cancel') {
        cancelPendingAppQuit(APP_ID)
        return
      }

      if (choice === 'save') {
        for (const tab of dirtyTabs) {
          const latest = tabsRef.current.find((item) => item.id === tab.id)
          if (!latest || !isVscodeTabDirty(latest)) continue
          if (!latest.writable) {
            cancelPendingAppQuit(APP_ID)
            await modal.alert({
              title: '无法保存',
              message: `「${latest.name}」为只读，无法保存。`,
              themeColor: THEME,
            })
            return
          }
          const saved = await saveTab(latest.id)
          if (!saved) {
            cancelPendingAppQuit(APP_ID)
            return
          }
        }
      }

      setWindowDocumentEdited(windowId, false)
      bypassWindowCloseGuard(windowId)
      closeWindow(windowId)
    })()
    return false
  }, [
    bypassWindowCloseGuard,
    cancelPendingAppQuit,
    closeWindow,
    modal,
    saveTab,
    setWindowDocumentEdited,
    windowId,
  ])

  useWindowCloseGuard(windowId, requestClose)

  const updateActiveText = useCallback((nextText: string) => {
    const tabId = activeTabIdRef.current
    if (!tabId) return
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, text: nextText } : tab)))
  }, [])

  const setActiveLanguage = useCallback((language: string) => {
    const tabId = activeTabIdRef.current
    if (!tabId) return
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, language } : tab)))
    setLanguagePickerOpen(false)
  }, [])

  useEffect(() => {
    setLanguagePickerOpen(false)
  }, [activeTabId])

  const languageQuickPickItems = useMemo(
    () =>
      MONACO_SELECTABLE_LANGUAGES.map((item) => ({
        id: item.id,
        label: item.label,
        keywords: item.keywords,
      })),
    [],
  )

  const searchHits = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return []
    return tabs.flatMap((tab) => {
      const lines = tab.text.split('\n')
      const matches: Array<{ tabId: string; path: string; name: string; line: number; preview: string }> = []
      lines.forEach((line, index) => {
        if (line.toLowerCase().includes(query)) {
          matches.push({
            tabId: tab.id,
            path: tab.path,
            name: tab.name,
            line: index + 1,
            preview: line.trim().slice(0, 120),
          })
        }
      })
      return matches
    })
  }, [searchQuery, tabs])

  const menuBar = useMemo((): MenuDefinition[] => {
    return [
      {
        label: 'Virtual Studio Code',
        items: [
          ...aboutAppMenuPrefix('关于 Virtual Studio Code', () => showBuiltinAbout(APP_ID)),
          {
            type: 'action',
            label: '隐藏 Virtual Studio Code',
            shortcut: '⌘H',
            onClick: () => windowId && minimizeWindow(windowId),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出 Virtual Studio Code',
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
            label: '打开…',
            shortcut: '⌘O',
            disabled: loading || openDialogOpen || !!dirtyPrompt,
            onClick: () => void pickAndOpen(),
          },
          {
            type: 'action',
            label: '打开文件夹…',
            shortcut: '⇧⌘O',
            disabled: loading || openDialogOpen || !!dirtyPrompt,
            onClick: () => void pickAndOpenFolder(),
          },
          {
            type: 'action',
            label: '关闭文件夹',
            disabled: !prefs.workspaceFolder,
            onClick: () => closeWorkspaceFolder(),
          },
          {
            type: 'action',
            label: '关闭标签',
            shortcut: '⌘W',
            disabled: !activeTab || loading || openDialogOpen || !!dirtyPrompt,
            onClick: () => handleCloseTab(),
          },
          {
            type: 'action',
            label: '保存',
            shortcut: '⌘S',
            disabled: !activeTab || !writable || !dirty || loading,
            onClick: () => void handleSave(),
          },
        ],
      },
      {
        label: '查看',
        items: [
          {
            type: 'action',
            label: `${menuCheckPrefix(prefs.sidebarVisible)}侧栏`,
            onClick: () => updatePrefs({ sidebarVisible: !prefs.sidebarVisible }),
          },
          {
            type: 'action',
            label: `${menuCheckPrefix(prefs.terminalVisible)}终端`,
            onClick: () => updatePrefs({ terminalVisible: !prefs.terminalVisible }),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '资源管理器',
            onClick: () => {
              setSidebarView('explorer')
              updatePrefs({ sidebarVisible: true })
            },
          },
          {
            type: 'action',
            label: '搜索',
            onClick: () => {
              setSidebarView('search')
              updatePrefs({ sidebarVisible: true })
            },
          },
          {
            type: 'action',
            label: '设置',
            onClick: () => {
              setSidebarView('settings')
              updatePrefs({ sidebarVisible: true })
            },
          },
        ],
      },
    ]
  }, [
    activeTab,
    closeWindowsForApp,
    closeWorkspaceFolder,
    dirty,
    dirtyPrompt,
    handleCloseTab,
    handleSave,
    loading,
    minimizeWindow,
    openDialogOpen,
    pickAndOpen,
    pickAndOpenFolder,
    prefs.sidebarVisible,
    prefs.terminalVisible,
    prefs.workspaceFolder,
    showBuiltinAbout,
    updatePrefs,
    windowId,
    writable,
  ])

  useAppMenuBar(APP_ID, menuBar, isActiveWindow)

  const dirtyPromptActions = useMemo(
    () => [
      {
        key: 'save',
        label: '保存',
        tone: 'primary' as const,
        disabled: !dirtyPrompt?.writable || loading,
        onClick: () => resolveDirtyPrompt('save'),
      },
      {
        key: 'discard',
        label: '不保存',
        tone: 'danger' as const,
        onClick: () => resolveDirtyPrompt('discard'),
      },
      {
        key: 'cancel',
        label: '取消',
        tone: 'secondary' as const,
        onClick: () => resolveDirtyPrompt('cancel'),
      },
    ],
    [dirtyPrompt?.writable, loading, resolveDirtyPrompt],
  )

  const activateSidebar = (view: SidebarView) => {
    if (prefs.sidebarVisible && sidebarView === view) {
      updatePrefs({ sidebarVisible: false })
      return
    }
    setSidebarView(view)
    updatePrefs({ sidebarVisible: true })
  }

  if (!windowId) {
    return <div class="vscode" />
  }

  return (
    <div class={`vscode vscode--theme-${prefs.theme}`}>
      <div class="vscode__body">
        <aside class="vscode__activity" aria-label="活动栏">
          <button
            type="button"
            class={`vscode__activity-btn${sidebarView === 'explorer' && prefs.sidebarVisible ? ' vscode__activity-btn--active' : ''}`}
            title="资源管理器"
            onClick={() => activateSidebar('explorer')}
          >
            <span class="vscode__activity-glyph" aria-hidden="true">
              ⊞
            </span>
          </button>
          <button
            type="button"
            class={`vscode__activity-btn${sidebarView === 'search' && prefs.sidebarVisible ? ' vscode__activity-btn--active' : ''}`}
            title="搜索"
            onClick={() => activateSidebar('search')}
          >
            <span class="vscode__activity-glyph" aria-hidden="true">
              ⌕
            </span>
          </button>
          <button
            type="button"
            class={`vscode__activity-btn${prefs.terminalVisible ? ' vscode__activity-btn--active' : ''}`}
            title="终端"
            onClick={() => updatePrefs({ terminalVisible: !prefs.terminalVisible })}
          >
            <span class="vscode__activity-glyph" aria-hidden="true">
              ⌁
            </span>
          </button>
          <div class="vscode__activity-spacer" />
          <button
            type="button"
            class={`vscode__activity-btn${sidebarView === 'settings' && prefs.sidebarVisible ? ' vscode__activity-btn--active' : ''}`}
            title="设置"
            onClick={() => activateSidebar('settings')}
          >
            <span class="vscode__activity-glyph" aria-hidden="true">
              ⚙
            </span>
          </button>
        </aside>

        {prefs.sidebarVisible ? (
          <aside class="vscode__sidebar" style={{ width: `${prefs.sidebarWidth}px` }}>
            {sidebarView === 'explorer' ? (
              <VscodeExplorer
                workspaceFolder={prefs.workspaceFolder}
                selectedPath={activeTab?.path}
                revealPath={revealPath ?? activeTab?.path}
                onOpenFile={(path) => void openDocument(path)}
                onOpenFolder={() => void pickAndOpenFolder()}
              />
            ) : undefined}

            {sidebarView === 'search' ? (
              <div class="vscode__search">
                <div class="vscode__sidebar-title">搜索</div>
                <input
                  class="vscode__search-input"
                  type="search"
                  placeholder="在已打开文件中搜索"
                  value={searchQuery}
                  onInput={(event) => setSearchQuery((event.target as HTMLInputElement).value)}
                />
                <div class="vscode__search-results">
                  {searchQuery.trim() && searchHits.length === 0 ? (
                    <div class="vscode__tree-hint">无匹配</div>
                  ) : undefined}
                  {searchHits.map((hit) => (
                    <button
                      key={`${hit.tabId}:${hit.line}:${hit.preview}`}
                      type="button"
                      class="vscode__search-hit"
                      onClick={() => setActiveTabId(hit.tabId)}
                    >
                      <span class="vscode__search-hit-name">
                        {hit.name}:{hit.line}
                      </span>
                      <span class="vscode__search-hit-preview">{hit.preview}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : undefined}

            {sidebarView === 'settings' ? (
              <div class="vscode__settings">
                <div class="vscode__sidebar-title">设置</div>
                <label class="vscode__setting">
                  <span>主题</span>
                  <select
                    value={prefs.theme}
                    onChange={(event) =>
                      updatePrefs({
                        theme: (event.target as HTMLSelectElement).value as VscodePrefs['theme'],
                      })
                    }
                  >
                    <option value="vs-dark">深色</option>
                    <option value="vs">浅色</option>
                    <option value="hc-black">高对比</option>
                  </select>
                </label>
                <label class="vscode__setting">
                  <span>字号</span>
                  <input
                    type="number"
                    min={10}
                    max={24}
                    value={prefs.fontSize}
                    onInput={(event) =>
                      updatePrefs({
                        fontSize: Number((event.target as HTMLInputElement).value) || 13,
                      })
                    }
                  />
                </label>
                <label class="vscode__setting vscode__setting--row">
                  <span>小地图</span>
                  <input
                    type="checkbox"
                    checked={prefs.minimap}
                    onChange={(event) =>
                      updatePrefs({ minimap: (event.target as HTMLInputElement).checked })
                    }
                  />
                </label>
                <label class="vscode__setting vscode__setting--row">
                  <span>自动换行</span>
                  <input
                    type="checkbox"
                    checked={prefs.wordWrap}
                    onChange={(event) =>
                      updatePrefs({ wordWrap: (event.target as HTMLInputElement).checked })
                    }
                  />
                </label>
              </div>
            ) : undefined}
          </aside>
        ) : undefined}

        <div class="vscode__main">
          <div class="vscode__editor-pane">
            {tabs.length > 0 ? (
              <div class="vscode__tabs" role="tablist" aria-label="打开的文件">
                {tabs.map((tab) => {
                  const isActive = tab.id === activeTab?.id
                  const tabDirty = isVscodeTabDirty(tab)
                  return (
                    <div
                      key={tab.id}
                      class={`vscode__tab${isActive ? ' vscode__tab--active' : ''}${tabDirty ? ' vscode__tab--dirty' : ''}`}
                      role="tab"
                      aria-selected={isActive}
                    >
                      <button
                        type="button"
                        class="vscode__tab-main"
                        title={tab.path}
                        onClick={() => setActiveTabId(tab.id)}
                      >
                        {tabDirty ? <span class="vscode__tab-dot" aria-hidden="true" /> : undefined}
                        <span class="vscode__tab-title">{tab.name}</span>
                      </button>
                      <button
                        type="button"
                        class="vscode__tab-close"
                        aria-label={`关闭 ${tab.name}`}
                        disabled={loading || openDialogOpen || !!dirtyPrompt}
                        onClick={(event) => {
                          event.stopPropagation()
                          void closeTab(tab.id)
                        }}
                      >
                        ×
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : undefined}

            <div class="vscode__editor">
              {activeTab ? (
                <MonacoEditor
                  className="vscode__monaco"
                  value={activeTab.text}
                  onChange={updateActiveText}
                  language={activeTab.language}
                  theme={prefs.theme}
                  readOnly={!activeTab.writable}
                  fontSize={prefs.fontSize}
                  minimap={prefs.minimap}
                  wordWrap={prefs.wordWrap ? 'on' : 'off'}
                  active={isActiveWindow}
                  onCursorChange={(line, column) => setCursor({ line, column })}
                />
              ) : (
                <div class="vscode__welcome">
                  <h1>Virtual Studio Code</h1>
                  <p>
                    {prefs.workspaceFolder
                      ? '从左侧资源管理器打开文件，或使用菜单「文件 → 打开…」。'
                      : '打开一个文件夹作为工作区，或直接打开单个文件。'}
                  </p>
                  <div class="vscode__welcome-actions">
                    <button
                      type="button"
                      class="vscode__welcome-btn"
                      onClick={() => void pickAndOpenFolder()}
                    >
                      打开文件夹
                    </button>
                    <button
                      type="button"
                      class="vscode__welcome-btn vscode__welcome-btn--secondary"
                      onClick={() => void pickAndOpen()}
                    >
                      打开文件
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {prefs.terminalVisible ? (
            <div class="vscode__terminal" style={{ height: `${prefs.terminalHeight}px` }}>
              <div class="vscode__panel-header">终端</div>
              <TerminalPanel
                session={terminalSession}
                usageActor={APP_ID}
                className="vscode__terminal-panel"
                colors={terminalColorsForTheme(prefs.theme)}
              />
            </div>
          ) : undefined}
        </div>
      </div>

      <footer class="vscode__status">
        <span>{activeTab ? activeTab.path : '未打开文件'}</span>
        <span class="vscode__status-spacer" />
        {activeTab ? (
          <>
            <span>
              Ln {cursor.line}, Col {cursor.column}
            </span>
            <button
              type="button"
              class="vscode__status-lang-btn"
              aria-haspopup="dialog"
              aria-expanded={languagePickerOpen}
              title="选择语言模式"
              onClick={() => setLanguagePickerOpen(true)}
            >
              {monacoLanguageLabel(activeTab.language)}
            </button>
            <span>{activeTab.writable ? (dirty || anyDirty ? '已编辑' : '已保存') : '只读'}</span>
          </>
        ) : undefined}
        {loading ? <span>处理中…</span> : undefined}
      </footer>

      {openDialog}

      <VscodeQuickPick
        open={languagePickerOpen}
        title="选择语言模式"
        placeholder="输入语言名称或后缀筛选…"
        items={languageQuickPickItems}
        activeId={activeTab?.language}
        onClose={() => setLanguagePickerOpen(false)}
        onSelect={(item) => setActiveLanguage(item.id)}
      />

      <WindowModal
        open={!!dirtyPrompt}
        title="未保存的更改"
        themeColor={THEME}
        onClose={() => resolveDirtyPrompt('cancel')}
        actions={dirtyPromptActions}
      >
        <p class="window-modal__message">是否保存对「{dirtyPrompt?.fileName}」的更改？</p>
      </WindowModal>
    </div>
  )
}
