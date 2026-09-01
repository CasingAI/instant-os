import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import { useOs } from '../../os/os-context.tsx'
import { useAppNarrowLayout } from '../../ui/use-app-narrow-layout.ts'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { IosButton } from '../../ui/ios-button.tsx'
import { TreeView } from '../../ui/tree-view.tsx'
import { formatStorageSize } from '../../os/format-storage-size.ts'
import { KeychainNavStack, useKeychainNavStack } from '../keychain/keychain-nav-stack.tsx'
import { requestFilesReveal } from '../files/files-reveal-request.ts'
import { FILES_MOUNTS_CHANGED_EVENT } from '../files/files-mount-store.ts'
import { FILES_IMAGE_MOUNTS_CHANGED_EVENT } from '../files/files-image-mount-store.ts'
import { DATA_STORAGE_CHANGED_EVENT } from '../../os/device-data-storage.ts'
import { unmountDiskImage } from '../files/files-image-actions.ts'
import { isImageLocationId } from '../files/files-types.ts'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import {
  DEVICE_CAPACITY_BYTES,
  loadDiskTree,
  loadBrowserStorageSnapshot,
  requestBrowserPersistence,
  type TreeNode,
  type BrowserStorageSnapshot,
} from './disk-utility-data.ts'
import {
  initialBenchmarkItems,
  runDiskBenchmarkSuite,
  type BenchmarkItemId,
  type BenchmarkItemState,
} from './disk-utility-benchmark.ts'
import {
  initialDiskScanItems,
  runDiskImageScan,
  type DiskScanItemId,
  type DiskScanItemState,
  type DiskScanReport,
} from './disk-utility-scan.ts'
import { buildDiskMap, findAncestorImageRoot } from './disk-utility-disk-map.ts'
import { DiskMapBar } from './disk-utility-disk-map-bar.tsx'
import {
  eraseDiskImageFile,
  formatPartitionInImageFile,
  partitionDiskImageFile,
  withExclusiveImageAccess,
  type DiskScheme,
  type FatVariant,
} from './disk-utility-format.ts'
import {
  DISK_UTILITY_THEME,
  EraseDiskDialog,
  PartitionDiskDialog,
  BenchmarkDialog,
  ScanDialog,
  type BenchmarkDialogState,
  type EraseDialogState,
  type ScanDialogState,
  type PartitionDialogState,
} from './disk-utility-dialogs.tsx'
import '../../ui/ios-nav-back.css'
import '../settings/settings.css'
import '../keychain/keychain.css'
import './disk-utility.css'

const APP_ID = 'disk-utility' as const
const DETAIL_REFRESH_DEBOUNCE_MS = 400

type DiskUtilityScreen = 'list' | 'detail' | 'partition'

function usagePercent(used: number, total: number): number {
  if (!total || !Number.isFinite(total)) return 0
  return Math.min(100, (used / total) * 100)
}

function formatBytes(value: number | undefined): string {
  return value === undefined ? '—' : formatStorageSize(value)
}

function occupancyLabel(occupancy: TreeNode['occupancy']): string {
  if (!occupancy || occupancy.kind === 'free') return '空闲'
  if (occupancy.kind === 'files-mount') return '已挂载为文件卷'
  if (occupancy.kind === 'vm') return `虚拟机正在使用（${occupancy.vmId}）`
  return `正在被「${occupancy.label}」使用`
}

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

function InfoList({ children }: { children: preact.ComponentChildren }): preact.JSX.Element {
  return <dl class="disk-utility__kv settings__list">{children}</dl>
}

function InfoRow({ name, value, mono }: { name: string; value: string; mono?: boolean }): preact.JSX.Element {
  return (
    <div class="disk-utility__kv-row">
      <dt class="disk-utility__kv-name">{name}</dt>
      <dd class={`disk-utility__kv-value${mono ? ' disk-utility__info-mono' : ''}`}>{value}</dd>
    </div>
  )
}

type DetailActions = {
  revealInFiles: (path: string) => void
  openSpaceSniffer: () => void
  eraseImage: (node: TreeNode) => void
  partitionImage: (node: TreeNode) => void
  enterPartitionView: (node: TreeNode) => void
  erasePartition: (node: TreeNode) => void
  unmountImage: (node: TreeNode) => void
  runBenchmark: (node: TreeNode) => void
  scanImage: (node: TreeNode) => void
}

function isVmOccupied(node: TreeNode): boolean {
  return node.occupancy?.kind === 'vm'
}

type DetailActionEntry = { key: string; node: preact.JSX.Element }

function DetailActionsBar({
  node,
  actions,
  partitionView,
  placement,
}: {
  node: TreeNode | undefined
  actions: DetailActions
  partitionView: boolean
  /** header：主要操作（抹掉/分区）；content：其余次要操作 */
  placement: 'header' | 'content'
}): preact.JSX.Element | undefined {
  if (!node) return undefined

  const vmLocked = isVmOccupied(node)
  // 第三方占用方同样禁止就地改写（withExclusiveImageAccess 侧另有守卫兜底）
  const appLocked = node.occupancy?.kind === 'app'
  const canMutateImage =
    (node.kind === 'image-root' || node.kind === 'partition') &&
    Boolean(node.imageFile) &&
    !vmLocked &&
    !appLocked
  const canScanImage =
    (node.kind === 'partition' ||
      (node.kind === 'image-root' && !(node.children ?? []).some((child) => child.kind === 'partition'))) &&
    Boolean(node.imageFile) &&
    !vmLocked &&
    !appLocked
  // 第一级（image-root）只展示「抹掉 / 分区 / 推出」；测速 / 在文件中显示放在分区或卷级别
  const isLevelOneImageRoot = node.kind === 'image-root'
  // 分区视图下，若当前节点文件系统未知（无 fat 信息），禁用会落到镜像实体的功能
  const fsUnknown = !node.fat
  const disableForUnknownFs =
    partitionView && node.kind === 'partition' && fsUnknown

  const entries: DetailActionEntry[] = []

  if (node.kind === 'image-root' && canMutateImage) {
    entries.push({
      key: 'erase-image',
      node: (
        <IosButton tone="danger" size="compact" onClick={() => actions.eraseImage(node)}>
          抹掉
        </IosButton>
      ),
    })
    entries.push(
      partitionView
        ? {
            key: 'partition-apply',
            node: (
              <IosButton tone="secondary" size="compact" onClick={() => actions.partitionImage(node)}>
                执行分区
              </IosButton>
            ),
          }
        : {
            key: 'partition-view',
            node: (
              <IosButton tone="secondary" size="compact" onClick={() => actions.enterPartitionView(node)}>
                分区
              </IosButton>
            ),
          },
    )
    if (isImageLocationId(node.id)) {
      entries.push({
        key: 'unmount',
        node: (
          <IosButton tone="secondary" size="compact" onClick={() => actions.unmountImage(node)}>
            推出
          </IosButton>
        ),
      })
    }
  }

  if (node.kind === 'partition' && canMutateImage) {
    entries.push({
      key: 'erase-partition',
      node: (
        <IosButton
          tone="danger"
          size="compact"
          disabled={disableForUnknownFs}
          onClick={() => actions.erasePartition(node)}
        >
          抹掉分区
        </IosButton>
      ),
    })
  }

  if (!isLevelOneImageRoot && (node.locationId || node.imageFile)) {
    entries.push({
      key: 'reveal',
      node: (
        <IosButton
          tone="secondary"
          size="compact"
          disabled={disableForUnknownFs}
          onClick={() => {
            const path = node.pathRoot ?? node.imageFile?.path
            if (!path) return
            actions.revealInFiles(path)
          }}
        >
          在文件中显示
        </IosButton>
      ),
    })
  }

  if (node.kind === 'volume' || node.kind === 'trash' || node.kind === 'container') {
    entries.push({
      key: 'sniff',
      node: (
        <IosButton tone="secondary" size="compact" onClick={actions.openSpaceSniffer}>
          空间嗅探
        </IosButton>
      ),
    })
  }

  if (canScanImage) {
    entries.push({
      key: 'scan',
      node: (
        <IosButton
          tone="secondary"
          size="compact"
          disabled={disableForUnknownFs}
          onClick={() => actions.scanImage(node)}
        >
          错误扫描
        </IosButton>
      ),
    })
  }

  if (!isLevelOneImageRoot && node.pathRoot && node.writable !== false && !vmLocked) {
    entries.push({
      key: 'benchmark',
      node: (
        <IosButton tone="secondary" size="compact" onClick={() => actions.runBenchmark(node)}>
          测速
        </IosButton>
      ),
    })
  }

  // 主要操作留在 Header，其余进正文，避免 Header 里横向滚动
  const HEADER_KEYS = new Set(['erase-image', 'partition-view', 'partition-apply', 'erase-partition'])
  const visible =
    placement === 'header'
      ? entries.filter((entry) => HEADER_KEYS.has(entry.key))
      : entries.filter((entry) => !HEADER_KEYS.has(entry.key))
  if (visible.length === 0) return undefined

  return (
    <div class={`disk-utility__detail-actions disk-utility__detail-actions--${placement}`}>
      {visible.map((entry) => entry.node)}
    </div>
  )
}

function DetailPanel({
  node,
  mapNode,
  showDiskMap,
  onSelectNode,
  actions,
}: {
  node: TreeNode | undefined
  mapNode: TreeNode | undefined
  showDiskMap: boolean
  onSelectNode: (node: TreeNode) => void
  actions: DetailActions
}): preact.JSX.Element {
  if (!node) {
    return (
      <section class="settings__section">
        <div class="settings__box settings__empty">选择一个节点以查看详情。</div>
      </section>
    )
  }

  const vmLocked = isVmOccupied(node)
  const mapSegments = mapNode ? buildDiskMap(mapNode) : undefined
  const showUsed = node.kind !== 'image-root' && node.kind !== 'partition' && node.bytes !== undefined
  const showFat =
    node.fat &&
    (node.kind === 'partition' ||
      (node.kind === 'image-root' && !(node.children ?? []).some((child) => child.kind === 'partition')))
  const fat = showFat ? node.fat : undefined

  return (
    <section class="settings__section">
      {showDiskMap && mapNode?.imageFile && mapSegments ? (
        <DiskMapBar
          segments={mapSegments}
          diskBytes={mapNode.imageFile.sizeBytes}
          selectedId={node.id}
          wide
          onSelect={(id) => {
            const target = id === mapNode.id ? mapNode : mapNode.children?.find((child) => child.id === id)
            if (target) onSelectNode(target)
          }}
        />
      ) : undefined}

      <InfoList>
        <InfoRow name="标识" value={node.id} mono />
        {node.pathRoot ? <InfoRow name="路径" value={node.pathRoot} /> : undefined}
        {node.writable !== undefined ? (
          <InfoRow name="权限" value={node.writable ? '可读写' : '只读'} />
        ) : undefined}
        {showUsed ? <InfoRow name="已使用" value={formatStorageSize(node.bytes ?? 0)} /> : undefined}
        {node.capacityBytes !== undefined ? (
          <InfoRow name="总容量" value={formatStorageSize(node.capacityBytes)} />
        ) : undefined}
        {node.occupancy ? <InfoRow name="占用状态" value={occupancyLabel(node.occupancy)} /> : undefined}
        {node.kind === 'image-root' && node.imageFile ? (
          <>
            <InfoRow name="源文件" value={node.imageFile.path} />
            <InfoRow name="镜像大小" value={formatStorageSize(node.imageFile.sizeBytes)} />
          </>
        ) : undefined}
        {node.kind === 'partition' && node.partition ? (
          <>
            <InfoRow name="分区号" value={String(node.partition.index)} />
            <InfoRow name="类型" value={node.partition.typeLabel} />
            <InfoRow name="起始偏移" value={formatStorageSize(node.partition.startBytes)} />
            <InfoRow name="大小" value={formatStorageSize(node.partition.sizeBytes)} />
            {node.partition.active ? <InfoRow name="状态" value="活动分区" /> : undefined}
          </>
        ) : undefined}
        {fat ? (
          <>
            <InfoRow name="文件系统" value={`${fat.variant}${fat.label ? ` · ${fat.label}` : ''}`} />
            <InfoRow name="簇大小" value={formatStorageSize(fat.clusterSizeBytes)} />
            <InfoRow name="簇总数" value={fat.totalClusters.toLocaleString()} />
            {fat.variant === 'exFAT' ? (
              <>
                <InfoRow name="容量" value={formatStorageSize(fat.capacityBytes)} />
                {fat.freeClusters !== undefined ? (
                  <InfoRow name="空闲簇" value={fat.freeClusters.toLocaleString()} />
                ) : undefined}
                <InfoRow name="序列号" value={fat.serialNumber} mono />
              </>
            ) : undefined}
          </>
        ) : undefined}
      </InfoList>

      <DetailActionsBar node={node} actions={actions} partitionView={showDiskMap} placement="content" />

      {(node.kind === 'system-disk' || node.kind === 'container') && node.capacityBytes ? (
        <div class="disk-utility__usage-block">
          <div class="disk-utility__detail-bar-row">
            <span class="disk-utility__detail-bar-label">使用量</span>
            <span class="disk-utility__detail-bar-value">
              {formatBytes(node.bytes)} / {formatBytes(node.capacityBytes)}
            </span>
          </div>
          {renderUsageBar(node.bytes ?? 0, node.capacityBytes)}
        </div>
      ) : undefined}

      {vmLocked ? (
        <p class="settings__section-footnote">虚拟机正在使用这块盘，无法抹掉、分区或推出。请先关机或从虚拟机里去掉它。</p>
      ) : undefined}
    </section>
  )
}

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
      <InfoList>
        <InfoRow
          name="storage.estimate"
          value={
            storage.estimateSupported
              ? `${formatBytes(storage.usageBytes)} / ${formatBytes(storage.quotaBytes)}（${browserUsedPct}）`
              : '不支持'
          }
        />
        <InfoRow
          name="系统空间（localStorage）"
          value={`${formatBytes(storage.localStorageUsedBytes)} / ${formatBytes(DEVICE_CAPACITY_BYTES)}（${systemUsedPct}）`}
        />
        <InfoRow
          name="数据空间（IndexedDB）"
          value={`${formatBytes(storage.dataStorageUsedBytes)} / ${formatBytes(storage.systemCapacityBytes)}（${dataUsedPct}）`}
        />
        <InfoRow
          name="持久化状态"
          value={storage.persisted ? '已请求持久化（数据受保护）' : '未持久化（可能被回收）'}
        />
      </InfoList>
      {storage.estimateSupported && storage.usageBytes !== undefined && storage.quotaBytes !== undefined ? (
        <div class="disk-utility__usage-block">
          <div class="disk-utility__detail-bar-row">
            <span class="disk-utility__detail-bar-label">浏览器配额</span>
            <span class="disk-utility__detail-bar-value">
              {formatBytes(storage.usageBytes)} / {formatBytes(storage.quotaBytes)}
            </span>
          </div>
          {renderUsageBar(storage.usageBytes, storage.quotaBytes)}
        </div>
      ) : undefined}
      <div class="disk-utility__usage-block">
        <div class="disk-utility__detail-bar-row">
          <span class="disk-utility__detail-bar-label">系统空间</span>
          <span class="disk-utility__detail-bar-value">
            {formatBytes(storage.localStorageUsedBytes)} / {formatBytes(DEVICE_CAPACITY_BYTES)}
          </span>
        </div>
        {renderUsageBar(storage.localStorageUsedBytes, DEVICE_CAPACITY_BYTES)}
      </div>
      <div class="disk-utility__usage-block">
        <div class="disk-utility__detail-bar-row">
          <span class="disk-utility__detail-bar-label">数据空间</span>
          <span class="disk-utility__detail-bar-value">
            {formatBytes(storage.dataStorageUsedBytes)} / {formatBytes(storage.systemCapacityBytes)}
          </span>
        </div>
        {renderUsageBar(storage.dataStorageUsedBytes, storage.systemCapacityBytes)}
      </div>
      <div class="disk-utility__detail-actions">
        <IosButton tone="secondary" size="compact" onClick={onRefresh}>
          刷新
        </IosButton>
        {!storage.persisted ? (
          <IosButton tone="primary" size="compact" onClick={onRequestPersistence}>
            请求持久化
          </IosButton>
        ) : undefined}
      </div>
    </section>
  )
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function DiskUtilityApp() {
  const { hostRef, narrowLayout, layoutReady } = useAppNarrowLayout()
  const { openApp } = useOs()
  const modal = useWindowModal()
  const [tree, setTree] = useState<TreeNode | undefined>(undefined)
  const [browserStorage, setBrowserStorage] = useState<BrowserStorageSnapshot | undefined>(undefined)
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [partitionViewRootId, setPartitionViewRootId] = useState<string | undefined>(undefined)
  const [eraseState, setEraseState] = useState<EraseDialogState | undefined>(undefined)
  const [partitionState, setPartitionState] = useState<PartitionDialogState | undefined>(undefined)
  const [benchmarkState, setBenchmarkState] = useState<BenchmarkDialogState | undefined>(undefined)
  const [benchmarkItems, setBenchmarkItems] = useState<Record<BenchmarkItemId, BenchmarkItemState>>(
    initialBenchmarkItems,
  )
  const [scanState, setScanState] = useState<ScanDialogState | undefined>(undefined)
  const [scanItems, setScanItems] = useState<Record<DiskScanItemId, DiskScanItemState>>(
    initialDiskScanItems(),
  )
  const [scanReport, setScanReport] = useState<DiskScanReport | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | undefined>(undefined)
  const busyRef = useRef(false)
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
      if (findNode(nextTree, current)) return current
      const imageContainer = nextTree.children?.find((child) => child.id === 'container:image')
      const fallbackImage = imageContainer?.children?.find(
        (child) =>
          child.kind === 'image-root' &&
          ((child.children ?? []).some((grandchild) => grandchild.kind === 'partition' && grandchild.pathRoot) ||
            child.pathRoot),
      )
      return fallbackImage?.id ?? nextTree.children?.[0]?.id
    })
    setPartitionViewRootId((current) => {
      if (!current) return current
      const root = findNode(nextTree, current)
      return root?.kind === 'image-root' ? current : undefined
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

  const mapNode = useMemo(
    () => (partitionViewRootId && tree ? findNode(tree, partitionViewRootId) : undefined),
    [partitionViewRootId, tree],
  )
  const partitionView = mapNode?.kind === 'image-root'

  const dataSpaceNode = tree?.children?.find((child) => child.id === 'container:builtin')
  const showBrowserStorage = selectedNode?.id === 'container:builtin'

  const handleSelectNode = useCallback(
    (node: TreeNode) => {
      if (node.kind === 'partition') {
        setSelectedId(node.id)
        const root = tree ? findAncestorImageRoot(tree, node.id) : undefined
        if (root && root.id !== partitionViewRootId) setPartitionViewRootId(root.id)
        if (narrowLayout && screen !== 'partition') navigateTo('partition', 'push')
        return
      }

      const wasInPartitionView = partitionViewRootId !== undefined
      setSelectedId(node.id)
      setPartitionViewRootId(undefined)
      if (narrowLayout) {
        if (wasInPartitionView) {
          navigateTo('detail', 'pop')
        } else if (screen === 'list') {
          navigateTo('detail', 'push')
        }
      }
    },
    [navigateTo, narrowLayout, partitionViewRootId, screen, tree],
  )

  const runMutation = useCallback(
    async (path: string, work: () => Promise<void>) => {
      if (busyRef.current) return
      busyRef.current = true
      setBusy(true)
      setDialogError(undefined)
      try {
        await withExclusiveImageAccess(path, work)
        setEraseState(undefined)
        setPartitionState(undefined)
        await refresh()
      } catch (error) {
        setDialogError(formatError(error))
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [refresh],
  )

  const runBenchmarkWork = useCallback(
    async (signal: AbortSignal, rootPath: string) => {
      if (busyRef.current) return
      busyRef.current = true
      setBusy(true)
      setDialogError(undefined)
      setBenchmarkItems(initialBenchmarkItems())
      try {
        await runDiskBenchmarkSuite({
          rootPath,
          signal,
          onItemUpdate: (id, state) => {
            setBenchmarkItems((prev) => ({ ...prev, [id]: state }))
          },
        })
      } catch (error) {
        if (error instanceof Error && error.message === 'aborted') {
          // 用户主动停止，保留已完成项的值
        } else {
          setDialogError(formatError(error))
        }
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [],
  )

  const runScanWork = useCallback(
    async (signal: AbortSignal, target: ScanDialogState) => {
      if (busyRef.current) return
      busyRef.current = true
      setBusy(true)
      setDialogError(undefined)
      setScanReport(undefined)
      setScanItems(initialDiskScanItems())
      try {
        const report = await runDiskImageScan({
          path: target.path,
          partition: target.partition,
          signal,
          onItemUpdate: (id, state) => {
            setScanItems((prev) => ({ ...prev, [id]: state }))
          },
        })
        setScanReport(report)
      } catch (error) {
        if (error instanceof Error && error.message === 'aborted') {
          setScanItems((prev) => {
            const next = { ...prev }
            for (const [id, item] of Object.entries(next)) {
              if (item.status === 'running') {
                next[id as DiskScanItemId] = { status: 'failed', message: '已停止' }
              }
            }
            return next
          })
        } else {
          setDialogError(formatError(error))
        }
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [],
  )

  const detailActions = useMemo<DetailActions>(
    () => ({
      revealInFiles: (path: string) => {
        requestFilesReveal(path)
        openApp('files', { documentId: path })
      },
      openSpaceSniffer: () => openApp('space-sniffer'),
      eraseImage: (node) => {
        if (!node.imageFile) return
        setDialogError(undefined)
        setEraseState({
          kind: 'disk',
          path: node.imageFile.path,
          label: node.label,
          sizeBytes: node.imageFile.sizeBytes,
        })
      },
      partitionImage: (node) => {
        if (!node.imageFile) return
        setDialogError(undefined)
        setPartitionState({
          path: node.imageFile.path,
          label: node.label,
          sizeBytes: node.imageFile.sizeBytes,
        })
      },
      enterPartitionView: (node) => {
        if (node.kind !== 'image-root') return
        setPartitionViewRootId(node.id)
        // 默认选中第一个可读分区；没有分区表（superfloppy）则停留在镜像根
        const firstReadable =
          (node.children ?? []).find((child) => child.kind === 'partition' && child.pathRoot) ??
          (node.pathRoot ? node : undefined)
        setSelectedId((firstReadable ?? node).id)
        if (narrowLayout) navigateTo('partition', 'push')
      },
      erasePartition: (node) => {
        if (!node.imageFile || !node.partition) return
        setDialogError(undefined)
        setEraseState({
          kind: 'partition',
          path: node.imageFile.path,
          label: node.label,
          sizeBytes: node.partition.sizeBytes,
          partition: {
            index: node.partition.index,
            startBytes: node.partition.startBytes,
            sizeBytes: node.partition.sizeBytes,
          },
        })
      },
      unmountImage: (node) => {
        void (async () => {
          if (!isImageLocationId(node.id)) return
          const ok = await modal.confirm({
            title: '推出磁盘镜像？',
            message: `「${node.label}」将从侧栏移除，修改会写回镜像文件。`,
            confirmLabel: '推出',
            cancelLabel: '取消',
            themeColor: DISK_UTILITY_THEME,
          })
          if (!ok) return
          try {
            await unmountDiskImage(node.id)
            await refresh()
          } catch (error) {
            await modal.alert({
              title: '无法推出',
              message: formatError(error),
              themeColor: DISK_UTILITY_THEME,
            })
          }
        })()
      },
      runBenchmark: (node) => {
        if (!node.pathRoot) return
        setBenchmarkItems(initialBenchmarkItems())
        setDialogError(undefined)
        setBenchmarkState({
          rootPath: node.pathRoot,
          label: node.label,
        })
      },
      scanImage: (node) => {
        if (!node.imageFile) return
        setScanItems(initialDiskScanItems())
        setScanReport(undefined)
        setDialogError(undefined)
        setScanState({
          path: node.imageFile.path,
          label: node.label,
          partition: node.kind === 'partition' ? node.partition : undefined,
        })
      },
    }),
    [modal, navigateTo, narrowLayout, openApp, refresh],
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

  const renderListContent = () => (
    <div class="settings__content settings__content--compact disk-utility__list-content">
      <div class="disk-utility__sidebar">
        <TreeView
          className="disk-utility__tree"
          ariaLabel="存储设备"
          nodes={tree?.children ?? []}
          defaultExpandedIds={['system-disk', 'container:builtin', 'container:mount', 'container:image']}
          selectedId={selectedId}
          onSelect={handleSelectNode}
          renderNode={(node) => {
            const showCapacity = node.capacityBytes !== undefined && node.bytes !== undefined
            const capacityPct = showCapacity ? usagePercent(node.bytes ?? 0, node.capacityBytes ?? 0) : undefined
            return (
              <>
                <span class="disk-utility__tree-main">
                  {nodeIcon(node)}
                  <span class="disk-utility__tree-label">{node.label}</span>
                </span>
                <span class="disk-utility__tree-size">
                  {showCapacity
                    ? `${formatBytes(node.bytes)} / ${formatBytes(node.capacityBytes)}`
                    : node.bytes !== undefined
                      ? formatBytes(node.bytes)
                      : ''}
                </span>
                <span class="disk-utility__tree-pct">
                  {capacityPct !== undefined ? `${capacityPct.toFixed(0)}%` : ''}
                </span>
              </>
            )
          }}
        />
        <p class="disk-utility__sidebar-footnote">
          {dataSpaceNode
            ? `数据空间 ${formatBytes(dataSpaceNode.bytes)} / ${formatBytes(dataSpaceNode.capacityBytes)}`
            : '加载中…'}
        </p>
      </div>
    </div>
  )

  const renderDetailNav = (
    stacked: boolean,
    inPartitionView: boolean,
    displayNode: TreeNode | undefined = selectedNode,
  ) => (
    <div class="settings__nav settings__nav--titled disk-utility__detail-nav">
      <div class="settings__nav-bar">
        {inPartitionView ? (
          <IosNavBackButton
            label="返回镜像"
            onClick={() => {
              if (mapNode) setSelectedId(mapNode.id)
              setPartitionViewRootId(undefined)
              if (stacked) navigateTo('detail', 'pop')
            }}
          />
        ) : stacked ? (
          <IosNavBackButton label="磁盘工具" onClick={() => navigateTo('list', 'pop')} />
        ) : (
          <span class="settings__nav-heading-spacer" aria-hidden="true" />
        )}
        <h1 class="settings__nav-heading">{displayNode?.label ?? ''}</h1>
        <span class="settings__nav-trailing">
          <DetailActionsBar node={displayNode} actions={detailActions} partitionView={inPartitionView} placement="header" />
        </span>
      </div>
    </div>
  )

  const renderDetailContent = (inPartitionView: boolean, displayNode: TreeNode | undefined = selectedNode) => (
    <div class="settings__content settings__content--compact disk-utility__detail-content">
      <DetailPanel
        node={displayNode}
        mapNode={mapNode}
        showDiskMap={inPartitionView}
        onSelectNode={handleSelectNode}
        actions={detailActions}
      />
      {showBrowserStorage && browserStorage ? (
        <BrowserStorageSection
          storage={browserStorage}
          onRefresh={() => void refresh()}
          onRequestPersistence={async () => {
            await requestBrowserPersistence()
            await refresh()
          }}
        />
      ) : undefined}
    </div>
  )

  const renderScreen = (target: DiskUtilityScreen) => {
    if (target === 'detail' || target === 'partition') {
      const inPartitionView = target === 'partition'
      return (
        <>
          {renderDetailNav(true, inPartitionView)}
          {renderDetailContent(inPartitionView)}
        </>
      )
    }
    return (
      <>
        {renderListNav()}
        {renderListContent()}
      </>
    )
  }

  return (
    <div ref={hostRef} class={`disk-utility${narrowLayout ? ' disk-utility--narrow' : ''}`}>
      {!narrowLayout ? (
        <div ref={splitRef} class="disk-utility__split">
          <div ref={listPaneRef} class="disk-utility__pane disk-utility__pane--list settings">
            {renderListNav()}
            {renderListContent()}
          </div>
          <div ref={detailPanelRef} class="disk-utility__pane disk-utility__pane--detail settings">
            <div class="disk-utility__wide-stack">
              <div
                class={`settings disk-utility__wide-stack__page${!partitionView ? ' is-active' : ''}`}
                style={{
                  transform: partitionView ? 'translateX(-100%)' : 'translateX(0)',
                  zIndex: partitionView ? 0 : 1,
                }}
              >
                {renderDetailNav(false, false, mapNode ?? selectedNode)}
                {renderDetailContent(false, mapNode ?? selectedNode)}
              </div>
              <div
                class={`settings disk-utility__wide-stack__page${partitionView ? ' is-active' : ''}`}
                style={{
                  transform: partitionView ? 'translateX(0)' : 'translateX(100%)',
                  zIndex: partitionView ? 1 : 0,
                }}
              >
                {renderDetailNav(false, true, selectedNode)}
                {renderDetailContent(true, selectedNode)}
              </div>
            </div>
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

      <EraseDiskDialog
        state={eraseState}
        busy={busy}
        error={dialogError}
        onClose={() => {
          if (busy) return
          setEraseState(undefined)
          setDialogError(undefined)
        }}
        onConfirm={(options: { label: string; scheme: DiskScheme; variant: FatVariant | 'auto' }) => {
          if (!eraseState) return
          const target = eraseState
          void runMutation(target.path, async () => {
            if (target.kind === 'partition' && target.partition) {
              await formatPartitionInImageFile(target.path, target.partition, {
                variant: options.variant,
                label: options.label,
              })
              return
            }
            await eraseDiskImageFile(target.path, target.sizeBytes, options)
          })
        }}
      />

      <PartitionDiskDialog
        state={partitionState}
        busy={busy}
        error={dialogError}
        onClose={() => {
          if (busy) return
          setPartitionState(undefined)
          setDialogError(undefined)
        }}
        onConfirm={(options) => {
          if (!partitionState) return
          const target = partitionState
          void runMutation(target.path, async () => {
            await partitionDiskImageFile(target.path, target.sizeBytes, options)
          })
        }}
      />

      <BenchmarkDialog
        state={benchmarkState}
        busy={busy}
        items={benchmarkItems}
        error={dialogError}
        onClose={() => {
          if (busy) return
          setBenchmarkState(undefined)
          setBenchmarkItems(initialBenchmarkItems())
          setDialogError(undefined)
        }}
        onRun={(signal: AbortSignal) => {
          if (!benchmarkState) return
          void runBenchmarkWork(signal, benchmarkState.rootPath)
        }}
      />

      <ScanDialog
        state={scanState}
        busy={busy}
        items={scanItems}
        report={scanReport}
        error={dialogError}
        onClose={() => {
          if (busy) return
          setScanState(undefined)
          setScanItems(initialDiskScanItems())
          setScanReport(undefined)
          setDialogError(undefined)
        }}
        onRun={(signal: AbortSignal) => {
          if (!scanState) return
          void runScanWork(signal, scanState)
        }}
      />
    </div>
  )
}

function findNode(node: TreeNode, id: string): TreeNode | undefined {
  if (node.id === id) return node
  if (!node.children) return undefined
  for (const child of node.children) {
    const found = findNode(child, id)
    if (found) return found
  }
  return undefined
}
