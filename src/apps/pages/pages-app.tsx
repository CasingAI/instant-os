import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Editor, JSONContent } from '@tiptap/core'
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
  createTextFile,
  readFileBlob,
  readTextFile,
  resolveFilesAbsolutePath,
  writeBinaryFile,
  writeTextFile,
} from '../files/files-vfs.ts'
import { DocumentTabBar } from '../../ui/document-tab-bar.tsx'
import {
  buildBlobUrlMap,
  createPagesAssetFromFile,
  mergeAsset,
  revokeBlobUrlMap,
  rewriteDocumentSrcToAssetPaths,
  rewriteDocumentSrcToBlobUrls,
  type PagesBlobUrlMap,
} from './pages-assets.ts'
import { jsonContentToMarkdown, markdownToJSONContent } from './pages-doc-convert.ts'
import { PagesEditor, type PagesViewMode } from './pages-editor.tsx'
import { PAGES_EMPTY_MARKDOWN, PAGES_OPEN_EXTENSIONS } from './pages-markdown.ts'
import {
  createEmptyPagesManifest,
  packEmptyPagesPackage,
  packPagesPackage,
  pruneAssetsToDocument,
  unpackPagesPackage,
  PAGES_EMPTY_DOCUMENT,
  PAGES_FILE_EXTENSION,
  PAGES_MIME,
  type PagesAssetMap,
} from './pages-package.ts'
import './pages.css'

const APP_ID = 'pages' as const
const THEME = '#2f6fed'
const DEFAULT_TITLE = '文稿'
const OPEN_TITLE = '打开文稿'
const AUTOSAVE_DELAY_MS = 1500

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

type PagesTabFormat = 'pages' | 'markdown'

type PagesTab = {
  id: string
  path: string
  node: FilesNode
  format: PagesTabFormat
  document: JSONContent
  assets: PagesAssetMap
  /** pages：规范化后的 {doc, assetIds}；markdown 不用 */
  savedFingerprint?: string
  /** markdown：保存时的正文 */
  savedMarkdown?: string
  viewMode: PagesViewMode
  sheetTableId: string | null
  outlineOpen: boolean
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

function isPagesPackagePath(path: string): boolean {
  return path.toLowerCase().endsWith(`.${PAGES_FILE_EXTENSION}`)
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function pagesFingerprint(
  doc: JSONContent,
  assets: PagesAssetMap,
  blobUrls: PagesBlobUrlMap,
): string {
  const normalized = rewriteDocumentSrcToAssetPaths(doc, blobUrls, assets)
  const assetIds = [...assets.keys()].sort()
  return JSON.stringify({ doc: normalized, assetIds })
}

function isTabDirty(tab: PagesTab, blobUrls: PagesBlobUrlMap): boolean {
  if (tab.format === 'markdown') {
    return jsonContentToMarkdown(tab.document) !== (tab.savedMarkdown ?? '')
  }
  return pagesFingerprint(tab.document, tab.assets, blobUrls) !== (tab.savedFingerprint ?? '')
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
    bypassWindowCloseGuard,
    cancelPendingAppQuit,
  } = useOs()
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
  const [findOpenSignal, setFindOpenSignal] = useState(0)
  const [findReplaceSignal, setFindReplaceSignal] = useState(0)
  const [saveHint, setSaveHint] = useState<'idle' | 'saving' | 'saved'>('idle')
  const bootstrappedRef = useRef(false)
  const loadingPathRef = useRef<string | undefined>(undefined)
  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)
  const mountedRef = useRef(true)
  const editorRef = useRef<Editor | null>(null)
  const blobUrlMapsRef = useRef(new Map<string, PagesBlobUrlMap>())
  /** 每个标签编辑器挂载后的首次 onDocumentChange 对齐基线（消化 TipTap 规范化） */
  const lastBaselineTabIdRef = useRef<string | undefined>(undefined)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingTabIdsRef = useRef(new Set<string>())
  const dirtyPromptRef = useRef(dirtyPrompt)
  const saveHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  tabsRef.current = tabs
  activeTabIdRef.current = activeTabId
  dirtyPromptRef.current = dirtyPrompt

  const clearAutosaveTimer = useCallback(() => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
  }, [])

  const getBlobMap = useCallback((tabId: string): PagesBlobUrlMap => {
    let map = blobUrlMapsRef.current.get(tabId)
    if (!map) {
      map = new Map()
      blobUrlMapsRef.current.set(tabId, map)
    }
    return map
  }, [])

  const disposeTabBlobs = useCallback((tabId: string) => {
    const map = blobUrlMapsRef.current.get(tabId)
    if (!map) return
    revokeBlobUrlMap(map)
    blobUrlMapsRef.current.delete(tabId)
  }, [])

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]
  const activeBlobMap = activeTab ? getBlobMap(activeTab.id) : new Map<string, string>()
  const dirty = activeTab ? isTabDirty(activeTab, activeBlobMap) : false
  const writable = activeTab ? isFilesNodeWritable(activeTab.node) : false
  const showEditor = ready && activeTab !== undefined

  const editorDocument = useMemo(() => {
    if (!activeTab) return PAGES_EMPTY_DOCUMENT
    return rewriteDocumentSrcToBlobUrls(activeTab.document, getBlobMap(activeTab.id))
  }, [activeTab, getBlobMap])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      for (const tabId of blobUrlMapsRef.current.keys()) {
        disposeTabBlobs(tabId)
      }
    }
  }, [disposeTabBlobs])

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
      setWindowDocumentEdited(windowId, isTabDirty(tab, getBlobMap(tab.id)))
      setWindowDocumentReadOnly(windowId, !isFilesNodeWritable(tab.node))
    },
    [getBlobMap, setWindowDocumentEdited, setWindowDocumentId, setWindowDocumentReadOnly, setWindowTitle, windowId],
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
        if (isPagesPackagePath(documentRef)) {
          const result = await readFileBlob(documentRef)
          if (!mountedRef.current) return false
          const path = await resolveFilesAbsolutePath(result.node)
          const already = tabsRef.current.find((tab) => tab.path === path)
          if (already) {
            setActiveTabId(already.id)
            setReady(true)
            return true
          }
          const bytes = new Uint8Array(await result.blob.arrayBuffer())
          const unpacked = unpackPagesPackage(bytes)
          const tabId = nextTabId()
          const blobMap = buildBlobUrlMap(unpacked.assets)
          blobUrlMapsRef.current.set(tabId, blobMap)
          const fingerprint = pagesFingerprint(unpacked.document, unpacked.assets, blobMap)
          const tab: PagesTab = {
            id: tabId,
            path,
            node: result.node,
            format: 'pages',
            document: unpacked.document,
            assets: unpacked.assets,
            savedFingerprint: fingerprint,
            viewMode: 'edit',
            sheetTableId: null,
            outlineOpen: false,
          }
          setTabs((prev) => [...prev, tab])
          setActiveTabId(tab.id)
          setReady(true)
          return true
        }

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
        const document = markdownToJSONContent(text)
        const normalizedMarkdown = jsonContentToMarkdown(document)
        const tab: PagesTab = {
          id: nextTabId(),
          path,
          node: result.node,
          format: 'markdown',
          document,
          assets: new Map(),
          savedMarkdown: normalizedMarkdown,
          viewMode: 'edit',
          sheetTableId: null,
          outlineOpen: false,
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
    async (tabId: string, opts?: { quiet?: boolean }): Promise<boolean> => {
      if (!windowId) return false
      const quiet = opts?.quiet === true
      const tab = tabsRef.current.find((item) => item.id === tabId)
      if (!tab || !isFilesNodeWritable(tab.node)) return false
      if (savingTabIdsRef.current.has(tabId)) return false
      if (!isTabDirty(tab, getBlobMap(tabId))) return true

      savingTabIdsRef.current.add(tabId)
      if (!quiet) setLoading(true)
      if (quiet) {
        setSaveHint('saving')
        if (saveHintTimerRef.current) clearTimeout(saveHintTimerRef.current)
      }
      try {
        if (tab.format === 'pages') {
          const blobMap = getBlobMap(tabId)
          const normalized = rewriteDocumentSrcToAssetPaths(tab.document, blobMap, tab.assets)
          const pruned = pruneAssetsToDocument(normalized, tab.assets)
          const packed = packPagesPackage({
            manifest: createEmptyPagesManifest(tab.node.name.replace(/\.pages$/i, '') || '无标题文档'),
            document: normalized,
            assets: pruned,
          })
          const updated = await writeBinaryFile(tab.path, toArrayBuffer(packed))
          const nextPath = await resolveFilesAbsolutePath(updated)
          // 释放已删除资源的 blob
          for (const [fileName, url] of [...blobMap.entries()]) {
            const still = [...pruned.values()].some((asset) => asset.fileName === fileName)
            if (!still) {
              URL.revokeObjectURL(url)
              blobMap.delete(fileName)
            }
          }
          const fingerprint = pagesFingerprint(normalized, pruned, blobMap)
          setTabs((prev) =>
            prev.map((item) =>
              item.id === tabId
                ? {
                    ...item,
                    node: updated,
                    path: nextPath,
                    document: normalized,
                    assets: pruned,
                    savedFingerprint: fingerprint,
                  }
                : item,
            ),
          )
          if (quiet) {
            setSaveHint('saved')
            saveHintTimerRef.current = setTimeout(() => setSaveHint('idle'), 1200)
          }
          return true
        }

        const markdown = jsonContentToMarkdown(tab.document)
        const updated = await writeTextFile(tab.path, markdown)
        const nextPath = await resolveFilesAbsolutePath(updated)
        setTabs((prev) =>
          prev.map((item) =>
            item.id === tabId
              ? {
                  ...item,
                  node: updated,
                  path: nextPath,
                  savedMarkdown: markdown,
                }
              : item,
          ),
        )
        if (quiet) {
          setSaveHint('saved')
          saveHintTimerRef.current = setTimeout(() => setSaveHint('idle'), 1200)
        }
        return true
      } catch (err) {
        if (quiet) setSaveHint('idle')
        await modal.alert({
          title: quiet ? '自动保存失败' : '无法保存',
          message: formatError(err),
          themeColor: THEME,
        })
        return false
      } finally {
        savingTabIdsRef.current.delete(tabId)
        if (!quiet) setLoading(false)
      }
    },
    [getBlobMap, modal, windowId],
  )

  const handleSave = useCallback(async (): Promise<boolean> => {
    const tabId = activeTabIdRef.current
    if (!tabId) return false
    clearAutosaveTimer()
    return saveTab(tabId)
  }, [clearAutosaveTimer, saveTab])

  const askDirtyChoice = useCallback((tab: PagesTab): Promise<DirtyChoice> => {
    if (!isTabDirty(tab, getBlobMap(tab.id))) return Promise.resolve('discard')
    return new Promise((resolve) => {
      setDirtyPrompt({
        fileName: tab.node.name,
        writable: isFilesNodeWritable(tab.node),
        resolve,
      })
    })
  }, [getBlobMap])

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
        createExtension: PAGES_FILE_EXTENSION,
        createInitialBytes: packEmptyPagesPackage(),
        createMimeType: PAGES_MIME,
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
      disposeTabBlobs(tabId)
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
    [bypassWindowCloseGuard, closeWindow, disposeTabBlobs, windowId],
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
    const dirtyTabs = tabsRef.current.filter((tab) => isTabDirty(tab, getBlobMap(tab.id)))
    if (dirtyTabs.length === 0) return true

    void (async () => {
      for (const tab of dirtyTabs) {
        const latest = tabsRef.current.find((item) => item.id === tab.id)
        if (!latest || !isTabDirty(latest, getBlobMap(latest.id))) continue
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
    getBlobMap,
    saveTab,
    setWindowDocumentEdited,
    windowId,
  ])

  useWindowCloseGuard(windowId, requestClose)

  // 脏文档防抖自动保存
  useEffect(() => {
    clearAutosaveTimer()
    if (!ready || !activeTab || !writable || !dirty) return
    if (loading || dirtyPrompt || openDialogOpen) return
    const tabId = activeTab.id
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null
      if (dirtyPromptRef.current) return
      void saveTab(tabId, { quiet: true })
    }, AUTOSAVE_DELAY_MS)
    return () => clearAutosaveTimer()
  }, [
    activeTab,
    clearAutosaveTimer,
    dirty,
    dirtyPrompt,
    loading,
    openDialogOpen,
    ready,
    saveTab,
    writable,
  ])

  // 切换标签时取消挂起的自动保存
  useEffect(() => {
    clearAutosaveTimer()
    setSaveHint('idle')
  }, [activeTabId, clearAutosaveTimer])

  useEffect(() => {
    return () => {
      clearAutosaveTimer()
      if (saveHintTimerRef.current) clearTimeout(saveHintTimerRef.current)
    }
  }, [clearAutosaveTimer])

  const updateActiveDocument = useCallback(
    (nextDocument: JSONContent) => {
      const tabId = activeTabIdRef.current
      if (!tabId) return
      // 该标签首次回调：只对齐 saved* 基线；之后的编辑才记脏
      const absorbBaseline = lastBaselineTabIdRef.current !== tabId
      if (absorbBaseline) {
        lastBaselineTabIdRef.current = tabId
      }
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== tabId) return tab
          if (absorbBaseline) {
            if (tab.format === 'markdown') {
              return {
                ...tab,
                document: nextDocument,
                savedMarkdown: jsonContentToMarkdown(nextDocument),
              }
            }
            const blobMap = getBlobMap(tabId)
            return {
              ...tab,
              document: nextDocument,
              savedFingerprint: pagesFingerprint(nextDocument, tab.assets, blobMap),
            }
          }
          return { ...tab, document: nextDocument }
        }),
      )
    },
    [getBlobMap],
  )

  const registerImage = useCallback(
    async (file: File): Promise<string> => {
      const tabId = activeTabIdRef.current
      const tab = tabsRef.current.find((item) => item.id === tabId)
      if (!tabId || !tab) throw new Error('无活动标签')
      if (tab.format === 'markdown') {
        await modal.alert({
          title: '无法插入本地图片',
          message:
            'Markdown 文件无法持久化本地图片。请改用「新建 / 打开」创建 .pages 文稿后再插入；也可在文稿中「导出 Markdown」。',
          themeColor: THEME,
        })
        throw new Error('markdown-no-local-image')
      }
      const asset = await createPagesAssetFromFile(file)
      const blob = new Blob([asset.bytes.slice()], { type: asset.mimeType })
      const blobUrl = URL.createObjectURL(blob)
      const map = getBlobMap(tabId)
      map.set(asset.fileName, blobUrl)
      setTabs((prev) =>
        prev.map((item) =>
          item.id === tabId ? { ...item, assets: mergeAsset(item.assets, asset) } : item,
        ),
      )
      return blobUrl
    },
    [getBlobMap, modal],
  )

  const handlePromptLink = useCallback(async (): Promise<string | undefined> => {
    const editor = editorRef.current
    const previous =
      editor && !editor.isDestroyed
        ? (editor.getAttributes('link').href as string | undefined)
        : undefined
    return modal.prompt({
      title: '编辑链接',
      label: '地址',
      initialValue: previous ?? 'https://',
      placeholder: 'https://',
      themeColor: THEME,
      confirmLabel: '确定',
    })
  }, [modal])

  const setActiveViewMode = useCallback((mode: PagesViewMode) => {
    const tabId = activeTabIdRef.current
    if (!tabId) return
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              viewMode: mode,
              sheetTableId: mode === 'sheet' ? tab.sheetTableId : null,
            }
          : tab,
      ),
    )
  }, [])

  const enterSheetView = useCallback((tableId: string) => {
    const tabId = activeTabIdRef.current
    if (!tabId) return
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === tabId ? { ...tab, viewMode: 'sheet', sheetTableId: tableId } : tab,
      ),
    )
  }, [])

  const toggleOutline = useCallback(() => {
    const tabId = activeTabIdRef.current
    if (!tabId) return
    setTabs((prev) =>
      prev.map((tab) => (tab.id === tabId ? { ...tab, outlineOpen: !tab.outlineOpen } : tab)),
    )
  }, [])

  const exportMarkdown = useCallback(async () => {
    const tabId = activeTabIdRef.current
    const tab = tabsRef.current.find((item) => item.id === tabId)
    if (!tab || tab.format !== 'pages') return
    const blobMap = getBlobMap(tab.id)
    const normalized = rewriteDocumentSrcToAssetPaths(tab.document, blobMap, tab.assets)
    const markdown = jsonContentToMarkdown(normalized)
    const mdName = tab.node.name.replace(/\.pages$/i, '.md')
    const mdPath = tab.path.replace(/\.pages$/i, '.md')
    const confirmed = await modal.confirm({
      title: '导出 Markdown',
      message: `将在同目录写入「${mdName}」（已存在则覆盖）。`,
      confirmLabel: '导出',
      themeColor: THEME,
    })
    if (!confirmed) return
    setLoading(true)
    try {
      try {
        await writeTextFile(mdPath, markdown)
      } catch {
        await createTextFile({
          locationId: tab.node.locationId,
          parentId: tab.node.parentId,
          name: mdName,
          text: markdown,
        })
      }
      await modal.alert({
        title: '已导出',
        message: `已写入「${mdName}」`,
        themeColor: THEME,
      })
    } catch (err) {
      await modal.alert({
        title: '导出失败',
        message: formatError(err),
        themeColor: THEME,
      })
    } finally {
      setLoading(false)
    }
  }, [getBlobMap, modal])

  const runEditorCommand = useCallback((action: (editor: Editor) => void) => {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed) return
    action(editor)
  }, [])

  const menuBar = useMemo((): MenuDefinition[] => {
    const formatDisabled = !ready || !writable || loading || activeTab?.viewMode !== 'edit'
    return [
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
          { type: 'separator' },
          {
            type: 'action',
            label: '查找…',
            shortcut: '⌘F',
            disabled: !ready || loading || activeTab?.viewMode === 'sheet',
            onClick: () => setFindOpenSignal((value) => value + 1),
          },
          {
            type: 'action',
            label: '查找和替换…',
            shortcut: '⌥⌘F',
            disabled: !ready || loading || !writable || activeTab?.viewMode === 'sheet',
            onClick: () => setFindReplaceSignal((value) => value + 1),
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
          { type: 'separator' },
          {
            type: 'action',
            label: activeTab?.outlineOpen ? '隐藏大纲' : '显示大纲',
            disabled: !ready || loading,
            onClick: () => toggleOutline(),
          },
          {
            type: 'action',
            label: '导出 Markdown…',
            disabled: !ready || loading || activeTab?.format !== 'pages',
            onClick: () => void exportMarkdown(),
          },
        ],
      },
    ]
  }, [
    activeTab?.format,
    activeTab?.outlineOpen,
    activeTab?.viewMode,
    dirty,
    dirtyPrompt,
    exportMarkdown,
    handleCloseTab,
    handleOpen,
    handleSave,
    loading,
    openDialogOpen,
    ready,
    runEditorCommand,
    setActiveViewMode,
    tabs.length,
    toggleOutline,
    writable,
  ])

  useAppMenuBar(APP_ID, menuBar, isActiveWindow)

  // 菜单 shortcut 仅展示；文件快捷键需自行监听（与 VS Code / Virtual JS 一致）
  useEffect(() => {
    if (!isActiveWindow) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (openDialogOpen || dirtyPrompt || loading || !ready) return

      const key = event.key.toLowerCase()
      if (key === 's' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        const tab = tabsRef.current.find((item) => item.id === activeTabIdRef.current)
        if (!tab || !isFilesNodeWritable(tab.node)) return
        if (!isTabDirty(tab, getBlobMap(tab.id))) return
        void handleSave()
        return
      }
      if (key === 'o' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        void handleOpen()
        return
      }
      if (key === 'w' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        handleCloseTab()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    dirtyPrompt,
    getBlobMap,
    handleCloseTab,
    handleOpen,
    handleSave,
    isActiveWindow,
    loading,
    openDialogOpen,
    ready,
  ])

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
        dirty: isTabDirty(tab, getBlobMap(tab.id)),
      })),
    [getBlobMap, tabs],
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
        initialDocument={editorDocument}
        format={activeTab.format}
        editable={writable}
        viewMode={activeTab.viewMode}
        sheetTableId={activeTab.sheetTableId}
        outlineOpen={activeTab.outlineOpen}
        onDocumentChange={updateActiveDocument}
        onViewModeChange={setActiveViewMode}
        onEnterSheet={enterSheetView}
        registerImage={registerImage}
        onPromptLink={handlePromptLink}
        findOpenSignal={findOpenSignal}
        findReplaceSignal={findReplaceSignal}
        onEditorReady={(editor) => {
          editorRef.current = editor
        }}
      />

      {saveHint !== 'idle' ? (
        <div class="pages__save-hint" aria-live="polite">
          {saveHint === 'saving' ? '自动保存中…' : '已自动保存'}
        </div>
      ) : null}

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
