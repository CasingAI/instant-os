import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { MarkdownDocumentPreview } from '../../markdown/markdown-public.ts'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { registerFileOpenHandler } from '../../os/file-open-registry.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { useSystemOpenDialog } from '../../window/system-open-dialog.tsx'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { FilesStorageFullError } from '../files/files-storage.ts'
import { readTextFile, resolveFilesAbsolutePath } from '../files/files-vfs.ts'
import {
  PREVIEW_MARKDOWN_EXTENSIONS,
  resolvePreviewKind,
  type PreviewKind,
} from './preview-kind.ts'
import './preview.css'

const APP_ID = 'preview' as const
const THEME = '#8b5a2b'
const DEFAULT_TITLE = '预览'
const OPEN_TITLE = '打开文档'

registerFileOpenHandler({
  appId: APP_ID,
  extensions: [...PREVIEW_MARKDOWN_EXTENSIONS],
  rank: 5,
})

type PreviewDocument = {
  path: string
  name: string
  text: string
  kind: PreviewKind
}

type PreviewAppProps = {
  windowId?: string
}

function formatError(error: unknown): string {
  if (error instanceof FilesStorageFullError) return error.message
  if (error instanceof Error && error.message) return error.message
  return '操作失败'
}

export function PreviewApp({ windowId }: PreviewAppProps) {
  const {
    windows,
    activeWindowId,
    setWindowTitle,
    setWindowDocumentId,
    setWindowDocumentEdited,
    setWindowDocumentReadOnly,
    closeWindowsForApp,
    minimizeWindow,
  } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const modal = useWindowModal()
  const { showSystemOpenDialog, dialog: openDialog, isOpen: openDialogOpen } = useSystemOpenDialog()

  const appWindow = windowId
    ? windows.find((window) => window.id === windowId && !window.closing)
    : undefined
  const pendingDocumentId = appWindow?.documentId
  const isActiveWindow = windowId !== undefined && activeWindowId === windowId

  const [document, setDocument] = useState<PreviewDocument | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const bootstrappedRef = useRef(false)
  const loadingPathRef = useRef<string | undefined>(undefined)
  const documentPathRef = useRef<string | undefined>(undefined)
  const mountedRef = useRef(true)

  documentPathRef.current = document?.path

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const syncWindowMeta = useCallback(
    (doc: PreviewDocument | undefined) => {
      if (!windowId) return
      if (!doc) {
        setWindowTitle(windowId, DEFAULT_TITLE)
        setWindowDocumentId(windowId, undefined)
        setWindowDocumentEdited(windowId, false)
        setWindowDocumentReadOnly(windowId, false)
        return
      }
      setWindowTitle(windowId, doc.name)
      setWindowDocumentId(windowId, doc.path)
      setWindowDocumentEdited(windowId, false)
      setWindowDocumentReadOnly(windowId, true)
    },
    [setWindowDocumentEdited, setWindowDocumentId, setWindowDocumentReadOnly, setWindowTitle, windowId],
  )

  useEffect(() => {
    if (!windowId || loading) return
    syncWindowMeta(document)
  }, [document, loading, syncWindowMeta, windowId])

  const openDocument = useCallback(
    async (documentRef: string): Promise<boolean> => {
      if (!windowId) return false
      if (documentPathRef.current === documentRef) return true
      if (loadingPathRef.current === documentRef) return true

      loadingPathRef.current = documentRef
      setLoading(true)
      try {
        const result = await readTextFile(documentRef)
        if (!mountedRef.current) return false
        const path = await resolveFilesAbsolutePath(result.node)
        const kind = resolvePreviewKind(result.node.name)
        setDocument({
          path,
          name: result.node.name,
          text: kind === 'markdown' ? result.text : '',
          kind,
        })
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
      acceptExtensions: [...PREVIEW_MARKDOWN_EXTENSIONS],
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
    }
  }, [openDocument, pendingDocumentId, windowId])

  useEffect(() => {
    if (!windowId || !bootstrappedRef.current || !pendingDocumentId) return
    if (loadingPathRef.current === pendingDocumentId) return
    if (documentPathRef.current === pendingDocumentId) return
    void openDocument(pendingDocumentId)
  }, [openDocument, pendingDocumentId, windowId])

  const handleOpen = useCallback(async () => {
    await pickAndOpen()
  }, [pickAndOpen])

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
        ],
      },
    ]
  }, [
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
          {document ? document.name : '未打开文档'}
        </div>
      </div>
      <div class="preview-app__body">
        {loading ? (
          <div class="preview-app__loading">正在打开…</div>
        ) : !document ? (
          <div class="preview-app__empty">
            <p class="preview-app__empty-title">预览</p>
            <p class="preview-app__empty-hint">打开 Markdown 等文档以查看拟物纸面渲染。</p>
            <button
              type="button"
              class="preview-app__toolbar-btn preview-app__empty-btn"
              disabled={openDialogOpen}
              onClick={() => void handleOpen()}
            >
              打开文档…
            </button>
          </div>
        ) : document.kind === 'unsupported' ? (
          <div class="preview-app__unsupported">
            <p class="preview-app__unsupported-title">暂不支持此格式</p>
            <p class="preview-app__unsupported-hint">
              「预览」目前可查看 Markdown（.md / .markdown / .mdx）。其它格式将陆续加入。
            </p>
          </div>
        ) : (
          <MarkdownDocumentPreview text={document.text} />
        )}
      </div>
      {openDialogOpen && openDialog ? openDialog : undefined}
    </div>
  )
}
