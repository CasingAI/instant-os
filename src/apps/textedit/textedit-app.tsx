import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { registerFileOpenHandler } from '../../os/file-open-registry.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useAppCloseGuard, useOs } from '../../os/os-context.tsx'
import { useSystemOpenDialog } from '../../window/system-open-dialog.tsx'
import { WindowModal } from '../../window/window-modal.tsx'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { FilesStorageFullError } from '../files/files-storage.ts'
import { isFilesNodeWritable, type FilesNode } from '../files/files-types.ts'
import { readTextFile, writeTextFile } from '../files/files-vfs.ts'
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

function formatError(error: unknown): string {
  if (error instanceof FilesStorageFullError) return error.message
  if (error instanceof Error && error.message) return error.message
  return '操作失败'
}

export function TextEditApp() {
  const {
    windows,
    setAppWindowTitle,
    setAppWindowDocumentId,
    setAppWindowDocumentEdited,
    closeWindowsForApp,
    minimizeWindow,
    bypassAppCloseGuard,
  } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const modal = useWindowModal()
  const { showSystemOpenDialog, dialog: openDialog, isOpen: openDialogOpen } = useSystemOpenDialog()

  const appWindow = windows.find((window) => window.appId === APP_ID && !window.closing)
  const pendingDocumentId = appWindow?.documentId

  const [node, setNode] = useState<FilesNode | undefined>(undefined)
  const [text, setText] = useState('')
  const [savedText, setSavedText] = useState('')
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [dirtyPrompt, setDirtyPrompt] = useState<DirtyPromptState | undefined>(undefined)
  const bootstrappedRef = useRef(false)
  const loadingIdRef = useRef<string | undefined>(undefined)
  const dirtyRef = useRef(false)
  const nodeRef = useRef(node)
  const textRef = useRef(text)

  nodeRef.current = node
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
    setAppWindowDocumentEdited(APP_ID, dirty)
  }, [dirty, setAppWindowDocumentEdited])

  const applyLoaded = useCallback(
    (nextNode: FilesNode, nextText: string) => {
      setNode(nextNode)
      setText(nextText)
      setSavedText(nextText)
      setAppWindowDocumentId(APP_ID, nextNode.id)
      setAppWindowTitle(APP_ID, nextNode.name)
      setAppWindowDocumentEdited(APP_ID, false)
      setReady(true)
    },
    [setAppWindowDocumentEdited, setAppWindowDocumentId, setAppWindowTitle],
  )

  const loadDocument = useCallback(
    async (documentId: string): Promise<boolean> => {
      if (loadingIdRef.current === documentId) {
        return true
      }
      loadingIdRef.current = documentId
      setLoading(true)
      try {
        const result = await readTextFile(documentId)
        applyLoaded(result.node, result.text)
        return true
      } catch (err) {
        await modal.alert({
          title: '无法打开',
          message: formatError(err),
          themeColor: THEME,
        })
        return false
      } finally {
        if (loadingIdRef.current === documentId) {
          loadingIdRef.current = undefined
        }
        setLoading(false)
      }
    },
    [applyLoaded, modal],
  )

  const handleSave = useCallback(async (): Promise<boolean> => {
    const current = nodeRef.current
    if (!current || !isFilesNodeWritable(current)) return false
    setLoading(true)
    try {
      const updated = await writeTextFile(current.id, textRef.current)
      setNode(updated)
      setSavedText(textRef.current)
      setAppWindowTitle(APP_ID, updated.name)
      setAppWindowDocumentEdited(APP_ID, false)
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
  }, [modal, setAppWindowDocumentEdited, setAppWindowTitle])

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

  const pickAndOpen = useCallback(async (): Promise<boolean> => {
    const picked = await showSystemOpenDialog({
      title: OPEN_TITLE,
      acceptExtensions: ['txt'],
      allowCreate: true,
      createExtension: 'txt',
    })
    if (!picked) {
      if (nodeRef.current) {
        setAppWindowTitle(APP_ID, nodeRef.current.name)
        setAppWindowDocumentEdited(APP_ID, dirtyRef.current)
      } else {
        setAppWindowTitle(APP_ID, DEFAULT_TITLE)
      }
      return false
    }
    return loadDocument(picked.id)
  }, [loadDocument, setAppWindowDocumentEdited, setAppWindowTitle, showSystemOpenDialog])

  useEffect(() => {
    if (bootstrappedRef.current) return
    bootstrappedRef.current = true

    void (async () => {
      if (pendingDocumentId) {
        const ok = await loadDocument(pendingDocumentId)
        if (!mountedRef.current) return
        if (!ok) {
          setAppWindowTitle(APP_ID, OPEN_TITLE)
          setAppWindowDocumentEdited(APP_ID, false)
          const picked = await pickAndOpen()
          if (!mountedRef.current) return
          if (!picked) {
            bypassAppCloseGuard(APP_ID)
            closeWindowsForApp(APP_ID)
          }
        }
        return
      }

      setAppWindowTitle(APP_ID, OPEN_TITLE)
      setAppWindowDocumentEdited(APP_ID, false)
      const picked = await pickAndOpen()
      if (!mountedRef.current) return
      if (!picked) {
        bypassAppCloseGuard(APP_ID)
        closeWindowsForApp(APP_ID)
      }
    })()
  }, [
    bypassAppCloseGuard,
    closeWindowsForApp,
    loadDocument,
    pendingDocumentId,
    pickAndOpen,
    setAppWindowDocumentEdited,
    setAppWindowTitle,
  ])

  useEffect(() => {
    if (!ready || !pendingDocumentId) return
    if (pendingDocumentId === nodeRef.current?.id) return
    if (loadingIdRef.current === pendingDocumentId) return

    void (async () => {
      const proceed = await ensureCleanOrConfirm()
      if (!proceed) {
        if (nodeRef.current) {
          setAppWindowDocumentId(APP_ID, nodeRef.current.id)
        }
        return
      }
      await loadDocument(pendingDocumentId)
    })()
  }, [ensureCleanOrConfirm, loadDocument, pendingDocumentId, ready, setAppWindowDocumentId])

  const handleOpen = useCallback(async () => {
    const proceed = await ensureCleanOrConfirm()
    if (!proceed) return
    await pickAndOpen()
  }, [ensureCleanOrConfirm, pickAndOpen])

  const requestClose = useCallback(() => {
    if (!dirtyRef.current) return true
    void (async () => {
      const choice = await askDirtyChoice()
      if (choice === 'cancel') return
      if (choice === 'save') {
        const saved = await handleSave()
        if (!saved) return
      } else {
        setAppWindowDocumentEdited(APP_ID, false)
      }
      bypassAppCloseGuard(APP_ID)
      closeWindowsForApp(APP_ID)
    })()
    return false
  }, [
    askDirtyChoice,
    bypassAppCloseGuard,
    closeWindowsForApp,
    handleSave,
    setAppWindowDocumentEdited,
  ])

  useAppCloseGuard(APP_ID, requestClose)

  const menuBar = useMemo((): MenuDefinition[] => {
    const liveWindow = windows.find((window) => window.appId === APP_ID && !window.minimized)

    return [
      {
        label: '文本编辑',
        items: [
          ...aboutAppMenuPrefix('关于文本编辑', () => showBuiltinAbout(APP_ID)),
          {
            type: 'action',
            label: '隐藏文本编辑',
            shortcut: '⌘H',
            onClick: () => liveWindow && minimizeWindow(liveWindow.id),
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
    windows,
    writable,
  ])

  useAppMenuBar(APP_ID, menuBar)

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

  if (!showEditor) {
    return (
      <div class="textedit">
        <div class="textedit__boot">{loading || openDialogOpen ? '正在打开…' : undefined}</div>
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
