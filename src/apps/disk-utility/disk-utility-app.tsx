import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import { useOs } from '../../os/os-context.tsx'
import { useAppNarrowLayout } from '../../ui/use-app-narrow-layout.ts'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { IosButton } from '../../ui/ios-button.tsx'
import { formatStorageSize } from '../../os/format-storage-size.ts'
import { KeychainNavStack, useKeychainNavStack } from '../keychain/keychain-nav-stack.tsx'
import { requestFilesReveal } from '../files/files-reveal-request.ts'
import { FILES_MOUNTS_CHANGED_EVENT } from '../files/files-mount-store.ts'
import { FILES_IMAGE_MOUNTS_CHANGED_EVENT } from '../files/files-image-mount-store.ts'
import { DATA_STORAGE_CHANGED_EVENT } from '../../os/device-data-storage.ts'
import {
  DEVICE_CAPACITY_BYTES,
  loadDiskTree,
  loadBrowserStorageSnapshot,
  requestBrowserPersistence,
  type TreeNode,
  type BrowserStorageSnapshot,
} from './disk-utility-data.ts'
import '../../ui/ios-nav-back.css'
import '../settings/settings.css'
import '../keychain/keychain.css'
import './disk-utility.css'

const APP_ID = 'disk-utility' as const
const DETAIL_REFRESH_DEBOUNCE_MS = 400

type DiskUtilityScreen = 'list' | 'detail'

/* ─── 工具函数 ─── */

function usagePercent(used: number, total: number): number {
  if (!total || !Number.isFinite(total)) return 0
  return Math.min(100, (used / total) * 100)
}

function formatBytes(value: number | undefined): string {
  return value === undefined ? '—' : formatStorageSize(value)
}

function occupancyLabel(occupancy: TreeNode['occupancy']): string {
  if (!occupancy || occupancy.kind === 'free') return '空闲'
  if (occupancy.kind === 'files-mount') return `文件已挂载（${occupancy.volumeId}）`
  return `虚拟机正在使用（${occupancy.vmId}）`
}

/* ─── 图标 ─── */

function DiskIcon({ class: cls }: { class?: string }): preact.JSX.Element {
  return (
    <span class={`disk-utility__icon ${cls ?? ''}`} aria-hidden="true">
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <rect x="2" y="3" width="12" height="10" rx="2" />
        <circle cx="8" cy="8" r="1.5" fill="var(--bg, #fff)" />
      </svg>
    </span>
  )
}

function ContainerIcon({ class: cls }: { class?: string }): preact.JSX.Element {
  return (
    <span class={`disk-utility__icon ${cls ?? ''}`} aria-hidden="true">
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <path d="M2 4.5C2 3.67 2.67 3 3.5 3h9c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" opacity="0.2" />
        <path d="M3 4.5C3 3.67 3.67 3 4.5 3h7c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5h-7A1.5 1.5 0 0 1 3 11.5z" fill="none" stroke="currentColor" stroke-width="1.2" />
      </svg>
    </span>
  )
}

function FolderIcon({ class: cls }: { class?: string }): preact.JSX.Element {
  return (
    <span class={`disk-utility__icon ${cls ?? ''}`} aria-hidden="true">
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h3.172a1.5 1.5 0 0 1 1.06.44l.829.828a.5.5 0 0 0 .353.146H13A1.5 1.5 0 0 1 14.5 4.4V12.5A1.5 1.5 0 0 1 13 14H3A1.5 1.5 0 0 1 1.5 12.5z" />
      </svg>
    </span>
  )
}

function ImageIcon({ class: cls }: { class?: string }): preact.JSX.Element {
  return (
    <span class={`disk-utility__icon ${cls ?? ''}`} aria-hidden="true">
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <path d="M2 4.5C2 3.12 3.12 2 4.5 2h7C12.88 2 14 3.12 14 4.5v7c0 1.38-1.12 2.5-2.5 2.5h-7A2.5 2.5 0 0 1 2 11.5z" opacity="0.15" />
        <circle cx="5.5" cy="6" r="1.2" />
        <path d="M3 12l2.5-3.5L8 11l2-2.5L13 12z" fill="none" stroke="currentColor" stroke-width="0.8" />
      </svg>
    </span>
  )
}

function TrashIcon({ class: cls }: { class?: string }): preact.JSX.Element {
  return (
    <span class={`disk-utility__icon ${cls ?? ''}`} aria-hidden="true">
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <path d="M5.5 1.5A1.5 1.5 0 0 1 7 0h2a1.5 1.5 0 0 1 1.5 1.5V3h3.5a.5.5 0 0 1 0 1H1.5a.5.5 0 0 1 0-1H5zM3 4l.8 9.1A1.5 1.5 0 0 0 5.3 14.5h5.4a1.5 1.5 0 0 0 1.5-1.4L13 4z" />
      </svg>
    </span>
  )
}

function ChevronIcon({ expanded }: { expanded: boolean }): preact.JSX.Element {
  return (
    <span class={`disk-utility__chevron${expanded ? ' disk-utility__chevron--open' : ''}`}>
      <svg viewBox="0 0 8 8" width="8" height="8" fill="currentColor">
        <path d="M1.5 1l2.5 3-2.5 3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </span>
  )
}

function nodeIcon(node: TreeNode): preact.JSX.Element {
  switch (node.kind) {
    case 'system-disk':
      return <DiskIcon />
    case 'container':
      return <ContainerIcon />
    case 'volume':
      return <FolderIcon />
    case 'image-root':
      return <ImageIcon />
    case 'partition':
      return <DiskIcon class="disk-utility__icon--partition" />
    case 'trash':
      return <TrashIcon />
    default:
      return <FolderIcon />
  }
}

/* ─── 使用率条 ─── */

function renderUsageBar(used: number, capacity: number): preact.JSX.Element {
  const pct = usagePercent(used, capacity)
  const fillClass =
    pct >= 95 ? 'disk-utility__usage-bar-fill--full' :
    pct >= 80 ? 'disk-utility__usage-bar-fill--warn' : ''
  return (
    <div class="disk-utility__usage-bar">
      <div
        class={`disk-utility__usage-bar-fill ${fillClass}`}
        style={{ width: `${Math.max(pct, pct > 0 ? 0.6 : 0).toFixed(2)}%` }}
        role="presentation"
      />
    </div>
  )
}

/* ─── 分区布局条 ─── */

function renderPartitionBar(node: TreeNode): preact.JSX.Element | null {
  if (!node.imageFile || !node.children || node.children.length === 0) return null
  const totalBytes = node.imageFile.sizeBytes || 1
  const isFat = (typeByte: number) => [0x01, 0x04, 0x06, 0x0b, 0x0c, 0x0e].includes(typeByte)

  return (
    <div class="disk-utility__partitions" role="img" aria-label="分区布局">
      {node.children.map((child) => {
        if (!child.partition) return null
        return (
          <div
            key={child.id}
            class={`disk-utility__partition-seg ${isFat(child.partition.typeByte) ? 'disk-utility__partition-seg--fat' : ''}`}
            style={{ width: `${Math.max(6, (child.partition.sizeBytes / totalBytes) * 100).toFixed(2)}%` }}
            title={`${child.partition.typeLabel} — ${formatStorageSize(child.partition.sizeBytes)}`}
          >
            {child.partition.index}
          </div>
        )
      })}
    </div>
  )
}

/* ─── 树节点行 ─── */

function TreeNodeRow({
  node,
  depth,
  selectedId,
  expandedSet,
  onToggle,
  onSelect,
  stacked,
}: {
  node: TreeNode
  depth: number
  selectedId: string | undefined
  expandedSet: Set<string>
  onToggle: (id: string) => void
  onSelect: (node: TreeNode) => void
  stacked: boolean
}): preact.JSX.Element {
  const hasChildren = (node.children?.length ?? 0) > 0
  const isExpanded = expandedSet.has(node.id)
  const isSelected = node.id === selectedId

  const handleClick = useCallback(() => {
    if (hasChildren) onToggle(node.id)
    onSelect(node)
  }, [node.id, hasChildren, onToggle, onSelect])

  // 对于 system-disk / container 节点，显示容量使用率
  const showCapacity = node.capacityBytes !== undefined && node.bytes !== undefined
  const capacityPct = showCapacity ? usagePercent(node.bytes!, node.capacityBytes!) : undefined

  const row = (
    <button
      type="button"
      class={`disk-utility__tree-row${isSelected ? ' disk-utility__tree-row--selected' : ''}`}
      style={{ paddingLeft: `${12 + depth * 20}px` }}
      onClick={handleClick}
    >
      {hasChildren ? (
        <ChevronIcon expanded={isExpanded} />
      ) : (
        <span class="disk-utility__chevron-placeholder" />
      )}

      {nodeIcon(node)}

      <span class="disk-utility__tree-label">{node.label}</span>

      {node.fat ? (
        <span class="disk-utility__fs-badge">{node.fat.variant}</span>
      ) : null}

      {node.occupancy && node.occupancy.kind !== 'free' ? (
        <span class="disk-utility__occupancy-badge">
          {node.occupancy.kind === 'vm' ? `VM: ${node.occupancy.vmId}` : `挂载: ${node.occupancy.volumeId}`}
        </span>
      ) : null}

      {showCapacity ? (
        <span class="disk-utility__tree-size">
          {formatBytes(node.bytes)} / {formatBytes(node.capacityBytes)}
        </span>
      ) : node.bytes !== undefined ? (
        <span class="disk-utility__tree-size">{formatBytes(node.bytes)}</span>
      ) : null}

      {capacityPct !== undefined ? (
        <span class="disk-utility__tree-pct">{capacityPct.toFixed(1)}%</span>
      ) : null}
    </button>
  )

  return (
    <>
      {row}
      {hasChildren && isExpanded
        ? node.children!.map((child) => (
            <TreeNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expandedSet={expandedSet}
              onToggle={onToggle}
              onSelect={onSelect}
              stacked={stacked}
            />
          ))
        : null}
    </>
  )
}

/* ─── 详情面板 ─── */

function DetailPanel({
  node,
  actions,
}: {
  node: TreeNode | undefined
  actions: {
    revealInFiles: (path: string) => void
    openSpaceSniffer: () => void
  }
}): preact.JSX.Element {
  if (!node) {
    return (
      <section class="settings__section">
        <div class="settings__box settings__empty">选择一个节点以查看详情。</div>
      </section>
    )
  }

  return (
    <section class="settings__section">
      {/* 基础信息 */}
      <div class="settings__list">
        <div class="settings__row">
          <span class="settings__row-name">标识</span>
          <span class="settings__row-size settings__row-size--mono">{node.id}</span>
        </div>
        {node.pathRoot ? (
          <div class="settings__row">
            <span class="settings__row-name">路径根</span>
            <span class="settings__row-size">{node.pathRoot}</span>
          </div>
        ) : null}
        {node.writable !== undefined ? (
          <div class="settings__row">
            <span class="settings__row-name">权限</span>
            <span class="settings__row-size">{node.writable ? '可读写' : '只读'}</span>
          </div>
        ) : null}
        {node.bytes !== undefined ? (
          <div class="settings__row">
            <span class="settings__row-name">已使用</span>
            <span class="settings__row-size">{formatStorageSize(node.bytes)}</span>
          </div>
        ) : null}
        {node.capacityBytes !== undefined ? (
          <div class="settings__row">
            <span class="settings__row-name">总容量</span>
            <span class="settings__row-size">{formatStorageSize(node.capacityBytes)}</span>
          </div>
        ) : null}
        {node.occupancy ? (
          <div class="settings__row">
            <span class="settings__row-name">占用状态</span>
            <span class="settings__row-size">{occupancyLabel(node.occupancy)}</span>
          </div>
        ) : null}
      </div>

      {/* 系统盘 / 容器：容量条 */}
      {(node.kind === 'system-disk' || node.kind === 'container') && node.capacityBytes ? (
        <>
          <div class="disk-utility__detail-bar-row">
            <span class="disk-utility__detail-bar-label">使用量</span>
            <span class="disk-utility__detail-bar-value">
              {formatBytes(node.bytes)} / {formatBytes(node.capacityBytes)}
            </span>
          </div>
          {renderUsageBar(node.bytes ?? 0, node.capacityBytes)}
          <div style={{ height: 8 }} />
        </>
      ) : null}

      {/* 镜像磁盘根：分区条 + 底层信息 */}
      {node.kind === 'image-root' && node.imageFile ? (
        <>
          <h2 class="settings__section-title">磁盘镜像底层信息</h2>
          <div class="settings__list">
            <div class="settings__row">
              <span class="settings__row-name">源文件</span>
              <span class="settings__row-size">{node.imageFile.path}</span>
            </div>
            <div class="settings__row">
              <span class="settings__row-name">镜像大小</span>
              <span class="settings__row-size">{formatStorageSize(node.imageFile.sizeBytes)}</span>
            </div>
          </div>

          {renderPartitionBar(node)}

          {node.fat ? (
            <div class="settings__list">
              <div class="settings__row">
                <span class="settings__row-name">FAT 文件系统</span>
                <span class="settings__row-size">
                  {node.fat.variant} — {node.fat.label || '未命名'}
                </span>
              </div>
              <div class="settings__row">
                <span class="settings__row-name">簇大小</span>
                <span class="settings__row-size">{formatStorageSize(node.fat.clusterSizeBytes)}</span>
              </div>
              <div class="settings__row">
                <span class="settings__row-name">簇总数</span>
                <span class="settings__row-size">{node.fat.totalClusters.toLocaleString()}</span>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {/* 分区节点详情 */}
      {node.kind === 'partition' && node.partition ? (
        <>
          <h2 class="settings__section-title">分区信息</h2>
          <div class="settings__list">
            <div class="settings__row">
              <span class="settings__row-name">分区号</span>
              <span class="settings__row-size">{node.partition.index}</span>
            </div>
            <div class="settings__row">
              <span class="settings__row-name">类型</span>
              <span class="settings__row-size">{node.partition.typeLabel}</span>
            </div>
            <div class="settings__row">
              <span class="settings__row-name">起始偏移</span>
              <span class="settings__row-size">{formatStorageSize(node.partition.startBytes)}</span>
            </div>
            <div class="settings__row">
              <span class="settings__row-name">大小</span>
              <span class="settings__row-size">{formatStorageSize(node.partition.sizeBytes)}</span>
            </div>
            {node.partition.active ? (
              <div class="settings__row">
                <span class="settings__row-name">状态</span>
                <span class="settings__row-size">活动分区</span>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {/* 操作按钮 */}
      {node.locationId || node.imageFile ? (
        <div class="disk-utility__detail-actions">
          <IosButton
            tone="secondary"
            size="compact"
            onClick={() => {
              const path = node.imageFile?.path ?? node.pathRoot
              if (!path) return
              actions.revealInFiles(path)
            }}
          >
            在文件中显示
          </IosButton>

          {(node.kind === 'volume' || node.kind === 'system-disk' || node.kind === 'container') ? (
            <IosButton tone="secondary" size="compact" onClick={actions.openSpaceSniffer}>
              空间嗅探
            </IosButton>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

/* ─── 浏览器存储面板 ─── */

function BrowserStorageSection({
  storage,
  onRefresh,
  onRequestPersistence,
}: {
  storage: BrowserStorageSnapshot
  onRefresh: () => void
  onRequestPersistence: () => void
}): preact.JSX.Element {
  const browserUsedPct =
    storage.estimateSupported && storage.usageBytes !== undefined && storage.quotaBytes !== undefined
      ? `${usagePercent(storage.usageBytes, storage.quotaBytes).toFixed(1)}%`
      : '—'

  const systemUsedPct = `${usagePercent(storage.localStorageUsedBytes, DEVICE_CAPACITY_BYTES).toFixed(1)}%`
  const dataUsedPct = `${usagePercent(storage.dataStorageUsedBytes, storage.systemCapacityBytes).toFixed(1)}%`

  return (
    <section class="settings__section">
      <h2 class="settings__section-title">浏览器存储</h2>
      <div class="settings__list">
        <div class="settings__row">
          <span class="settings__row-name">storage.estimate 配额</span>
          <span class="settings__row-size">
            {storage.estimateSupported
              ? `${formatBytes(storage.usageBytes)} / ${formatBytes(storage.quotaBytes)}（${browserUsedPct}）`
              : '不支持'}
          </span>
        </div>
        {storage.estimateSupported && storage.usageBytes !== undefined && storage.quotaBytes !== undefined ? (
          <>
            {renderUsageBar(storage.usageBytes, storage.quotaBytes)}
            <div style={{ height: 6 }} />
          </>
        ) : null}

        <div class="settings__row">
          <span class="settings__row-name">系统空间（localStorage）</span>
          <span class="settings__row-size">
            {formatBytes(storage.localStorageUsedBytes)} / {formatBytes(DEVICE_CAPACITY_BYTES)}（{systemUsedPct}）
          </span>
        </div>
        {renderUsageBar(storage.localStorageUsedBytes, DEVICE_CAPACITY_BYTES)}
        <div style={{ height: 6 }} />

        <div class="settings__row">
          <span class="settings__row-name">数据空间（IndexedDB）</span>
          <span class="settings__row-size">
            {formatBytes(storage.dataStorageUsedBytes)} / {formatBytes(storage.systemCapacityBytes)}（{dataUsedPct}）
          </span>
        </div>
        {renderUsageBar(storage.dataStorageUsedBytes, storage.systemCapacityBytes)}

        <div class="settings__row">
          <span class="settings__row-name">持久化状态</span>
          <span class="settings__row-size">
            {storage.persisted ? '已请求持久化（数据受保护）' : '未持久化（可能被回收）'}
          </span>
        </div>
      </div>

      <div class="disk-utility__detail-actions">
        <IosButton tone="secondary" size="compact" onClick={onRefresh}>
          刷新
        </IosButton>
        {!storage.persisted ? (
          <IosButton tone="primary" size="compact" onClick={onRequestPersistence}>
            请求持久化
          </IosButton>
        ) : null}
      </div>
    </section>
  )
}

/* ─── 主组件 ─── */

export function DiskUtilityApp() {
  const { hostRef, narrowLayout, layoutReady } = useAppNarrowLayout()
  const { openApp } = useOs()
  const [tree, setTree] = useState<TreeNode | undefined>(undefined)
  const [browserStorage, setBrowserStorage] = useState<BrowserStorageSnapshot | undefined>(undefined)
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [expandedSet, setExpandedSet] = useState<Set<string>>(() => new Set(['system-disk', 'container:builtin']))
  const prevNarrowLayoutRef = useRef<boolean | undefined>(undefined)
  const splitRef = useRef<HTMLDivElement>(null)
  const listPaneRef = useRef<HTMLDivElement>(null)
  const detailPanelRef = useRef<HTMLDivElement>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const {
    page: screen,
    stack: navStack,
    transition: navTransition,
    queuedTransition: navQueuedTransition,
    commitQueuedTransition: commitNavQueuedTransition,
    navigate: navigateTo,
    handleMotionEnd: handleStackMotionEnd,
    setPage: resetNavPage,
  } = useKeychainNavStack<DiskUtilityScreen>('list')

  const refresh = useCallback(async () => {
    const [nextTree, nextStorage] = await Promise.all([
      loadDiskTree(),
      loadBrowserStorageSnapshot(),
    ])
    setTree(nextTree)
    setBrowserStorage(nextStorage)
    setSelectedId((current) => {
      if (!current) return current
      // 如果当前选中的节点还在新树中，保留
      if (findNode(nextTree, current)) return current
      return nextTree.children?.[0]?.id
    })
  }, [])

  useEffect(() => {
    void refresh()
    const handle = () => {
      if (refreshTimerRef.current) return
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = undefined
        void refresh()
      }, DETAIL_REFRESH_DEBOUNCE_MS)
    }
    window.addEventListener(DATA_STORAGE_CHANGED_EVENT, handle)
    window.addEventListener(FILES_MOUNTS_CHANGED_EVENT, handle)
    window.addEventListener(FILES_IMAGE_MOUNTS_CHANGED_EVENT, handle)
    return () => {
      window.removeEventListener(DATA_STORAGE_CHANGED_EVENT, handle)
      window.removeEventListener(FILES_MOUNTS_CHANGED_EVENT, handle)
      window.removeEventListener(FILES_IMAGE_MOUNTS_CHANGED_EVENT, handle)
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
      }
    }
  }, [refresh])

  useLayoutEffect(() => {
    if (!layoutReady) return
    const previous = prevNarrowLayoutRef.current
    prevNarrowLayoutRef.current = narrowLayout
    if (previous === undefined) return
    if (previous && !narrowLayout) {
      resetNavPage('list')
    }
  }, [layoutReady, narrowLayout, resetNavPage])

  const selectedNode = useMemo(
    () => (tree && selectedId ? findNode(tree, selectedId) : undefined),
    [tree, selectedId],
  )

  const handleToggle = useCallback((id: string) => {
    setExpandedSet((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const handleSelectNode = useCallback(
    (node: TreeNode) => {
      setSelectedId(node.id)
      if (narrowLayout) {
        navigateTo('detail', 'push')
      }
    },
    [navigateTo, narrowLayout],
  )

  const detailActions = useMemo(
    () => ({
      revealInFiles: (path: string) => {
        requestFilesReveal(path)
        openApp('files', { documentId: path })
      },
      openSpaceSniffer: () => openApp('space-sniffer'),
    }),
    [openApp],
  )

  useAppMenuBar(APP_ID, [])

  const renderListNav = () => (
    <div class="settings__nav settings__nav--titled">
      <div class="settings__nav-bar">
        <span class="settings__nav-heading-spacer" aria-hidden="true" />
        <h1 class="settings__nav-heading">磁盘工具</h1>
        <span class="settings__nav-trailing" aria-hidden="true" />
      </div>
    </div>
  )

  const renderListContent = (stacked: boolean) => (
    <div class="settings__content settings__content--compact">
      <section class="settings__section">
        <div class="disk-utility__tree">
          {tree?.children?.map((child) => (
            <TreeNodeRow
              key={child.id}
              node={child}
              depth={0}
              selectedId={selectedId}
              expandedSet={expandedSet}
              onToggle={handleToggle}
              onSelect={handleSelectNode}
              stacked={stacked}
            />
          ))}
        </div>
        <p class="settings__section-footnote">
          {tree
            ? `系统磁盘 ${formatBytes(tree.bytes)} / ${formatBytes(tree.capacityBytes)}`
            : '加载中…'}
        </p>
      </section>
    </div>
  )

  const renderDetailNav = (stacked: boolean) => (
    <div class="settings__nav settings__nav--titled">
      <div class="settings__nav-bar">
        {stacked ? (
          <IosNavBackButton label="磁盘工具" onClick={() => navigateTo('list', 'pop')} />
        ) : (
          <span class="settings__nav-heading-spacer" aria-hidden="true" />
        )}
        <h1 class="settings__nav-heading">{selectedNode?.label ?? '详情'}</h1>
        <span class="settings__nav-trailing" aria-hidden="true" />
      </div>
    </div>
  )

  const renderDetailContent = () => (
    <div class="settings__content settings__content--compact">
      <DetailPanel node={selectedNode} actions={detailActions} />

      {browserStorage ? (
        <BrowserStorageSection
          storage={browserStorage}
          onRefresh={() => void refresh()}
          onRequestPersistence={async () => {
            await requestBrowserPersistence()
            await refresh()
          }}
        />
      ) : null}
    </div>
  )

  const renderScreen = (target: DiskUtilityScreen) => {
    if (target === 'detail') {
      return (
        <>
          {renderDetailNav(true)}
          {renderDetailContent()}
        </>
      )
    }
    return (
      <>
        {renderListNav()}
        {renderListContent(true)}
      </>
    )
  }

  return (
    <div ref={hostRef} class={`disk-utility${narrowLayout ? ' disk-utility--narrow' : ''}`}>
      {!narrowLayout ? (
        <div ref={splitRef} class="disk-utility__split">
          <div ref={listPaneRef} class="disk-utility__pane disk-utility__pane--list settings settings--full">
            {renderListNav()}
            {renderListContent(false)}
          </div>
          <div ref={detailPanelRef} class="disk-utility__pane disk-utility__pane--detail settings settings--full">
            {renderDetailNav(false)}
            {renderDetailContent()}
          </div>
        </div>
      ) : (
        <KeychainNavStack
          stack={navStack}
          page={screen}
          transition={navTransition}
          queuedTransition={navQueuedTransition}
          commitQueuedTransition={commitNavQueuedTransition}
          onMotionEnd={handleStackMotionEnd}
          renderPage={renderScreen}
        />
      )}
    </div>
  )
}

/* ─── 树搜索 ─── */

function findNode(node: TreeNode, id: string): TreeNode | undefined {
  if (node.id === id) return node
  if (!node.children) return undefined
  for (const child of node.children) {
    const found = findNode(child, id)
    if (found) return found
  }
  return undefined
}
