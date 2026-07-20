import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { registerFileOpenHandler } from '../../os/file-open-registry.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import {
  FilePreview,
  loadPreviewDocument,
  PREVIEW_OPEN_EXTENSIONS,
  type PreviewKind,
} from '../../preview/file-preview-public.ts'
import { useSystemOpenDialog } from '../../window/system-open-dialog.tsx'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { FilesStorageFullError } from '../files/files-storage.ts'
import { DocumentTabBar } from '../../ui/document-tab-bar.tsx'
import './preview.css'

const APP_ID = 'preview' as const
const THEME = '#8b5a2b'
const DEFAULT_TITLE = '预览'
const OPEN_TITLE = '打开文件'

registerFileOpenHandler({
  appId: APP_ID,
  extensions: [...PREVIEW_OPEN_EXTENSIONS],
  rank: 5,
})

type PreviewTab = {
  id: string
  path: string
  name: string
  kind: PreviewKind
  text?: string
  imageSrc?: string
  modelUrl?: string
}

type PreviewAppProps = {
  windowId?: string
}

let tabCounter = 0

function nextTabId(): string {
  tabCounter += 1
  return `preview-tab-${tabCounter}`
}

function formatError(error: unknown): string {
  if (error instanceof FilesStorageFullError) return error.message
  if (error instanceof Error && error.message) return error.message
  return '操作失败'
}

function revokeTabUrls(tab: PreviewTab): void {
  if (tab.imageSrc?.startsWith('blob:')) {
    URL.revokeObjectURL(tab.imageSrc)
  }
  if (tab.modelUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(tab.modelUrl)
  }
}

export function PreviewApp({ windowId }: PreviewAppProps) {
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
  } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const modal = useWindowModal()
  const { showSystemOpenDialog, dialog: openDialog, isOpen: openDialogOpen } = useSystemOpenDialog()

  const appWindow = windowId
    ? windows.find((window) => window.id === windowId && !window.closing)
    : undefined
  const pendingDocumentId = appWindow?.documentId
  const isActiveWindow = windowId !== undefined && activeWindowId === windowId

  const [tabs, setTabs] = useState<PreviewTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const bootstrappedRef = useRef(false)
  const loadingPathRef = useRef<string | undefined>(undefined)
  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)
  const mountedRef = useRef(true)

  tabsRef.current = tabs
  activeTabIdRef.current = activeTabId

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      for (const tab of tabsRef.current) {
        revokeTabUrls(tab)
      }
    }
  }, [])

  useEffect(() => {
    if (!windowId || !ready) return
    if (!activeTab) {
      setWindowTitle(windowId, DEFAULT_TITLE)
      setWindowDocumentId(windowId, undefined)
      setWindowDocumentEdited(windowId, false)
      setWindowDocumentReadOnly(windowId, false)
      return
    }
    setWindowTitle(windowId, activeTab.name)
    setWindowDocumentId(windowId, activeTab.path)
    setWindowDocumentEdited(windowId, false)
    setWindowDocumentReadOnly(windowId, true)
  }, [
    activeTab?.id,
    activeTab?.name,
    activeTab?.path,
    ready,
    setWindowDocumentEdited,
    setWindowDocumentId,
    setWindowDocumentReadOnly,
    setWindowTitle,
    windowId,
  ])

  const focusTab = useCallback((tabId: string) => {
    setActiveTabId(tabId)
  }, [])

  const tabItems = useMemo(
    () =>
      tabs.map((tab) => ({
        id: tab.id,
        title: tab.name,
        pathTitle: tab.path,
      })),
    [tabs],
  )

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
        const loaded = await loadPreviewDocument(documentRef)
        if (!mountedRef.current) return false
        const already = tabsRef.current.find((tab) => tab.path === loaded.path)
        if (already) {
          setActiveTabId(already.id)
          setReady(true)
          return true
        }
        const imageSrc =
          loaded.kind === 'image' && loaded.blob
            ? URL.createObjectURL(loaded.blob)
            : undefined
        const modelUrl =
          loaded.kind === 'model3d'
            ? loaded.modelUrl ??
              (loaded.blob ? URL.createObjectURL(loaded.blob) : undefined)
            : undefined
        if (!mountedRef.current) {
          if (imageSrc) URL.revokeObjectURL(imageSrc)
          if (modelUrl?.startsWith('blob:')) URL.revokeObjectURL(modelUrl)
          return false
        }
        const tab: PreviewTab = {
          id: nextTabId(),
          path: loaded.path,
          name: loaded.name,
          kind: loaded.kind,
          text: loaded.text,
          imageSrc,
          modelUrl,
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

  const pickAndOpen = useCallback(async (): Promise<boolean> => {
    if (!windowId) return false
    const path = await showSystemOpenDialog({
      title: OPEN_TITLE,
      acceptExtensions: [...PREVIEW_OPEN_EXTENSIONS],
      allowCreate: false,
      presentation: 'modal',
    })
    if (!path) return false
    return openDocument(path)
  }, [openDocument, showSystemOpenDialog, windowId])

  useEffect(() => {
    if (!windowId || bootstrappedRef.current) return
    bootstrappedRef.current = true

    if (pendingDocumentId) {
      void openDocument(pendingDocumentId)
    } else {
      setReady(true)
    }
  }, [openDocument, pendingDocumentId, windowId])

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
    await pickAndOpen()
  }, [pickAndOpen])

  const removeTab = useCallback(
    (tabId: string) => {
      if (!windowId) return
      const current = tabsRef.current
      const index = current.findIndex((tab) => tab.id === tabId)
      if (index < 0) return
      const closing = current[index]
      if (closing) revokeTabUrls(closing)
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
    (tabId: string) => {
      removeTab(tabId)
    },
    [removeTab],
  )

  const menuBar = useMemo((): MenuDefinition[] => {
    return [
      {
        label: '预览',
        items: [
          ...aboutAppMenuPrefix('关于预览', () => showBuiltinAbout(APP_ID)),
          {
            type: 'action',
            label: '隐藏预览',
            shortcut: '⌘H',
            onClick: () => windowId && minimizeWindow(windowId),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出预览',
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
            disabled: loading || openDialogOpen,
            onClick: () => void handleOpen(),
          },
          {
            type: 'action',
            label: '关闭标签页',
            shortcut: '⌘W',
            disabled: !activeTab || loading,
            onClick: () => activeTab && closeTab(activeTab.id),
          },
        ],
      },
    ]
  }, [
    activeTab,
    closeTab,
    closeWindowsForApp,
    handleOpen,
    loading,
    minimizeWindow,
    openDialogOpen,
    showBuiltinAbout,
    windowId,
  ])

  useAppMenuBar(APP_ID, menuBar, isActiveWindow)

  return (
    <div class="preview-app">
      <div class="preview-app__toolbar">
        <button
          type="button"
          class="preview-app__toolbar-btn"
          disabled={loading || openDialogOpen}
          onClick={() => void handleOpen()}
        >
          打开…
        </button>
        <div class="preview-app__toolbar-title">
          {activeTab ? activeTab.name : '未打开文档'}
        </div>
      </div>

      {tabs.length > 1 ? (
        <DocumentTabBar
          class="preview-app__doc-tabs"
          tabs={tabItems}
          activeTabId={activeTab?.id}
          closeDisabled={loading || openDialogOpen}
          onActivate={focusTab}
          onClose={closeTab}
        />
      ) : undefined}

      <div class="preview-app__body">
        {loading && !activeTab ? (
          <div class="preview-app__loading">正在打开…</div>
        ) : !activeTab ? (
          <div class="preview-app__empty">
            <p class="preview-app__empty-title">预览</p>
            <p class="preview-app__empty-hint">
              打开 Markdown、图片或 3D 模型（glTF / GLB），以只读方式查看内容。
            </p>
            <button
              type="button"
              class="preview-app__toolbar-btn preview-app__empty-btn"
              disabled={openDialogOpen}
              onClick={() => void handleOpen()}
            >
              打开文件…
            </button>
          </div>
        ) : (
          <FilePreview
            kind={activeTab.kind}
            text={activeTab.text}
            imageSrc={activeTab.imageSrc}
            imageAlt={activeTab.name}
            modelUrl={activeTab.modelUrl}
          />
        )}
      </div>
      {openDialogOpen && openDialog ? openDialog : undefined}
    </div>
  )
}
