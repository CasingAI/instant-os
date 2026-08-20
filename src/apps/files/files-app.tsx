import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ComponentChildren, ComponentType, JSX } from 'preact'
import { getAppDefinition } from '../../os/app-registry.tsx'
import {
  getDefaultFileOpenApp,
  listRegisteredFileOpenApps,
  setPreferredFileOpenApp,
} from '../../os/file-open-registry.ts'
import {
  listFilesContextMenuContributions,
  type FilesContextMenuOps,
} from '../../os/file-context-menu-registry.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import type { BuiltinAppId, GeneratedAppId } from '../../os/types.ts'
import {
  AdaptiveActionMenu,
  type AdaptiveActionMenuLeafItem,
  type AdaptiveActionMenuItem,
} from '../../ui/adaptive-action-menu.tsx'
import { IosCheckToggle } from '../../ui/ios-check-toggle.tsx'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { useAppNarrowLayout } from '../../ui/use-app-narrow-layout.ts'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { WindowModal } from '../../window/window-modal.tsx'
import { getFilesClipboard, setFilesClipboard } from './files-clipboard.ts'
import { readAppliedDockReservePx } from '../../dock/dock-css-vars.ts'
import { formatStorageSize } from '../../os/format-storage-size.ts'
import { DATA_STORAGE_CHANGED_EVENT } from '../../os/device-data-storage.ts'
import { FilesStorageFullError, FILE_SIDEBAR_METRIC_LOCATIONS, getFilesBytesByLocation } from './files-storage.ts'
import {
  collectDataTransferEntries,
  importExternalNodes,
  type ExternalImportNode,
} from './files-import-external.ts'
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
  isMountNodeId,
  isTrashLocationId,
  type FilesLocation,
  type FilesLocationId,
  type FilesNode,
  type MountFilesLocationId,
} from './files-types.ts'
import { isUserSpecialFolderNode } from './files-user-special.ts'
import { marqueeSelection, rangeSelection, toggleInSet } from './files-selection.ts'
import { FilesOpProgressDialog } from './files-op-progress-dialog.tsx'
import { estimateFilesOpDurationMs } from './files-op-progress-policy.ts'
import {
  runFilesOpWithProgress,
  type FilesOpProgressUiState,
} from './files-run-with-op-progress.ts'
import {
  isArchiveFileName,
  type FilesArchiveFormat,
} from './files-archive.ts'
import {
  compressNodesToArchiveOp,
  extractArchiveToDirectoryOp,
} from './files-archive-ops.ts'
import { preloadAppBundleIcons } from './files-app-bundle-icon.tsx'
import {
  FILES_NAME_DISPLAY_OPTIONS,
  formatFilesDisplayName,
  readFilesNameDisplayMode,
  writeFilesNameDisplayMode,
  type FilesNameDisplayMode,
} from './files-name-display.ts'
import {
  applicationsBundleDisplayName,
  isApplicationsBundleRootNode,
  parseApplicationsDirPath,
} from './files-location-applications.ts'
import { resolveAppCatalogEntryByBundlePath } from '../../os/app-catalog.ts'
import {
  FILES_VFS_CHANGED_EVENT,
  copyNodeTo,
  createTextFile,
  emptyTrash,
  enrichFilesNodeMeta,
  estimateCopyWorkload,
  estimateDeleteWorkload,
  filesNodeNeedsViewportMeta,
  getFilesLocationLabel,
  getNodeOrThrow,
  getCachedListDirectory,
  invalidateFilesVfsPathCaches,
  listDirectory,
  listFilesLocations,
  mkdir,
  moveNodeTo,
  removeNode,
  renameNode,
  resolveFilesAbsolutePath,
  resolveNodeByAbsolutePath,
  resolvePathNodes,
  restoreNode,
  trashNode,
} from './files-vfs.ts'
import {
  filesLocationPathRoot,
  formatFilesByteSize,
  formatFilesTimestamp,
  joinFilesAbsolutePath,
  parseFilesAbsolutePath,
} from './files-path.ts'
import { reconcileGithubRepoAttributes } from '../github-desktop/github-repo-attributes.ts'
import { encodeInfoDocumentId, encodeVolumeInfoDocumentId } from '../file-info/info-document-id.ts'
import { FilesPathBar, type FilesPathBarSegment } from './files-path-bar.tsx'
import { FilesFolderTemplateIcon, FilesNodeIcon, FilesTxtTemplateIcon } from './files-node-icon.tsx'
import '../../ui/ios-check-toggle.css'
import '../../ui/ios-nav-back.css'
import './files.css'

const APP_ID = 'files' as const

function canRenameOrDeleteFilesNode(node: FilesNode): boolean {
  return isFilesNodeWritable(node) && !isUserSpecialFolderNode(node)
}
const THEME = '#8a6a38'
const LONG_PRESS_MS = 380
const LONG_PRESS_MOVE_PX = 8
const VIEW_MODE_STORAGE_KEY = 'files.viewMode'
const SORT_STORAGE_KEY = 'files.sort'
const VIEWPORT_META_DEBOUNCE_MS = 100
const VIEWPORT_META_CONCURRENCY = 8
const VIEWPORT_META_ROOT_MARGIN = '96px'
/** 目录拉取超过此时长才显示加载卡片，避免快请求闪一下 */
const LOADING_SHOW_DELAY_MS = 200
/** 加载卡片一旦出现，至少展示此时长 */
const LOADING_MIN_VISIBLE_MS = 300

type FilesViewMode = 'grid' | 'list'

type FilesSortKey = 'name' | 'date' | 'size'
type FilesSort = { key: FilesSortKey; direction: 'asc' | 'desc' }

function menuCheckPrefix(active: boolean): string {
  return active ? '✓ ' : ''
}

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

function readFilesSort(): FilesSort {
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FilesSort>
      if (
        (parsed.key === 'name' || parsed.key === 'date' || parsed.key === 'size') &&
        (parsed.direction === 'asc' || parsed.direction === 'desc')
      ) {
        return { key: parsed.key, direction: parsed.direction }
      }
    }
  } catch {
    // ignore
  }
  return { key: 'name', direction: 'asc' }
}

function writeFilesSort(sort: FilesSort): void {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort))
  } catch {
    // ignore
  }
}

/** 列表排序：文件夹恒排前，组内按 key 排序；direction=desc 组内反转 */
function sortNodeList(nodes: readonly FilesNode[], sort: FilesSort): FilesNode[] {
  const compare = (a: FilesNode, b: FilesNode): number => {
    if (sort.key === 'name') {
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    }
    if (sort.key === 'date') {
      return a.updatedAt - b.updatedAt
    }
    return a.byteSize - b.byteSize
  }
  const applyDirection = (list: FilesNode[]): FilesNode[] => {
    list.sort(compare)
    if (sort.direction === 'desc') list.reverse()
    return list
  }
  const folders = nodes.filter((node) => node.kind === 'folder')
  const rest = nodes.filter((node) => node.kind !== 'folder')
  return [...applyDirection(folders), ...applyDirection(rest)]
}

const SORT_KEY_LABELS: Record<FilesSortKey, string> = {
  name: '名称',
  date: '修改日期',
  size: '大小',
}

/** 排序菜单单项目文案：当前项带 ✓ 与方向箭头，非当前项仅显示字段名 */
function formatSortOptionLabel(sort: FilesSort, key: FilesSortKey): string {
  if (sort.key !== key) return SORT_KEY_LABELS[key]
  return `${SORT_KEY_LABELS[key]}${sort.direction === 'asc' ? ' ↑' : ' ↓'}`
}

/** 排序菜单项：按名称 / 修改日期 / 大小，当前字段前加 ✓ */
function buildSortMenuItems(
  sort: FilesSort,
  onChange: (key: FilesSortKey) => void,
): AdaptiveActionMenuLeafItem[] {
  return (['name', 'date', 'size'] as const).map((key) => ({
    type: 'action',
    label: `${sort.key === key ? '✓ ' : ''}${formatSortOptionLabel(sort, key)}`,
    onClick: () => onChange(key),
  }))
}

function formatListByteSize(node: FilesNode, metaResolved: ReadonlySet<string>): string {
  if (node.kind === 'folder' || node.locationId === 'models3d' || node.locationId === 'applications') {
    return '—'
  }
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

/** 框选矩形（相对 .files__browser 内容区坐标） */
type FilesMarqueeRect = {
  left: number
  top: number
  right: number
  bottom: number
}

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

function FilesContextSubmenu({
  item,
  onClose,
}: {
  item: Extract<AdaptiveActionMenuItem, { type: 'submenu' }>
  onClose: () => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [alignLeft, setAlignLeft] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }

    const row = rowRef.current
    const submenu = submenuRef.current
    if (!row || !submenu) {
      return
    }

    const rowRect = row.getBoundingClientRect()
    const submenuRect = submenu.getBoundingClientRect()
    const fitsRight = rowRect.right + submenuRect.width + 8 <= window.innerWidth
    setAlignLeft(!fitsRight)

    const defaultTop = -5
    let top = defaultTop
    const overflowBottom = rowRect.top + defaultTop + submenuRect.height - (window.innerHeight - 8)
    if (overflowBottom > 0) {
      top -= overflowBottom
    }
    const overflowTop = 8 - (rowRect.top + top)
    if (overflowTop > 0) {
      top += overflowTop
    }
    submenu.style.top = `${top}px`
  }, [open, item.items])

  return (
    <div
      ref={rowRef}
      class={`files__context-submenu-row${open ? ' files__context-submenu-row--open' : ''}`}
      role="none"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span class="files__context-submenu-label">{item.label}</span>
      <span class="files__context-submenu-chevron" aria-hidden="true">
        ›
      </span>
      {open && (
        <div
          ref={submenuRef}
          class={`files__context files__context-submenu${alignLeft ? ' files__context-submenu--left' : ''}`}
          role="menu"
          aria-label={item.label}
        >
          {item.items.map((subItem, index) => {
            if (subItem.type === 'separator') return undefined
            return (
              <button
                key={`${item.label}-${subItem.label}-${index}`}
                type="button"
                class="files__context-item"
                disabled={subItem.disabled}
                onClick={() => {
                  subItem.onClick()
                  onClose()
                }}
              >
                {subItem.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * 右键菜单 / 弹出层定位容器：渲染后按实际尺寸 clamp 进视口，
 * 避免靠近屏幕边缘时溢出（子菜单 FilesContextSubmenu 有同样的边界修正）。
 */
function FilesContextMenu({
  x,
  y,
  className = 'files__context',
  style,
  role,
  children,
}: {
  x: number
  y: number
  className?: string
  style?: JSX.CSSProperties
  role?: JSX.HTMLAttributes<HTMLDivElement>['role']
  children: ComponentChildren
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) {
      return
    }
    const menuRect = menu.getBoundingClientRect()
    const dockReserve = readAppliedDockReservePx()
    const maxX = window.innerWidth - menuRect.width - 8
    const maxY = window.innerHeight - dockReserve - menuRect.height - 8
    menu.style.left = `${Math.max(8, Math.min(x, maxX))}px`
    menu.style.top = `${Math.max(8, Math.min(y, maxY))}px`
  }, [x, y])

  return (
    <div
      ref={menuRef}
      class={className}
      role={role}
      style={{ left: `${x}px`, top: `${y}px`, ...style }}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  )
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

function ApplicationsGlyph() {
  return (
    <svg class="files__location-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="7" height="7" rx="1.6" fill="#c9a66a" stroke="#8a6a38" stroke-width="1" />
      <rect x="13" y="4" width="7" height="7" rx="1.6" fill="#f0d9a8" stroke="#8a6a38" stroke-width="1" />
      <rect x="4" y="13" width="7" height="7" rx="1.6" fill="#f0d9a8" stroke="#8a6a38" stroke-width="1" />
      <rect x="13" y="13" width="7" height="7" rx="1.6" fill="#c9a66a" stroke="#8a6a38" stroke-width="1" />
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

function TrashGlyph() {
  return (
    <svg class="files__location-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#c9a66a"
        stroke="#8a6a38"
        stroke-width="1"
        d="M5.5 7.5h13l-.9 12.2a1.8 1.8 0 0 1-1.8 1.6H8.2a1.8 1.8 0 0 1-1.8-1.6L5.5 7.5z"
      />
      <path stroke="#5a4328" stroke-width="1.1" stroke-linecap="round" d="M4 7.5h16" />
      <path stroke="#5a4328" stroke-width="1.1" stroke-linecap="round" d="M9.5 5.5h5" />
      <path stroke="#5a4328" stroke-width="0.9" stroke-linecap="round" d="M10 11v4.5M14 11v4.5" />
    </svg>
  )
}

function LocationGlyph({ id }: { id: FilesLocationId }) {
  if (isTrashLocationId(id)) return <TrashGlyph />
  if (isMountLocationId(id)) return <MountGlyph />
  if (id === 'applications') return <ApplicationsGlyph />
  if (id === 'models3d') return <ModelsGlyph />
  if (id === 'source') return <SourceGlyph />
  return <DeviceGlyph />
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** 一个文件夹一份滚动位置：钥匙 = 卷 + 文件夹 id（根目录为 undefined） */
function filesScrollKey(locationId: FilesLocationId, folderId: string | undefined): string {
  return `${locationId}\0${folderId ?? ''}`
}

export function FilesApp({ windowId }: { windowId?: string }) {
  const { windows, openApp, openGeneratedApp, activeWindowId } = useOs()
  const modal = useWindowModal()
  const { hostRef, narrowLayout, layoutReady } = useAppNarrowLayout()

  const appWindow = windowId
    ? windows.find((window) => window.id === windowId && !window.closing)
    : undefined
  const pendingDocumentId = appWindow?.documentId

  const [locationId, setLocationId] = useState<FilesLocationId>('local')
  const [locations, setLocations] = useState<readonly FilesLocation[]>([])
  const [locationBytes, setLocationBytes] = useState<Partial<Record<FilesLocationId, number>>>({})
  const [folderId, setFolderId] = useState<string | undefined>(undefined)
  const [pathNodes, setPathNodes] = useState<FilesNode[]>([])
  const [items, setItems] = useState<FilesNode[]>([])
  const [refreshing, setRefreshing] = useState(true)
  const [showLoadingCard, setShowLoadingCard] = useState(false)
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
  const [viewMode, setViewMode] = useState<FilesViewMode>(() => readFilesViewMode())
  const [sort, setSort] = useState<FilesSort>(() => readFilesSort())
  const [nameDisplayMode, setNameDisplayMode] = useState<FilesNameDisplayMode>(() =>
    readFilesNameDisplayMode(),
  )
  const [metaResolvedIds, setMetaResolvedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [selectNonce, setSelectNonce] = useState(0)
  const [pendingSelectName, setPendingSelectName] = useState<string | undefined>(undefined)
  /** 窄屏触屏多选模式：点按复选、工具栏「完成」退出 */
  const [selectionMode, setSelectionMode] = useState(false)
  /** 轻量提示（移入废纸篓等瞬时反馈） */
  const [toast, setToast] = useState<string | undefined>(undefined)
  const toastTimerRef = useRef<number | undefined>(undefined)
  /** Shift 区间选择的锚点 id */
  const selectionAnchorRef = useRef<string | undefined>(undefined)
  /** 框选进行中的矩形（相对 .files__browser 视口） */
  const [marqueeRect, setMarqueeRect] = useState<FilesMarqueeRect | undefined>(undefined)
  const marqueeStartRef = useRef<{ x: number; y: number; pointerId?: number } | undefined>(undefined)
  /** 拖放落点高亮：文件夹节点 id / 侧栏卷 id / 路径栏段 key */
  const [dropTarget, setDropTarget] = useState<{ kind: 'node'; id: string } | { kind: 'location'; id: FilesLocationId } | { kind: 'pathbar'; key: string } | undefined>(undefined)
  const [opProgressUi, setOpProgressUi] = useState<FilesOpProgressUiState | undefined>(undefined)
  const newFileButtonRef = useRef<HTMLButtonElement>(null)
  const browserRef = useRef<HTMLDivElement>(null)
  /** 按「卷 + 文件夹」记忆的滚动位置（仅本次打开期间） */
  const scrollByFolderRef = useRef(new Map<string, number>())
  /** 当前滚动容器正在展示的文件夹钥匙 */
  const scrollKeyRef = useRef(filesScrollKey('local', undefined))
  /** 换目录后待执行的滚动恢复：normal 恢复记忆，skip 留给选中项滚入 */
  const pendingScrollRestoreRef = useRef<
    | { key: string; mode: 'normal' | 'skip' }
    | undefined
  >(undefined)
  const applyScrollRestoreRef = useRef(false)
  /** 外部揭示等需要把目标项滚入视口的导航：不恢复旧记忆 */
  const skipScrollRestoreRef = useRef(false)
  const prevNarrowLayoutRef = useRef<boolean | undefined>(undefined)
  const suppressItemClickRef = useRef(false)
  const longPressTimerRef = useRef<number | undefined>(undefined)
  const longPressStartRef = useRef<{ x: number; y: number; node?: FilesNode } | undefined>(
    undefined,
  )
  const lastPointerTypeRef = useRef<string>('mouse')
  const actionSheetOpenedByLongPressRef = useRef(false)
  const refreshGenRef = useRef(0)
  const loadingShowDelayRef = useRef<number | undefined>(undefined)
  const loadingHideDelayRef = useRef<number | undefined>(undefined)
  const loadingCardShownAtRef = useRef<number | undefined>(undefined)
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
  /** 触屏多选模式（供 window 级 keydown 同步读取） */
  const selectionModeRef = useRef(false)
  selectionModeRef.current = selectionMode
  /** 窄屏首次滑入内容层时，等布局 transition 后再滚入选中项 */
  const pendingRevealLayoutRef = useRef(false)
  /** 右键菜单/触屏长按等操作手势触发的选区变化，跳过自动滚入（浮层已定位在鼠标处） */
  const suppressAutoScrollRef = useRef(false)

  // 换目录（含换卷、路径栏、符号链接）时：先拍下当前偏移，再为下一目录挂起恢复。
  // 此时列表仍是旧目录内容，布局 effect 早于被动 effect（refresh 的 setItems），偏移可信。
  // 加载中（refreshing）屏幕内容可能已不属于旧钥匙，跳过保存，交由 onScroll 兜底。
  useLayoutEffect(() => {
    const key = filesScrollKey(locationId, folderId)
    if (scrollKeyRef.current === key) {
      skipScrollRestoreRef.current = false
      return
    }
    const root = browserRef.current
    if (root && !refreshing) {
      scrollByFolderRef.current.set(scrollKeyRef.current, root.scrollTop)
    }
    scrollKeyRef.current = key
    const skip = skipScrollRestoreRef.current
    skipScrollRestoreRef.current = false
    pendingScrollRestoreRef.current = { key, mode: skip ? 'skip' : 'normal' }
  }, [locationId, folderId, refreshing])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
    selectionAnchorRef.current = undefined
    setPendingSelectName(undefined)
  }, [])

  /** 单选（清空后选中），并记录 Shift 区间锚点 */
  const activateSelection = useCallback((nodeId: string) => {
    setPendingSelectName(undefined)
    setSelectedIds(new Set([nodeId]))
    selectionAnchorRef.current = nodeId
    setSelectNonce((value) => value + 1)
  }, [])

  /** 切换选中（⌘/Ctrl 点击） */
  const toggleSelection = useCallback((nodeId: string) => {
    setPendingSelectName(undefined)
    setSelectedIds((current) => {
      const next = toggleInSet(current, nodeId)
      selectionAnchorRef.current = nodeId
      return next
    })
  }, [])

  /** Shift 区间选择：锚点（或最后操作项）到目标项之间的全部项 */
  const rangeSelectTo = useCallback((nodeId: string) => {
    setPendingSelectName(undefined)
    setSelectedIds((current) => {
      const anchor = selectionAnchorRef.current
      selectionAnchorRef.current = nodeId
      if (anchor === undefined || current.size === 0) {
        return new Set([nodeId])
      }
      const ordered = itemsRef.current.map((item) => item.id)
      return rangeSelection(ordered, anchor, nodeId)
    })
  }, [])

  const selectAll = useCallback(() => {
    const ids = itemsRef.current.map((item) => item.id)
    if (ids.length === 0) return
    selectionAnchorRef.current = ids[0]
    setPendingSelectName(undefined)
    setSelectedIds(new Set(ids))
  }, [])

  /** 选中项（按 items 顺序），供批量操作使用 */
  const selectedNodes = useMemo(
    () => items.filter((node) => selectedIds.has(node.id)),
    [items, selectedIds],
  )
  const selectedIdsRef = useRef<ReadonlySet<string>>(new Set())
  selectedIdsRef.current = selectedIds
  const firstSelectedId = selectedIds.size === 1 ? [...selectedIds][0] : undefined

  /** 进入触屏多选模式：清空现有选择，点按即复选 */
  const enterSelectionMode = useCallback(() => {
    setSelectedIds(new Set())
    selectionAnchorRef.current = undefined
    setPendingSelectName(undefined)
    setSelectionMode(true)
  }, [])

  /** 退出触屏多选模式并清空选择 */
  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false)
    clearSelection()
  }, [clearSelection])

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

  /** 按当前显示顺序在选中项间移动（方向键）；extend 时做区间扩展 */
  const moveSelectionBy = useCallback(
    (delta: number, extend: boolean) => {
      const ordered = itemsRef.current
      if (ordered.length === 0) return
      const current = [...selectedIdsRef.current]
      const lastId = current[current.length - 1]
      const currentIndex =
        lastId === undefined ? -1 : ordered.findIndex((item) => item.id === lastId)
      const nextIndex = Math.max(0, Math.min(ordered.length - 1, currentIndex + delta))
      const next = ordered[nextIndex]
      if (!next) return
      if (extend) {
        setPendingSelectName(undefined)
        setSelectedIds((prev) => {
          const anchor = selectionAnchorRef.current
          if (anchor === undefined) {
            selectionAnchorRef.current = lastId
          }
          const start = selectionAnchorRef.current ?? lastId
          const result = rangeSelection(
            ordered.map((item) => item.id),
            start,
            next.id,
          )
          // 区间外原选中项保留（与 Finder 方向键扩展一致）
          for (const id of prev) result.add(id)
          return result
        })
        return
      }
      activateSelection(next.id)
      scrollSelectedIntoView(next.id)
    },
    [activateSelection, scrollSelectedIntoView],
  )

  const locationLabel = getFilesLocationLabel(locationId)
  const locationWritable = isFilesLocationWritable(locationId)
  /** 整卷只读（如 3D 模型、系统）；与单个文件夹只读不同 */
  const isProtectedVolume = !locationWritable
  const currentFolder = pathNodes.length > 0 ? pathNodes[pathNodes.length - 1] : undefined
  const pathBarAbsolutePath = useMemo(() => {
    const root = filesLocationPathRoot(locationId)
    if (pathNodes.length === 0) return root
    return joinFilesAbsolutePath(root, ...pathNodes.map((node) => node.name))
  }, [locationId, pathNodes])
  const canCreateHere =
    locationWritable &&
    !isTrashLocationId(locationId) &&
    (locationId !== 'dev' || currentFolder !== undefined) &&
    (currentFolder === undefined || isFilesNodeWritable(currentFolder))
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

  const clearLoadingTimers = useCallback(() => {
    if (loadingShowDelayRef.current !== undefined) {
      window.clearTimeout(loadingShowDelayRef.current)
      loadingShowDelayRef.current = undefined
    }
    if (loadingHideDelayRef.current !== undefined) {
      window.clearTimeout(loadingHideDelayRef.current)
      loadingHideDelayRef.current = undefined
    }
  }, [])

  const beginRefreshingUi = useCallback(
    (gen: number) => {
      clearLoadingTimers()
      loadingCardShownAtRef.current = undefined
      setRefreshing(true)
      setShowLoadingCard(false)

      const revealCard = () => {
        if (gen !== refreshGenRef.current) return
        loadingCardShownAtRef.current = Date.now()
        setShowLoadingCard(true)
      }

      if (itemsRef.current.length === 0) {
        revealCard()
        return
      }

      loadingShowDelayRef.current = window.setTimeout(() => {
        loadingShowDelayRef.current = undefined
        revealCard()
      }, LOADING_SHOW_DELAY_MS)
    },
    [clearLoadingTimers],
  )

  const endRefreshingUi = useCallback(
    (gen: number) => {
      clearLoadingTimers()

      const finish = () => {
        if (gen !== refreshGenRef.current) return
        loadingCardShownAtRef.current = undefined
        setShowLoadingCard(false)
        setRefreshing(false)
      }

      const shownAt = loadingCardShownAtRef.current
      if (shownAt === undefined) {
        finish()
        return
      }

      const remaining = LOADING_MIN_VISIBLE_MS - (Date.now() - shownAt)
      if (remaining <= 0) {
        finish()
        return
      }

      loadingHideDelayRef.current = window.setTimeout(() => {
        loadingHideDelayRef.current = undefined
        finish()
      }, remaining)
    },
    [clearLoadingTimers],
  )

  const refresh = useCallback(async (options?: { quiet?: boolean }) => {
    // quiet 刷新不递增 gen，避免盖掉进行中的显式 refresh 导致加载卡片无法结束
    //（例如新建文件：create 触发 VFS 事件 debounce 与 await refresh() 并行）
    const gen = options?.quiet ? refreshGenRef.current : ++refreshGenRef.current
    const cachedListing = getCachedListDirectory(locationId, folderId)
    const showLoadingUi = !options?.quiet && cachedListing === undefined

    // 换目录后待恢复的滚动位置：等该目录的列表真正落地（setItems）再启用写回，
    // 避免恢复发生在加载占位或旧目录内容上
    const armScrollRestore = () => {
      const pending = pendingScrollRestoreRef.current
      if (!pending || pending.mode !== 'normal') return
      if (pending.key !== filesScrollKey(locationId, folderId)) return
      applyScrollRestoreRef.current = true
    }

    resetViewportMeta()
    if (cachedListing !== undefined) {
      setItems(sortNodeList(cachedListing, sort))
      armScrollRestore()
    }
    if (!options?.quiet) {
      if (showLoadingUi) {
        beginRefreshingUi(gen)
      } else {
        clearLoadingTimers()
        loadingCardShownAtRef.current = undefined
        setShowLoadingCard(false)
        setRefreshing(false)
      }
    }
    setError(undefined)
    try {
      if (locationId === 'dev') {
        await reconcileGithubRepoAttributes().catch(() => undefined)
      }
      if (locationId === 'applications') {
        await preloadAppBundleIcons()
      }
      const [listed, path] = await Promise.all([
        listDirectory(locationId, folderId),
        resolvePathNodes(locationId, folderId),
      ])
      if (gen !== refreshGenRef.current) return
      setItems(sortNodeList(listed, sort))
      armScrollRestore()
      setPathNodes(path)
    } catch (err) {
      if (gen !== refreshGenRef.current) return
      setError(formatError(err))
      setItems([])
      armScrollRestore()
      setPathNodes([])
    } finally {
      if (gen === refreshGenRef.current && showLoadingUi) endRefreshingUi(gen)
    }
  }, [beginRefreshingUi, clearLoadingTimers, endRefreshingUi, folderId, locationId, resetViewportMeta, sort])

  useEffect(() => () => clearLoadingTimers(), [clearLoadingTimers])

  const refreshLocations = useCallback(async () => {
    try {
      setLocations(await listFilesLocations())
    } catch {
      setLocations([])
    }
  }, [])

  const refreshLocationBytes = useCallback(async () => {
    try {
      const entries = await getFilesBytesByLocation(FILE_SIDEBAR_METRIC_LOCATIONS)
      const map: Partial<Record<FilesLocationId, number>> = {}
      for (const entry of entries) {
        map[entry.locationId] = entry.bytes
      }
      setLocationBytes(map)
    } catch {
      setLocationBytes({})
    }
  }, [])

  useEffect(() => {
    void refreshLocations()
  }, [refreshLocations])

  useEffect(() => {
    void refreshLocationBytes()
  }, [refreshLocationBytes])

  useEffect(() => {
    setItems((prev) => sortNodeList(prev, sort))
  }, [sort])

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

  // 换目录后、新目录列表落地时写回记忆的滚动位置（首次进入为顶部）。
  // 只在被 refresh 武装（armScrollRestore）后执行一次；同目录内的列表更新不重放。
  useLayoutEffect(() => {
    if (!applyScrollRestoreRef.current) return
    applyScrollRestoreRef.current = false
    const pending = pendingScrollRestoreRef.current
    pendingScrollRestoreRef.current = undefined
    if (!pending) return
    const root = browserRef.current
    if (!root) return
    root.scrollTop = scrollByFolderRef.current.get(pending.key) ?? 0
  }, [items, refreshing])

  const itemIdsKey = useMemo(() => items.map((item) => item.id).join('\0'), [items])

  useEffect(() => {
    if (refreshing) return
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
  }, [enqueueViewportMeta, itemIdsKey, refreshing, viewMode])

  const navigateToDocumentPath = useCallback(async (absolutePath: string) => {
    const applyBrowse = (
      nextLocationId: FilesLocationId,
      nextFolderId: string | undefined,
      revealItem = false,
    ) => {
      // 只有确实要换目录时才挂上「跳过恢复」标记（留给选中项滚入）；
      // 同目录揭示不产生恢复，避免标记残留到下一次真正的换目录
      const willChangeKey = filesScrollKey(nextLocationId, nextFolderId) !== scrollKeyRef.current
      skipScrollRestoreRef.current = willChangeKey && revealItem
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
      clearSelection()
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
        applyBrowse(parsed.locationId, undefined, selectName != null)
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
            applyBrowse(node.locationId, node.kind === 'folder' ? node.id : node.parentId, true)
            armSelectByName(selectName)
            return true
          }
          if (node.kind === 'folder') {
            clearSelection()
            applyBrowse(node.locationId, node.id)
          } else {
            // 揭示文件：优先把目标项滚入视口，不恢复该目录的旧记忆
            applyBrowse(node.locationId, node.parentId, true)
            activateSelection(node.id)
          }
          return true
        }
      } catch {
        // 挂载权限未就绪等：继续尝试父路径
      }

      if (parsed.segments.length <= 1) {
        applyBrowse(parsed.locationId, undefined, true)
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
    if (!pendingSelectName || refreshing) return
    const match = items.find((node) => node.name === pendingSelectName)
    if (!match) return
    setPendingSelectName(undefined)
    activateSelection(match.id)
  }, [activateSelection, items, pendingSelectName, refreshing])

  // 等目录切换动画 / 窄屏滑入结束后再滚入，避免 transform 过程中 scrollIntoView 无效
  useEffect(() => {
    // 右键菜单/触屏长按等操作手势触发的选区变化不自动滚入（浮层已定位在鼠标处，滚动会把目标 Item 移走）
    const suppressAutoScroll = suppressAutoScrollRef.current
    suppressAutoScrollRef.current = false
    if (suppressAutoScroll) return
    if (!firstSelectedId || refreshing) return
    if (!items.some((node) => node.id === firstSelectedId)) return

    let cancelled = false
    const timers: number[] = []
    const frames: number[] = []

    const queueScroll = (delayMs: number, clearLayoutWait = false) => {
      timers.push(
        window.setTimeout(() => {
          frames.push(
            window.requestAnimationFrame(() => {
              if (cancelled) return
              scrollSelectedIntoView(firstSelectedId)
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
  }, [folderMotion, items, refreshing, scrollSelectedIntoView, selectNonce, firstSelectedId])

  // 「在文件中显示」选中高亮约 2.5s 后淡出清除（手动多选不清除）
  useEffect(() => {
    if (!firstSelectedId) return
    const id = firstSelectedId
    const timer = window.setTimeout(() => {
      setSelectedIds((current) => {
        if (!current.has(id)) return current
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }, 2500)
    return () => window.clearTimeout(timer)
  }, [selectNonce, firstSelectedId])

  useEffect(() => {
    let trailingTimer: number | undefined
    let maxTimer: number | undefined
    const flush = () => {
      window.clearTimeout(trailingTimer)
      window.clearTimeout(maxTimer)
      trailingTimer = undefined
      maxTimer = undefined
      void refresh({ quiet: true })
      void refreshLocationBytes()
    }
    const onVfsChanged = () => {
      // 尾随 debounce：安静 80ms 后刷；连续风暴时至少每 300ms 刷一次
      window.clearTimeout(trailingTimer)
      trailingTimer = window.setTimeout(flush, 80)
      if (maxTimer === undefined) {
        maxTimer = window.setTimeout(flush, 300)
      }
    }
    const onDataStorageChanged = () => {
      void refreshLocationBytes()
    }
    window.addEventListener(FILES_VFS_CHANGED_EVENT, onVfsChanged)
    window.addEventListener(DATA_STORAGE_CHANGED_EVENT, onDataStorageChanged)
    return () => {
      window.clearTimeout(trailingTimer)
      window.clearTimeout(maxTimer)
      window.removeEventListener(FILES_VFS_CHANGED_EVENT, onVfsChanged)
      window.removeEventListener(DATA_STORAGE_CHANGED_EVENT, onDataStorageChanged)
    }
  }, [refresh, refreshLocationBytes])

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
      if (lastOpenedDocumentIdRef.current || selectedIds.size > 0) {
        pendingRevealLayoutRef.current = true
      }
      setStackedBrowserOpen(true)
      return
    }

    if (previous && !narrowLayout) {
      // 窄 → 宽：恢复并排，侧栏展开由 CSS 过渡
      setStackedBrowserOpen(false)
    }
  }, [layoutReady, narrowLayout, selectedIds])

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

  /** 轻量 toast：重置旧定时器，2.2s 后自动消失 */
  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current !== undefined) {
      window.clearTimeout(toastTimerRef.current)
      toastTimerRef.current = undefined
    }
    setToast(message)
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = undefined
      setToast(undefined)
    }, 2200)
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== undefined) {
        window.clearTimeout(toastTimerRef.current)
        toastTimerRef.current = undefined
      }
    }
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
    // 长按/触屏右键置位的点击抑制标记，可能在 ActionSheet 遮罩上落空而永远消费不掉
    // （松手时的 pointerup/click 命中遮罩，handleItemClick 不执行）。每次新指针手势
    // 开始前强制复位，避免吞掉后续的正常点击。长按自身在定时器回调里重新置位，不受影响。
    const resetSuppressItemClick = () => {
      suppressItemClickRef.current = false
    }
    window.addEventListener('pointerdown', resetSuppressItemClick, true)
    window.addEventListener('pointercancel', resetSuppressItemClick, true)
    return () => {
      window.removeEventListener('pointerdown', resetSuppressItemClick, true)
      window.removeEventListener('pointercancel', resetSuppressItemClick, true)
    }
  }, [])

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
      setSelectionMode(false)
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
      setSelectionMode(false)
      setFolderMotion('push')
      setFolderId(node.id)
    },
    [clearSelection, closeTransientMenus],
  )

  const openAppBundle = useCallback(
    (node: FilesNode) => {
      if (!isApplicationsBundleRootNode(node)) return
      closeTransientMenus()
      const bundlePath = parseApplicationsDirPath(node.id)
      void (async () => {
        try {
          const entry = bundlePath ? await resolveAppCatalogEntryByBundlePath(bundlePath) : undefined
          if (!entry) return
          if (entry.kind === 'generated') {
            openGeneratedApp(entry.id as GeneratedAppId, entry.name)
            return
          }
          openApp(entry.id)
        } catch (err) {
          await modal.alert({ title: '无法打开', message: formatError(err), themeColor: THEME })
        }
      })()
    },
    [closeTransientMenus, modal, openApp, openGeneratedApp],
  )

  const showAppBundleContents = useCallback(
    (node: FilesNode) => {
      if (!isApplicationsBundleRootNode(node)) return
      enterFolder(node)
    },
    [enterFolder],
  )

  const goBackInPath = useCallback(() => {
    if (pathNodes.length === 0) return
    setNewFileMenu(undefined)
    clearSelection()
    setSelectionMode(false)
    setFolderMotion('pop')
    const parent = pathNodes[pathNodes.length - 1]?.parentId
    setFolderId(parent)
  }, [clearSelection, pathNodes])

  const navigatePathBar = useCallback(
    (nextFolderId: string | undefined) => {
      closeTransientMenus()
      if (nextFolderId === folderId) return
      clearSelection()
      setSelectionMode(false)
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
      label: applicationsBundleDisplayName(node),
      folderId: node.id,
      current: index === pathNodes.length - 1,
    }))
    return [root, ...folders]
  }, [locationId, locationLabel, pathNodes])

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

  /** 打开/进入单个节点（不处理选择逻辑；Enter 与单击共用） */
  const openNode = useCallback(
    (node: FilesNode) => {
      if (node.kind === 'folder') {
        if (isApplicationsBundleRootNode(node)) {
          openAppBundle(node)
          return
        }
        enterFolder(node)
        return
      }
      if (node.kind === 'symlink') {
        void (async () => {
          try {
            const linkPath = await resolveFilesAbsolutePath(node)
            const target = await resolveNodeByAbsolutePath(linkPath, { follow: true })
            if (target?.kind === 'folder') {
              clearSelection()
              setFolderMotion('push')
              if (target.locationId !== locationId) {
                setLocationId(target.locationId)
              }
              setFolderId(target.id)
              return
            }
            if (target?.kind === 'file') {
              await openFile(target)
              return
            }
            await modal.alert({
              title: '无法打开',
              message: '符号链接目标无效或已断开',
              themeColor: THEME,
            })
          } catch (err) {
            await modal.alert({
              title: '无法打开',
              message: formatError(err),
              themeColor: THEME,
            })
          }
        })()
        return
      }
      void openFile(node)
    },
    [
      clearSelection,
      enterFolder,
      locationId,
      modal,
      openAppBundle,
      openFile,
    ],
  )

  const handleItemClick = useCallback(
    (node: FilesNode, event: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
      if (suppressItemClickRef.current) {
        suppressItemClickRef.current = false
        return
      }
      closeTransientMenus()

      // 触屏多选模式：点按复选，不打开
      if (selectionMode) {
        toggleSelection(node.id)
        return
      }

      const meta = event.metaKey || event.ctrlKey
      const shift = event.shiftKey

      if (meta) {
        toggleSelection(node.id)
        return
      }
      if (shift) {
        rangeSelectTo(node.id)
        return
      }

      openNode(node)
    },
    [closeTransientMenus, openNode, rangeSelectTo, selectionMode, toggleSelection],
  )

  /** 复制选中项（多选批量；mode=copy） */
  const handleCopy = useCallback(
    (nodes: readonly FilesNode[]) => {
      if (nodes.length === 0) return
      closeTransientMenus()
      setFilesClipboard({
        entries: nodes.map((node) => ({ nodeId: node.id, name: node.name, kind: node.kind })),
        mode: 'copy',
      })
      setClipboardRevision((value) => value + 1)
    },
    [closeTransientMenus],
  )

  /** 剪切选中项（mode=cut；粘贴成功后删除源） */
  const handleCut = useCallback(
    (nodes: readonly FilesNode[]) => {
      if (nodes.length === 0) return
      closeTransientMenus()
      setFilesClipboard({
        entries: nodes.map((node) => ({ nodeId: node.id, name: node.name, kind: node.kind })),
        mode: 'cut',
      })
      setClipboardRevision((value) => value + 1)
    },
    [closeTransientMenus],
  )

  const handlePaste = useCallback(async () => {
    const entry = getFilesClipboard()
    if (!entry) {
      // 无内部剪贴板：系统剪贴板中的外部文件浏览器无法读取（Chromium 限制，实测 types=[]），
      // 引导用户走拖放 / 导入
      if (canCreateHere) {
        await modal.alert({
          title: '没有可粘贴的内容',
          message:
            '系统剪贴板中的文件无法直接粘贴（浏览器限制）。请从 Finder 把文件拖入窗口，或使用工具栏「导入」。',
          themeColor: THEME,
        })
      }
      return
    }
    if (!canCreateHere) return
    closeTransientMenus()
    try {
      const workloads = await Promise.all(
        entry.entries.map((item) => estimateCopyWorkload(item.nodeId).catch(() => undefined)),
      )
      const totalUnits = workloads.reduce((sum, item) => sum + (item?.totalUnits ?? 1), 0)
      await runFilesOpWithProgress({
        kind: 'paste',
        totalWork: totalUnits,
        estimatedTotalMs: estimateFilesOpDurationMs(totalUnits),
        onUiChange: setOpProgressUi,
        task: async (report) => {
          let done = 0
          for (let index = 0; index < entry.entries.length; index += 1) {
            const item = entry.entries[index]!
            const itemWorkload = workloads[index]?.totalUnits ?? 1
            await copyNodeTo({
              sourceId: item.nodeId,
              destLocationId: locationId,
              destParentId: folderId,
              onProgress: (progress) => {
                report({
                  done: done + Math.round(progress.done * (itemWorkload / totalUnits)),
                  total: totalUnits,
                })
              },
            })
            done += itemWorkload
            if (entry.mode === 'cut') {
              // 剪切语义：粘贴成功后删除源；源已不存在（重复粘贴）时跳过
              await removeNode(item.nodeId).catch(() => undefined)
            }
          }
        },
      })
      await refresh()
    } catch (err) {
      await modal.alert({ title: '无法粘贴', message: formatError(err), themeColor: THEME })
    }
  }, [canCreateHere, closeTransientMenus, folderId, locationId, modal, refresh])

  /** 删除选中项：默认移入废纸篓；permanent（按住 ⌥）时永久删除 */
  const handleTrash = useCallback(
    async (nodes: readonly FilesNode[], permanent: boolean) => {
      if (nodes.length === 0) return
      closeTransientMenus()
      const single = nodes.length === 1 ? nodes[0]! : undefined
      if (permanent) {
        const ok = await modal.confirm({
          title: single ? `永久删除「${single.name}」？` : `永久删除选中的 ${nodes.length} 项？`,
          message:
            '永久删除后将无法恢复，且会释放占用的数据空间。',
          confirmLabel: '永久删除',
          cancelLabel: '取消',
          confirmTone: 'danger',
          themeColor: THEME,
        })
        if (!ok) return
        try {
          const workloads = await Promise.all(
            nodes.map((node) => estimateDeleteWorkload(node.id).catch(() => undefined)),
          )
          const totalUnits = workloads.reduce((sum, item) => sum + (item?.totalUnits ?? 1), 0)
          await runFilesOpWithProgress({
            kind: 'delete',
            totalWork: totalUnits,
            estimatedTotalMs: estimateFilesOpDurationMs(totalUnits),
            onUiChange: setOpProgressUi,
            task: async (report) => {
              let done = 0
              for (let index = 0; index < nodes.length; index += 1) {
                const node = nodes[index]!
                const units = workloads[index]?.totalUnits ?? 1
                await removeNode(node.id, {
                  onProgress: (progress) => {
                    report({ done: done + progress.done, total: totalUnits })
                  },
                })
                done += units
              }
            },
          })
        } catch (err) {
          await modal.alert({ title: '无法删除', message: formatError(err), themeColor: THEME })
        }
        clearSelection()
        await refresh()
        return
      }

      try {
        // 内部卷移入废纸篓为元数据级移动（成本≈删除）；挂载卷按复制估算
        const workloads = await Promise.all(
          nodes.map((node) =>
            isMountNodeId(node.id)
              ? estimateCopyWorkload(node.id).catch(() => undefined)
              : estimateDeleteWorkload(node.id).catch(() => undefined),
          ),
        )
        const totalUnits = workloads.reduce((sum, item) => sum + (item?.totalUnits ?? 1), 0)
        await runFilesOpWithProgress({
          kind: 'delete',
          totalWork: totalUnits,
          estimatedTotalMs: estimateFilesOpDurationMs(totalUnits),
          onUiChange: setOpProgressUi,
          task: async (report) => {
            let done = 0
            for (let index = 0; index < nodes.length; index += 1) {
              const node = nodes[index]!
              const units = workloads[index]?.totalUnits ?? 1
              await trashNode(node.id, {
                onProgress: (progress) => {
                  report({ done: done + progress.done, total: totalUnits })
                },
              })
              done += units
            }
          },
        })
      } catch (err) {
        await modal.alert({ title: '无法删除', message: formatError(err), themeColor: THEME })
      }
      showToast(nodes.length > 1 ? `已将 ${nodes.length} 项移入废纸篓` : '已移入废纸篓')
      clearSelection()
      await refresh()
    },
    [clearSelection, closeTransientMenus, modal, refresh, showToast],
  )

  /** 从废纸篓恢复选中项 */
  const handleRestore = useCallback(
    async (nodes: readonly FilesNode[]) => {
      if (nodes.length === 0) return
      closeTransientMenus()
      try {
        for (const node of nodes) {
          await restoreNode(node.id)
        }
      } catch (err) {
        await modal.alert({ title: '无法恢复', message: formatError(err), themeColor: THEME })
      }
      clearSelection()
      await refresh()
    },
    [clearSelection, closeTransientMenus, modal, refresh],
  )

  /** 刷新当前目录：失效 VFS 路径缓存后重读（挂载卷外部变更也能刷到） */
  const handleRefresh = useCallback(() => {
    closeTransientMenus()
    invalidateFilesVfsPathCaches()
    void refresh()
  }, [closeTransientMenus, refresh])

  /** 压缩选中项为 zip / tar.gz，写入当前目录 */
  const handleCompress = useCallback(
    async (nodes: readonly FilesNode[], format: FilesArchiveFormat) => {
      closeTransientMenus()
      await compressNodesToArchiveOp(nodes, format, {
        locationId,
        folderId,
        destRoot: pathBarAbsolutePath,
        canCreateHere,
        setOpProgressUi,
        refresh,
        showToast,
        alertError: async (title, error) => {
          await modal.alert({ title, message: formatError(error), themeColor: THEME })
        },
      })
    },
    [canCreateHere, closeTransientMenus, folderId, locationId, modal, pathBarAbsolutePath, refresh, showToast],
  )

  /** 解压归档到当前目录 */
  const handleExtract = useCallback(
    async (node: FilesNode) => {
      closeTransientMenus()
      await extractArchiveToDirectoryOp(node, {
        locationId,
        folderId,
        destRoot: pathBarAbsolutePath,
        canCreateHere,
        setOpProgressUi,
        refresh,
        showToast,
        alertError: async (title, error) => {
          await modal.alert({ title, message: formatError(error), themeColor: THEME })
        },
      })
    },
    [canCreateHere, closeTransientMenus, folderId, locationId, modal, pathBarAbsolutePath, refresh, showToast],
  )

  /** 暴露给右键菜单贡献方的归档操作能力 */
  const filesArchiveOps = useMemo(
    (): FilesContextMenuOps => ({
      canCreateHere,
      compressAsZip: (nodes) => void handleCompress(nodes, 'zip'),
      compressAsTarGz: (nodes) => void handleCompress(nodes, 'gzip-tar'),
      extractHere: (node) => void handleExtract(node),
      isArchiveFileName,
    }),
    [canCreateHere, handleCompress, handleExtract],
  )

  /** 清空废纸篓（永久删除全部内容） */
  const handleEmptyTrash = useCallback(async () => {
    if (!isTrashLocationId(locationId)) return
    closeTransientMenus()
    const ok = await modal.confirm({
      title: '清空废纸篓？',
      message: '废纸篓中的全部内容将被永久删除，无法恢复。',
      confirmLabel: '清空',
      cancelLabel: '取消',
      confirmTone: 'danger',
      themeColor: THEME,
    })
    if (!ok) return
    try {
      await runFilesOpWithProgress({
        kind: 'delete',
        totalWork: Math.max(1, itemsRef.current.length),
        estimatedTotalMs: estimateFilesOpDurationMs(Math.max(1, itemsRef.current.length)),
        onUiChange: setOpProgressUi,
        task: async (report) => {
          await emptyTrash({ onProgress: report })
        },
      })
    } catch (err) {
      await modal.alert({ title: '无法清空', message: formatError(err), themeColor: THEME })
    }
    clearSelection()
    await refresh()
  }, [clearSelection, closeTransientMenus, locationId, modal, refresh])

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
      if (!canRenameOrDeleteFilesNode(node)) return
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

  const handleShowInfo = useCallback(
    async (nodes: FilesNode[]) => {
      closeTransientMenus()
      try {
        if (nodes.some((node) => node.locationId === 'dev' && node.id !== '')) {
          await reconcileGithubRepoAttributes().catch(() => undefined)
        }
        const paths: string[] = []
        for (const node of nodes) {
          paths.push(await resolveFilesAbsolutePath(node))
        }
        openApp('file-info', { documentId: encodeInfoDocumentId(paths) })
      } catch (err) {
        await modal.alert({ title: '无法显示信息', message: formatError(err), themeColor: THEME })
      }
    },
    [closeTransientMenus, modal, openApp],
  )

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => {
      const next: FilesViewMode = prev === 'grid' ? 'list' : 'grid'
      writeFilesViewMode(next)
      return next
    })
  }, [])

  /** 列表列头排序：同列切换方向，跨列默认升序 */
  const handleSortColumn = useCallback((key: FilesSortKey) => {
    setSort((prev) => {
      const next: FilesSort =
        prev.key === key
          ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
          : { key, direction: 'asc' }
      writeFilesSort(next)
      return next
    })
  }, [])

  const handleShowCurrentFolderInfo = useCallback(async () => {
    closeTransientMenus()
    if (currentFolder) {
      await handleShowInfo([currentFolder])
      return
    }
    openApp('file-info', { documentId: encodeVolumeInfoDocumentId(locationId) })
  }, [closeTransientMenus, currentFolder, handleShowInfo, locationId, openApp])

  // ── 框选（鼠标/触控笔在空白处拖拽）─────────────────────────────────────
  const marqueeRectRef = useRef<FilesMarqueeRect | undefined>(undefined)

  const beginMarquee = useCallback((event: PointerEvent) => {
    if (event.pointerType === 'touch') return
    if (event.button !== 0) return
    if ((event.target as HTMLElement | undefined)?.closest?.('.files__item, .files__list-item'))
      return
    clearLongPress()
    // 指针捕获：鼠标移出容器后仍能收到 move/up，保证框选完整
    try {
      ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
    } catch {
      // 部分环境不支持捕获，忽略
    }
    const rect = {
      left: event.clientX,
      top: event.clientY,
      right: event.clientX,
      bottom: event.clientY,
    }
    marqueeStartRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
    marqueeRectRef.current = rect
    setMarqueeRect(rect)
  }, [clearLongPress])

  const updateMarquee = useCallback((event: PointerEvent) => {
    const start = marqueeStartRef.current
    if (!start) return
    const rect = {
      left: start.x,
      top: start.y,
      right: event.clientX,
      bottom: event.clientY,
    }
    marqueeRectRef.current = rect
    setMarqueeRect(rect)
  }, [])

  const endMarquee = useCallback(() => {
    const start = marqueeStartRef.current
    const rect = marqueeRectRef.current
    marqueeStartRef.current = undefined
    marqueeRectRef.current = undefined
    setMarqueeRect(undefined)
    const root = browserRef.current
    // 释放指针捕获：避免后续 click 被重定向到容器而吞掉（如列表列头排序按钮的 onClick）
    if (start?.pointerId !== undefined && root) {
      try {
        root.releasePointerCapture?.(start.pointerId)
      } catch {
        // 部分环境不支持或已释放，忽略
      }
    }
    if (!start || !rect) return
    if (!root) return
    const entries = itemsRef.current.flatMap((node) => {
      const el = root.querySelector<HTMLElement>(
        `[data-files-node-id="${CSS.escape(node.id)}"]`,
      )
      if (!el) return []
      const r = el.getBoundingClientRect()
      return [
        {
          id: node.id,
          rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        },
      ]
    })
    const selected = marqueeSelection(entries, rect)
    // 空白处单击 / 框选落空：清空现有选择（与 Finder 一致，避免只能按 Esc 退出选择）
    if (selected.length === 0) {
      clearSelection()
      return
    }
    selectionAnchorRef.current = selected[0]
    setPendingSelectName(undefined)
    setSelectedIds(new Set(selected))
  }, [clearSelection])

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
        // 长按进入选择态：未选中该项时先点亮（与 iOS Files 一致），菜单操作范围随之覆盖该项
        if (!selectedIdsRef.current.has(node.id)) {
          activateSelection(node.id)
        }
        openItemActionSheet(node)
      }, LONG_PRESS_MS)
    },
    [activateSelection, clearLongPress, openItemActionSheet],
  )

  const beginBackgroundLongPress = useCallback(
    (event: PointerEvent) => {
      lastPointerTypeRef.current = event.pointerType
      if (event.button !== 0) return
      // 排除文件项与列表列头：列头是排序按钮，按下不应进入框选，避免 setPointerCapture 吞掉其 click
      if (
        (event.target as HTMLElement | undefined)?.closest?.(
          '.files__item, .files__list-item, .files__list-header',
        )
      )
        return

      // 鼠标 / 触控笔：空白处按下进入框选；触屏保留长按 ActionSheet
      if (event.pointerType !== 'touch') {
        beginMarquee(event)
        return
      }

      clearLongPress()
      actionSheetOpenedByLongPressRef.current = false
      longPressStartRef.current = { x: event.clientX, y: event.clientY }
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = undefined
        longPressStartRef.current = undefined
        openBackgroundActionSheet()
      }, LONG_PRESS_MS)
    },
    [beginMarquee, clearLongPress, openBackgroundActionSheet],
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

  // ── 拖放（HTML5 DnD）─────────────────────────────────────────────────
  const DRAG_MIME = 'application/x-instant-files'

  const handleDragStart = useCallback(
    (event: DragEvent, node: FilesNode) => {
      // 拖起未选中项时先单选（同步更新 ref，dataTransfer 需立即拿到最新选择集）
      if (!selectedIdsRef.current.has(node.id)) {
        const next = new Set<string>([node.id])
        selectedIdsRef.current = next
        selectionAnchorRef.current = node.id
        setPendingSelectName(undefined)
        setSelectedIds(next)
      }
      const ids = [...selectedIdsRef.current]
      if (ids.length === 0) ids.push(node.id)
      event.dataTransfer?.setData(DRAG_MIME, JSON.stringify(ids))
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'copyMove'
      }
    },
    [],
  )

  /** 执行拖放：默认同卷移动、跨卷复制；按住 ⌥ 反转 */
  const dropFilesOnto = useCallback(
    async (
      event: DragEvent,
      dest: { destLocationId: FilesLocationId; destParentId: string | undefined },
    ) => {
      const raw = event.dataTransfer?.getData(DRAG_MIME)
      if (!raw) return
      let ids: string[]
      try {
        ids = JSON.parse(raw) as string[]
      } catch {
        return
      }
      if (ids.length === 0) return
      const copyMode = event.altKey
      try {
        await runFilesOpWithProgress({
          kind: 'paste',
          totalWork: ids.length,
          estimatedTotalMs: estimateFilesOpDurationMs(ids.length),
          onUiChange: setOpProgressUi,
          task: async (report) => {
            let done = 0
            for (const id of ids) {
              const node = await getNodeOrThrow(id).catch(() => undefined)
              if (!node) {
                done += 1
                report({ done, total: ids.length })
                continue
              }
              const shouldMove = !copyMode && node.locationId === dest.destLocationId
              if (shouldMove) {
                await moveNodeTo(id, dest.destLocationId, dest.destParentId)
              } else {
                await copyNodeTo({
                  sourceId: id,
                  destLocationId: dest.destLocationId,
                  destParentId: dest.destParentId,
                })
              }
              done += 1
              report({ done, total: ids.length })
            }
          },
        })
      } catch (err) {
        await modal.alert({ title: '无法移动', message: formatError(err), themeColor: THEME })
      }
      clearSelection()
      // 目标目录仍是当前目录（refresh 闭包 folderId 与目标一致）时才直接刷新；
      // 否则由 VFS 事件驱动用最新目录刷新，避免旧目录结果覆盖当前列表
      if (folderId === dest.destParentId) {
        await refresh()
      } else {
        invalidateFilesVfsPathCaches()
        window.dispatchEvent(new Event(FILES_VFS_CHANGED_EVENT))
      }
    },
    [clearSelection, folderId, modal, refresh],
  )

  /** 导入系统外部文件（拖放 / 选择器）：写入由公共 importExternalNodes 完成 */
  const handleExternalImport = useCallback(
    async (
      nodes: readonly ExternalImportNode[],
      dest: { destLocationId: FilesLocationId; destParentId: string | undefined },
    ) => {
      if (nodes.length === 0) return
      try {
        await importExternalNodes({ nodes, dest, onUiChange: setOpProgressUi })
        clearSelection()
        // 仅当导入目标仍是当前目录（refresh 闭包中的 folderId 与目标一致）时才直接刷新。
        // 若导入期间用户已导航到其他目录：直接刷新会用旧目录结果覆盖当前列表
        // （"点击文件夹后立刻跳回前一个目录"），此时改为触发 VFS 事件，
        // 由事件驱动的 debounce 用最新目录刷新。
        if (folderId === dest.destParentId) {
          await refresh()
        } else {
          invalidateFilesVfsPathCaches()
          window.dispatchEvent(new Event(FILES_VFS_CHANGED_EVENT))
        }
      } catch (err) {
        await modal.alert({ title: '无法导入', message: formatError(err), themeColor: THEME })
      }
    },
    [clearSelection, folderId, modal, refresh],
  )

  /** 外部文件是否进入导入流程（有文件但无内部拖拽数据） */
  const externalDropTargets = useCallback(
    (event: DragEvent, dest: { destLocationId: FilesLocationId; destParentId: string | undefined }) => {
      const internal = event.dataTransfer?.getData(DRAG_MIME)
      if (internal) {
        void dropFilesOnto(event, dest)
        return
      }
      if (event.dataTransfer?.files.length) {
        event.preventDefault()
        void collectDataTransferEntries(event.dataTransfer).then(
          (nodes) => {
            if (nodes.length > 0) {
              void handleExternalImport(nodes, dest)
            }
          },
          (err) => {
            void modal.alert({ title: '无法导入', message: formatError(err), themeColor: THEME })
          },
        )
      }
    },
    [dropFilesOnto, handleExternalImport, modal],
  )

  const [backgroundDropActive, setBackgroundDropActive] = useState(false)

  const handleBackgroundDragOver = useCallback((event: DragEvent) => {
    const hasFiles = (event.dataTransfer?.types ?? []).includes('Files')
    if (!hasFiles) return
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy'
    }
    setBackgroundDropActive(true)
    // 指针离开列表项进入空白：熄灭残留的落点高亮，让高亮严格跟随指针
    setDropTarget(undefined)
  }, [])

  const handleBackgroundDragLeave = useCallback((event: DragEvent) => {
    // 子元素间移动触发的 dragleave 冒泡：relatedTarget 仍在容器内则忽略
    const related = event.relatedTarget
    if (related instanceof Node && browserRef.current?.contains(related)) return
    setBackgroundDropActive(false)
  }, [])

  const handleBackgroundDrop = useCallback(
    (event: DragEvent) => {
      setBackgroundDropActive(false)
      // 无论是否外部文件都阻止默认行为，避免浏览器打开/导航被 drop 的文件
      event.preventDefault()
      if (!event.dataTransfer?.files.length) return
      void collectDataTransferEntries(event.dataTransfer).then(
        (nodes) => {
          if (nodes.length > 0) {
            void handleExternalImport(nodes, {
              destLocationId: locationId,
              destParentId: folderId,
            })
          }
        },
        (err) => {
          void modal.alert({ title: '无法导入', message: formatError(err), themeColor: THEME })
        },
      )
    },
    [folderId, handleExternalImport, locationId, modal],
  )

  // 全局兜底：外部文件拖到未绑定拖放处理的区域（窗口边框/侧栏空白/菜单栏等）时，
  // 仍接受 dragover 并导入到当前目录。否则该区域的 drop 会被浏览器取消
  // ——"拖入后立刻松开"时如果指针停在未处理区域，文件就会悄悄丢在窗口外。
  useEffect(() => {
    const onDocumentDragOver = (event: DragEvent) => {
      if (event.defaultPrevented) return
      if (!(event.dataTransfer?.types ?? []).includes('Files')) return
      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy'
      }
    }
    const onDocumentDrop = (event: DragEvent) => {
      if (event.defaultPrevented) return
      if (!event.dataTransfer?.files.length) return
      event.preventDefault()
      void collectDataTransferEntries(event.dataTransfer).then(
        (nodes) => {
          if (nodes.length > 0) {
            void handleExternalImport(nodes, {
              destLocationId: locationId,
              destParentId: folderId,
            })
          }
        },
        (err) => {
          void modal.alert({ title: '无法导入', message: formatError(err), themeColor: THEME })
        },
      )
    }
    document.addEventListener('dragover', onDocumentDragOver)
    document.addEventListener('drop', onDocumentDrop)
    return () => {
      document.removeEventListener('dragover', onDocumentDragOver)
      document.removeEventListener('drop', onDocumentDrop)
    }
  }, [folderId, handleExternalImport, locationId, modal])

  const importInputRef = useRef<HTMLInputElement>(null)

  /** 打开系统文件选择器（input[type=file] multiple，全浏览器可用） */
  const openSystemFilePicker = useCallback(() => {
    importInputRef.current?.click()
  }, [])

  const handleImportInputChange = useCallback(
    (event: JSX.TargetedEvent<HTMLInputElement>) => {
      const files = [...(event.currentTarget.files ?? [])]
      event.currentTarget.value = ''
      if (files.length === 0) return
      void handleExternalImport(
        files.map((file) => ({ name: file.name, kind: 'file' as const, file })),
        { destLocationId: locationId, destParentId: folderId },
      )
    },
    [folderId, handleExternalImport, locationId],
  )

  const handleFolderDragOver = useCallback(
    (event: DragEvent, node: FilesNode) => {
      event.preventDefault()
      if (node.kind !== 'folder') {
        // 文件项不是有效落点；preventDefault 仍阻止外部拖放触发浏览器默认打开/导航
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'none'
        }
        return
      }
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move'
      }
      // 函数式更新：dropTarget 未变化时返回原引用，避免 dragover 高频触发渲染风暴
      setDropTarget((prev) =>
        prev?.kind === 'node' && prev.id === node.id ? prev : { kind: 'node', id: node.id },
      )
    },
    [],
  )

  const handleFolderDragLeave = useCallback(
    (event: DragEvent, node: FilesNode) => {
      // 指针仍在 item 子元素间移动时触发的 dragleave：忽略，避免高亮闪烁
      const related = event.relatedTarget
      const current = event.currentTarget as HTMLElement | null
      if (related instanceof Node && current?.contains(related)) return
      setDropTarget((state) =>
        state?.kind === 'node' && state.id === node.id ? undefined : state,
      )
    },
    [],
  )

  const handleFolderDrop = useCallback(
    (event: DragEvent, node: FilesNode) => {
      event.preventDefault()
      setDropTarget(undefined)
      if (node.kind === 'folder') {
        externalDropTargets(event, { destLocationId: node.locationId, destParentId: node.id })
        return
      }
      // 文件项：内部拖拽忽略；外部文件导入到该文件所在目录
      if (event.dataTransfer?.getData(DRAG_MIME)) return
      if (event.dataTransfer?.files.length) {
        void collectDataTransferEntries(event.dataTransfer).then(
          (nodes) => {
            if (nodes.length > 0) {
              void handleExternalImport(nodes, {
                destLocationId: node.locationId,
                destParentId: node.parentId,
              })
            }
          },
          (err) => {
            void modal.alert({ title: '无法导入', message: formatError(err), themeColor: THEME })
          },
        )
      }
    },
    [externalDropTargets, handleExternalImport, modal],
  )

  const handleLocationDragOver = useCallback(
    (event: DragEvent, location: FilesLocation) => {
      event.preventDefault()
      if (!location.writable || isTrashLocationId(location.id)) {
        // 只读/废纸篓卷不是有效落点：禁止光标，同时避免浏览器默认打开文件
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'none'
        }
        return
      }
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move'
      }
      // 函数式更新：dropTarget 未变化时返回原引用，避免 dragover 高频触发渲染风暴
      setDropTarget((prev) =>
        prev?.kind === 'location' && prev.id === location.id
          ? prev
          : { kind: 'location', id: location.id },
      )
    },
    [],
  )

  const handleLocationDragLeave = useCallback(
    (event: DragEvent, location: FilesLocation) => {
      const related = event.relatedTarget
      const current = event.currentTarget as HTMLElement | null
      if (related instanceof Node && current?.contains(related)) return
      setDropTarget((state) =>
        state?.kind === 'location' && state.id === location.id ? undefined : state,
      )
    },
    [],
  )

  const handleLocationDrop = useCallback(
    (event: DragEvent, location: FilesLocation) => {
      event.preventDefault()
      setDropTarget(undefined)
      if (!location.writable || isTrashLocationId(location.id)) return
      externalDropTargets(event, { destLocationId: location.id, destParentId: undefined })
    },
    [externalDropTargets],
  )

  // ── 键盘快捷键（仅当前窗口激活时生效）─────────────────────────────────
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (windowId && activeWindowId !== appWindow?.id) return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      const meta = event.metaKey || event.ctrlKey
      const alt = event.altKey
      const key = event.key

      if (meta && key.toLowerCase() === 'a') {
        event.preventDefault()
        selectAll()
        return
      }
      if (meta && key.toLowerCase() === 'c') {
        event.preventDefault()
        if (selectedNodes.length > 0) handleCopy(selectedNodes)
        return
      }
      if (meta && key.toLowerCase() === 'x') {
        event.preventDefault()
        if (selectedNodes.length > 0) handleCut(selectedNodes)
        return
      }
      if (meta && key.toLowerCase() === 'v') {
        event.preventDefault()
        void handlePaste()
        return
      }
      if (meta && key === 'ArrowUp') {
        event.preventDefault()
        goBackInPath()
        return
      }
      if (meta && key.toLowerCase() === 'r') {
        event.preventDefault()
        handleRefresh()
        return
      }
      if (key === 'Delete' || (meta && key === 'Backspace')) {
        event.preventDefault()
        const nodes = selectedNodes
        if (nodes.length > 0) void handleTrash(nodes, alt)
        return
      }
      if (key === 'Enter') {
        // 焦点在文件项按钮上时，原生 click 已处理打开，避免双重触发
        const active = document.activeElement as HTMLElement | null
        if (active?.closest?.('[data-files-node-id]')) return
        event.preventDefault()
        const first = itemsRef.current.find((node) => selectedIdsRef.current.has(node.id))
        if (first) openNode(first)
        return
      }
      if (key === 'F2') {
        event.preventDefault()
        const first = selectedNodes[0]
        if (first && selectedNodes.length === 1) void handleRename(first)
        return
      }
      if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
        const delta = key === 'ArrowDown' || key === 'ArrowRight' ? 1 : -1
        moveSelectionBy(delta, event.shiftKey)
        event.preventDefault()
        return
      }
      if (key === 'Home') {
        event.preventDefault()
        const first = itemsRef.current[0]
        if (first) {
          activateSelection(first.id)
          scrollSelectedIntoView(first.id)
        }
        return
      }
      if (key === 'End') {
        event.preventDefault()
        const last = itemsRef.current[itemsRef.current.length - 1]
        if (last) {
          activateSelection(last.id)
          scrollSelectedIntoView(last.id)
        }
        return
      }
      if (key === ' ') {
        event.preventDefault()
        const ordered = itemsRef.current
        const current = [...selectedIdsRef.current]
        const lastId = current[current.length - 1]
        const target =
          lastId ??
          selectionAnchorRef.current ??
          ordered[0]?.id
        if (target !== undefined) toggleSelection(target)
        return
      }
      if (key === 'Escape' && (selectedIdsRef.current.size > 0 || selectionModeRef.current)) {
        if (selectionModeRef.current) {
          setSelectionMode(false)
        }
        clearSelection()
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    activeWindowId,
    appWindow?.id,
    activateSelection,
    clearSelection,
    goBackInPath,
    handleCopy,
    handleCut,
    handlePaste,
    handleRefresh,
    handleRename,
    handleTrash,
    moveSelectionBy,
    openNode,
    scrollSelectedIntoView,
    selectAll,
    selectedNodes,
    toggleSelection,
    windowId,
  ])

  /** 选中项失效清理：目录刷新后剔除不存在的 id */
  useEffect(() => {
    if (selectedIds.size === 0) return
    const valid = new Set(items.map((node) => node.id))
    const stale = [...selectedIds].filter((id) => !valid.has(id))
    if (stale.length === 0) return
    setSelectedIds((current) => {
      const next = new Set(current)
      for (const id of stale) next.delete(id)
      return next
    })
    if (selectionAnchorRef.current !== undefined && !valid.has(selectionAnchorRef.current)) {
      selectionAnchorRef.current = undefined
    }
  }, [items, selectedIds])

  const buildItemMenuActions = useCallback(
    (node: FilesNode): AdaptiveActionMenuItem[] => {
      const items: AdaptiveActionMenuItem[] = []
      const isTrashVolume = isTrashLocationId(locationId)
      // 右键目标若不在选中集，则操作范围退化为该节点
      const targetNodes = selectedIdsRef.current.has(node.id) ? selectedNodes : [node]
      const multi = targetNodes.length > 1
      const countLabel = (action: string) => (multi ? `${action} ${targetNodes.length} 项` : action)

      if (isTrashVolume) {
        items.push({
          type: 'action',
          label: '恢复',
          onClick: () => void handleRestore(targetNodes),
        })
        items.push({ type: 'separator' })
        items.push({
          type: 'action',
          label: multi ? `显示 ${targetNodes.length} 项的信息` : '显示信息',
          onClick: () => void handleShowInfo(targetNodes),
        })
        return items
      }

      if (isApplicationsBundleRootNode(node)) {
        items.push({
          type: 'action',
          label: '打开',
          onClick: () => openAppBundle(node),
        })
        items.push({
          type: 'action',
          label: '显示包内容',
          onClick: () => showAppBundleContents(node),
        })
        items.push({ type: 'separator' })
      } else if (node.kind === 'file' && !multi) {
        items.push({
          type: 'action',
          label: '打开方式…',
          onClick: () => void showOpenWithChooser(node),
        })
      }
      items.push({
        type: 'action',
        label: countLabel('复制'),
        onClick: () => handleCopy(targetNodes),
      })
      if (canRenameOrDeleteFilesNode(node)) {
        items.push({
          type: 'action',
          label: countLabel('剪切'),
          onClick: () => handleCut(targetNodes),
        })
      }
      if (canPasteHere) {
        items.push({
          type: 'action',
          label: '粘贴',
          onClick: () => void handlePaste(),
        })
      }
      if (canRenameOrDeleteFilesNode(node)) {
        items.push({ type: 'separator' })
        if (!multi) {
          items.push({
            type: 'action',
            label: '重新命名',
            onClick: () => void handleRename(node),
          })
        }
        items.push({
          type: 'action',
          label: countLabel('移入废纸篓'),
          onClick: () => void handleTrash(targetNodes, false),
        })
      }
      for (const contribution of listFilesContextMenuContributions({ node, canCreateHere })) {
        const submenuItems = contribution.buildItems({ node, targetNodes, ops: filesArchiveOps })
        if (submenuItems.length === 0) continue
        items.push({ type: 'separator' })
        items.push({
          type: 'submenu',
          label: contribution.label,
          items: submenuItems.map((subItem) => ({
            type: 'action' as const,
            label: subItem.label,
            disabled: subItem.disabled,
            onClick: subItem.onClick,
          })),
        })
      }
      items.push({ type: 'separator' })
      items.push({
        type: 'action',
        label: multi ? `显示 ${targetNodes.length} 项的信息` : '显示信息',
        onClick: () => void handleShowInfo(targetNodes),
      })
      return items
    },
    [
      canCreateHere,
      canPasteHere,
      filesArchiveOps,
      handleCopy,
      handleCut,
      handlePaste,
      handleRename,
      handleRestore,
      handleShowInfo,
      handleTrash,
      locationId,
      openAppBundle,
      selectedNodes,
      showAppBundleContents,
      showOpenWithChooser,
    ],
  )

  const backgroundMenuItems = useMemo((): AdaptiveActionMenuItem[] => {
    const items: AdaptiveActionMenuItem[] = []
    // 排序项直接平铺在菜单顶部：当前项带 ✓ 与方向箭头，点击即切换（Finder 风格）
    items.push(...buildSortMenuItems(sort, (key) => handleSortColumn(key)))
    items.push({ type: 'separator' })
    if (isTrashLocationId(locationId)) {
      items.push({
        type: 'action',
        label: '刷新',
        onClick: () => void handleRefresh(),
      })
      items.push({ type: 'separator' })
      items.push({
        type: 'action',
        label: '清空废纸篓',
        onClick: () => void handleEmptyTrash(),
      })
      items.push({
        type: 'action',
        label: '显示信息',
        onClick: () => void handleShowCurrentFolderInfo(),
      })
      return items
    }
    if (canCreateHere) {
      items.push({
        type: 'action',
        label: '新建文件夹',
        onClick: () => void handleNewFolder(),
      })
      items.push({
        type: 'action',
        label: '从本机导入…',
        onClick: openSystemFilePicker,
      })
    }
    items.push({
      type: 'action',
      label: '刷新',
      onClick: () => void handleRefresh(),
    })
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
    handleEmptyTrash,
    handleNewFolder,
    handlePaste,
    handleRefresh,
    handleShowCurrentFolderInfo,
    handleSortColumn,
    locationId,
    openSystemFilePicker,
    sort,
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
    const canMutate = canCreateHere
    const atContainerRoot = pathNodes.length === 0

    return [
      {
        label: '文件',
        items: [
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
            label: '全选',
            shortcut: '⌘A',
            onClick: () => selectAll(),
          },
          {
            type: 'action',
            label: '复制',
            shortcut: '⌘C',
            disabled: selectedNodes.length === 0,
            onClick: () => handleCopy(selectedNodes),
          },
          {
            type: 'action',
            label: '剪切',
            shortcut: '⌘X',
            disabled: selectedNodes.length === 0 || !canMutate,
            onClick: () => handleCut(selectedNodes),
          },
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
            label: isTrashLocationId(locationId) ? '清空废纸篓' : '移入废纸篓',
            shortcut: '⌘⌫',
            disabled: isTrashLocationId(locationId)
              ? itemsRef.current.length === 0
              : selectedNodes.length === 0 || !canMutate,
            onClick: () => {
              if (isTrashLocationId(locationId)) {
                void handleEmptyTrash()
              } else {
                void handleTrash(selectedNodes, false)
              }
            },
          },
        ],
      },
      {
        label: '显示',
        items: FILES_NAME_DISPLAY_OPTIONS.map((option) => ({
          type: 'action' as const,
          label: `${menuCheckPrefix(nameDisplayMode === option.id)}${option.label}`,
          onClick: () => {
            setNameDisplayMode(option.id)
            writeFilesNameDisplayMode(option.id)
          },
        })),
      },
      {
        label: '前往',
        items: [
          {
            type: 'action',
            label: '刷新',
            shortcut: '⌘R',
            onClick: () => void handleRefresh(),
          },
          {
            type: 'action',
            label: '返回上级',
            disabled: !canGoBackInPath,
            onClick: () => goBackInPath(),
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
    goBackInPath,
    handleCut,
    handleCopy,
    handleEmptyTrash,
    handleNewFolder,
    handlePaste,
    handleRefresh,
    handleTrash,
    locationId,
    locations,
    nameDisplayMode,
    navigatePathBar,
    openNewFileMenu,
    pathNodes.length,
    selectAll,
    selectLocation,
    selectedNodes,
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
              const isDropTarget = dropTarget?.kind === 'location' && dropTarget.id === location.id
              const itemClass = `files__sidebar-item${active ? ' files__sidebar-item--active' : ''}${mountId ? ' files__sidebar-item--mount' : ''}${isDropTarget ? ' files__sidebar-item--drop-target' : ''}`
              const locationBytesForId = locationBytes[location.id]
              const locationContent = (
                <>
                  <span class="files__sidebar-icon">
                    <LocationGlyph id={location.id} />
                  </span>
                  <span class="files__sidebar-copy">
                    <span class="files__sidebar-label">{location.label}</span>
                    {locationBytesForId !== undefined ? (
                      <span class="files__sidebar-size">
                        已用 {formatStorageSize(locationBytesForId)}
                      </span>
                    ) : undefined}
                  </span>
                </>
              )
              const locationDragHandlers = {
                onDragOver: (event: DragEvent) => handleLocationDragOver(event, location),
                onDragLeave: (event: DragEvent) => handleLocationDragLeave(event, location),
                onDrop: (event: DragEvent) => handleLocationDrop(event, location),
              }
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
                        {...locationDragHandlers}
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
                      {...locationDragHandlers}
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
          {selectedIds.size > 0 ? (
            <button
              type="button"
              class="files__toolbar-title files__toolbar-title-btn"
              title="清除选择 (Esc)"
              onClick={clearSelection}
            >
              已选 {selectedIds.size} 项 ✕
            </button>
          ) : (
            <h1 class="files__toolbar-title">{currentTitle}</h1>
          )}
          <div class="files__toolbar-right">
            {narrowLayout ? (
              <button
                type="button"
                class="files__toolbar-btn"
                onClick={selectionMode ? exitSelectionMode : enterSelectionMode}
              >
                {selectionMode ? '完成' : '选择'}
              </button>
            ) : undefined}
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
            <input
              ref={importInputRef}
              type="file"
              multiple
              class="files__import-input"
              onChange={handleImportInputChange}
              aria-hidden="true"
              tabIndex={-1}
            />
          </div>
        </header>

        {!isProtectedVolume ? undefined : (
          <div class="files__protected-banner" role="status">
            此容器受保护不可修改
          </div>
        )}
        {!isProtectedVolume && isMountLocationId(locationId) ? (
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
            backgroundDropActive ? 'files__browser--drop-active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          tabIndex={0}
          onScroll={() => {
            const root = browserRef.current
            if (root) scrollByFolderRef.current.set(scrollKeyRef.current, root.scrollTop)
          }}
          onAnimationEnd={(event) => {
            if (event.currentTarget !== event.target) return
            setFolderMotion('idle')
          }}
          onPointerDown={beginBackgroundLongPress}
          onPointerMove={(event) => {
            handleLongPressMove(event)
            updateMarquee(event)
          }}
          onPointerUp={() => {
            clearLongPress()
            endMarquee()
          }}
          onPointerCancel={() => {
            clearLongPress()
            endMarquee()
          }}
          onDragOver={handleBackgroundDragOver}
          onDragLeave={handleBackgroundDragLeave}
          onDrop={handleBackgroundDrop}
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
          {showLoadingCard ? (
            <div class="files__empty">正在加载…</div>
          ) : items.length === 0 ? (
            <div class="files__empty">
              <p class="files__empty-title">
                {isTrashLocationId(locationId) ? '废纸篓为空' : '此文件夹为空'}
              </p>
              <p class="files__empty-text">
                {isTrashLocationId(locationId)
                  ? '删除的文件会移入这里，可恢复或清空。'
                  : canCreateHere
                    ? '可新建文件夹，或新建文本文件。'
                    : '此位置为系统资源，仅供浏览。'}
              </p>
            </div>
          ) : (
            <>
              {viewMode === 'list' ? (
                <div class="files__list-header" role="row">
                  <span class="files__list-header-icon" aria-hidden="true" />
                  <button
                    type="button"
                    class="files__list-header-btn"
                    aria-sort={sort.key === 'name' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                    onClick={() => handleSortColumn('name')}
                  >
                    名称{sort.key === 'name' ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                  <button
                    type="button"
                    class="files__list-header-btn files__list-header-btn--size"
                    aria-sort={sort.key === 'size' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                    onClick={() => handleSortColumn('size')}
                  >
                    大小{sort.key === 'size' ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                  <button
                    type="button"
                    class="files__list-header-btn files__list-header-btn--date"
                    aria-sort={sort.key === 'date' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                    onClick={() => handleSortColumn('date')}
                  >
                    修改日期{sort.key === 'date' ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </div>
              ) : undefined}
              <ul class={viewMode === 'list' ? 'files__list' : 'files__grid'}>
                {items.map((node) => {
                  const selected = selectedIds.has(node.id)
                  const isDropTarget = dropTarget?.kind === 'node' && dropTarget.id === node.id
                  const itemClass =
                    viewMode === 'list'
                      ? `files__list-item${selected ? ' files__list-item--selected' : ''}${isDropTarget ? ' files__list-item--drop-target' : ''}`
                      : `files__item${selected ? ' files__item--selected' : ''}${isDropTarget ? ' files__item--drop-target' : ''}`
                  return (
                    <li key={node.id}>
                    <button
                      type="button"
                      class={itemClass}
                      data-files-node-id={node.id}
                      aria-selected={selected}
                      draggable={!isTrashLocationId(locationId) && !selectionMode}
                      onClick={(event) => handleItemClick(node, event)}
                      onDragStart={(event) => handleDragStart(event, node)}
                      onDragOver={(event) => handleFolderDragOver(event, node)}
                      onDragLeave={(event) => handleFolderDragLeave(event, node)}
                      onDrop={(event) => handleFolderDrop(event, node)}
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
                        // 右键未选中项时先单选（保持多选时右键全集操作）
                        if (!selectedIdsRef.current.has(node.id)) {
                          // 操作手势触发的选区变化不自动滚入，避免菜单弹出瞬间列表滚动导致被 scroll-close 关闭
                          suppressAutoScrollRef.current = true
                          activateSelection(node.id)
                        }
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
                            <span class="files__list-name">
                              {formatFilesDisplayName(
                                applicationsBundleDisplayName(node),
                                nameDisplayMode,
                              )}
                            </span>
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
                          <span class="files__item-name">
                            {formatFilesDisplayName(
                            applicationsBundleDisplayName(node),
                            nameDisplayMode,
                          )}
                          </span>
                        </>
                      )}
                    </button>
                  </li>
                  )
                })}
              </ul>
            </>
          )}
          {marqueeRect ? (
            <div
              class="files__marquee"
              style={{
                left: `${Math.min(marqueeRect.left, marqueeRect.right)}px`,
                top: `${Math.min(marqueeRect.top, marqueeRect.bottom)}px`,
                width: `${Math.abs(marqueeRect.right - marqueeRect.left)}px`,
                height: `${Math.abs(marqueeRect.bottom - marqueeRect.top)}px`,
              }}
            />
          ) : undefined}
        </div>

        <FilesPathBar
          segments={pathBarSegments}
          absolutePath={pathBarAbsolutePath}
          onNavigate={navigatePathBar}
        />

        {toast ? (
          <div class="files__toast" role="status">
            {toast}
          </div>
        ) : undefined}
      </section>

      {contextMenu ? (
        <FilesContextMenu x={contextMenu.x} y={contextMenu.y}>
          {buildItemMenuActions(contextMenu.node).map((item, index) => {
            if (item.type === 'separator') return undefined
            if (item.type === 'submenu') {
              return (
                <FilesContextSubmenu
                  key={`sub-${item.label}`}
                  item={item}
                  onClose={() => setContextMenu(undefined)}
                />
              )
            }
            return (
              <button
                key={`${item.label}-${index}`}
                type="button"
                class="files__context-item"
                disabled={item.disabled}
                onClick={() => {
                  item.onClick()
                  setContextMenu(undefined)
                }}
              >
                {item.label}
              </button>
            )
          })}
        </FilesContextMenu>
      ) : undefined}

      {backgroundContextMenu ? (
        <FilesContextMenu x={backgroundContextMenu.x} y={backgroundContextMenu.y}>
          {backgroundMenuItems.map((item, index) => {
            if (item.type === 'separator') return undefined
            if (item.type === 'submenu') {
              return (
                <FilesContextSubmenu
                  key={`sub-${item.label}`}
                  item={item}
                  onClose={() => setBackgroundContextMenu(undefined)}
                />
              )
            }
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
        </FilesContextMenu>
      ) : undefined}

      {locationContextMenu ? (
        <FilesContextMenu x={locationContextMenu.x} y={locationContextMenu.y}>
          <button
            type="button"
            class="files__context-item"
            onClick={() =>
              void handleUnmount(locationContextMenu.locationId, locationContextMenu.label)
            }
          >
            推出
          </button>
        </FilesContextMenu>
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
        <FilesContextMenu
          x={newFileMenu.x}
          y={newFileMenu.y}
          className="files__popover"
          role="menu"
          style={{ ['--files-popover-arrow-x' as string]: `${newFileMenu.arrowX}px` }}
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
        </FilesContextMenu>
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
