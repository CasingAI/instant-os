import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
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
import './textedit.css'

const APP_ID = 'textedit' as const
const THEME = '#3d7a4a'
const DEFAULT_TITLE = '文本编辑'
const OPEN_TITLE = '打开文件'

registerFileOpenHandler({
  appId: APP_ID,
  extensions: ['txt'],
  rank: 10,
})

type DirtyChoice = 'save' | 'discard' | 'cancel'

type DirtyPromptState = {
  fileName: string
  resolve: (choice: DirtyChoice) => void
}

type TextEditAppProps = {
  windowId?: string
}

function formatError(error: unknown): string {
  if (error instanceof FilesStorageFullError) return error.message
  if (error instanceof Error && error.message) return error.message
  return '操作失败'
}

export function TextEditApp({ windowId }: TextEditAppProps) {
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

  const [node, setNode] = useState<FilesNode | undefined>(undefined)
  const [documentPath, setDocumentPath] = useState<string | undefined>(undefined)
  const [text, setText] = useState('')
  const [savedText, setSavedText] = useState('')
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [dirtyPrompt, setDirtyPrompt] = useState<DirtyPromptState | undefined>(undefined)
  const bootstrappedRef = useRef(false)
  const loadingIdRef = useRef<string | undefined>(undefined)
  const dirtyRef = useRef(false)
  const nodeRef = useRef(node)
  const documentPathRef = useRef(documentPath)
  const textRef = useRef(text)

  nodeRef.current = node
  documentPathRef.current = documentPath
  textRef.current = text

  const dirty = node !== undefined && text !== savedText
  dirtyRef.current = dirty
  const writable = node ? isFilesNodeWritable(node) : false
  const mountedRef = useRef(true)
  const showEditor = ready && node !== undefined

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!windowId) return
    setWindowDocumentEdited(windowId, dirty)
  }, [dirty, setWindowDocumentEdited, windowId])

  const applyLoaded = useCallback(
    async (nextNode: FilesNode, nextText: string) => {
      if (!windowId) return
      const path = await resolveFilesAbsolutePath(nextNode)
      setNode(nextNode)
      setDocumentPath(path)
      setText(nextText)
      setSavedText(nextText)
      setWindowDocumentId(windowId, path)
      setWindowTitle(windowId, nextNode.name)
      setWindowDocumentEdited(windowId, false)
      setWindowDocumentReadOnly(windowId, !isFilesNodeWritable(nextNode))
      setReady(true)
    },
    [setWindowDocumentEdited, setWindowDocumentId, setWindowDocumentReadOnly, setWindowTitle, windowId],
  )

  const loadDocument = useCallback(
    async (documentRef: string): Promise<boolean> => {
      if (loadingIdRef.current === documentRef) {
        return true
      }
      loadingIdRef.current = documentRef
      setLoading(true)
      try {
        const result = await readTextFile(documentRef)
        await applyLoaded(result.node, result.text)
        return true
      } catch (err) {
        await modal.alert({
          title: '无法打开',
          message: formatError(err),
          themeColor: THEME,
        })
        return false
      } finally {
        if (loadingIdRef.current === documentRef) {
          loadingIdRef.current = undefined
        }
        setLoading(false)
      }
    },
    [applyLoaded, modal],
  )

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!windowId) return false
    const current = nodeRef.current
    const path = documentPathRef.current
    if (!current || !isFilesNodeWritable(current)) return false
    setLoading(true)
    try {
      const updated = await writeTextFile(path ?? current.id, textRef.current)
      const nextPath = await resolveFilesAbsolutePath(updated)
      setNode(updated)
      setDocumentPath(nextPath)
      setSavedText(textRef.current)
      setWindowDocumentId(windowId, nextPath)
      setWindowTitle(windowId, updated.name)
      setWindowDocumentEdited(windowId, false)
      setWindowDocumentReadOnly(windowId, !isFilesNodeWritable(updated))
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
  }, [modal, setWindowDocumentEdited, setWindowDocumentId, setWindowDocumentReadOnly, setWindowTitle, windowId])

  const askDirtyChoice = useCallback((): Promise<DirtyChoice> => {
    if (!dirtyRef.current) return Promise.resolve('discard')
    return new Promise((resolve) => {
      setDirtyPrompt({
        fileName: nodeRef.current?.name ?? '文稿',
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

  const ensureCleanOrConfirm = useCallback(async (): Promise<boolean> => {
    const choice = await askDirtyChoice()
    if (choice === 'cancel') return false
    if (choice === 'save') return handleSave()
    return true
  }, [askDirtyChoice, handleSave])

  const pickAndOpen = useCallback(
    async (presentation: 'host' | 'modal'): Promise<boolean> => {
      if (!windowId) return false
      if (presentation === 'host') {
        setWindowTitle(windowId, OPEN_TITLE)
        setWindowDocumentEdited(windowId, false)
        setWindowDocumentReadOnly(windowId, false)
      }
      const picked = await showSystemOpenDialog({
        title: OPEN_TITLE,
        acceptExtensions: ['txt'],
        allowCreate: true,
        createExtension: 'txt',
        presentation,
      })
      if (!picked) {
        if (presentation === 'host' && !nodeRef.current) {
          setWindowTitle(windowId, DEFAULT_TITLE)
          setWindowDocumentReadOnly(windowId, false)
        } else if (nodeRef.current) {
          setWindowTitle(windowId, nodeRef.current.name)
          setWindowDocumentEdited(windowId, dirtyRef.current)
          setWindowDocumentReadOnly(windowId, !isFilesNodeWritable(nodeRef.current))
        }
        return false
      }
      const path = await resolveFilesAbsolutePath(picked)
      return loadDocument(path)
    },
    [
      loadDocument,
      setWindowDocumentEdited,
      setWindowDocumentReadOnly,
      setWindowTitle,
      showSystemOpenDialog,
      windowId,
    ],
  )

  useEffect(() => {
    if (!windowId || bootstrappedRef.current) return
    bootstrappedRef.current = true

    void (async () => {
      if (pendingDocumentId) {
        const ok = await loadDocument(pendingDocumentId)
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
    loadDocument,
    pendingDocumentId,
    pickAndOpen,
    setWindowDocumentEdited,
    setWindowDocumentReadOnly,
    setWindowTitle,
    windowId,
  ])

  useEffect(() => {
    if (!windowId || !ready || !pendingDocumentId) return
    if (pendingDocumentId === documentPathRef.current) return
    if (loadingIdRef.current === pendingDocumentId) return

    void (async () => {
      const proceed = await ensureCleanOrConfirm()
      if (!proceed) {
        if (documentPathRef.current) {
          setWindowDocumentId(windowId, documentPathRef.current)
        }
        return
      }
      await loadDocument(pendingDocumentId)
    })()
  }, [ensureCleanOrConfirm, loadDocument, pendingDocumentId, ready, setWindowDocumentId, windowId])

  const handleOpen = useCallback(async () => {
    const proceed = await ensureCleanOrConfirm()
    if (!proceed) return
    await pickAndOpen('modal')
  }, [ensureCleanOrConfirm, pickAndOpen])

  const requestClose = useCallback(() => {
    if (!windowId) return true
    if (!dirtyRef.current) return true
    void (async () => {
      const choice = await askDirtyChoice()
      if (choice === 'cancel') {
        cancelPendingAppQuit(APP_ID)
        return
      }
      if (choice === 'save') {
        const saved = await handleSave()
        if (!saved) {
          cancelPendingAppQuit(APP_ID)
          return
        }
      } else {
        setWindowDocumentEdited(windowId, false)
      }
      bypassWindowCloseGuard(windowId)
      closeWindow(windowId)
    })()
    return false
  }, [
    askDirtyChoice,
    bypassWindowCloseGuard,
    cancelPendingAppQuit,
    closeWindow,
    handleSave,
    setWindowDocumentEdited,
    windowId,
  ])

  useWindowCloseGuard(windowId, requestClose)

  const menuBar = useMemo((): MenuDefinition[] => {
    return [
      {
        label: '文本编辑',
        items: [
          ...aboutAppMenuPrefix('关于文本编辑', () => showBuiltinAbout(APP_ID)),
          {
            type: 'action',
            label: '隐藏文本编辑',
            shortcut: '⌘H',
            onClick: () => windowId && minimizeWindow(windowId),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出文本编辑',
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
            disabled: !ready || loading || openDialogOpen || !!dirtyPrompt,
            onClick: () => void handleOpen(),
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
    ]
  }, [
    closeWindowsForApp,
    dirty,
    dirtyPrompt,
    handleOpen,
    handleSave,
    loading,
    minimizeWindow,
    openDialogOpen,
    ready,
    showBuiltinAbout,
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
        disabled: !writable || loading,
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
    [loading, resolveDirtyPrompt, writable],
  )

  const pickingWithoutDocument = openDialogOpen && !showEditor

  if (!windowId) {
    return <div class="textedit" />
  }

  if (pickingWithoutDocument) {
    return <div class="textedit textedit--picking">{openDialog}</div>
  }

  if (!showEditor) {
    return (
      <div class="textedit textedit--picking">
        <div class="textedit__boot">{loading ? '正在打开…' : undefined}</div>
        {openDialog}
      </div>
    )
  }

  return (
    <div class="textedit">
      <textarea
        class="textedit__input"
        value={text}
        readOnly={!writable}
        spellcheck={false}
        aria-label={node.name}
        onInput={(event) => setText((event.target as HTMLTextAreaElement).value)}
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
