import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ComponentType } from 'preact'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { getAppDefinition } from '../../os/app-registry.tsx'
import {
  getDefaultFileOpenApp,
  listRegisteredFileOpenApps,
  setPreferredFileOpenApp,
} from '../../os/file-open-registry.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import type { BuiltinAppId } from '../../os/types.ts'
import {
  AdaptiveActionMenu,
  type AdaptiveActionMenuItem,
} from '../../ui/adaptive-action-menu.tsx'
import { IosCheckToggle } from '../../ui/ios-check-toggle.tsx'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { useAppNarrowLayout } from '../../ui/use-app-narrow-layout.ts'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { WindowModal } from '../../window/window-modal.tsx'
import { getFilesClipboard, setFilesClipboard } from './files-clipboard.ts'
import { FilesStorageFullError } from './files-storage.ts'
import {
  FILES_MOUNTS_CHANGED_EVENT,
  addMount,
  canMountDirectories,
  pickDirectoryToMount,
  removeMount,
} from './files-mount-store.ts'
import {
  subscribeFilesRevealRequests,
  takeFilesRevealRequest,
} from './files-reveal-request.ts'
import {
  isFilesLocationWritable,
  isFilesNodeWritable,
  isMountLocationId,
  type FilesLocation,
  type FilesLocationId,
  type FilesNode,
  type MountFilesLocationId,
} from './files-types.ts'
import {
  FILES_VFS_CHANGED_EVENT,
  copyNodeTo,
  createTextFile,
  enrichFilesNodeMeta,
  filesNodeNeedsViewportMeta,
  getFilesLocationLabel,
  getNodeOrThrow,
  listDirectory,
  listFilesLocations,
  mkdir,
  removeNode,
  renameNode,
  resolveFilesAbsolutePath,
  resolveNodeByAbsolutePath,
  resolvePathNodes,
} from './files-vfs.ts'
import {
  filesLocationPathRoot,
  formatFilesByteSize,
  formatFilesTimestamp,
  joinFilesAbsolutePath,
  parseFilesAbsolutePath,
} from './files-path.ts'
import { FilesPathBar, type FilesPathBarSegment } from './files-path-bar.tsx'
import { FilesFolderTemplateIcon, FilesNodeIcon, FilesTxtTemplateIcon } from './files-node-icon.tsx'
import '../../ui/ios-check-toggle.css'
import '../../ui/ios-nav-back.css'
import './files.css'

const APP_ID = 'files' as const
const THEME = '#8a6a38'
const LONG_PRESS_MS = 380
const LONG_PRESS_MOVE_PX = 8
const VIEW_MODE_STORAGE_KEY = 'files.viewMode'
const VIEWPORT_META_DEBOUNCE_MS = 100
const VIEWPORT_META_CONCURRENCY = 8
const VIEWPORT_META_ROOT_MARGIN = '96px'

type FilesViewMode = 'grid' | 'list'

function readFilesViewMode(): FilesViewMode {
  try {
    const raw = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    if (raw === 'list' || raw === 'grid') return raw
  } catch {
    // ignore
  }
  return 'grid'
}

function writeFilesViewMode(mode: FilesViewMode): void {
  try {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode)
  } catch {
    // ignore
  }
}

function formatListByteSize(node: FilesNode, metaResolved: ReadonlySet<string>): string {
  if (node.kind === 'folder' || node.locationId === 'models3d') return '—'
  if (filesNodeNeedsViewportMeta(node) && !metaResolved.has(node.id)) return '…'
  return formatFilesByteSize(node.byteSize)
}

function formatListTimestamp(node: FilesNode, metaResolved: ReadonlySet<string>): string {
  if (filesNodeNeedsViewportMeta(node) && !metaResolved.has(node.id)) return '…'
  return formatFilesTimestamp(node.updatedAt)
}

async function mapIdsWithConcurrency(
  ids: readonly string[],
  concurrency: number,
  worker: (id: string) => Promise<void>,
): Promise<void> {
  if (ids.length === 0) return
  let nextIndex = 0
  const runners = Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= ids.length) return
      await worker(ids[index]!)
    }
  })
  await Promise.all(runners)
}

function FilesViewModeIcon({ mode }: { mode: FilesViewMode }) {
  if (mode === 'list') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2" y="2.5" width="3" height="3" rx="0.5" fill="currentColor" />
        <rect x="7" y="3.25" width="7" height="1.5" rx="0.5" fill="currentColor" />
        <rect x="2" y="6.5" width="3" height="3" rx="0.5" fill="currentColor" />
        <rect x="7" y="7.25" width="7" height="1.5" rx="0.5" fill="currentColor" />
        <rect x="2" y="10.5" width="3" height="3" rx="0.5" fill="currentColor" />
        <rect x="7" y="11.25" width="7" height="1.5" rx="0.5" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="2" width="5" height="5" rx="0.75" fill="currentColor" />
      <rect x="9" y="2" width="5" height="5" rx="0.75" fill="currentColor" />
      <rect x="2" y="9" width="5" height="5" rx="0.75" fill="currentColor" />
      <rect x="9" y="9" width="5" height="5" rx="0.75" fill="currentColor" />
    </svg>
  )
}

type ContextMenuState = {
  x: number
  y: number
  node: FilesNode
}

type BackgroundContextMenuState = {
  x: number
  y: number
}

type LocationContextMenuState = {
  x: number
  y: number
  locationId: MountFilesLocationId
  label: string
}

type ActionSheetState =
  | { kind: 'item'; node: FilesNode }
  | { kind: 'background' }

type NewFileMenuState = {
  x: number
  y: number
  /** 箭头相对弹层左缘的水平偏移，对准新建按钮中心 */
  arrowX: number
}

function formatError(error: unknown): string {
  if (error instanceof FilesStorageFullError) return error.message
  if (error instanceof Error && error.message) return error.message
  return '操作失败'
}

function toTextFileName(baseName: string): string {
  const trimmed = baseName.trim().replace(/\.txt$/i, '')
  if (!trimmed) return '未命名.txt'
  return `${trimmed}.txt`
}

function DeviceGlyph() {
  return (
    <svg class="files__location-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2.5" y="5" width="19" height="14" rx="2.2" fill="#c9a66a" stroke="#8a6a38" stroke-width="1" />
      <rect x="3.2" y="5.7" width="17.6" height="3.6" rx="1.1" fill="#f0d9a8" opacity="0.78" />
      <circle cx="12" cy="13.4" r="5.4" fill="#2a241c" opacity="0.9" />
      <circle cx="12" cy="13.4" r="4.3" fill="none" stroke="#e8c56a" stroke-width="1.2" opacity="0.75" />
      <circle cx="12" cy="13.4" r="2.8" fill="none" stroke="#8a6a38" stroke-width="0.9" opacity="0.55" />
      <circle cx="12" cy="13.4" r="1.6" fill="#c9a66a" />
      <circle cx="12" cy="13.4" r="0.7" fill="#5a4328" />
      <circle cx="18.5" cy="7.5" r="0.9" fill="#c9a046" />
      <rect x="4.2" y="16.8" width="3.2" height="1.1" rx="0.4" fill="#8a6a38" opacity="0.55" />
    </svg>
  )
}

function ModelsGlyph() {
  return (
    <svg class="files__location-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#f0d9a8" stroke="#8a6a38" stroke-width="1" d="M12 3.2 L20 7.5 L20 16.2 L12 20.5 L4 16.2 L4 7.5 Z" />
      <path fill="#c9a66a" opacity="0.65" d="M12 3.2 L20 7.5 L12 11.8 L4 7.5 Z" />
      <path stroke="#5a4328" stroke-width="1" fill="none" d="M12 11.8 V20.5 M4 7.5 L12 11.8 L20 7.5" />
    </svg>
  )
}

function SourceGlyph() {
  return (
    <svg class="files__location-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5.5" y="3.5" width="13" height="16.5" rx="1.6" fill="#e6d4b0" stroke="#8a6a38" stroke-width="1" />
      <rect x="4" y="5" width="13" height="16.5" rx="1.6" fill="#f0d9a8" stroke="#8a6a38" stroke-width="1" />
      <path stroke="#5a4328" stroke-width="1.3" stroke-linecap="round" d="M7 9.5h7M7 13h7M7 16.5h4.5" />
      <rect x="14.2" y="7.2" width="5.2" height="5.2" rx="1" fill="#a67c42" opacity="0.9" />
      <path fill="#f0d9a8" d="M15.2 9.8h3.2v0.9h-3.2zM15.2 11.2h2.2v0.8h-2.2z" />
    </svg>
  )
}

function MountGlyph() {
  return (
    <svg class="files__location-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="6" width="18" height="13" rx="2" fill="#c9a66a" stroke="#8a6a38" stroke-width="1" />
      <path
        fill="#f0d9a8"
        d="M5 9.2h14v7.6c0 .9-.7 1.6-1.6 1.6H6.6c-.9 0-1.6-.7-1.6-1.6V9.2z"
        opacity="0.85"
      />
      <path
        fill="none"
        stroke="#5a4328"
        stroke-width="1.2"
        stroke-linecap="round"
        d="M8 4.5v3M12 3.5v4M16 4.5v3"
      />
      <circle cx="12" cy="13.2" r="2.2" fill="#5a4328" opacity="0.7" />
    </svg>
  )
}

function LocationGlyph({ id }: { id: FilesLocationId }) {
  if (isMountLocationId(id)) return <MountGlyph />
  if (id === 'models3d') return <ModelsGlyph />
  if (id === 'source') return <SourceGlyph />
  return <DeviceGlyph />
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function FilesApp({ windowId }: { windowId?: string }) {
  const { closeWindowsForApp, minimizeWindow, windows, openApp } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const modal = useWindowModal()
  const { hostRef, narrowLayout, layoutReady } = useAppNarrowLayout()

  const appWindow = windowId
    ? windows.find((window) => window.id === windowId && !window.closing)
    : undefined
  const pendingDocumentId = appWindow?.documentId

  const [locationId, setLocationId] = useState<FilesLocationId>('local')
  const [locations, setLocations] = useState<readonly FilesLocation[]>([])
  const [folderId, setFolderId] = useState<string | undefined>(undefined)
  const [pathNodes, setPathNodes] = useState<FilesNode[]>([])
  const [items, setItems] = useState<FilesNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | undefined>(undefined)
  const [backgroundContextMenu, setBackgroundContextMenu] = useState<
    BackgroundContextMenuState | undefined
  >(undefined)
  const [locationContextMenu, setLocationContextMenu] = useState<
    LocationContextMenuState | undefined
  >(undefined)
  const [actionSheet, setActionSheet] = useState<ActionSheetState | undefined>(undefined)
  const [newFileMenu, setNewFileMenu] = useState<NewFileMenuState | undefined>(undefined)
  const [clipboardRevision, setClipboardRevision] = useState(0)
  const [stackedBrowserOpen, setStackedBrowserOpen] = useState(false)
  const [folderMotion, setFolderMotion] = useState<'idle' | 'push' | 'pop'>('idle')
  const [openWithNode, setOpenWithNode] = useState<FilesNode | undefined>(undefined)
  const [openWithAlways, setOpenWithAlways] = useState(false)
  const [infoNode, setInfoNode] = useState<FilesNode | undefined>(undefined)
  const [infoPath, setInfoPath] = useState<string | undefined>(undefined)
  const [viewMode, setViewMode] = useState<FilesViewMode>(() => readFilesViewMode())
  const [metaResolvedIds, setMetaResolvedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [selectNonce, setSelectNonce] = useState(0)
  const [pendingSelectName, setPendingSelectName] = useState<string | undefined>(undefined)
  const newFileButtonRef = useRef<HTMLButtonElement>(null)
  const browserRef = useRef<HTMLDivElement>(null)
  const prevNarrowLayoutRef = useRef<boolean | undefined>(undefined)
  const suppressItemClickRef = useRef(false)
  const longPressTimerRef = useRef<number | undefined>(undefined)
  const longPressStartRef = useRef<{ x: number; y: number; node?: FilesNode } | undefined>(
    undefined,
  )
  const lastPointerTypeRef = useRef<string>('mouse')
  const actionSheetOpenedByLongPressRef = useRef(false)
  const refreshGenRef = useRef(0)
  const viewportMetaGenRef = useRef(0)
  const viewportMetaPendingRef = useRef(new Set<string>())
  const viewportMetaInFlightRef = useRef(new Set<string>())
  const viewportMetaResolvedRef = useRef(new Set<string>())
  const viewportMetaDebounceRef = useRef<number | undefined>(undefined)
  const itemsRef = useRef<FilesNode[]>([])
  itemsRef.current = items
  const lastOpenedDocumentIdRef = useRef<string | undefined>(undefined)
  const lastRevealNonceRef = useRef(0)
  const narrowLayoutRef = useRef(narrowLayout)
  narrowLayoutRef.current = narrowLayout
  /** 窄屏首次滑入内容层时，等布局 transition 后再滚入选中项 */
  const pendingRevealLayoutRef = useRef(false)

  const clearSelection = useCallback(() => {
    setSelectedId(undefined)
    setPendingSelectName(undefined)
  }, [])

  const activateSelection = useCallback((nodeId: string) => {
    setPendingSelectName(undefined)
    setSelectedId(nodeId)
    setSelectNonce((value) => value + 1)
  }, [])

  const scrollSelectedIntoView = useCallback((nodeId: string) => {
    const root = browserRef.current
    if (!root) return
    const item = root.querySelector<HTMLElement>(
      `[data-files-node-id="${CSS.escape(nodeId)}"]`,
    )
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    item?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: reduceMotion ? 'auto' : 'smooth',
    })
  }, [])

  const locationLabel = getFilesLocationLabel(locationId)
  const locationWritable = isFilesLocationWritable(locationId)
  const currentFolder = pathNodes.length > 0 ? pathNodes[pathNodes.length - 1] : undefined
  const canCreateHere =
    locationWritable && (currentFolder === undefined || isFilesNodeWritable(currentFolder))
  const currentTitle = pathNodes.length > 0 ? pathNodes[pathNodes.length - 1].name : locationLabel
  const canGoBackInPath = pathNodes.length > 0
  const showToolbarBack = canGoBackInPath || (narrowLayout && stackedBrowserOpen)
  const clipboard = getFilesClipboard()
  const canPasteHere = canCreateHere && clipboard !== undefined
  void clipboardRevision

  const resetViewportMeta = useCallback(() => {
    viewportMetaGenRef.current += 1
    viewportMetaPendingRef.current.clear()
    viewportMetaInFlightRef.current.clear()
    viewportMetaResolvedRef.current.clear()
    if (viewportMetaDebounceRef.current !== undefined) {
      window.clearTimeout(viewportMetaDebounceRef.current)
      viewportMetaDebounceRef.current = undefined
    }
    setMetaResolvedIds(new Set())
  }, [])

  const flushViewportMetaQueue = useCallback(async () => {
    const gen = viewportMetaGenRef.current
    const ids = [...viewportMetaPendingRef.current]
    viewportMetaPendingRef.current.clear()
    if (ids.length === 0) return

    await mapIdsWithConcurrency(ids, VIEWPORT_META_CONCURRENCY, async (id) => {
      if (gen !== viewportMetaGenRef.current) return
      if (viewportMetaResolvedRef.current.has(id) || viewportMetaInFlightRef.current.has(id)) {
        return
      }
      viewportMetaInFlightRef.current.add(id)
      try {
        const enriched = await enrichFilesNodeMeta(id)
        if (gen !== viewportMetaGenRef.current) return
        if (enriched) {
          setItems((prev) =>
            prev.map((node) =>
              node.id === enriched.id
                ? {
                    ...node,
                    byteSize: enriched.byteSize,
                    updatedAt: enriched.updatedAt,
                    createdAt: enriched.createdAt,
                  }
                : node,
            ),
          )
        }
      } finally {
        viewportMetaInFlightRef.current.delete(id)
        if (gen === viewportMetaGenRef.current) {
          viewportMetaResolvedRef.current.add(id)
          setMetaResolvedIds((prev) => {
            if (prev.has(id)) return prev
            const next = new Set(prev)
            next.add(id)
            return next
          })
        }
      }
    })
  }, [])

  const scheduleViewportMetaFlush = useCallback(() => {
    if (viewportMetaDebounceRef.current !== undefined) {
      window.clearTimeout(viewportMetaDebounceRef.current)
    }
    viewportMetaDebounceRef.current = window.setTimeout(() => {
      viewportMetaDebounceRef.current = undefined
      void flushViewportMetaQueue()
    }, VIEWPORT_META_DEBOUNCE_MS)
  }, [flushViewportMetaQueue])

  const enqueueViewportMeta = useCallback(
    (nodeId: string) => {
      if (
        viewportMetaResolvedRef.current.has(nodeId) ||
        viewportMetaInFlightRef.current.has(nodeId) ||
        viewportMetaPendingRef.current.has(nodeId)
      ) {
        return
      }
      const node = itemsRef.current.find((item) => item.id === nodeId)
      if (!node || !filesNodeNeedsViewportMeta(node)) return
      viewportMetaPendingRef.current.add(nodeId)
      scheduleViewportMetaFlush()
    },
    [scheduleViewportMetaFlush],
  )

  const refresh = useCallback(async (options?: { quiet?: boolean }) => {
    const gen = ++refreshGenRef.current
    resetViewportMeta()
    if (!options?.quiet) setLoading(true)
    setError(undefined)
    try {
      const [listed, path] = await Promise.all([
        listDirectory(locationId, folderId),
        resolvePathNodes(locationId, folderId),
      ])
      if (gen !== refreshGenRef.current) return
      setItems(listed)
      setPathNodes(path)
    } catch (err) {
      if (gen !== refreshGenRef.current) return
      setError(formatError(err))
      setItems([])
      setPathNodes([])
    } finally {
      if (gen === refreshGenRef.current && !options?.quiet) setLoading(false)
    }
  }, [folderId, locationId, resetViewportMeta])

  const refreshLocations = useCallback(async () => {
    try {
      setLocations(await listFilesLocations())
    } catch {
      setLocations([])
    }
  }, [])

  useEffect(() => {
    void refreshLocations()
  }, [refreshLocations])

  useEffect(() => {
    if (locations.length === 0) return
    if (!locations.some((item) => item.id === locationId)) {
      setLocationId('local')
      setFolderId(undefined)
    }
  }, [locationId, locations])

  useEffect(() => {
    const onMountsChanged = () => {
      void refreshLocations()
    }
    window.addEventListener(FILES_MOUNTS_CHANGED_EVENT, onMountsChanged)
    return () => window.removeEventListener(FILES_MOUNTS_CHANGED_EVENT, onMountsChanged)
  }, [refreshLocations])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const itemIdsKey = useMemo(() => items.map((item) => item.id).join('\0'), [items])

  useEffect(() => {
    if (loading) return
    const root = browserRef.current
    if (!root) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const target = entry.target as HTMLElement
          const nodeId = target.dataset.filesNodeId
          if (!nodeId) continue
          enqueueViewportMeta(nodeId)
        }
      },
      { root, rootMargin: VIEWPORT_META_ROOT_MARGIN, threshold: 0 },
    )

    const nodes = root.querySelectorAll<HTMLElement>('[data-files-node-id]')
    for (const node of nodes) {
      observer.observe(node)
    }

    return () => observer.disconnect()
  }, [enqueueViewportMeta, itemIdsKey, loading, viewMode])

  const navigateToDocumentPath = useCallback(async (absolutePath: string) => {
    const applyBrowse = (nextLocationId: FilesLocationId, nextFolderId: string | undefined) => {
      // 递增 gen，丢弃仍在飞的旧 refresh，避免导航后被过期列表盖回
      refreshGenRef.current += 1
      setLocationId(nextLocationId)
      setFolderId(nextFolderId)
      setFolderMotion('push')
      if (narrowLayoutRef.current) {
        // 窄屏内容层有 slide transition；即使已是 browser-open，揭示时也可能仍在滑入中
        pendingRevealLayoutRef.current = true
        setStackedBrowserOpen(true)
      }
    }

    const armSelectByName = (name: string | undefined) => {
      setSelectedId(undefined)
      setPendingSelectName(name)
      if (name) setSelectNonce((value) => value + 1)
    }

    const tryNavigate = async (
      path: string,
      selectName?: string,
    ): Promise<boolean> => {
      const parsed = parseFilesAbsolutePath(path)
      if (!parsed) return false

      if (parsed.segments.length === 0) {
        applyBrowse(parsed.locationId, undefined)
        if (selectName) armSelectByName(selectName)
        else clearSelection()
        return true
      }

      const leafName = parsed.segments[parsed.segments.length - 1]

      try {
        const node = await resolveNodeByAbsolutePath(path)
        if (node) {
          if (selectName) {
            // 递归落到父目录：进入该目录并按文件名待选
            applyBrowse(node.locationId, node.kind === 'folder' ? node.id : node.parentId)
            armSelectByName(selectName)
            return true
          }
          if (node.kind === 'folder') {
            clearSelection()
            applyBrowse(node.locationId, node.id)
          } else {
            applyBrowse(node.locationId, node.parentId)
            activateSelection(node.id)
          }
          return true
        }
      } catch {
        // 挂载权限未就绪等：继续尝试父路径
      }

      if (parsed.segments.length <= 1) {
        applyBrowse(parsed.locationId, undefined)
        armSelectByName(selectName ?? leafName)
        return true
      }

      const parentPath = joinFilesAbsolutePath(
        filesLocationPathRoot(parsed.locationId),
        ...parsed.segments.slice(0, -1),
      )
      return tryNavigate(parentPath, selectName ?? leafName)
    }

    try {
      const ok = await tryNavigate(absolutePath)
      if (ok) {
        lastOpenedDocumentIdRef.current = absolutePath
      } else {
        lastOpenedDocumentIdRef.current = undefined
      }
    } catch {
      lastOpenedDocumentIdRef.current = undefined
    }
  }, [activateSelection, clearSelection])

  useEffect(() => {
    const drainReveal = () => {
      const request = takeFilesRevealRequest()
      if (!request) return
      if (request.nonce === lastRevealNonceRef.current) return
      lastRevealNonceRef.current = request.nonce
      lastOpenedDocumentIdRef.current = request.path
      void navigateToDocumentPath(request.path)
    }

    drainReveal()
    return subscribeFilesRevealRequests(drainReveal)
  }, [navigateToDocumentPath])

  useEffect(() => {
    if (!pendingDocumentId) return
    if (lastOpenedDocumentIdRef.current === pendingDocumentId) return
    lastOpenedDocumentIdRef.current = pendingDocumentId
    void navigateToDocumentPath(pendingDocumentId)
  }, [navigateToDocumentPath, pendingDocumentId])

  useEffect(() => {
    if (!pendingSelectName || loading) return
    const match = items.find((node) => node.name === pendingSelectName)
    if (!match) return
    setPendingSelectName(undefined)
    setSelectedId(match.id)
    setSelectNonce((value) => value + 1)
  }, [items, loading, pendingSelectName])

  // 等目录切换动画 / 窄屏滑入结束后再滚入，避免 transform 过程中 scrollIntoView 无效
  useEffect(() => {
    if (!selectedId || loading) return
    if (!items.some((node) => node.id === selectedId)) return

    let cancelled = false
    const timers: number[] = []
    const frames: number[] = []

    const queueScroll = (delayMs: number, clearLayoutWait = false) => {
      timers.push(
        window.setTimeout(() => {
          frames.push(
            window.requestAnimationFrame(() => {
              if (cancelled) return
              scrollSelectedIntoView(selectedId)
              if (clearLayoutWait) pendingRevealLayoutRef.current = false
            }),
          )
        }, delayMs),
      )
    }

    const waitingLayout = pendingRevealLayoutRef.current
    if (folderMotion === 'idle' && !waitingLayout) {
      queueScroll(0)
    } else if (folderMotion === 'idle' && waitingLayout) {
      // 与 --files-layout-duration（0.36s）对齐
      queueScroll(400, true)
    } else {
      // push/pop 约 0.28s；reduced-motion 时 animationend 可能不触发，用超时兜底
      queueScroll(300)
      if (waitingLayout) queueScroll(400, true)
    }

    return () => {
      cancelled = true
      for (const timer of timers) window.clearTimeout(timer)
      for (const frame of frames) window.cancelAnimationFrame(frame)
    }
  }, [folderMotion, items, loading, scrollSelectedIntoView, selectNonce, selectedId])

  // 选中高亮约 2.5s 后淡出清除
  useEffect(() => {
    if (!selectedId) return
    const timer = window.setTimeout(() => {
      setSelectedId((current) => (current === selectedId ? undefined : current))
    }, 2500)
    return () => window.clearTimeout(timer)
  }, [selectNonce, selectedId])

  useEffect(() => {
    let timer: number | undefined
    const onVfsChanged = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        void refresh({ quiet: true })
      }, 80)
    }
    window.addEventListener(FILES_VFS_CHANGED_EVENT, onVfsChanged)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener(FILES_VFS_CHANGED_EVENT, onVfsChanged)
    }
  }, [refresh])

  useEffect(() => {
    if (!isMountLocationId(locationId)) return
    const softRefresh = () => {
      void refresh({ quiet: true })
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') softRefresh()
    }
    window.addEventListener('focus', softRefresh)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', softRefresh)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [locationId, refresh])

  useEffect(() => {
    if (!layoutReady) return

    const previous = prevNarrowLayoutRef.current
    if (previous === undefined) {
      prevNarrowLayoutRef.current = narrowLayout
      return
    }

    prevNarrowLayoutRef.current = narrowLayout

    if (!previous && narrowLayout) {
      // 宽 → 窄：保持当前浏览内容，侧栏收起由 CSS 过渡
      // 若正从「在文件中显示」进入，标记等待滑入后再滚入选中项
      if (lastOpenedDocumentIdRef.current || selectedId) {
        pendingRevealLayoutRef.current = true
      }
      setStackedBrowserOpen(true)
      return
    }

    if (previous && !narrowLayout) {
      // 窄 → 宽：恢复并排，侧栏展开由 CSS 过渡
      setStackedBrowserOpen(false)
    }
  }, [layoutReady, narrowLayout, selectedId])

  useEffect(() => {
    if (!contextMenu && !locationContextMenu && !backgroundContextMenu) return
    const close = () => {
      setContextMenu(undefined)
      setLocationContextMenu(undefined)
      setBackgroundContextMenu(undefined)
    }
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [backgroundContextMenu, contextMenu, locationContextMenu])

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== undefined) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = undefined
    }
    longPressStartRef.current = undefined
  }, [])

  const closeTransientMenus = useCallback(() => {
    setContextMenu(undefined)
    setBackgroundContextMenu(undefined)
    setLocationContextMenu(undefined)
    setNewFileMenu(undefined)
    setActionSheet(undefined)
  }, [])

  const openItemActionSheet = useCallback((node: FilesNode) => {
    setContextMenu(undefined)
    setBackgroundContextMenu(undefined)
    setLocationContextMenu(undefined)
    setNewFileMenu(undefined)
    actionSheetOpenedByLongPressRef.current = true
    setActionSheet({ kind: 'item', node })
  }, [])

  const openBackgroundActionSheet = useCallback(() => {
    setContextMenu(undefined)
    setBackgroundContextMenu(undefined)
    setLocationContextMenu(undefined)
    setNewFileMenu(undefined)
    actionSheetOpenedByLongPressRef.current = true
    setActionSheet({ kind: 'background' })
  }, [])

  const isTouchLikePointer = useCallback(() => {
    const type = lastPointerTypeRef.current
    return type === 'touch' || type === 'pen'
  }, [])

  useEffect(() => {
    return () => clearLongPress()
  }, [clearLongPress])

  useEffect(() => {
    if (!newFileMenu) return
    const close = () => setNewFileMenu(undefined)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    const timer = window.setTimeout(() => {
      window.addEventListener('click', close)
      window.addEventListener('scroll', close, true)
      window.addEventListener('keydown', onKeyDown)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [newFileMenu])

  const selectLocation = useCallback(
    (next: FilesLocationId) => {
      closeTransientMenus()
      clearSelection()
      setLocationId(next)
      setFolderId(undefined)
      if (narrowLayout) {
        if (stackedBrowserOpen) {
          setFolderMotion('push')
        }
        setStackedBrowserOpen(true)
        return
      }
      setFolderMotion('push')
    },
    [clearSelection, closeTransientMenus, narrowLayout, stackedBrowserOpen],
  )

  const handleMount = useCallback(async () => {
    closeTransientMenus()

    if (!canMountDirectories()) {
      await modal.alert({
        title: '无法挂载',
        message:
          '当前浏览器不支持挂载本机文件夹。请使用支持 File System Access API 的浏览器（如 Chrome、Edge）。',
        themeColor: THEME,
      })
      return
    }

    const ok = await modal.confirm({
      title: '挂载本机文件夹',
      message:
        '挂载后可在本系统中浏览并读写该文件夹里的真实文件，具备文件能力的应用也可访问。改动会直接落在电脑磁盘上，请勿挂载含重要或敏感数据的目录；卸载不会撤销已发生的修改。',
      confirmLabel: '继续',
      cancelLabel: '取消',
      themeColor: THEME,
    })
    if (!ok) return

    try {
      const handle = await pickDirectoryToMount()
      const mount = await addMount(handle)
      await refreshLocations()
      selectLocation(mount.id)
    } catch (err) {
      if (isAbortError(err)) return
      await modal.alert({ title: '无法挂载', message: formatError(err), themeColor: THEME })
    }
  }, [closeTransientMenus, modal, refreshLocations, selectLocation])

  const handleUnmount = useCallback(
    async (mountId: MountFilesLocationId, label: string) => {
      setLocationContextMenu(undefined)
      setActionSheet(undefined)
      const ok = await modal.confirm({
        title: '卸载文件夹？',
        message: `「${label}」将从侧栏移除，不会删除磁盘上的文件。`,
        confirmLabel: '卸载',
        cancelLabel: '取消',
        themeColor: THEME,
      })
      if (!ok) return
      try {
        await removeMount(mountId)
        if (locationId === mountId) {
          setLocationId('local')
          setFolderId(undefined)
        }
        await refreshLocations()
      } catch (err) {
        await modal.alert({ title: '无法卸载', message: formatError(err), themeColor: THEME })
      }
    },
    [locationId, modal, refreshLocations],
  )

  const enterFolder = useCallback(
    (node: FilesNode) => {
      if (node.kind !== 'folder') return
      closeTransientMenus()
      clearSelection()
      setFolderMotion('push')
      setFolderId(node.id)
    },
    [clearSelection, closeTransientMenus],
  )

  const goBackInPath = useCallback(() => {
    if (pathNodes.length === 0) return
    setNewFileMenu(undefined)
    clearSelection()
    setFolderMotion('pop')
    const parent = pathNodes[pathNodes.length - 1]?.parentId
    setFolderId(parent)
  }, [clearSelection, pathNodes])

  const navigatePathBar = useCallback(
    (nextFolderId: string | undefined) => {
      closeTransientMenus()
      if (nextFolderId === folderId) return
      clearSelection()
      const currentDepth = pathNodes.length
      const targetDepth =
        nextFolderId === undefined
          ? 0
          : pathNodes.findIndex((node) => node.id === nextFolderId) + 1
      setFolderMotion(targetDepth < currentDepth ? 'pop' : 'push')
      setFolderId(nextFolderId)
    },
    [clearSelection, closeTransientMenus, folderId, pathNodes],
  )

  const pathBarSegments = useMemo((): FilesPathBarSegment[] => {
    const root: FilesPathBarSegment = {
      key: `root:${locationId}`,
      label: locationLabel,
      folderId: undefined,
      current: pathNodes.length === 0,
    }
    const folders = pathNodes.map((node, index) => ({
      key: node.id,
      label: node.name,
      folderId: node.id,
      current: index === pathNodes.length - 1,
    }))
    return [root, ...folders]
  }, [locationId, locationLabel, pathNodes])

  const pathBarAbsolutePath = useMemo(() => {
    const root = filesLocationPathRoot(locationId)
    if (pathNodes.length === 0) return root
    return joinFilesAbsolutePath(root, ...pathNodes.map((node) => node.name))
  }, [locationId, pathNodes])

  const leaveBrowserStack = useCallback(() => {
    closeTransientMenus()
    setStackedBrowserOpen(false)
  }, [closeTransientMenus])

  const handleToolbarBack = useCallback(() => {
    if (canGoBackInPath) {
      goBackInPath()
      return
    }
    if (narrowLayout && stackedBrowserOpen) {
      leaveBrowserStack()
    }
  }, [canGoBackInPath, goBackInPath, leaveBrowserStack, narrowLayout, stackedBrowserOpen])

  const openFileWithApp = useCallback(
    (node: FilesNode, appId: BuiltinAppId, remember: boolean) => {
      if (remember) {
        setPreferredFileOpenApp(node.name, appId)
      }
      setOpenWithNode(undefined)
      setOpenWithAlways(false)
      void (async () => {
        try {
          const documentId = await resolveFilesAbsolutePath(node)
          openApp(appId, { documentId })
        } catch (err) {
          await modal.alert({ title: '无法打开', message: formatError(err), themeColor: THEME })
        }
      })()
    },
    [modal, openApp],
  )

  const showOpenWithChooser = useCallback(
    async (node: FilesNode) => {
      if (node.kind !== 'file') return
      closeTransientMenus()
      const candidates = listRegisteredFileOpenApps()
      if (candidates.length === 0) {
        await modal.alert({
          title: '无法打开',
          message: '系统中还没有可用来打开文件的程序。',
          themeColor: THEME,
        })
        return
      }
      setOpenWithNode(node)
      setOpenWithAlways(false)
    },
    [closeTransientMenus, modal],
  )

  const openFile = useCallback(
    async (node: FilesNode) => {
      if (node.kind !== 'file') return
      closeTransientMenus()
      const appId = getDefaultFileOpenApp(node.name)
      if (appId) {
        try {
          const documentId = await resolveFilesAbsolutePath(node)
          openApp(appId, { documentId })
        } catch (err) {
          await modal.alert({ title: '无法打开', message: formatError(err), themeColor: THEME })
        }
        return
      }

      const specify = await modal.confirm({
        title: '无法打开',
        message: '没有可以用于打开这个文件的程序。',
        confirmLabel: '手动指定',
        cancelLabel: '好',
        themeColor: THEME,
      })
      if (!specify) return
      await showOpenWithChooser(node)
    },
    [closeTransientMenus, modal, openApp, showOpenWithChooser],
  )

  const handleItemClick = useCallback(
    (node: FilesNode) => {
      if (suppressItemClickRef.current) {
        suppressItemClickRef.current = false
        return
      }
      closeTransientMenus()
      if (node.kind === 'folder') {
        enterFolder(node)
      } else {
        void openFile(node)
      }
    },
    [closeTransientMenus, enterFolder, openFile],
  )

  const handleCopy = useCallback((node: FilesNode) => {
    closeTransientMenus()
    setFilesClipboard({
      nodeId: node.id,
      name: node.name,
      kind: node.kind,
    })
    setClipboardRevision((value) => value + 1)
  }, [closeTransientMenus])

  const handlePaste = useCallback(async () => {
    const entry = getFilesClipboard()
    if (!entry || !canCreateHere) return
    closeTransientMenus()
    try {
      await copyNodeTo({
        sourceId: entry.nodeId,
        destLocationId: locationId,
        destParentId: folderId,
      })
      await refresh()
    } catch (err) {
      await modal.alert({ title: '无法粘贴', message: formatError(err), themeColor: THEME })
    }
  }, [canCreateHere, closeTransientMenus, folderId, locationId, modal, refresh])

  const handleNewFolder = useCallback(async () => {
    if (!canCreateHere) return
    closeTransientMenus()
    const name = await modal.prompt({
      title: '新建文件夹',
      label: '名称',
      placeholder: '新建文件夹',
      initialValue: '新建文件夹',
      requireValue: true,
      confirmLabel: '创建',
      themeColor: THEME,
    })
    if (name === undefined) return
    try {
      await mkdir({ locationId, parentId: folderId, name })
      await refresh()
    } catch (err) {
      await modal.alert({ title: '无法创建', message: formatError(err), themeColor: THEME })
    }
  }, [canCreateHere, closeTransientMenus, folderId, locationId, modal, refresh])

  const openNewFileMenu = useCallback(() => {
    if (!canCreateHere) return
    setContextMenu(undefined)
    setBackgroundContextMenu(undefined)
    setLocationContextMenu(undefined)
    setActionSheet(undefined)
    const button = newFileButtonRef.current
    if (!button) return
    if (newFileMenu) {
      setNewFileMenu(undefined)
      return
    }
    const rect = button.getBoundingClientRect()
    const popoverWidth = 176
    const x = Math.max(8, Math.min(rect.right - popoverWidth, window.innerWidth - popoverWidth - 8))
    const arrowX = Math.min(popoverWidth - 16, Math.max(16, rect.left + rect.width / 2 - x))
    setNewFileMenu({
      x,
      y: rect.bottom + 10,
      arrowX,
    })
  }, [canCreateHere, newFileMenu])

  const createTextFileNamed = useCallback(async () => {
    if (!canCreateHere) return
    closeTransientMenus()

    const baseName = await modal.prompt({
      title: '新建文本文件',
      label: '名称',
      placeholder: '未命名',
      initialValue: '未命名',
      suffix: '.txt',
      requireValue: true,
      confirmLabel: '创建',
      themeColor: THEME,
    })
    if (baseName === undefined) return

    try {
      await createTextFile({
        locationId,
        parentId: folderId,
        name: toTextFileName(baseName),
      })
      await refresh()
    } catch (err) {
      await modal.alert({ title: '无法创建', message: formatError(err), themeColor: THEME })
    }
  }, [canCreateHere, closeTransientMenus, folderId, locationId, modal, refresh])

  const handleRename = useCallback(
    async (node: FilesNode) => {
      if (!isFilesNodeWritable(node)) return
      closeTransientMenus()
      const name = await modal.prompt({
        title: '重新命名',
        label: '名称',
        initialValue: node.name,
        requireValue: true,
        confirmLabel: '完成',
        themeColor: THEME,
      })
      if (name === undefined || name.trim() === node.name) return
      try {
        await renameNode(node.id, name)
        await refresh()
      } catch (err) {
        await modal.alert({ title: '无法重命名', message: formatError(err), themeColor: THEME })
      }
    },
    [closeTransientMenus, modal, refresh],
  )

  const handleDelete = useCallback(
    async (node: FilesNode) => {
      if (!isFilesNodeWritable(node)) return
      closeTransientMenus()
      const ok = await modal.confirm({
        title: node.kind === 'folder' ? '删除文件夹？' : '删除文件？',
        message:
          node.kind === 'folder'
            ? `「${node.name}」及其包含的所有内容将被永久删除。`
            : `「${node.name}」将被永久删除。`,
        confirmLabel: '删除',
        cancelLabel: '取消',
        confirmTone: 'danger',
        themeColor: THEME,
      })
      if (!ok) return
      try {
        await removeNode(node.id)
        await refresh()
      } catch (err) {
        await modal.alert({ title: '无法删除', message: formatError(err), themeColor: THEME })
      }
    },
    [closeTransientMenus, modal, refresh],
  )

  const handleShowInfo = useCallback(
    async (node: FilesNode) => {
      closeTransientMenus()
      try {
        const fresh =
          node.id === ''
            ? node
            : await getNodeOrThrow(node.id).catch(() => node)
        const path = await resolveFilesAbsolutePath(fresh)
        setInfoNode(fresh)
        setInfoPath(path)
      } catch (err) {
        await modal.alert({ title: '无法显示信息', message: formatError(err), themeColor: THEME })
      }
    },
    [closeTransientMenus, modal],
  )

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => {
      const next: FilesViewMode = prev === 'grid' ? 'list' : 'grid'
      writeFilesViewMode(next)
      return next
    })
  }, [])

  const closeInfo = useCallback(() => {
    setInfoNode(undefined)
    setInfoPath(undefined)
  }, [])

  const handleShowCurrentFolderInfo = useCallback(async () => {
    closeTransientMenus()
    if (currentFolder) {
      await handleShowInfo(currentFolder)
      return
    }
    setInfoNode({
      id: '',
      locationId,
      parentId: undefined,
      name: currentTitle,
      kind: 'folder',
      mimeType: undefined,
      byteSize: 0,
      createdAt: 0,
      updatedAt: 0,
      attributes: { writable: locationWritable },
    })
    setInfoPath(pathBarAbsolutePath)
  }, [
    closeTransientMenus,
    currentFolder,
    currentTitle,
    handleShowInfo,
    locationId,
    locationWritable,
    pathBarAbsolutePath,
  ])

  const beginItemLongPress = useCallback(
    (event: PointerEvent, node: FilesNode) => {
      lastPointerTypeRef.current = event.pointerType
      if (event.button !== 0) return

      clearLongPress()
      actionSheetOpenedByLongPressRef.current = false
      longPressStartRef.current = { x: event.clientX, y: event.clientY, node }
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = undefined
        longPressStartRef.current = undefined
        suppressItemClickRef.current = true
        openItemActionSheet(node)
      }, LONG_PRESS_MS)
    },
    [clearLongPress, openItemActionSheet],
  )

  const beginBackgroundLongPress = useCallback(
    (event: PointerEvent) => {
      lastPointerTypeRef.current = event.pointerType
      if (event.button !== 0) return
      if ((event.target as HTMLElement | undefined)?.closest?.('.files__item, .files__list-item'))
        return

      clearLongPress()
      actionSheetOpenedByLongPressRef.current = false
      longPressStartRef.current = { x: event.clientX, y: event.clientY }
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = undefined
        longPressStartRef.current = undefined
        openBackgroundActionSheet()
      }, LONG_PRESS_MS)
    },
    [clearLongPress, openBackgroundActionSheet],
  )

  const handleLongPressMove = useCallback(
    (event: PointerEvent) => {
      const start = longPressStartRef.current
      if (!start || longPressTimerRef.current === undefined) return
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (dx * dx + dy * dy > LONG_PRESS_MOVE_PX * LONG_PRESS_MOVE_PX) {
        clearLongPress()
      }
    },
    [clearLongPress],
  )

  const buildItemMenuActions = useCallback(
    (node: FilesNode): AdaptiveActionMenuItem[] => {
      const items: AdaptiveActionMenuItem[] = []
      if (node.kind === 'file') {
        items.push({
          type: 'action',
          label: '打开方式…',
          onClick: () => void showOpenWithChooser(node),
        })
      }
      items.push({
        type: 'action',
        label: '复制',
        onClick: () => handleCopy(node),
      })
      if (canPasteHere) {
        items.push({
          type: 'action',
          label: '粘贴',
          onClick: () => void handlePaste(),
        })
      }
      if (isFilesNodeWritable(node)) {
        items.push({ type: 'separator' })
        items.push({
          type: 'action',
          label: '重新命名',
          onClick: () => void handleRename(node),
        })
        items.push({
          type: 'action',
          label: '删除',
          onClick: () => void handleDelete(node),
        })
      }
      items.push({ type: 'separator' })
      items.push({
        type: 'action',
        label: '显示信息',
        onClick: () => void handleShowInfo(node),
      })
      return items
    },
    [canPasteHere, handleCopy, handleDelete, handlePaste, handleRename, handleShowInfo, showOpenWithChooser],
  )

  const backgroundMenuItems = useMemo((): AdaptiveActionMenuItem[] => {
    const items: AdaptiveActionMenuItem[] = []
    if (canCreateHere) {
      items.push({
        type: 'action',
        label: '新建文件夹',
        onClick: () => void handleNewFolder(),
      })
    }
    items.push({
      type: 'action',
      label: '显示信息',
      onClick: () => void handleShowCurrentFolderInfo(),
    })
    if (canPasteHere) {
      items.push({
        type: 'action',
        label: '粘贴',
        onClick: () => void handlePaste(),
      })
    }
    return items
  }, [
    canCreateHere,
    canPasteHere,
    handleNewFolder,
    handlePaste,
    handleShowCurrentFolderInfo,
  ])

  const actionSheetItems = useMemo((): AdaptiveActionMenuItem[] => {
    if (!actionSheet) return []
    if (actionSheet.kind === 'item') return buildItemMenuActions(actionSheet.node)
    return backgroundMenuItems
  }, [actionSheet, backgroundMenuItems, buildItemMenuActions])

  const actionSheetTitle = useMemo(() => {
    if (!actionSheet) return '操作'
    if (actionSheet.kind === 'item') return actionSheet.node.name
    return currentTitle
  }, [actionSheet, currentTitle])

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === APP_ID && !window.minimized)
    const canMutate = canCreateHere
    const atContainerRoot = pathNodes.length === 0

    return [
      {
        label: '文件',
        items: [
          ...aboutAppMenuPrefix('关于文件', () => showBuiltinAbout(APP_ID)),
          {
            type: 'action',
            label: '隐藏文件',
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '新建文件夹',
            shortcut: '⇧⌘N',
            disabled: !canMutate,
            onClick: () => void handleNewFolder(),
          },
          {
            type: 'action',
            label: '新建文件',
            disabled: !canMutate,
            onClick: () => openNewFileMenu(),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '粘贴',
            shortcut: '⌘V',
            disabled: !canPasteHere,
            onClick: () => void handlePaste(),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出文件',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp(APP_ID),
          },
        ],
      },
      {
        label: '前往',
        items: [
          {
            type: 'action',
            label: '返回上级',
            disabled: !canGoBackInPath,
            onClick: goBackInPath,
          },
          {
            type: 'action',
            label: '容器根目录',
            disabled: atContainerRoot,
            onClick: () => navigatePathBar(undefined),
          },
          { type: 'separator' },
          ...locations.map((location) => ({
            type: 'action' as const,
            label: location.label,
            onClick: () => selectLocation(location.id),
          })),
        ],
      },
    ]
  }, [
    canCreateHere,
    canGoBackInPath,
    canPasteHere,
    closeWindowsForApp,
    goBackInPath,
    handleNewFolder,
    handlePaste,
    locations,
    minimizeWindow,
    navigatePathBar,
    openNewFileMenu,
    pathNodes.length,
    selectLocation,
    showBuiltinAbout,
    windows,
  ])

  useAppMenuBar(APP_ID, menuBar)

  const backLabel = canGoBackInPath
    ? pathNodes.length > 1
      ? pathNodes[pathNodes.length - 2].name
      : locationLabel
    : '容器'

  const openWithApps = useMemo(() => {
    return listRegisteredFileOpenApps().flatMap((appId) => {
      const definition = getAppDefinition(appId)
      if (!definition) return []
      return [{ appId, name: definition.name, Icon: definition.icon as ComponentType<{ size?: number }> }]
    })
  }, [openWithNode])

  return (
    <div
      ref={hostRef}
      class={[
        'files',
        narrowLayout ? 'files--narrow' : '',
        narrowLayout && stackedBrowserOpen ? 'files--browser-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <aside class="files__sidebar">
        <header class="files__sidebar-toolbar">
          <h1 class="files__sidebar-toolbar-title">容器</h1>
        </header>
        <div class="files__sidebar-section">
          <div class="files__sidebar-heading">容器</div>
          <ul class="files__sidebar-list">
            {locations.map((location) => {
              const active = location.id === locationId
              const mountId = isMountLocationId(location.id) ? location.id : undefined
              const itemClass = `files__sidebar-item${active ? ' files__sidebar-item--active' : ''}${mountId ? ' files__sidebar-item--mount' : ''}`
              const locationContent = (
                <>
                  <span class="files__sidebar-icon">
                    <LocationGlyph id={location.id} />
                  </span>
                  <span class="files__sidebar-label">{location.label}</span>
                </>
              )
              const handleLocationContextMenu = (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
                if (!mountId) return
                event.preventDefault()
                setContextMenu(undefined)
                setNewFileMenu(undefined)
                setLocationContextMenu({
                  x: event.clientX,
                  y: event.clientY,
                  locationId: mountId,
                  label: location.label,
                })
              }
              return (
                <li key={location.id}>
                  {mountId ? (
                    <div class={itemClass}>
                      <button
                        type="button"
                        class="files__sidebar-item-select"
                        onClick={() => selectLocation(location.id)}
                        onContextMenu={handleLocationContextMenu}
                      >
                        {locationContent}
                      </button>
                      <button
                        type="button"
                        class={`files__sidebar-unmount${active ? ' files__sidebar-unmount--active' : ''}`}
                        aria-label={`推出 ${location.label}`}
                        title="推出"
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleUnmount(mountId, location.label)
                        }}
                      >
                        <span aria-hidden="true">⏏</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      class={itemClass}
                      onClick={() => selectLocation(location.id)}
                      onContextMenu={handleLocationContextMenu}
                    >
                      {locationContent}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
        <div class="files__sidebar-footer">
          <button type="button" class="files__sidebar-mount" onClick={() => void handleMount()}>
            挂载
          </button>
        </div>
      </aside>

      <section class="files__main">
        <header class="files__toolbar">
          <div class="files__toolbar-left">
            {showToolbarBack ? (
              <IosNavBackButton label={backLabel} onClick={handleToolbarBack} />
            ) : (
              <span class="files__toolbar-spacer" />
            )}
          </div>
          <h1 class="files__toolbar-title">{currentTitle}</h1>
          <div class="files__toolbar-right">
            <button
              type="button"
              class="files__toolbar-btn files__toolbar-btn--icon"
              aria-label={viewMode === 'grid' ? '切换到列表视图' : '切换到图标视图'}
              title={viewMode === 'grid' ? '列表视图' : '图标视图'}
              onClick={toggleViewMode}
            >
              <FilesViewModeIcon mode={viewMode === 'grid' ? 'list' : 'grid'} />
            </button>
            {canCreateHere ? (
              <>
                <button
                  type="button"
                  class="files__toolbar-btn files__toolbar-btn--icon"
                  aria-label="新建文件夹"
                  title="新建文件夹"
                  onClick={() => void handleNewFolder()}
                >
                  <FilesFolderTemplateIcon size="list" />
                </button>
                <button
                  ref={newFileButtonRef}
                  type="button"
                  class="files__toolbar-btn files__toolbar-btn--primary files__toolbar-btn--icon"
                  aria-label="新建文件"
                  title="新建文件"
                  aria-haspopup="menu"
                  aria-expanded={!!newFileMenu}
                  onClick={(event) => {
                    event.stopPropagation()
                    openNewFileMenu()
                  }}
                >
                  <FilesTxtTemplateIcon size="list" />
                </button>
              </>
            ) : undefined}
          </div>
        </header>

        {!canCreateHere ? (
          <div class="files__protected-banner" role="status">
            此容器受保护不可修改
          </div>
        ) : isMountLocationId(locationId) ? (
          <div class="files__protected-banner files__protected-banner--mount" role="status">
            对此容器的修改会立刻同步到本机真实文件夹
          </div>
        ) : undefined}

        <div
          ref={browserRef}
          class={[
            'files__browser',
            folderMotion === 'push' ? 'files__browser--push' : '',
            folderMotion === 'pop' ? 'files__browser--pop' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onAnimationEnd={(event) => {
            if (event.currentTarget !== event.target) return
            setFolderMotion('idle')
          }}
          onPointerDown={beginBackgroundLongPress}
          onPointerMove={handleLongPressMove}
          onPointerUp={clearLongPress}
          onPointerCancel={clearLongPress}
          onContextMenu={(event) => {
            if ((event.target as HTMLElement | undefined)?.closest?.('.files__item, .files__list-item'))
              return
            event.preventDefault()
            clearLongPress()
            setNewFileMenu(undefined)
            setLocationContextMenu(undefined)
            setContextMenu(undefined)
            if (actionSheetOpenedByLongPressRef.current) {
              actionSheetOpenedByLongPressRef.current = false
              return
            }
            if (isTouchLikePointer()) {
              if (backgroundMenuItems.length > 0) openBackgroundActionSheet()
              return
            }
            setActionSheet(undefined)
            if (backgroundMenuItems.length === 0) return
            setBackgroundContextMenu({ x: event.clientX, y: event.clientY })
          }}
        >
          {error ? <div class="files__banner files__banner--error">{error}</div> : undefined}
          {loading ? (
            <div class="files__empty">正在加载…</div>
          ) : items.length === 0 ? (
            <div class="files__empty">
              <p class="files__empty-title">此文件夹为空</p>
              <p class="files__empty-text">
                {canCreateHere
                  ? '可新建文件夹，或新建文本文件。'
                  : '此位置为系统资源，仅供浏览。'}
              </p>
            </div>
          ) : (
            <ul class={viewMode === 'list' ? 'files__list' : 'files__grid'}>
              {items.map((node) => {
                const selected = node.id === selectedId
                const itemClass =
                  viewMode === 'list'
                    ? `files__list-item${selected ? ' files__list-item--selected' : ''}`
                    : `files__item${selected ? ' files__item--selected' : ''}`
                return (
                  <li key={node.id}>
                    <button
                      type="button"
                      class={itemClass}
                      data-files-node-id={node.id}
                      aria-selected={selected}
                      onClick={() => handleItemClick(node)}
                      onPointerDown={(event) => beginItemLongPress(event, node)}
                      onPointerMove={handleLongPressMove}
                      onPointerUp={clearLongPress}
                      onPointerCancel={clearLongPress}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        clearLongPress()
                        setNewFileMenu(undefined)
                        setLocationContextMenu(undefined)
                        setBackgroundContextMenu(undefined)
                        activateSelection(node.id)
                        if (actionSheetOpenedByLongPressRef.current) {
                          actionSheetOpenedByLongPressRef.current = false
                          suppressItemClickRef.current = true
                          return
                        }
                        if (isTouchLikePointer()) {
                          suppressItemClickRef.current = true
                          openItemActionSheet(node)
                          return
                        }
                        setActionSheet(undefined)
                        setContextMenu({
                          x: event.clientX,
                          y: event.clientY,
                          node,
                        })
                      }}
                    >
                      {viewMode === 'list' ? (
                        <>
                          <span class="files__list-icon">
                            <FilesNodeIcon node={node} size="list" />
                          </span>
                          <span class="files__list-main">
                            <span class="files__list-name">{node.name}</span>
                            <span class="files__list-date files__list-date--inline">
                              {formatListTimestamp(node, metaResolvedIds)}
                            </span>
                          </span>
                          <span class="files__list-size">
                            {formatListByteSize(node, metaResolvedIds)}
                          </span>
                          <span class="files__list-date files__list-date--col">
                            {formatListTimestamp(node, metaResolvedIds)}
                          </span>
                        </>
                      ) : (
                        <>
                          <span class="files__item-icon">
                            <FilesNodeIcon node={node} size="grid" />
                          </span>
                          <span class="files__item-name">{node.name}</span>
                        </>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <FilesPathBar
          segments={pathBarSegments}
          absolutePath={pathBarAbsolutePath}
          onNavigate={navigatePathBar}
        />
      </section>

      {contextMenu ? (
        <div
          class="files__context"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.node.kind === 'file' ? (
            <button
              type="button"
              class="files__context-item"
              onClick={() => void showOpenWithChooser(contextMenu.node)}
            >
              打开方式…
            </button>
          ) : undefined}
          <button
            type="button"
            class="files__context-item"
            onClick={() => handleCopy(contextMenu.node)}
          >
            复制
          </button>
          {canPasteHere ? (
            <button
              type="button"
              class="files__context-item"
              onClick={() => void handlePaste()}
            >
              粘贴
            </button>
          ) : undefined}
          {isFilesNodeWritable(contextMenu.node) ? (
            <>
              <button
                type="button"
                class="files__context-item"
                onClick={() => void handleRename(contextMenu.node)}
              >
                重新命名
              </button>
              <button
                type="button"
                class="files__context-item files__context-item--danger"
                onClick={() => void handleDelete(contextMenu.node)}
              >
                删除
              </button>
            </>
          ) : undefined}
          <button
            type="button"
            class="files__context-item"
            onClick={() => void handleShowInfo(contextMenu.node)}
          >
            显示信息
          </button>
        </div>
      ) : undefined}

      {backgroundContextMenu ? (
        <div
          class="files__context"
          style={{ left: `${backgroundContextMenu.x}px`, top: `${backgroundContextMenu.y}px` }}
          onClick={(event) => event.stopPropagation()}
        >
          {backgroundMenuItems.map((item, index) => {
            if (item.type === 'separator') return undefined
            return (
              <button
                key={`${item.label}-${index}`}
                type="button"
                class="files__context-item"
                disabled={item.disabled}
                onClick={() => {
                  item.onClick()
                  setBackgroundContextMenu(undefined)
                }}
              >
                {item.label}
              </button>
            )
          })}
        </div>
      ) : undefined}

      {locationContextMenu ? (
        <div
          class="files__context"
          style={{ left: `${locationContextMenu.x}px`, top: `${locationContextMenu.y}px` }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            class="files__context-item"
            onClick={() =>
              void handleUnmount(locationContextMenu.locationId, locationContextMenu.label)
            }
          >
            推出
          </button>
        </div>
      ) : undefined}

      <AdaptiveActionMenu
        open={actionSheet !== undefined && actionSheetItems.length > 0}
        title={actionSheetTitle}
        items={actionSheetItems}
        narrowLayout
        mount="portal"
        onClose={() => {
          actionSheetOpenedByLongPressRef.current = false
          setActionSheet(undefined)
        }}
      />

      {newFileMenu ? (
        <div
          class="files__popover"
          role="menu"
          style={{
            left: `${newFileMenu.x}px`,
            top: `${newFileMenu.y}px`,
            ['--files-popover-arrow-x' as string]: `${newFileMenu.arrowX}px`,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div class="files__popover-label">新建文件</div>
          <button
            type="button"
            class="files__popover-item"
            role="menuitem"
            onClick={() => void createTextFileNamed()}
          >
            <span class="files__popover-item-icon" aria-hidden="true">
              <FilesTxtTemplateIcon size="list" />
            </span>
            <span class="files__popover-item-copy">
              <span class="files__popover-item-title">文本文件</span>
              <span class="files__popover-item-meta">.txt</span>
            </span>
          </button>
        </div>
      ) : undefined}

      <WindowModal
        open={!!openWithNode}
        title="打开方式"
        themeColor={THEME}
        onClose={() => {
          setOpenWithNode(undefined)
          setOpenWithAlways(false)
        }}
        actions={[
          {
            key: 'cancel',
            label: '取消',
            tone: 'secondary',
            onClick: () => {
              setOpenWithNode(undefined)
              setOpenWithAlways(false)
            },
          },
        ]}
      >
        {openWithNode ? (
          <div class="files__open-with">
            <p class="files__open-with-message">
              选择用于打开「{openWithNode.name}」的程序：
            </p>
            <ul class="files__open-with-list">
              {openWithApps.map(({ appId, name, Icon }) => (
                <li key={appId}>
                  <button
                    type="button"
                    class="files__open-with-item"
                    onClick={() => openFileWithApp(openWithNode, appId, openWithAlways)}
                  >
                    <span class="files__open-with-icon" aria-hidden="true">
                      <Icon size={36} />
                    </span>
                    <span class="files__open-with-name">{name}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div
              class="files__open-with-always"
              onClick={() => setOpenWithAlways((value) => !value)}
            >
              <IosCheckToggle
                checked={openWithAlways}
                label="始终使用此程序打开此类文件"
                onChange={setOpenWithAlways}
              />
              <span class="files__open-with-always-text">始终使用此程序打开此类文件</span>
            </div>
          </div>
        ) : undefined}
      </WindowModal>

      <WindowModal
        open={!!infoNode}
        title="信息"
        themeColor={THEME}
        wide
        onClose={closeInfo}
        actions={[
          {
            key: 'ok',
            label: '完成',
            tone: 'primary',
            onClick: () => {
              closeInfo()
            },
          },
        ]}
      >
        {infoNode ? (
          <dl class="files__info">
            <div class="files__info-row">
              <dt>名称</dt>
              <dd>{infoNode.name}</dd>
            </div>
            <div class="files__info-row">
              <dt>种类</dt>
              <dd>{infoNode.kind === 'folder' ? '文件夹' : '文件'}</dd>
            </div>
            <div class="files__info-row">
              <dt>位置</dt>
              <dd>{getFilesLocationLabel(infoNode.locationId)}</dd>
            </div>
            <div class="files__info-row files__info-row--path">
              <dt>路径</dt>
              <dd>
                <code class="files__info-path">{infoPath ?? '…'}</code>
              </dd>
            </div>
            {infoNode.kind === 'file' ? (
              <div class="files__info-row">
                <dt>大小</dt>
                <dd>{formatFilesByteSize(infoNode.byteSize)}</dd>
              </div>
            ) : undefined}
            {infoNode.mimeType ? (
              <div class="files__info-row">
                <dt>类型</dt>
                <dd>{infoNode.mimeType}</dd>
              </div>
            ) : undefined}
            <div class="files__info-row">
              <dt>创建</dt>
              <dd>{formatFilesTimestamp(infoNode.createdAt)}</dd>
            </div>
            <div class="files__info-row">
              <dt>修改</dt>
              <dd>{formatFilesTimestamp(infoNode.updatedAt)}</dd>
            </div>
            <div class="files__info-row">
              <dt>权限</dt>
              <dd>{isFilesNodeWritable(infoNode) ? '可读写' : '只读'}</dd>
            </div>
          </dl>
        ) : undefined}
      </WindowModal>
    </div>
  )
}
