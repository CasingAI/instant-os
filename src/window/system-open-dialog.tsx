import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import { fileNameExtension, normalizeFileExtension } from '../os/file-open-registry.ts'
import { getFloatingOverlayRoot } from '../ui/floating-overlay-root.ts'
import { useWindowModal, WindowModalProvider } from './window-modal-context.tsx'
import {
  computeResizedBounds,
  getResizeCursor,
  RESIZE_DIRECTIONS,
  type ResizeDirection,
} from './window-resize.ts'
import { getMaximizedBounds, type WindowBounds } from './window-metrics.ts'
import { clampFloatingPosition } from './window-snap.ts'
import { FilesStorageFullError } from '../apps/files/files-storage.ts'
import {
  FILES_MOUNTS_CHANGED_EVENT,
} from '../apps/files/files-mount-store.ts'
import {
  isFilesLocationWritable,
  isFilesNodeWritable,
  isTrashLocationId,
  type FilesLocation,
  type FilesLocationId,
  type FilesNode,
} from '../apps/files/files-types.ts'
import { filesLocationPathRoot } from '../apps/files/files-path.ts'
import {
  collectDataTransferEntries,
  importExternalNodes,
  type ExternalImportNode,
} from '../apps/files/files-import-external.ts'
import { FilesOpProgressDialog } from '../apps/files/files-op-progress-dialog.tsx'
import type { FilesOpProgressUiState } from '../apps/files/files-run-with-op-progress.ts'
import {
  createBinaryFile,
  createTextFile,
  getFilesLocationLabel,
  listDirectory,
  listFilesLocations,
  resolveFilesAbsolutePath,
  resolveNodeByAbsolutePath,
  resolvePathNodes,
} from '../apps/files/files-vfs.ts'
import { ensureUserSpecialFolders } from '../apps/files/files-user-special.ts'
import { FilesNodeIcon } from '../apps/files/files-node-icon.tsx'
import { buildSaveDialogPath, sanitizeSaveFileName, splitSuggestedSavePath } from './system-save-path.ts'
import './system-open-dialog.css'

export type SystemOpenDialogSelectionMode = 'file' | 'folder'
export type SystemOpenDialogIntent = 'open' | 'save'

export type SystemOpenDialogOptions = {
  title?: string
  /** 仅显示 / 可选这些后缀的文件；不传则显示全部文件。folder 模式下忽略 */
  acceptExtensions?: readonly string[]
  /** 是否显示「新建」；默认 false。folder 模式下忽略 */
  allowCreate?: boolean
  /** 新建文件后缀，默认 txt；支持 txt / md / markdown / pages */
  createExtension?: string
  /** 新建文本文件初始正文；默认空字符串（与 createInitialBytes 二选一） */
  createInitialText?: string
  /** 新建二进制文件初始内容（如 .pages 包）；优先于 createInitialText */
  createInitialBytes?: Uint8Array
  /** 新建二进制文件的 MIME；默认 application/octet-stream */
  createMimeType?: string
  /** 选择目标；默认 file */
  selectionMode?: SystemOpenDialogSelectionMode
  /** 打开已有文件，或指定存储路径（不创建文件）。默认 open */
  intent?: SystemOpenDialogIntent
  /** intent=save 时的默认文件名 */
  defaultFileName?: string
  /** 打开时定位到该目录（或文件所在目录）；save 默认 /user/Downloads */
  initialPath?: string
  /**
   * @deprecated 打开对话框一律挂在系统浮层，不再随 App 窗口伸缩。
   */
  presentation?: 'host' | 'modal'
}

/** @deprecated 使用 SystemOpenDialogOptions */
export type FilesOpenDialogOptions = SystemOpenDialogOptions

type DialogState = {
  options: SystemOpenDialogOptions
  resolve: (value: string | undefined) => void
}

type NavPoint = {
  locationId: FilesLocationId
  folderId: string | undefined
}

type FormatFilterMode = 'accepted' | 'all'

const DEFAULT_FILE_DIALOG_TITLE = '打开文件'
const DEFAULT_FOLDER_DIALOG_TITLE = '选择文件夹'
const DEFAULT_SAVE_DIALOG_TITLE = '存储'
const DEFAULT_SAVE_INITIAL_PATH = '/user/Downloads'
const DEFAULT_DIALOG_WIDTH = 560
const DEFAULT_DIALOG_HEIGHT = 440
const MIN_DIALOG_WIDTH = 360
const MIN_DIALOG_HEIGHT = 320
const DIALOG_NARROW_ENTER = 480
const DIALOG_NARROW_EXIT = 520
const CLOSE_ANIMATION_MS = 200
const THEME = '#8a6a38'

function centeredDialogBounds(): WindowBounds {
  const work = getMaximizedBounds()
  const width = Math.min(DEFAULT_DIALOG_WIDTH, work.width)
  const height = Math.min(DEFAULT_DIALOG_HEIGHT, work.height)
  return {
    x: work.x + Math.round((work.width - width) / 2),
    y: work.y + Math.round((work.height - height) / 2),
    width,
    height,
  }
}

function clampDialogSize(width: number, height: number): Pick<WindowBounds, 'width' | 'height'> {
  const work = getMaximizedBounds()
  return {
    width: Math.max(MIN_DIALOG_WIDTH, Math.min(width, work.width)),
    height: Math.max(MIN_DIALOG_HEIGHT, Math.min(height, work.height)),
  }
}

function formatError(error: unknown): string {
  if (error instanceof FilesStorageFullError) return error.message
  if (error instanceof Error && error.message) return error.message
  return '操作失败'
}

function matchesAccept(node: FilesNode, accept: ReadonlySet<string> | undefined): boolean {
  if (node.kind === 'folder') return true
  if (!accept || accept.size === 0) return true
  const extension = fileNameExtension(node.name)
  if (extension !== undefined && accept.has(extension)) return true
  // 多段后缀（如 .stems.zip）：accept 里带点的条目按完整后缀匹配文件名末尾
  const lower = node.name.toLowerCase()
  for (const entry of accept) {
    if (entry.includes('.') && lower.endsWith(`.${entry}`)) return true
  }
  return false
}

/**
 * 统计导入树中文件总数，以及不在当前格式过滤内的文件数。
 * accept 为空（显示所有格式）时视为无不兼容。
 */
function countImportedIncompatibleNodes(
  nodes: readonly ExternalImportNode[],
  accept: ReadonlySet<string> | undefined,
): { total: number; incompatible: number } {
  let total = 0
  let incompatible = 0
  const walk = (node: ExternalImportNode) => {
    if (node.kind === 'folder') {
      for (const child of node.children ?? []) walk(child)
      return
    }
    total += 1
    if (
      accept &&
      accept.size > 0 &&
      !matchesAccept({ id: '', kind: 'file', name: node.name } as FilesNode, accept)
    ) {
      incompatible += 1
    }
  }
  for (const node of nodes) walk(node)
  return { total, incompatible }
}

function toCreateFileName(baseName: string, extension: string): string {
  const ext = normalizeFileExtension(extension) || 'txt'
  const trimmed = baseName.trim().replace(new RegExp(`\\.${ext}$`, 'i'), '')
  if (!trimmed) return `未命名.${ext}`
  return `${trimmed}.${ext}`
}

function fallbackSaveFileName(extension?: string): string {
  return extension ? `untitled.${extension}` : 'untitled'
}

function sameNavPoint(a: NavPoint, b: NavPoint): boolean {
  return a.locationId === b.locationId && a.folderId === b.folderId
}

function NavArrowGlyph({ direction }: { direction: 'back' | 'forward' }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d={direction === 'back' ? 'M10.2 3.2 4.8 8l5.4 4.8' : 'M5.8 3.2 11.2 8l-5.4 4.8'}
        fill="none"
        stroke="currentColor"
        stroke-width="2.1"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

function SystemOpenDialogBrowser({
  options,
  onClose,
  onPick,
}: {
  options: SystemOpenDialogOptions
  onClose: () => void
  onPick: (path: string) => void
}) {
  const modal = useWindowModal()
  const selectionMode: SystemOpenDialogSelectionMode =
    options.selectionMode === 'folder' ? 'folder' : 'file'
  const folderMode = selectionMode === 'folder'
  const saveMode = !folderMode && options.intent === 'save'
  const saveDefaultExtension = useMemo(() => {
    if (!saveMode) return undefined
    const fromName = options.defaultFileName
      ? fileNameExtension(options.defaultFileName)
      : undefined
    if (fromName) return fromName
    const first = options.acceptExtensions?.[0]
    return first ? normalizeFileExtension(first) : undefined
  }, [options.acceptExtensions, options.defaultFileName, saveMode])

  const configuredAccept = useMemo(() => {
    if (folderMode) return undefined
    if (!options.acceptExtensions || options.acceptExtensions.length === 0) {
      return undefined
    }
    return new Set(options.acceptExtensions.map(normalizeFileExtension).filter(Boolean))
  }, [folderMode, options.acceptExtensions])

  const createExtension = normalizeFileExtension(options.createExtension ?? 'txt') || 'txt'
  const createInitialText = options.createInitialText ?? ''
  const createInitialBytes = options.createInitialBytes
  const createMimeType = options.createMimeType ?? 'application/octet-stream'
  const allowCreate = !folderMode && !saveMode && options.allowCreate === true
  const canCreateTextExtension =
    createExtension === 'txt' || createExtension === 'md' || createExtension === 'markdown'
  const canCreateBinaryExtension = createExtension === 'pages'
  const canCreateExtension = canCreateTextExtension || canCreateBinaryExtension
  const canChooseFormats = !folderMode && configuredAccept !== undefined && configuredAccept.size > 0

  const rootRef = useRef<HTMLDivElement | null>(null)
  const prevNarrowRef = useRef<boolean | undefined>(undefined)
  const historyIndexRef = useRef(0)

  const [narrowLayout, setNarrowLayout] = useState(false)
  const [stackedBrowserOpen, setStackedBrowserOpen] = useState(false)
  const [locationId, setLocationId] = useState<FilesLocationId>('local')
  const [locations, setLocations] = useState<readonly FilesLocation[]>([])
  const [folderId, setFolderId] = useState<string | undefined>(undefined)
  const [pathNodes, setPathNodes] = useState<FilesNode[]>([])
  const [items, setItems] = useState<FilesNode[]>([])
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<NavPoint[]>([{ locationId: 'local', folderId: undefined }])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [formatFilter, setFormatFilter] = useState<FormatFilterMode>('accepted')
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [optionsDraft, setOptionsDraft] = useState<FormatFilterMode>('accepted')
  const [dragActive, setDragActive] = useState(false)
  const [opProgressUi, setOpProgressUi] = useState<FilesOpProgressUiState | undefined>(undefined)
  const [saveFileName, setSaveFileName] = useState(
    () => options.defaultFileName?.trim() || fallbackSaveFileName(saveDefaultExtension),
  )
  const needsNavBoot = saveMode || Boolean(options.initialPath)
  const [navBooted, setNavBooted] = useState(!needsNavBoot)

  historyIndexRef.current = historyIndex

  const accept =
    canChooseFormats && formatFilter === 'accepted' ? configuredAccept : undefined

  const locationWritable = isFilesLocationWritable(locationId)
  const currentFolder = pathNodes.length > 0 ? pathNodes[pathNodes.length - 1] : undefined
  const canCreateHere =
    locationWritable && (currentFolder === undefined || isFilesNodeWritable(currentFolder))
  const locationLabel = getFilesLocationLabel(locationId)
  const selected = items.find((item) => item.id === selectedId)
  const canOpen = folderMode
    ? selected === undefined || selected.kind === 'folder'
    : selected?.kind === 'file'
  const canSave =
    saveMode &&
    locationWritable &&
    canCreateHere &&
    Boolean(sanitizeSaveFileName(saveFileName, saveDefaultExtension))
  const canGoBackInHistory = historyIndex > 0
  const canGoForward = historyIndex < history.length - 1
  const canLeaveBrowserStack = narrowLayout && stackedBrowserOpen && !canGoBackInHistory
  const canGoBack = canGoBackInHistory || canLeaveBrowserStack

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const [nextItems, nextPath] = await Promise.all([
        listDirectory(locationId, folderId),
        resolvePathNodes(locationId, folderId),
      ])
      const visible = folderMode
        ? nextItems.filter((node) => node.kind === 'folder')
        : nextItems.filter((node) => matchesAccept(node, accept))
      setItems(visible)
      setPathNodes(nextPath)
      setSelectedId((current) =>
        current && visible.some((node) => node.id === current) ? current : undefined,
      )
    } catch (err) {
      setItems([])
      setPathNodes([])
      setError(formatError(err))
    } finally {
      setLoading(false)
    }
  }, [accept, folderId, folderMode, locationId])

  const refreshLocations = useCallback(async () => {
    try {
      const all = await listFilesLocations()
      // 废纸篓不是合法选择/保存目标，不出现在对话框侧栏
      setLocations(all.filter((location) => !isTrashLocationId(location.id)))
    } catch {
      setLocations([])
    }
  }, [])

  useEffect(() => {
    void refreshLocations()
  }, [refreshLocations])

  useEffect(() => {
    if (!needsNavBoot) {
      return
    }

    let cancelled = false
    const boot = async () => {
      if (saveMode) {
        await ensureUserSpecialFolders().catch(() => undefined)
      }

      const rawPath = (options.initialPath?.trim() || (saveMode ? DEFAULT_SAVE_INITIAL_PATH : '')) || ''
      if (!rawPath) {
        if (!cancelled) setNavBooted(true)
        return
      }

      const split = splitSuggestedSavePath(rawPath)
      if (split.fileName && !options.defaultFileName) {
        setSaveFileName(split.fileName)
      }

      try {
        const folderNode = await resolveNodeByAbsolutePath(split.folderHint)
        if (cancelled) return
        if (folderNode?.kind === 'folder') {
          const point = { locationId: folderNode.locationId, folderId: folderNode.id }
          setLocationId(point.locationId)
          setFolderId(point.folderId)
          setSelectedId(undefined)
          setHistory([point])
          setHistoryIndex(0)
        } else if (split.folderHint === '/user' || split.folderHint === '/user/') {
          setLocationId('local')
          setFolderId(undefined)
          setSelectedId(undefined)
        }
      } catch {
        // keep default /user root
      }

      if (!cancelled) setNavBooted(true)
    }

    void boot()
    return () => {
      cancelled = true
    }
    // 仅在打开时定位一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    if (!navBooted) return
    void refresh()
  }, [navBooted, refresh])

  useEffect(() => {
    const node = rootRef.current
    if (!node) return

    const sync = () => {
      const width = node.clientWidth
      setNarrowLayout((current) => {
        if (current) {
          return width < DIALOG_NARROW_EXIT
        }
        return width <= DIALOG_NARROW_ENTER
      })
    }

    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const previous = prevNarrowRef.current
    if (previous === undefined) {
      prevNarrowRef.current = narrowLayout
      if (narrowLayout) {
        setStackedBrowserOpen(true)
      }
      return
    }

    prevNarrowRef.current = narrowLayout

    if (!previous && narrowLayout) {
      setStackedBrowserOpen(true)
      return
    }

    if (previous && !narrowLayout) {
      setStackedBrowserOpen(false)
    }
  }, [narrowLayout])

  useEffect(() => {
    if (!optionsOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      setOptionsOpen(false)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [optionsOpen])

  const applyNavPoint = useCallback((point: NavPoint) => {
    setLocationId(point.locationId)
    setFolderId(point.folderId)
    setSelectedId(undefined)
  }, [])

  const pushNav = useCallback(
    (point: NavPoint) => {
      applyNavPoint(point)
      const index = historyIndexRef.current
      setHistory((prev) => {
        const truncated = prev.slice(0, index + 1)
        const last = truncated[truncated.length - 1]
        if (last && sameNavPoint(last, point)) {
          return truncated
        }
        const next = [...truncated, point]
        setHistoryIndex(next.length - 1)
        return next
      })
    },
    [applyNavPoint],
  )

  const selectLocation = useCallback(
    (next: FilesLocationId) => {
      pushNav({ locationId: next, folderId: undefined })
      if (narrowLayout) {
        setStackedBrowserOpen(true)
      }
    },
    [narrowLayout, pushNav],
  )

  const enterFolder = useCallback(
    (node: FilesNode) => {
      if (node.kind !== 'folder') return
      pushNav({ locationId, folderId: node.id })
    },
    [locationId, pushNav],
  )

  const goBack = useCallback(() => {
    if (canGoBackInHistory) {
      const nextIndex = historyIndex - 1
      const point = history[nextIndex]
      if (!point) return
      applyNavPoint(point)
      setHistoryIndex(nextIndex)
      return
    }
    if (canLeaveBrowserStack) {
      setStackedBrowserOpen(false)
    }
  }, [
    applyNavPoint,
    canGoBackInHistory,
    canLeaveBrowserStack,
    history,
    historyIndex,
  ])

  const goForward = useCallback(() => {
    if (!canGoForward) return
    const nextIndex = historyIndex + 1
    const point = history[nextIndex]
    if (!point) return
    applyNavPoint(point)
    setHistoryIndex(nextIndex)
  }, [applyNavPoint, canGoForward, history, historyIndex])

  const pickNodePath = useCallback(
    async (node: FilesNode) => {
      try {
        onPick(await resolveFilesAbsolutePath(node))
      } catch (err) {
        await modal.alert({ title: '无法打开', message: formatError(err), themeColor: THEME })
      }
    },
    [modal, onPick],
  )

  const handleItemActivate = useCallback(
    (node: FilesNode) => {
      if (folderMode) {
        if (node.kind !== 'folder') return
        setSelectedId(node.id)
        return
      }
      if (node.kind === 'folder') {
        enterFolder(node)
        return
      }
      setSelectedId(node.id)
      if (saveMode) {
        setSaveFileName(node.name)
      }
    },
    [enterFolder, folderMode, saveMode],
  )

  const handleItemDoubleClick = useCallback(
    (node: FilesNode) => {
      if (node.kind === 'folder') {
        enterFolder(node)
        return
      }
      if (folderMode) return
      if (saveMode) {
        setSaveFileName(node.name)
        return
      }
      void pickNodePath(node)
    },
    [enterFolder, folderMode, pickNodePath, saveMode],
  )

  const handleSave = useCallback(async () => {
    if (!saveMode || !canSave) return
    try {
      const folderPath = currentFolder
        ? await resolveFilesAbsolutePath(currentFolder)
        : filesLocationPathRoot(locationId)
      onPick(buildSaveDialogPath(folderPath, saveFileName, saveDefaultExtension))
    } catch (err) {
      await modal.alert({ title: '无法存储', message: formatError(err), themeColor: THEME })
    }
  }, [
    canSave,
    currentFolder,
    locationId,
    modal,
    onPick,
    saveDefaultExtension,
    saveFileName,
    saveMode,
  ])

  const handleOpen = useCallback(() => {
    if (saveMode) {
      void handleSave()
      return
    }
    if (folderMode) {
      if (selected?.kind === 'folder') {
        void pickNodePath(selected)
        return
      }
      if (currentFolder) {
        void pickNodePath(currentFolder)
        return
      }
      onPick(filesLocationPathRoot(locationId))
      return
    }
    if (!selected || selected.kind !== 'file') return
    void pickNodePath(selected)
  }, [currentFolder, folderMode, handleSave, locationId, onPick, pickNodePath, saveMode, selected])

  const handleDragOver = useCallback(
    (event: DragEvent) => {
      if (!(event.dataTransfer?.types ?? []).includes('Files')) return
      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = locationWritable ? 'copy' : 'none'
      }
      if (locationWritable) {
        setDragActive(true)
      }
    },
    [locationWritable],
  )

  const handleDragLeave = useCallback((event: DragEvent) => {
    // 子元素间移动触发的 dragleave 冒泡：relatedTarget 仍在容器内则忽略
    const related = event.relatedTarget
    if (related instanceof Node && rootRef.current?.contains(related)) return
    setDragActive(false)
  }, [])

  const handleDrop = useCallback(
    (event: DragEvent) => {
      setDragActive(false)
      // 阻止浏览器打开/导航被 drop 的文件，也让文件 APP 的 document 兜底
      // （其监听依赖 defaultPrevented 判断）不会抢走这次导入到别的目录
      event.preventDefault()
      if (!event.dataTransfer?.files.length) return
      if (!locationWritable || busy) return
      setBusy(true)
      void collectDataTransferEntries(event.dataTransfer).then(
        async (nodes) => {
          try {
            if (nodes.length === 0) return
            await importExternalNodes({
              nodes,
              dest: { destLocationId: locationId, destParentId: folderId },
              onUiChange: setOpProgressUi,
            })
            await refresh()
            const { total, incompatible } = countImportedIncompatibleNodes(nodes, accept)
            if (incompatible > 0) {
              await modal.alert({
                title: '已导入',
                message: `已导入 ${total} 个文件，其中 ${incompatible} 个不在当前支持格式列表中，可切换到「所有格式」查看。`,
                themeColor: THEME,
              })
            }
          } catch (err) {
            await modal.alert({ title: '无法导入', message: formatError(err), themeColor: THEME })
          } finally {
            setBusy(false)
          }
        },
        (err) => {
          setBusy(false)
          void modal.alert({ title: '无法导入', message: formatError(err), themeColor: THEME })
        },
      )
    },
    [accept, busy, folderId, locationId, locationWritable, modal, refresh],
  )

  const handleCreate = useCallback(async () => {
    if (!allowCreate || !canCreateHere || busy) return
    if (!canCreateExtension) {
      await modal.alert({
        title: '无法新建',
        message: '当前仅支持新建文本类文件（.txt / .md）或文稿包（.pages）。',
        themeColor: THEME,
      })
      return
    }

    const name = await modal.prompt({
      title: createExtension === 'txt' ? '新建文本文件' : '新建文稿',
      label: '名称',
      placeholder: '未命名',
      initialValue: '未命名',
      suffix: `.${createExtension}`,
      requireValue: true,
      confirmLabel: '创建',
      themeColor: THEME,
    })
    if (name === undefined) return

    setBusy(true)
    try {
      const fileName = toCreateFileName(name, createExtension)
      let node
      if (canCreateBinaryExtension) {
        const raw = createInitialBytes ?? new Uint8Array()
        const copy = new Uint8Array(raw.byteLength)
        copy.set(raw)
        node = await createBinaryFile({
          locationId,
          parentId: folderId,
          name: fileName,
          bytes: copy.buffer,
          mimeType: createMimeType,
        })
      } else {
        node = await createTextFile({
          locationId,
          parentId: folderId,
          name: fileName,
          text: createInitialText,
        })
      }
      await pickNodePath(node)
    } catch (err) {
      await modal.alert({ title: '无法创建', message: formatError(err), themeColor: THEME })
    } finally {
      setBusy(false)
    }
  }, [
    allowCreate,
    busy,
    canCreateBinaryExtension,
    canCreateExtension,
    canCreateHere,
    createExtension,
    createInitialBytes,
    createInitialText,
    createMimeType,
    folderId,
    locationId,
    modal,
    pickNodePath,
  ])

  const openOptions = useCallback(() => {
    setOptionsDraft(formatFilter)
    setOptionsOpen(true)
  }, [formatFilter])

  const confirmOptions = useCallback(() => {
    setFormatFilter(optionsDraft)
    setOptionsOpen(false)
  }, [optionsDraft])

  const currentTitle =
    pathNodes.length > 0 ? pathNodes[pathNodes.length - 1].name : locationLabel

  const rootClass = [
    'system-open-dialog',
    narrowLayout ? 'system-open-dialog--narrow' : '',
    narrowLayout && stackedBrowserOpen ? 'system-open-dialog--browser-open' : '',
    dragActive ? 'system-open-dialog--drop-active' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={rootRef}
      class={rootClass}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <aside class="system-open-dialog__sidebar">
        <div class="system-open-dialog__sidebar-heading">位置</div>
        <ul class="system-open-dialog__sidebar-list">
          {locations.map((location) => {
            const active = location.id === locationId
            return (
              <li key={location.id}>
                <button
                  type="button"
                  class={`system-open-dialog__sidebar-item${active ? ' system-open-dialog__sidebar-item--active' : ''}`}
                  onClick={() => selectLocation(location.id)}
                >
                  {location.label}
                </button>
              </li>
            )
          })}
        </ul>
      </aside>

      <div class="system-open-dialog__main">
        <header class="system-open-dialog__toolbar">
          <div class="system-open-dialog__nav" role="group" aria-label="浏览历史">
            <button
              type="button"
              class="system-open-dialog__nav-btn"
              disabled={!canGoBack || busy}
              aria-label="后退"
              onClick={goBack}
            >
              <NavArrowGlyph direction="back" />
            </button>
            <button
              type="button"
              class="system-open-dialog__nav-btn"
              disabled={!canGoForward || busy}
              aria-label="前进"
              onClick={goForward}
            >
              <NavArrowGlyph direction="forward" />
            </button>
          </div>
          <div class="system-open-dialog__path">{currentTitle}</div>
        </header>

        {!canCreateHere && allowCreate ? (
          <div class="system-open-dialog__banner" role="status">
            此位置为只读
          </div>
        ) : undefined}

        {error ? (
          <div class="system-open-dialog__banner system-open-dialog__banner--error">{error}</div>
        ) : undefined}

        <div class="system-open-dialog__browser">
          {loading ? (
            <div class="system-open-dialog__empty">正在加载…</div>
          ) : items.length === 0 ? (
            <div class="system-open-dialog__empty">此文件夹为空</div>
          ) : (
            <ul class="system-open-dialog__list">
              {items.map((node) => {
                const selectedItem = node.id === selectedId
                return (
                  <li key={node.id}>
                    <button
                      type="button"
                      class={`system-open-dialog__row${selectedItem ? ' system-open-dialog__row--selected' : ''}`}
                      onClick={() => handleItemActivate(node)}
                      onDblClick={() => handleItemDoubleClick(node)}
                    >
                      <span class="system-open-dialog__row-icon" aria-hidden="true">
                        <FilesNodeIcon node={node} size="list" />
                      </span>
                      <span class="system-open-dialog__row-name">{node.name}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <footer class={`system-open-dialog__footer${saveMode ? ' system-open-dialog__footer--save' : ''}`}>
          {saveMode ? (
            <>
              <label class="system-open-dialog__filename">
                <span class="system-open-dialog__filename-label">名称</span>
                <input
                  type="text"
                  class="system-open-dialog__filename-input"
                  value={saveFileName}
                  spellcheck={false}
                  aria-label="文件名"
                  onInput={(event) => {
                    setSaveFileName((event.currentTarget as HTMLInputElement).value)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void handleSave()
                    }
                  }}
                />
              </label>
              <div class="system-open-dialog__footer-actions">
                {canChooseFormats ? (
                  <button
                    type="button"
                    class="system-open-dialog__btn"
                    disabled={busy}
                    onClick={openOptions}
                  >
                    选项
                  </button>
                ) : (
                  <span class="system-open-dialog__footer-spacer" />
                )}
                <div class="system-open-dialog__footer-end">
                  <button
                    type="button"
                    class="system-open-dialog__btn"
                    disabled={busy}
                    onClick={onClose}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    class="system-open-dialog__btn system-open-dialog__btn--primary"
                    disabled={!canSave || busy}
                    onClick={handleOpen}
                  >
                    存储
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div class="system-open-dialog__footer-start">
                {allowCreate ? (
                  <button
                    type="button"
                    class="system-open-dialog__btn"
                    disabled={!canCreateHere || busy}
                    onClick={() => void handleCreate()}
                  >
                    新建
                  </button>
                ) : undefined}
                {canChooseFormats ? (
                  <button
                    type="button"
                    class="system-open-dialog__btn"
                    disabled={busy}
                    onClick={openOptions}
                  >
                    选项
                  </button>
                ) : undefined}
                {!allowCreate && !canChooseFormats ? (
                  <span class="system-open-dialog__footer-spacer" />
                ) : undefined}
              </div>
              <div class="system-open-dialog__footer-end">
                <button
                  type="button"
                  class="system-open-dialog__btn"
                  disabled={busy}
                  onClick={onClose}
                >
                  取消
                </button>
                <button
                  type="button"
                  class="system-open-dialog__btn system-open-dialog__btn--primary"
                  disabled={!canOpen || busy}
                  onClick={handleOpen}
                >
                  打开
                </button>
              </div>
            </>
          )}
        </footer>
      </div>

      {optionsOpen ? (
        <div class="system-open-dialog__sheet-layer" role="presentation">
          <div
            class="system-open-dialog__sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="system-open-dialog-options-title"
          >
            <header class="system-open-dialog__sheet-header">
              <h3 class="system-open-dialog__sheet-title" id="system-open-dialog-options-title">
                选项
              </h3>
            </header>
            <div class="system-open-dialog__options" role="radiogroup" aria-label="显示格式">
              <button
                type="button"
                class="system-open-dialog__options-row"
                role="radio"
                aria-checked={optionsDraft === 'accepted'}
                onClick={() => setOptionsDraft('accepted')}
              >
                <span class="system-open-dialog__options-label">仅支持的格式</span>
                {optionsDraft === 'accepted' ? (
                  <span class="system-open-dialog__options-check" aria-hidden="true">
                    ✓
                  </span>
                ) : undefined}
              </button>
              <button
                type="button"
                class="system-open-dialog__options-row"
                role="radio"
                aria-checked={optionsDraft === 'all'}
                onClick={() => setOptionsDraft('all')}
              >
                <span class="system-open-dialog__options-label">所有格式</span>
                {optionsDraft === 'all' ? (
                  <span class="system-open-dialog__options-check" aria-hidden="true">
                    ✓
                  </span>
                ) : undefined}
              </button>
            </div>
            <footer class="system-open-dialog__sheet-actions">
              <button
                type="button"
                class="system-open-dialog__btn"
                onClick={() => setOptionsOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                class="system-open-dialog__btn system-open-dialog__btn--primary"
                onClick={confirmOptions}
              >
                好
              </button>
            </footer>
          </div>
        </div>
      ) : undefined}

      <FilesOpProgressDialog
        open={opProgressUi !== undefined}
        title={opProgressUi?.title ?? ''}
        remainingLabel={opProgressUi?.remainingLabel ?? ''}
        fraction={opProgressUi?.fraction ?? 0}
        themeColor={THEME}
      />
    </div>
  )
}

function SystemOpenDialogPanel({
  options,
  closing,
  onClose,
  onPick,
}: {
  options: SystemOpenDialogOptions
  closing: boolean
  onClose: () => void
  onPick: (path: string) => void
}) {
  const title =
    options.title ??
    (options.intent === 'save'
      ? DEFAULT_SAVE_DIALOG_TITLE
      : options.selectionMode === 'folder'
        ? DEFAULT_FOLDER_DIALOG_TITLE
        : DEFAULT_FILE_DIALOG_TITLE)
  const [bounds, setBounds] = useState<WindowBounds>(() => centeredDialogBounds())
  const boundsRef = useRef(bounds)
  boundsRef.current = bounds
  const dragRef = useRef<
    | { kind: 'move'; startX: number; startY: number; origin: WindowBounds }
    | { kind: 'resize'; direction: ResizeDirection; startX: number; startY: number; origin: WindowBounds }
    | undefined
  >(undefined)

  useEffect(() => {
    if (closing) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closing, onClose])

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const session = dragRef.current
      if (!session) return
      if (session.kind === 'move') {
        const nextX = session.origin.x + (event.clientX - session.startX)
        const nextY = session.origin.y + (event.clientY - session.startY)
        const clamped = clampFloatingPosition(
          nextX,
          nextY,
          session.origin.width,
          session.origin.height,
        )
        setBounds({
          x: clamped.x,
          y: clamped.y,
          width: session.origin.width,
          height: session.origin.height,
        })
        return
      }

      const raw = computeResizedBounds(
        session.origin,
        session.direction,
        event.clientX - session.startX,
        event.clientY - session.startY,
      )
      const size = clampDialogSize(raw.width, raw.height)
      let { x, y } = raw
      if (session.direction.includes('w')) {
        x = session.origin.x + session.origin.width - size.width
      }
      if (session.direction.includes('n')) {
        y = session.origin.y + session.origin.height - size.height
      }
      const pos = clampFloatingPosition(x, y, size.width, size.height)
      setBounds({ x: pos.x, y: pos.y, width: size.width, height: size.height })
    }

    const onPointerUp = () => {
      dragRef.current = undefined
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [])

  const onTitlebarPointerDown = useCallback((event: PointerEvent) => {
    if (closing || event.button !== 0) return
    event.preventDefault()
    dragRef.current = {
      kind: 'move',
      startX: event.clientX,
      startY: event.clientY,
      origin: boundsRef.current,
    }
    document.body.style.cursor = 'move'
    document.body.style.userSelect = 'none'
  }, [closing])

  const onResizePointerDown = useCallback((direction: ResizeDirection, event: PointerEvent) => {
    if (closing || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = {
      kind: 'resize',
      direction,
      startX: event.clientX,
      startY: event.clientY,
      origin: boundsRef.current,
    }
    document.body.style.cursor = getResizeCursor(direction)
    document.body.style.userSelect = 'none'
  }, [closing])

  const frameStyle = {
    left: `${bounds.x}px`,
    top: `${bounds.y}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
  }

  return createPortal(
    <div class={`system-open-dialog-layer${closing ? ' system-open-dialog-layer--closing' : ''}`}>
      <div
        class={`system-open-dialog-scrim${closing ? ' system-open-dialog-scrim--closing' : ''}`}
        aria-hidden="true"
      />
      <div
        class={`system-open-dialog-frame${closing ? ' system-open-dialog-frame--closing' : ''}`}
        style={frameStyle}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header class="system-open-dialog-frame__titlebar" onPointerDown={onTitlebarPointerDown}>
          <h2 class="system-open-dialog-frame__title">{title}</h2>
        </header>
        <div class="system-open-dialog-frame__body">
          {/* 嵌套模态宿主：prompt/alert 必须盖在本浮层之上，不能落到 App 窗口里 */}
          <WindowModalProvider>
            <SystemOpenDialogBrowser options={options} onClose={onClose} onPick={onPick} />
          </WindowModalProvider>
        </div>
        {RESIZE_DIRECTIONS.map((direction) => (
          <div
            key={direction}
            class={`system-open-dialog-frame__resize system-open-dialog-frame__resize--${direction}`}
            style={{ cursor: getResizeCursor(direction) }}
            onPointerDown={(event) => onResizePointerDown(direction, event)}
          />
        ))}
      </div>
    </div>,
    getFloatingOverlayRoot(),
  )
}

export function useSystemOpenDialog() {
  const [state, setState] = useState<DialogState | undefined>(undefined)
  const [closing, setClosing] = useState(false)
  const stateRef = useRef(state)
  const closingRef = useRef(false)
  const pendingValueRef = useRef<string | undefined>(undefined)
  stateRef.current = state
  closingRef.current = closing

  const showSystemOpenDialog = useCallback((options: SystemOpenDialogOptions = {}) => {
    return new Promise<string | undefined>((resolve) => {
      closingRef.current = false
      pendingValueRef.current = undefined
      setClosing(false)
      setState({ options, resolve })
    })
  }, [])

  const closeWith = useCallback((value: string | undefined) => {
    if (!stateRef.current || closingRef.current) return
    pendingValueRef.current = value
    closingRef.current = true
    setClosing(true)
  }, [])

  useEffect(() => {
    if (!closing) return
    const timer = window.setTimeout(() => {
      const current = stateRef.current
      stateRef.current = undefined
      current?.resolve(pendingValueRef.current)
      pendingValueRef.current = undefined
      closingRef.current = false
      setState(undefined)
      setClosing(false)
    }, CLOSE_ANIMATION_MS)
    return () => window.clearTimeout(timer)
  }, [closing])

  useEffect(() => {
    return () => {
      const current = stateRef.current
      if (!current) return
      stateRef.current = undefined
      current.resolve(closingRef.current ? pendingValueRef.current : undefined)
    }
  }, [])

  const dialog = state ? (
    <SystemOpenDialogPanel
      options={state.options}
      closing={closing}
      onClose={() => closeWith(undefined)}
      onPick={(node) => closeWith(node)}
    />
  ) : undefined

  const isOpen = state !== undefined && !closing

  return { showSystemOpenDialog, dialog, isOpen }
}

/** @deprecated 使用 useSystemOpenDialog */
export function useFilesOpenDialog() {
  const { showSystemOpenDialog, dialog, isOpen } = useSystemOpenDialog()
  return {
    showFilesOpenDialog: showSystemOpenDialog,
    dialog,
    isOpen,
    presentation: 'modal' as const,
  }
}
