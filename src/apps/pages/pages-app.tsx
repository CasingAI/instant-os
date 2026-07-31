import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Editor } from '@tiptap/core'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { registerFileOpenHandler } from '../../os/file-open-registry.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs, useWindowCloseGuard } from '../../os/os-context.tsx'
import { useSystemOpenDialog } from '../../window/system-open-dialog.tsx'
import { WindowModal } from '../../window/window-modal.tsx'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { FilesStorageFullError } from '../files/files-storage.ts'
import { isFilesNodeWritable, type FilesNode } from '../files/files-types.ts'
import {
  readTextFile,
  resolveFilesAbsolutePath,
  writeTextFile,
} from '../files/files-vfs.ts'
import { DocumentTabBar } from '../../ui/document-tab-bar.tsx'
import { PagesEditor, type PagesViewMode } from './pages-editor.tsx'
import { PAGES_EMPTY_MARKDOWN, PAGES_OPEN_EXTENSIONS } from './pages-markdown.ts'
import './pages.css'

const APP_ID = 'pages' as const
const THEME = '#2f6fed'
const DEFAULT_TITLE = '文稿'
const OPEN_TITLE = '打开文稿'

registerFileOpenHandler({
  appId: APP_ID,
  extensions: [...PAGES_OPEN_EXTENSIONS],
  rank: 4,
})

type DirtyChoice = 'save' | 'discard' | 'cancel'

type DirtyPromptState = {
  fileName: string
  writable: boolean
  resolve: (choice: DirtyChoice) => void
}

type PagesTab = {
  id: string
  path: string
  node: FilesNode
  markdown: string
  savedMarkdown: string
  viewMode: PagesViewMode
}

type PagesAppProps = {
  windowId?: string
}

let tabCounter = 0

function nextTabId(): string {
  tabCounter += 1
  return `pages-tab-${tabCounter}`
}

function formatError(error: unknown): string {
  if (error instanceof FilesStorageFullError) return error.message
  if (error instanceof Error && error.message) return error.message
  return '操作失败'
}

function isTabDirty(tab: PagesTab): boolean {
  return tab.markdown !== tab.savedMarkdown
}

export function PagesApp({ windowId }: PagesAppProps) {
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

  const [tabs, setTabs] = useState<PagesTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [dirtyPrompt, setDirtyPrompt] = useState<DirtyPromptState | undefined>(undefined)
  const bootstrappedRef = useRef(false)
  const loadingPathRef = useRef<string | undefined>(undefined)
  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)
  const mountedRef = useRef(true)
  const editorRef = useRef<Editor | null>(null)

  tabsRef.current = tabs
  activeTabIdRef.current = activeTabId

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]
  const dirty = activeTab ? isTabDirty(activeTab) : false
  const writable = activeTab ? isFilesNodeWritable(activeTab.node) : false
  const showEditor = ready && activeTab !== undefined

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const syncWindowToTab = useCallback(
    (tab: PagesTab | undefined) => {
      if (!windowId) return
      if (!tab) {
        setWindowTitle(windowId, DEFAULT_TITLE)
        setWindowDocumentId(windowId, undefined)
        setWindowDocumentEdited(windowId, false)
        setWindowDocumentReadOnly(windowId, false)
        return
      }
      setWindowTitle(windowId, tab.node.name)
      setWindowDocumentId(windowId, tab.path)
      setWindowDocumentEdited(windowId, isTabDirty(tab))
      setWindowDocumentReadOnly(windowId, !isFilesNodeWritable(tab.node))
    },
    [setWindowDocumentEdited, setWindowDocumentId, setWindowDocumentReadOnly, setWindowTitle, windowId],
  )

  useEffect(() => {
    if (!windowId || !ready || !activeTab) return
    setWindowTitle(windowId, activeTab.node.name)
    setWindowDocumentId(windowId, activeTab.path)
    setWindowDocumentReadOnly(windowId, !isFilesNodeWritable(activeTab.node))
  }, [
    activeTab?.id,
    activeTab?.node.name,
    activeTab?.path,
    ready,
    setWindowDocumentId,
    setWindowDocumentReadOnly,
    setWindowTitle,
    windowId,
  ])

  useEffect(() => {
    if (!windowId || !ready) return
    setWindowDocumentEdited(windowId, dirty)
  }, [dirty, ready, setWindowDocumentEdited, windowId])

  const focusTab = useCallback((tabId: string) => {
    setActiveTabId(tabId)
  }, [])

  const openDocument = useCallback(
    async (documentRef: string): Promise<boolean> => {
      if (!windowId) return false

      const existing = tabsRef.current.find((tab) => tab.path === documentRef)
      if (existing) {
        setActiveTabId(existing.id)
        setReady(true)
        return true
      }

      if (loadingPathRef.current === documentRef) {
        return true
      }

      loadingPathRef.current = documentRef
      setLoading(true)
      try {
        const result = await readTextFile(documentRef)
        if (!mountedRef.current) return false
        const path = await resolveFilesAbsolutePath(result.node)
        const already = tabsRef.current.find((tab) => tab.path === path)
        if (already) {
          setActiveTabId(already.id)
          setReady(true)
          return true
        }
        const text = result.text.length > 0 ? result.text : PAGES_EMPTY_MARKDOWN
        const tab: PagesTab = {
          id: nextTabId(),
          path,
          node: result.node,
          markdown: text,
          savedMarkdown: text,
          viewMode: 'edit',
        }
        setTabs((prev) => [...prev, tab])
        setActiveTabId(tab.id)
        setReady(true)
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
    [modal, windowId],
  )

  const saveTab = useCallback(
    async (tabId: string): Promise<boolean> => {
      if (!windowId) return false
      const tab = tabsRef.current.find((item) => item.id === tabId)
      if (!tab || !isFilesNodeWritable(tab.node)) return false
      setLoading(true)
      try {
        const updated = await writeTextFile(tab.path, tab.markdown)
        const nextPath = await resolveFilesAbsolutePath(updated)
        setTabs((prev) =>
          prev.map((item) =>
            item.id === tabId
              ? {
                  ...item,
                  node: updated,
                  path: nextPath,
                  savedMarkdown: item.markdown,
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
    [modal, windowId],
  )

  const handleSave = useCallback(async (): Promise<boolean> => {
    const tabId = activeTabIdRef.current
    if (!tabId) return false
    return saveTab(tabId)
  }, [saveTab])

  const askDirtyChoice = useCallback((tab: PagesTab): Promise<DirtyChoice> => {
    if (!isTabDirty(tab)) return Promise.resolve('discard')
    return new Promise((resolve) => {
      setDirtyPrompt({
        fileName: tab.node.name,
        writable: isFilesNodeWritable(tab.node),
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

  const pickAndOpen = useCallback(
    async (presentation: 'host' | 'modal'): Promise<boolean> => {
      if (!windowId) return false
      if (presentation === 'host' && tabsRef.current.length === 0) {
        setWindowTitle(windowId, OPEN_TITLE)
        setWindowDocumentEdited(windowId, false)
        setWindowDocumentReadOnly(windowId, false)
      }
      const path = await showSystemOpenDialog({
        title: OPEN_TITLE,
        acceptExtensions: [...PAGES_OPEN_EXTENSIONS],
        allowCreate: true,
        createExtension: 'md',
        createInitialText: PAGES_EMPTY_MARKDOWN,
        presentation,
      })
      if (!path) {
        if (presentation === 'host' && tabsRef.current.length === 0) {
          setWindowTitle(windowId, DEFAULT_TITLE)
          setWindowDocumentReadOnly(windowId, false)
        } else {
          const current =
            tabsRef.current.find((tab) => tab.id === activeTabIdRef.current) ?? tabsRef.current[0]
          if (current) syncWindowToTab(current)
        }
        return false
      }
      return openDocument(path)
    },
    [
      openDocument,
      setWindowDocumentEdited,
      setWindowDocumentReadOnly,
      setWindowTitle,
      showSystemOpenDialog,
      syncWindowToTab,
      windowId,
    ],
  )

  useEffect(() => {
    if (!windowId || bootstrappedRef.current) return
    bootstrappedRef.current = true

    void (async () => {
      if (pendingDocumentId) {
        const ok = await openDocument(pendingDocumentId)
        if (!mountedRef.current) return
        if (!ok) {
          setWindowTitle(windowId, OPEN_TITLE)
          setWindowDocumentEdited(windowId, false)
          setWindowDocumentReadOnly(windowId, false)
          const picked = await pickAndOpen('host')
          if (!mountedRef.current) return
          if (!picked) {
            bypassWindowCloseGuard(windowId)
            closeWindow(windowId)
          }
        }
        return
      }

      setWindowTitle(windowId, OPEN_TITLE)
      setWindowDocumentEdited(windowId, false)
      setWindowDocumentReadOnly(windowId, false)
      const picked = await pickAndOpen('host')
      if (!mountedRef.current) return
      if (!picked) {
        bypassWindowCloseGuard(windowId)
        closeWindow(windowId)
      }
    })()
  }, [
    bypassWindowCloseGuard,
    closeWindow,
    openDocument,
    pendingDocumentId,
    pickAndOpen,
    setWindowDocumentEdited,
    setWindowDocumentReadOnly,
    setWindowTitle,
    windowId,
  ])

  useEffect(() => {
    if (!windowId || !ready || !pendingDocumentId) return
    if (loadingPathRef.current === pendingDocumentId) return

    const existing = tabsRef.current.find((tab) => tab.path === pendingDocumentId)
    if (existing) {
      if (existing.id !== activeTabIdRef.current) {
        setActiveTabId(existing.id)
      }
      return
    }

    void openDocument(pendingDocumentId)
  }, [openDocument, pendingDocumentId, ready, windowId])

  const handleOpen = useCallback(async () => {
    await pickAndOpen('modal')
  }, [pickAndOpen])

  const removeTab = useCallback(
    (tabId: string) => {
      if (!windowId) return
      const current = tabsRef.current
      const index = current.findIndex((tab) => tab.id === tabId)
      if (index < 0) return
      const nextTabs = current.filter((tab) => tab.id !== tabId)
      if (nextTabs.length === 0) {
        setTabs([])
        setActiveTabId(undefined)
        bypassWindowCloseGuard(windowId)
        closeWindow(windowId)
        return
      }
      setTabs(nextTabs)
      if (activeTabIdRef.current === tabId) {
        const neighbor = nextTabs[Math.min(index, nextTabs.length - 1)]
        setActiveTabId(neighbor?.id)
      }
    },
    [bypassWindowCloseGuard, closeWindow, windowId],
  )

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
    const dirtyTabs = tabsRef.current.filter(isTabDirty)
    if (dirtyTabs.length === 0) return true

    void (async () => {
      for (const tab of dirtyTabs) {
        const latest = tabsRef.current.find((item) => item.id === tab.id)
        if (!latest || !isTabDirty(latest)) continue
        setActiveTabId(latest.id)
        const choice = await askDirtyChoice(latest)
        if (choice === 'cancel') {
          cancelPendingAppQuit(APP_ID)
          return
        }
        if (choice === 'save') {
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
    askDirtyChoice,
    bypassWindowCloseGuard,
    cancelPendingAppQuit,
    closeWindow,
    saveTab,
    setWindowDocumentEdited,
    windowId,
  ])

  useWindowCloseGuard(windowId, requestClose)

  const updateActiveMarkdown = useCallback((nextMarkdown: string) => {
    const tabId = activeTabIdRef.current
    if (!tabId) return
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== tabId) return tab
        // 打开后编辑器规范化 Markdown：在尚未有用户改动时同步 saved，避免假脏
        if (tab.markdown === tab.savedMarkdown) {
          return { ...tab, markdown: nextMarkdown, savedMarkdown: nextMarkdown }
        }
        return { ...tab, markdown: nextMarkdown }
      }),
    )
  }, [])

  const setActiveViewMode = useCallback((mode: PagesViewMode) => {
    const tabId = activeTabIdRef.current
    if (!tabId) return
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, viewMode: mode } : tab)))
  }, [])

  const runEditorCommand = useCallback((action: (editor: Editor) => void) => {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed) return
    action(editor)
  }, [])

  const menuBar = useMemo((): MenuDefinition[] => {
    const formatDisabled = !ready || !writable || loading || activeTab?.viewMode !== 'edit'
    return [
      {
        label: '文稿',
        items: [
          ...aboutAppMenuPrefix('关于文稿', () => showBuiltinAbout(APP_ID)),
          {
            type: 'action',
            label: '隐藏文稿',
            shortcut: '⌘H',
            onClick: () => windowId && minimizeWindow(windowId),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出文稿',
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
            label: '新建 / 打开…',
            shortcut: '⌘O',
            disabled: !ready || loading || openDialogOpen || !!dirtyPrompt,
            onClick: () => void handleOpen(),
          },
          {
            type: 'action',
            label: '关闭标签',
            shortcut: '⌘W',
            disabled: !ready || tabs.length === 0 || loading || openDialogOpen || !!dirtyPrompt,
            onClick: () => handleCloseTab(),
          },
          {
            type: 'action',
            label: '保存',
            shortcut: '⌘S',
            disabled: !ready || !writable || !dirty || loading,
            onClick: () => void handleSave(),
          },
        ],
      },
      {
        label: '编辑',
        items: [
          {
            type: 'action',
            label: '撤销',
            shortcut: '⌘Z',
            disabled: formatDisabled,
            onClick: () => runEditorCommand((editor) => editor.chain().focus().undo().run()),
          },
          {
            type: 'action',
            label: '重做',
            shortcut: '⇧⌘Z',
            disabled: formatDisabled,
            onClick: () => runEditorCommand((editor) => editor.chain().focus().redo().run()),
          },
        ],
      },
      {
        label: '格式',
        items: [
          {
            type: 'action',
            label: '粗体',
            shortcut: '⌘B',
            disabled: formatDisabled,
            onClick: () => runEditorCommand((editor) => editor.chain().focus().toggleBold().run()),
          },
          {
            type: 'action',
            label: '斜体',
            shortcut: '⌘I',
            disabled: formatDisabled,
            onClick: () => runEditorCommand((editor) => editor.chain().focus().toggleItalic().run()),
          },
          {
            type: 'action',
            label: '下划线',
            shortcut: '⌘U',
            disabled: formatDisabled,
            onClick: () =>
              runEditorCommand((editor) => editor.chain().focus().toggleUnderline().run()),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '标题 1',
            disabled: formatDisabled,
            onClick: () =>
              runEditorCommand((editor) => editor.chain().focus().toggleHeading({ level: 1 }).run()),
          },
          {
            type: 'action',
            label: '标题 2',
            disabled: formatDisabled,
            onClick: () =>
              runEditorCommand((editor) => editor.chain().focus().toggleHeading({ level: 2 }).run()),
          },
          {
            type: 'action',
            label: '无序列表',
            disabled: formatDisabled,
            onClick: () =>
              runEditorCommand((editor) => editor.chain().focus().toggleBulletList().run()),
          },
          {
            type: 'action',
            label: '任务列表',
            disabled: formatDisabled,
            onClick: () =>
              runEditorCommand((editor) => editor.chain().focus().toggleTaskList().run()),
          },
        ],
      },
      {
        label: '查看',
        items: [
          {
            type: 'action',
            label: '可视化编辑',
            disabled: !ready || loading,
            onClick: () => setActiveViewMode('edit'),
          },
          {
            type: 'action',
            label: 'Markdown 源码',
            disabled: !ready || loading,
            onClick: () => setActiveViewMode('source'),
          },
        ],
      },
    ]
  }, [
    activeTab?.viewMode,
    closeWindowsForApp,
    dirty,
    dirtyPrompt,
    handleCloseTab,
    handleOpen,
    handleSave,
    loading,
    minimizeWindow,
    openDialogOpen,
    ready,
    runEditorCommand,
    setActiveViewMode,
    showBuiltinAbout,
    tabs.length,
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

  const pickingWithoutDocument = openDialogOpen && !showEditor

  const tabItems = useMemo(
    () =>
      tabs.map((tab) => ({
        id: tab.id,
        title: tab.node.name,
        pathTitle: tab.path,
        dirty: isTabDirty(tab),
      })),
    [tabs],
  )

  if (!windowId) {
    return <div class="pages" />
  }

  if (pickingWithoutDocument) {
    return <div class="pages pages--picking">{openDialog}</div>
  }

  if (!showEditor) {
    return (
      <div class="pages pages--picking">
        <div class="pages__boot">{loading ? '正在打开…' : undefined}</div>
        {openDialog}
      </div>
    )
  }

  return (
    <div class="pages">
      {tabs.length > 0 ? (
        <DocumentTabBar
          tabs={tabItems}
          activeTabId={activeTab.id}
          closeDisabled={loading || openDialogOpen || !!dirtyPrompt}
          onActivate={focusTab}
          onClose={(tabId) => void closeTab(tabId)}
        />
      ) : undefined}

      <PagesEditor
        key={activeTab.id}
        initialMarkdown={activeTab.markdown}
        editable={writable}
        viewMode={activeTab.viewMode}
        onMarkdownChange={updateActiveMarkdown}
        onViewModeChange={setActiveViewMode}
        onEditorReady={(editor) => {
          editorRef.current = editor
        }}
      />

      {openDialog}

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
