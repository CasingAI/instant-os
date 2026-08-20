import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy'
import { formatStorageSize } from '../../os/format-storage-size.ts'
import type { ScanNode } from './space-sniffer-types.ts'

const FOLDER_COLOR = '#4a90e2'
const DOUBLE_CLICK_MS = 400
const ZOOM_MS = 280
const FOLDER_HEADER_PX = 18
const PADDING_INNER_PX = 2
const PADDING_OUTER_PX = 3
const ROOT_SHELL_Z = 12
const TOOLTIP_PAD = 8
const TOOLTIP_OFFSET_X = 12
const TOOLTIP_OFFSET_Y = 14

type HoverTipState = {
  name: string
  size: string
  kind: string
  cursorX: number
  cursorY: number
}

/** 将 tooltip 限制在容器内，空间不足时翻转到光标另一侧 */
function placeTooltip(
  cursorX: number,
  cursorY: number,
  tipWidth: number,
  tipHeight: number,
  containerWidth: number,
  containerHeight: number,
): { x: number; y: number } | undefined {
  if (
    tipWidth <= 0 ||
    tipHeight <= 0 ||
    tipWidth > containerWidth - TOOLTIP_PAD * 2 ||
    tipHeight > containerHeight - TOOLTIP_PAD * 2
  ) {
    return undefined
  }

  let x = cursorX + TOOLTIP_OFFSET_X
  let y = cursorY + TOOLTIP_OFFSET_Y

  if (x + tipWidth > containerWidth - TOOLTIP_PAD) {
    x = cursorX - tipWidth - TOOLTIP_OFFSET_X
  }
  if (y + tipHeight > containerHeight - TOOLTIP_PAD) {
    y = cursorY - tipHeight - TOOLTIP_OFFSET_Y
  }

  x = Math.max(TOOLTIP_PAD, Math.min(x, containerWidth - tipWidth - TOOLTIP_PAD))
  y = Math.max(TOOLTIP_PAD, Math.min(y, containerHeight - tipHeight - TOOLTIP_PAD))

  return { x, y }
}

function hoverTipFromEvent(
  event: MouseEvent,
  container: HTMLElement,
  tile: { node: ScanNode },
  kindLabel: string,
  sizeText: string,
): HoverTipState {
  const bounds = container.getBoundingClientRect()
  return {
    name: tile.node.name,
    size: sizeText,
    kind: kindLabel,
    cursorX: event.clientX - bounds.left,
    cursorY: event.clientY - bounds.top,
  }
}

function isUnderPath(path: string, parentPath: string): boolean {
  return path === parentPath || path.startsWith(`${parentPath}/`)
}

const FILE_CLASS_COLORS: Array<{ test: RegExp; color: string }> = [
  { test: /\.(png|jpe?g|gif|webp|svg|heic|bmp|ico)$/i, color: '#34c759' },
  { test: /\.(mp4|mov|mkv|avi|webm|m4v)$/i, color: '#af52de' },
  { test: /\.(mp3|wav|flac|aac|m4a|ogg)$/i, color: '#ff2d55' },
  { test: /\.(zip|tar|gz|tgz|rar|7z)$/i, color: '#ff9500' },
  { test: /\.(pdf|doc|docx|ppt|pptx|xls|xlsx|txt|md)$/i, color: '#ff3b30' },
  { test: /\.(js|ts|tsx|jsx|json|css|html|py|rs|go|java|c|cpp|h)$/i, color: '#5856d6' },
]

type TreemapHierarchyDatum = {
  name: string
  value?: number
  node?: ScanNode
  children?: TreemapHierarchyDatum[]
}

export type TreemapTile = {
  node: ScanNode
  x: number
  y: number
  width: number
  height: number
  color: string
  depth: number
}

/** 已展开文件夹的外框 + 顶栏（含当前视图根） */
type FolderShell = {
  node: ScanNode
  path: string
  name: string
  byteSize: number
  x: number
  y: number
  width: number
  height: number
  depth: number
}

type LayoutResult = {
  tiles: TreemapTile[]
  shells: FolderShell[]
}

type TileRect = {
  x: number
  y: number
  width: number
  height: number
}

/** 相对画布的比例布局（进文件夹后继续用这套，不再重算） */
type PinnedTile = {
  node: ScanNode
  color: string
  x: number
  y: number
  width: number
  height: number
}

type PinnedShell = {
  node: ScanNode
  path: string
  name: string
  byteSize: number
  x: number
  y: number
  width: number
  height: number
  depth: number
}

type ZoomTile = {
  node: ScanNode
  color: string
  from: TileRect
  to: TileRect
}

type ZoomShell = {
  node: ScanNode
  path: string
  name: string
  byteSize: number
  from: TileRect
  to: TileRect
  depth: number
  /** 正在进入/离开的那一层：实底，避免挖空透底 */
  primary: boolean
}

type ZoomState = {
  tiles: ZoomTile[]
  shells: ZoomShell[]
  active: boolean
  /** 放大时藏起该文件夹子树；缩小时用背景层 */
  hideUnderPath?: string
}

type PinnedLayout = {
  rootPath: string
  tiles: PinnedTile[]
  shells: PinnedShell[]
}

/** 一次进入文件夹的记录，供后退原路缩小 */
type DrillFrame = {
  folderPath: string
  parentPath: string
  /** 进入前父级完整画面（他人块 + 子块原位） */
  parentSettled: PinnedLayout
  /** 子块在父级上的位置 */
  childSlots: PinnedTile[]
  /** 进入后全屏钉住布局 */
  folderPinned: PinnedLayout
  /** 进入前父级已展开的文件夹路径 */
  expandedPaths: string[]
}

function colorForNode(node: ScanNode): string {
  if (node.kind === 'folder') {
    return FOLDER_COLOR
  }
  for (const entry of FILE_CLASS_COLORS) {
    if (entry.test.test(node.name)) {
      return entry.color
    }
  }
  return '#8e8e93'
}

function toHierarchy(
  node: ScanNode,
  remainingDepth: number,
  expandedPaths: ReadonlySet<string>,
  isViewRoot = false,
): TreemapHierarchyDatum {
  const visibleChildren = (node.children ?? []).filter((child) => child.byteSize > 0)
  const forceExpand =
    node.kind === 'folder' && expandedPaths.has(node.path) && visibleChildren.length > 0

  // 视图根有子项时至少摊开一层，才能保留外框/顶栏
  if (
    node.kind === 'file' ||
    visibleChildren.length === 0 ||
    (!isViewRoot && !forceExpand && remainingDepth <= 1)
  ) {
    return {
      name: node.name,
      value: Math.max(node.byteSize, 1),
      node,
    }
  }

  // 单击展开时至少再露出一层，子文件夹里能看到内容，才分得清文件夹/文件
  const childDepth = forceExpand
    ? Math.max(2, remainingDepth)
    : isViewRoot
      ? Math.max(1, remainingDepth - 1)
      : remainingDepth - 1

  return {
    name: node.name,
    node,
    children: visibleChildren.map((child) =>
      toHierarchy(child, childDepth, expandedPaths, false),
    ),
  }
}

function computeLayout(
  root: ScanNode,
  width: number,
  height: number,
  detailLevel: number,
  expandedPaths: ReadonlySet<string>,
): LayoutResult {
  if (width <= 0 || height <= 0 || root.byteSize <= 0) {
    return { tiles: [], shells: [] }
  }

  const data = toHierarchy(root, detailLevel, expandedPaths, true)
  const hierarchyRoot = hierarchy<TreemapHierarchyDatum>(data)
    .sum((datum) => datum.value ?? 0)
    .sort((left, right) => (right.value ?? 0) - (left.value ?? 0))

  const layoutRoot = treemap<TreemapHierarchyDatum>()
    .tile(treemapSquarify)
    .size([width, height])
    .paddingInner(PADDING_INNER_PX)
    .paddingOuter(PADDING_OUTER_PX)
    .paddingTop(FOLDER_HEADER_PX)
    .round(true)(hierarchyRoot)

  const tiles: TreemapTile[] = layoutRoot.leaves().flatMap((leaf) => {
    const node = leaf.data.node
    if (!node) return []
    const tileWidth = leaf.x1 - leaf.x0
    const tileHeight = leaf.y1 - leaf.y0
    if (tileWidth <= 0 || tileHeight <= 0) return []
    return [
      {
        node,
        x: leaf.x0,
        y: leaf.y0,
        width: tileWidth,
        height: tileHeight,
        color: colorForNode(node),
        depth: leaf.depth,
      },
    ]
  })

  const shells: FolderShell[] = []
  layoutRoot.each((node) => {
    if (!node.children || node.children.length === 0) return
    const scanNode = node.data.node
    if (!scanNode || scanNode.kind !== 'folder') return
    const shellWidth = node.x1 - node.x0
    const shellHeight = node.y1 - node.y0
    if (shellWidth <= 0 || shellHeight <= 0) return
    shells.push({
      node: scanNode,
      path: scanNode.path,
      name: scanNode.name,
      byteSize: scanNode.byteSize,
      x: node.x0,
      y: node.y0,
      width: shellWidth,
      height: shellHeight,
      depth: node.depth,
    })
  })

  return { tiles, shells }
}

function tileToPinned(tile: TreemapTile, width: number, height: number): PinnedTile {
  return {
    node: tile.node,
    color: tile.color,
    x: tile.x / width,
    y: tile.y / height,
    width: tile.width / width,
    height: tile.height / height,
  }
}

function shellToPinned(shell: FolderShell, width: number, height: number): PinnedShell {
  return {
    node: shell.node,
    path: shell.path,
    name: shell.name,
    byteSize: shell.byteSize,
    x: shell.x / width,
    y: shell.y / height,
    width: shell.width / width,
    height: shell.height / height,
    depth: shell.depth,
  }
}

function pinnedToRect(tile: PinnedTile, width: number, height: number): TileRect {
  return {
    x: tile.x * width,
    y: tile.y * height,
    width: Math.max(1, tile.width * width),
    height: Math.max(1, tile.height * height),
  }
}

function pinnedShellToRect(shell: PinnedShell, width: number, height: number): TileRect {
  return {
    x: shell.x * width,
    y: shell.y * height,
    width: Math.max(1, shell.width * width),
    height: Math.max(1, shell.height * height),
  }
}

function pinnedToTiles(pinned: PinnedTile[], width: number, height: number): TreemapTile[] {
  return pinned.map((tile) => ({
    node: tile.node,
    color: tile.color,
    ...pinnedToRect(tile, width, height),
    depth: 1,
  }))
}

function pinnedToShells(pinned: PinnedShell[], width: number, height: number): FolderShell[] {
  return pinned.map((shell) => ({
    node: shell.node,
    path: shell.path,
    name: shell.name,
    byteSize: shell.byteSize,
    x: shell.x * width,
    y: shell.y * height,
    width: Math.max(1, shell.width * width),
    height: Math.max(1, shell.height * height),
    depth: shell.depth,
  }))
}

/** 视图根外框内侧的内容区（与 d3 paddingTop + paddingOuter 对齐） */
function viewContentRect(width: number, height: number): TileRect {
  return {
    x: PADDING_OUTER_PX,
    y: FOLDER_HEADER_PX + PADDING_OUTER_PX,
    width: Math.max(1, width - PADDING_OUTER_PX * 2),
    height: Math.max(1, height - FOLDER_HEADER_PX - PADDING_OUTER_PX * 2),
  }
}

/** 文件夹壳内侧内容区（顶栏下方） */
function shellContentRect(shell: TileRect): TileRect {
  return {
    x: shell.x + PADDING_OUTER_PX,
    y: shell.y + FOLDER_HEADER_PX,
    width: Math.max(1, shell.width - PADDING_OUTER_PX * 2),
    height: Math.max(1, shell.height - FOLDER_HEADER_PX - PADDING_OUTER_PX),
  }
}

function shellFromChildren(bounds: TileRect, canvas: TileRect): TileRect {
  const x = Math.max(canvas.x, bounds.x - PADDING_OUTER_PX)
  const y = Math.max(canvas.y, bounds.y - FOLDER_HEADER_PX)
  const right = Math.min(canvas.x + canvas.width, bounds.x + bounds.width + PADDING_OUTER_PX)
  const bottom = Math.min(canvas.y + canvas.height, bounds.y + bounds.height + PADDING_OUTER_PX)
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  }
}

function boundsOfTiles(tiles: Array<TileRect>): TileRect | undefined {
  if (tiles.length === 0) return undefined
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const tile of tiles) {
    minX = Math.min(minX, tile.x)
    minY = Math.min(minY, tile.y)
    maxX = Math.max(maxX, tile.x + tile.width)
    maxY = Math.max(maxY, tile.y + tile.height)
  }
  const nextWidth = maxX - minX
  const nextHeight = maxY - minY
  if (nextWidth <= 0 || nextHeight <= 0) return undefined
  return { x: minX, y: minY, width: nextWidth, height: nextHeight }
}

function mapRectIntoTarget(rect: TileRect, bounds: TileRect, target: TileRect): TileRect {
  return {
    x: target.x + ((rect.x - bounds.x) / bounds.width) * target.width,
    y: target.y + ((rect.y - bounds.y) / bounds.height) * target.height,
    width: (rect.width / bounds.width) * target.width,
    height: (rect.height / bounds.height) * target.height,
  }
}

type SpaceSnifferTreemapProps = {
  root: ScanNode
  detailLevel: number
  selectedPath: string | undefined
  onSelect: (node: ScanNode) => void
  onActivate: (node: ScanNode) => void
  onContextMenu: (event: MouseEvent, node: ScanNode) => void
}

export function SpaceSnifferTreemap({
  root,
  detailLevel,
  selectedPath,
  onSelect,
  onActivate,
  onContextMenu,
}: SpaceSnifferTreemapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [layoutSize, setLayoutSize] = useState({ width: 0, height: 0 })
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())
  const [zoom, setZoom] = useState<ZoomState | undefined>(undefined)
  const [pinned, setPinned] = useState<PinnedLayout | undefined>(undefined)
  /** 后退动画时父级底图（不含正在缩小的子块） */
  const [zoomBackdrop, setZoomBackdrop] = useState<PinnedTile[] | undefined>(undefined)
  const [hoverTip, setHoverTip] = useState<HoverTipState | undefined>(undefined)
  const [tooltipFrame, setTooltipFrame] = useState<{ x: number; y: number } | undefined>(
    undefined,
  )
  const tooltipRef = useRef<HTMLDivElement>(null)
  const enterFolderRef = useRef<ScanNode | undefined>(undefined)
  const enterRectRef = useRef<TileRect | undefined>(undefined)
  const lastExpandRef = useRef<{ path: string; at: number } | undefined>(undefined)
  const tilesRef = useRef<TreemapTile[]>([])
  const shellsRef = useRef<FolderShell[]>([])
  const zoomTimerRef = useRef<number | undefined>(undefined)
  const pendingEnterRef = useRef(false)
  const pendingLeaveRef = useRef(false)
  const prevRootPathRef = useRef(root.path)
  /** 钻取栈；depth 为当前生效层数，后退只减 depth，前进可再放大 */
  const drillStackRef = useRef<DrillFrame[]>([])
  const drillDepthRef = useRef(0)
  const layoutSizeRef = useRef(layoutSize)
  layoutSizeRef.current = layoutSize
  const onActivateRef = useRef(onActivate)
  onActivateRef.current = onActivate
  const prevDetailLevelRef = useRef(detailLevel)

  useEffect(() => {
    if (prevDetailLevelRef.current === detailLevel) return
    prevDetailLevelRef.current = detailLevel
    setPinned(undefined)
    drillStackRef.current = []
    drillDepthRef.current = 0
  }, [detailLevel])

  useLayoutEffect(() => {
    if (!hoverTip || !containerRef.current || !tooltipRef.current) {
      setTooltipFrame(undefined)
      return
    }
    const container = containerRef.current
    const tip = tooltipRef.current
    const frame = placeTooltip(
      hoverTip.cursorX,
      hoverTip.cursorY,
      tip.offsetWidth,
      tip.offsetHeight,
      container.clientWidth,
      container.clientHeight,
    )
    setTooltipFrame(frame)
  }, [hoverTip])

  const playZoomTransition = (
    zoomTiles: ZoomTile[],
    zoomShells: ZoomShell[],
    backdrop: PinnedTile[] | undefined,
    hideUnderPath?: string,
  ) => {
    setPinned(undefined)
    setZoomBackdrop(backdrop)
    setHoverTip(undefined)
    setTooltipFrame(undefined)
    setZoom({ tiles: zoomTiles, shells: zoomShells, active: false, hideUnderPath })
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setZoom((current) => (current ? { ...current, active: true } : current))
      })
    })
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateSize = () => {
      const width = Math.floor(container.clientWidth)
      const height = Math.floor(container.clientHeight)
      setLayoutSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      )
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    return () => {
      if (zoomTimerRef.current !== undefined) window.clearTimeout(zoomTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const prevPath = prevRootPathRef.current
    prevRootPathRef.current = root.path

    setExpandedPaths(new Set())
    enterFolderRef.current = undefined
    enterRectRef.current = undefined
    lastExpandRef.current = undefined

    if (pendingEnterRef.current) {
      pendingEnterRef.current = false
      setZoom(undefined)
      setZoomBackdrop(undefined)
      return
    }

    if (pendingLeaveRef.current) {
      pendingLeaveRef.current = false
      return
    }

    const size = layoutSizeRef.current
    const stack = drillStackRef.current
    const depth = drillDepthRef.current

    // 后退：父级 ← 当前文件夹，原路缩小
    const leaveFrame = depth > 0 ? stack[depth - 1] : undefined
    if (
      leaveFrame &&
      leaveFrame.folderPath === prevPath &&
      leaveFrame.parentPath === root.path &&
      size.width > 0 &&
      size.height > 0
    ) {
      drillDepthRef.current = depth - 1
      pendingLeaveRef.current = true

      const zoomTiles: ZoomTile[] = leaveFrame.folderPinned.tiles.map((tile) => {
        const slot =
          leaveFrame.childSlots.find((entry) => entry.node.path === tile.node.path) ?? tile
        return {
          node: tile.node,
          color: tile.color,
          from: pinnedToRect(tile, size.width, size.height),
          to: pinnedToRect(slot, size.width, size.height),
        }
      })
      const zoomShells: ZoomShell[] = leaveFrame.folderPinned.shells.map((shell) => {
        const slot =
          leaveFrame.parentSettled.shells.find((entry) => entry.path === shell.path) ?? shell
        return {
          node: shell.node,
          path: shell.path,
          name: shell.name,
          byteSize: shell.byteSize,
          from: pinnedShellToRect(shell, size.width, size.height),
          to: pinnedShellToRect(slot, size.width, size.height),
          depth: shell.depth,
          primary: shell.path === leaveFrame.folderPath,
        }
      })
      const others = leaveFrame.parentSettled.tiles.filter(
        (tile) => !leaveFrame.childSlots.some((child) => child.node.path === tile.node.path),
      )
      playZoomTransition(zoomTiles, zoomShells, others)

      if (zoomTimerRef.current !== undefined) window.clearTimeout(zoomTimerRef.current)
      zoomTimerRef.current = window.setTimeout(() => {
        setZoom(undefined)
        setZoomBackdrop(undefined)
        setPinned(leaveFrame.parentSettled)
        setExpandedPaths(new Set(leaveFrame.expandedPaths))
        pendingLeaveRef.current = false
        zoomTimerRef.current = undefined
      }, ZOOM_MS)
      return
    }

    // 前进：父级 → 已钻取过的文件夹，再放大一次
    const enterFrame = stack[depth]
    if (
      enterFrame &&
      enterFrame.parentPath === prevPath &&
      enterFrame.folderPath === root.path &&
      size.width > 0 &&
      size.height > 0
    ) {
      drillDepthRef.current = depth + 1

      const zoomTiles: ZoomTile[] = enterFrame.folderPinned.tiles.map((tile) => {
        const slot =
          enterFrame.childSlots.find((entry) => entry.node.path === tile.node.path) ?? tile
        return {
          node: tile.node,
          color: tile.color,
          from: pinnedToRect(slot, size.width, size.height),
          to: pinnedToRect(tile, size.width, size.height),
        }
      })
      const zoomShells: ZoomShell[] = enterFrame.folderPinned.shells.map((shell) => {
        const slot =
          enterFrame.parentSettled.shells.find((entry) => entry.path === shell.path) ?? shell
        return {
          node: shell.node,
          path: shell.path,
          name: shell.name,
          byteSize: shell.byteSize,
          from: pinnedShellToRect(slot, size.width, size.height),
          to: pinnedShellToRect(shell, size.width, size.height),
          depth: shell.depth,
          primary: shell.path === enterFrame.folderPath,
        }
      })
      const others = enterFrame.parentSettled.tiles.filter(
        (tile) => !enterFrame.childSlots.some((child) => child.node.path === tile.node.path),
      )
      playZoomTransition(zoomTiles, zoomShells, others)

      if (zoomTimerRef.current !== undefined) window.clearTimeout(zoomTimerRef.current)
      zoomTimerRef.current = window.setTimeout(() => {
        setZoom(undefined)
        setZoomBackdrop(undefined)
        setPinned(enterFrame.folderPinned)
        zoomTimerRef.current = undefined
      }, ZOOM_MS)
      return
    }

    // 跨级跳转等：丢掉钻取历史
    drillStackRef.current = []
    drillDepthRef.current = 0
    setZoom(undefined)
    setZoomBackdrop(undefined)
    setPinned((current) => (current?.rootPath === root.path ? current : undefined))
  }, [root.path])

  const computedLayout = useMemo(
    () =>
      computeLayout(
        root,
        layoutSize.width,
        layoutSize.height,
        detailLevel,
        expandedPaths,
      ),
    [detailLevel, expandedPaths, layoutSize.height, layoutSize.width, root],
  )

  const tiles = zoomBackdrop
    ? pinnedToTiles(zoomBackdrop, layoutSize.width, layoutSize.height)
    : pinned?.rootPath === root.path && pinned.tiles.length > 0
      ? pinnedToTiles(pinned.tiles, layoutSize.width, layoutSize.height)
      : computedLayout.tiles

  const shells =
    zoom || zoomBackdrop
      ? []
      : pinned?.rootPath === root.path && pinned.tiles.length > 0
        ? pinnedToShells(pinned.shells, layoutSize.width, layoutSize.height)
        : computedLayout.shells

  if (!zoomBackdrop) {
    tilesRef.current = tiles
    shellsRef.current = shells
  }

  const beginZoomInto = (folder: ScanNode, _from: TileRect) => {
    if (zoom || layoutSize.width <= 0 || layoutSize.height <= 0) {
      onActivateRef.current(folder)
      return
    }

    const currentTiles =
      pinned?.rootPath === root.path && pinned.tiles.length > 0
        ? pinnedToTiles(pinned.tiles, layoutSize.width, layoutSize.height)
        : tilesRef.current
    const currentShells =
      pinned?.rootPath === root.path && pinned.tiles.length > 0
        ? pinnedToShells(pinned.shells, layoutSize.width, layoutSize.height)
        : shellsRef.current

    const childTiles = currentTiles.filter(
      (tile) => isUnderPath(tile.node.path, folder.path) && tile.node.path !== folder.path,
    )
    const childBounds = boundsOfTiles(childTiles)
    if (!childBounds || childTiles.length === 0) {
      setPinned(undefined)
      onActivateRef.current(folder)
      return
    }

    const canvas: TileRect = {
      x: 0,
      y: 0,
      width: layoutSize.width,
      height: layoutSize.height,
    }
    const folderShell = currentShells.find((shell) => shell.path === folder.path)
    const shellFrom: TileRect = folderShell
      ? {
          x: folderShell.x,
          y: folderShell.y,
          width: folderShell.width,
          height: folderShell.height,
        }
      : shellFromChildren(childBounds, canvas)
    const shellTo = canvas
    // 用壳内侧内容区做映射，避免子块包围盒被拉满后顶栏对不齐
    const bounds = shellContentRect(shellFrom)
    const content = viewContentRect(layoutSize.width, layoutSize.height)

    const nestedShells = currentShells.filter(
      (shell) => shell.path !== folder.path && isUnderPath(shell.path, folder.path),
    )
    const otherTiles = currentTiles.filter((tile) => !isUnderPath(tile.node.path, folder.path))
    const childSlots = childTiles.map((tile) =>
      tileToPinned(tile, layoutSize.width, layoutSize.height),
    )
    // 后退时要能缩回原壳位；若当前没画出该壳，用推算出的 shellFrom 补上
    const shellsForParent: FolderShell[] = folderShell
      ? currentShells
      : [
          ...currentShells,
          {
            node: folder,
            path: folder.path,
            name: folder.name,
            byteSize: folder.byteSize,
            x: shellFrom.x,
            y: shellFrom.y,
            width: shellFrom.width,
            height: shellFrom.height,
            depth: 1,
          },
        ]
    const parentSettled: PinnedLayout = {
      rootPath: root.path,
      tiles: [
        ...otherTiles.map((tile) => tileToPinned(tile, layoutSize.width, layoutSize.height)),
        ...childSlots,
      ],
      shells: shellsForParent.map((shell) =>
        shellToPinned(shell, layoutSize.width, layoutSize.height),
      ),
    }

    const zoomTiles: ZoomTile[] = childTiles.map((tile) => ({
      node: tile.node,
      color: tile.color,
      from: {
        x: tile.x,
        y: tile.y,
        width: tile.width,
        height: tile.height,
      },
      to: mapRectIntoTarget(tile, bounds, content),
    }))

    const zoomShells: ZoomShell[] = [
      {
        node: folder,
        path: folder.path,
        name: folder.name,
        byteSize: folder.byteSize,
        from: shellFrom,
        to: shellTo,
        depth: 0,
        primary: true,
      },
      ...nestedShells.map((shell) => ({
        node: shell.node,
        path: shell.path,
        name: shell.name,
        byteSize: shell.byteSize,
        from: {
          x: shell.x,
          y: shell.y,
          width: shell.width,
          height: shell.height,
        },
        to: mapRectIntoTarget(shell, bounds, content),
        depth: shell.depth,
        primary: false,
      })),
    ]

    const rootShellPinned: PinnedShell = {
      node: folder,
      path: folder.path,
      name: folder.name,
      byteSize: folder.byteSize,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      depth: 0,
    }

    const folderPinned: PinnedLayout = {
      rootPath: folder.path,
      tiles: zoomTiles.map((tile) => ({
        node: tile.node,
        color: tile.color,
        x: tile.to.x / layoutSize.width,
        y: tile.to.y / layoutSize.height,
        width: tile.to.width / layoutSize.width,
        height: tile.to.height / layoutSize.height,
      })),
      shells: [
        rootShellPinned,
        ...zoomShells
          .filter((shell) => !shell.primary)
          .map((shell) => ({
            node: shell.node,
            path: shell.path,
            name: shell.name,
            byteSize: shell.byteSize,
            x: shell.to.x / layoutSize.width,
            y: shell.to.y / layoutSize.height,
            width: shell.to.width / layoutSize.width,
            height: shell.to.height / layoutSize.height,
            depth: shell.depth,
          })),
      ],
    }

    // 从当前深度截断再压入，丢掉旧的「前进」分支
    drillStackRef.current = drillStackRef.current.slice(0, drillDepthRef.current)
    drillStackRef.current.push({
      folderPath: folder.path,
      parentPath: root.path,
      parentSettled,
      childSlots,
      folderPinned,
      expandedPaths: [...expandedPaths],
    })
    drillDepthRef.current = drillStackRef.current.length

    playZoomTransition(zoomTiles, zoomShells, undefined, folder.path)

    if (zoomTimerRef.current !== undefined) window.clearTimeout(zoomTimerRef.current)
    zoomTimerRef.current = window.setTimeout(() => {
      setPinned(folderPinned)
      pendingEnterRef.current = true
      onActivateRef.current(folder)
      zoomTimerRef.current = undefined
    }, ZOOM_MS)
  }

  const handleSingleClick = (tile: TreemapTile) => {
    if (zoom) return
    const now = performance.now()
    const recent = lastExpandRef.current
    if (
      recent &&
      now - recent.at < DOUBLE_CLICK_MS &&
      isUnderPath(tile.node.path, recent.path)
    ) {
      return
    }

    onSelect(tile.node)
    if (tile.node.kind !== 'folder') return

    enterFolderRef.current = tile.node
    enterRectRef.current = {
      x: tile.x,
      y: tile.y,
      width: tile.width,
      height: tile.height,
    }

    const hasVisibleChildren = (tile.node.children ?? []).some((child) => child.byteSize > 0)
    if (!hasVisibleChildren) return

    lastExpandRef.current = { path: tile.node.path, at: now }

    if (expandedPaths.has(tile.node.path)) {
      setExpandedPaths((current) => {
        const next = new Set(current)
        next.delete(tile.node.path)
        return next
      })
      if (pinned?.rootPath === root.path) {
        setPinned(undefined)
      }
      return
    }

    if (pinned?.rootPath === root.path) {
      setPinned(undefined)
    }

    setExpandedPaths((current) => {
      const next = new Set(current)
      next.add(tile.node.path)
      return next
    })
  }

  if (root.byteSize <= 0) {
    return (
      <div class="space-sniffer__treemap space-sniffer__treemap--empty" aria-label="暂无数据">
        <p>暂无可显示的占用</p>
      </div>
    )
  }

  const busy = Boolean(zoom)
  const displayTiles = zoom?.hideUnderPath
    ? tiles.filter((tile) => !isUnderPath(tile.node.path, zoom.hideUnderPath!))
    : tiles

  const nestedShells = shells.filter((shell) => shell.path !== root.path)
  // 当前视图根外框始终铺满画布，画在色块之上，避免被盖住或从 pin 里丢
  const rootShell =
    !busy && !zoomBackdrop && layoutSize.width > 0 && layoutSize.height > 0
      ? {
          node: root,
          path: root.path,
          name: root.name,
          byteSize: root.byteSize,
          x: 0,
          y: 0,
          width: layoutSize.width,
          height: layoutSize.height,
          depth: 0,
        }
      : undefined

  const renderShell = (shell: FolderShell, isRoot: boolean) => {
    const showLabel = shell.width >= 40 && shell.height >= FOLDER_HEADER_PX
    const showSize = shell.width >= 96
    const sizeText = formatStorageSize(shell.byteSize)
    const canEnter = !isRoot
    return (
      <div
        key={`shell:${shell.path}`}
        class={`space-sniffer__folder-shell${isRoot ? ' space-sniffer__folder-shell--root' : ''}`}
        style={{
          left: shell.x,
          top: shell.y,
          width: shell.width,
          height: shell.height,
          // 嵌套壳必须低于色块，否则不透明底会盖住子内容；根框透明描边可压在最上面
          zIndex: isRoot ? ROOT_SHELL_Z : 0,
        }}
      >
        {showLabel ? (
          <div
            class={`space-sniffer__folder-shell-label${canEnter ? ' space-sniffer__folder-shell-label--enter' : ''}`}
            title={canEnter ? `双击进入 ${shell.name}` : undefined}
            onDblClick={(event) => {
              event.stopPropagation()
              if (busy || !canEnter) return
              beginZoomInto(shell.node, {
                x: shell.x,
                y: shell.y,
                width: shell.width,
                height: shell.height,
              })
            }}
          >
            <span class="space-sniffer__folder-shell-name">{shell.name}</span>
            {showSize ? (
              <span class="space-sniffer__folder-shell-size">{sizeText}</span>
            ) : undefined}
          </div>
        ) : undefined}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      class={`space-sniffer__treemap${busy ? ' space-sniffer__treemap--busy' : ''}`}
      aria-label="文件占用矩形树图"
      role="group"
    >
      {busy ? <div class="space-sniffer__zoom-veil" aria-hidden="true" /> : undefined}

      {nestedShells.map((shell) => renderShell(shell, false))}

      {/* 缩放中：标题壳跟色块一起过渡，实底盖住挖空，避免 tab 消失/透底 */}
      {zoom
        ? zoom.shells.map((shell) => {
            const rect = zoom.active ? shell.to : shell.from
            const showLabel = rect.width >= 40 && rect.height >= FOLDER_HEADER_PX
            const showSize = rect.width >= 96
            return (
              <div
                key={`zoom-shell:${shell.path}`}
                class={`space-sniffer__folder-shell space-sniffer__folder-shell--zoom${
                  shell.primary ? ' space-sniffer__folder-shell--zoom-primary' : ''
                }`}
                style={{
                  left: rect.x,
                  top: rect.y,
                  width: rect.width,
                  height: rect.height,
                  // 主壳实底在下盖挖空；嵌套壳标题在其上；色块最高
                  zIndex: shell.primary ? 2 : 3,
                }}
              >
                {showLabel ? (
                  <div class="space-sniffer__folder-shell-label">
                    <span class="space-sniffer__folder-shell-name">{shell.name}</span>
                    {showSize ? (
                      <span class="space-sniffer__folder-shell-size">
                        {formatStorageSize(shell.byteSize)}
                      </span>
                    ) : undefined}
                  </div>
                ) : undefined}
              </div>
            )
          })
        : undefined}

      {displayTiles.map((tile) => {
        const selected = tile.node.path === selectedPath
        const showLabel = tile.width >= 36 && tile.height >= 22
        const showSize = tile.width >= 72 && tile.height >= 42
        const sizeText = formatStorageSize(tile.node.byteSize)
        const kindLabel = tile.node.kind === 'folder' ? '文件夹' : '文件'
        const ariaLabel = `${kindLabel} ${tile.node.name}，${sizeText}`
        const style = {
          left: `${tile.x}px`,
          top: `${tile.y}px`,
          width: `${tile.width}px`,
          height: `${tile.height}px`,
          background: tile.color,
        }

        return (
          <button
            type="button"
            key={tile.node.path}
            class={`space-sniffer__tile${selected ? ' space-sniffer__tile--selected' : ''}`}
            style={style}
            aria-label={ariaLabel}
            disabled={busy}
            onMouseEnter={(event) => {
              if (busy) return
              const container = containerRef.current
              if (!container) return
              setTooltipFrame(undefined)
              setHoverTip(hoverTipFromEvent(event, container, tile, kindLabel, sizeText))
            }}
            onMouseMove={(event) => {
              if (busy) return
              const container = containerRef.current
              if (!container) return
              setTooltipFrame(undefined)
              setHoverTip(hoverTipFromEvent(event, container, tile, kindLabel, sizeText))
            }}
            onMouseLeave={() => {
              setHoverTip(undefined)
              setTooltipFrame(undefined)
            }}
            onClick={(event) => {
              event.stopPropagation()
              setHoverTip(undefined)
              setTooltipFrame(undefined)
              handleSingleClick(tile)
            }}
            onDblClick={(event) => {
              event.stopPropagation()
              if (busy) return
              if (tile.node.kind === 'folder') {
                beginZoomInto(tile.node, {
                  x: tile.x,
                  y: tile.y,
                  width: tile.width,
                  height: tile.height,
                })
                return
              }
              const folder = enterFolderRef.current
              const from = enterRectRef.current
              if (folder?.kind === 'folder' && from) {
                beginZoomInto(folder, from)
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (busy) return
              setHoverTip(undefined)
              setTooltipFrame(undefined)
              onSelect(tile.node)
              onContextMenu(event, tile.node)
            }}
          >
            {showLabel ? (
              <span class="space-sniffer__tile-copy">
                <span class="space-sniffer__tile-name">{tile.node.name}</span>
                {showSize ? (
                  <span class="space-sniffer__tile-size">{sizeText}</span>
                ) : undefined}
              </span>
            ) : undefined}
          </button>
        )
      })}

      {rootShell ? renderShell(rootShell, true) : undefined}

      {hoverTip && tooltipFrame && !busy ? (
        <div
          ref={tooltipRef}
          class="space-sniffer__tooltip"
          style={{ left: `${tooltipFrame.x}px`, top: `${tooltipFrame.y}px` }}
          role="tooltip"
        >
          <span class="space-sniffer__tooltip-kind">{hoverTip.kind}</span>
          <span class="space-sniffer__tooltip-name">{hoverTip.name}</span>
          <span class="space-sniffer__tooltip-size">{hoverTip.size}</span>
        </div>
      ) : hoverTip && !busy ? (
        <div
          ref={tooltipRef}
          class="space-sniffer__tooltip space-sniffer__tooltip--measure"
          aria-hidden="true"
        >
          <span class="space-sniffer__tooltip-kind">{hoverTip.kind}</span>
          <span class="space-sniffer__tooltip-name">{hoverTip.name}</span>
          <span class="space-sniffer__tooltip-size">{hoverTip.size}</span>
        </div>
      ) : undefined}

      {zoom
        ? zoom.tiles.map((tile) => {
            const rect = zoom.active ? tile.to : tile.from
            const showLabel = rect.width >= 36 && rect.height >= 22
            const showSize = rect.width >= 72 && rect.height >= 42
            return (
              <div
                key={tile.node.path}
                class="space-sniffer__tile space-sniffer__tile--zoom"
                style={{
                  left: rect.x,
                  top: rect.y,
                  width: rect.width,
                  height: rect.height,
                  background: tile.color,
                }}
              >
                {showLabel ? (
                  <span class="space-sniffer__tile-copy">
                    <span class="space-sniffer__tile-name">{tile.node.name}</span>
                    {showSize ? (
                      <span class="space-sniffer__tile-size">
                        {formatStorageSize(tile.node.byteSize)}
                      </span>
                    ) : undefined}
                  </span>
                ) : undefined}
              </div>
            )
          })
        : undefined}
    </div>
  )
}
