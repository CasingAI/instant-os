import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import type { ManagedAppEntry } from './app-storage.ts'
import { getManagedAppTotalBytes } from './app-storage.ts'
import { formatStorageSize } from './format-storage-size.ts'

const CHART_COLORS = [
  '#4a90e2',
  '#5856d6',
  '#34c759',
  '#ff9500',
  '#ff3b30',
  '#af52de',
  '#5ac8fa',
  '#ff2d55',
  '#64d2ff',
  '#a2845e',
] as const

type AppsStorageViewProps = {
  entries: ManagedAppEntry[]
  totalBytes: number
  onBack: () => void
  onSelectApp: (entry: ManagedAppEntry) => void
}

type ChartSlice = {
  id: string
  label: string
  bytes: number
  percent: number
  color: string
  entry?: ManagedAppEntry
}

type TreemapHierarchyDatum = {
  name: string
  value?: number
  slice?: ChartSlice
  children?: TreemapHierarchyDatum[]
}

type TreemapTile = {
  slice: ChartSlice
  x: number
  y: number
  width: number
  height: number
}

function colorForEntry(entry: ManagedAppEntry | undefined, index: number): string {
  if (entry?.themeColor) {
    return entry.themeColor
  }
  return CHART_COLORS[index % CHART_COLORS.length] ?? CHART_COLORS[0]
}

function buildChartSlices(entries: ManagedAppEntry[], totalBytes: number): ChartSlice[] {
  const appEntries = entries
    .map((entry) => ({
      entry,
      bytes: getManagedAppTotalBytes(entry),
    }))
    .filter((item) => item.bytes > 0)
    .sort((left, right) => right.bytes - left.bytes)

  const attributedBytes = appEntries.reduce((sum, item) => sum + item.bytes, 0)
  const overheadBytes = Math.max(0, totalBytes - attributedBytes)

  const slices: ChartSlice[] = appEntries.map((item, index) => ({
    id: item.entry.id,
    label: item.entry.name,
    bytes: item.bytes,
    percent: totalBytes > 0 ? (item.bytes / totalBytes) * 100 : 0,
    color: colorForEntry(item.entry, index),
    entry: item.entry,
  }))

  if (overheadBytes > 0) {
    slices.push({
      id: '__registry__',
      label: '应用清单索引',
      bytes: overheadBytes,
      percent: totalBytes > 0 ? (overheadBytes / totalBytes) * 100 : 0,
      color: '#c7c7cc',
    })
  }

  return slices
}

function formatPercent(value: number): string {
  if (value <= 0) {
    return '0%'
  }
  if (value < 1) {
    return '<1%'
  }
  if (value >= 10) {
    return `${Math.round(value)}%`
  }
  return `${value.toFixed(1)}%`
}

function computeTreemapTiles(slices: ChartSlice[], width: number, height: number): TreemapTile[] {
  if (slices.length === 0 || width <= 0 || height <= 0) {
    return []
  }

  const root = hierarchy<TreemapHierarchyDatum>({
    name: 'root',
    children: slices.map((slice) => ({
      name: slice.label,
      value: slice.bytes,
      slice,
    })),
  })
    .sum((datum) => datum.value ?? 0)
    .sort((left, right) => (right.value ?? 0) - (left.value ?? 0))

  const layoutRoot = treemap<TreemapHierarchyDatum>()
    .tile(treemapSquarify)
    .size([width, height])
    .paddingInner(2)
    .round(true)(root)

  return layoutRoot.leaves().flatMap((node) => {
    const { slice } = node.data
    if (!slice) {
      return []
    }

    const tileWidth = node.x1 - node.x0
    const tileHeight = node.y1 - node.y0
    if (tileWidth <= 0 || tileHeight <= 0) {
      return []
    }

    return [
      {
        slice,
        x: node.x0,
        y: node.y0,
        width: tileWidth,
        height: tileHeight,
      },
    ]
  })
}

type StorageTreemapProps = {
  slices: ChartSlice[]
  onSelectSlice: (slice: ChartSlice) => void
}

function StorageTreemap({ slices, onSelectSlice }: StorageTreemapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [layoutSize, setLayoutSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const updateSize = () => {
      const width = Math.floor(container.clientWidth)
      const height = Math.floor(container.clientHeight)
      setLayoutSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      )
    }

    updateSize()
    const resizeObserver = new ResizeObserver(updateSize)
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [])

  const tiles = useMemo(
    () => computeTreemapTiles(slices, layoutSize.width, layoutSize.height),
    [layoutSize.height, layoutSize.width, slices],
  )

  if (slices.length === 0) {
    return (
      <div class="settings__treemap settings__treemap--empty" aria-label="暂无应用存储数据">
        <p>暂无应用占用系统空间</p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      class="settings__treemap settings__treemap--interactive"
      aria-label="应用程序存储占比方块图"
      role="group"
    >
      {tiles.map((tile) => (
        <TreemapTileView
          key={tile.slice.id}
          tile={tile}
          onSelect={tile.slice.entry ? () => onSelectSlice(tile.slice) : undefined}
        />
      ))}
    </div>
  )
}

type TreemapTileViewProps = {
  tile: TreemapTile
  onSelect?: () => void
}

function TreemapTileView({ tile, onSelect }: TreemapTileViewProps) {
  const { slice, x, y, width, height } = tile
  const showLabel = width >= 28 && height >= 20
  const showSize = width >= 64 && height >= 44
  const tooltip = `${slice.label} · ${formatStorageSize(slice.bytes)} · ${formatPercent(slice.percent)}`
  const style = {
    left: `${x}px`,
    top: `${y}px`,
    width: `${width}px`,
    height: `${height}px`,
    background: slice.color,
  }

  const label = showLabel ? (
    <span class="settings__treemap-tile-copy">
      <span class="settings__treemap-tile-name">{slice.label}</span>
      {showSize ? (
        <span class="settings__treemap-tile-size">{formatStorageSize(slice.bytes)}</span>
      ) : undefined}
    </span>
  ) : undefined

  if (onSelect) {
    return (
      <button
        type="button"
        class="settings__treemap-tile settings__treemap-tile--button"
        style={style}
        title={tooltip}
        aria-label={tooltip}
        onClick={onSelect}
      >
        {label}
      </button>
    )
  }

  return (
    <div class="settings__treemap-tile" style={style} title={tooltip} aria-label={tooltip}>
      {label}
    </div>
  )
}

export function AppsStorageView({ entries, totalBytes, onBack, onSelectApp }: AppsStorageViewProps) {
  const generatedEntries = useMemo(
    () => entries.filter((entry) => entry.kind === 'generated'),
    [entries],
  )
  const slices = useMemo(
    () => buildChartSlices(generatedEntries, totalBytes),
    [generatedEntries, totalBytes],
  )

  const handleSelectSlice = useMemo(
    () => (slice: ChartSlice) => {
      if (slice.entry) {
        onSelectApp(slice.entry)
      }
    },
    [onSelectApp],
  )

  return (
    <div class="settings settings--apps-storage">
      <div class="settings__nav">
        <IosNavBackButton label="存储空间" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section settings__section--fill">
          <h2 class="settings__section-title">应用程序</h2>
          <p class="settings__section-subtitle">各应用占系统空间中「应用程序」分类的比例</p>
          <div class="settings__box settings__treemap-panel settings__treemap-panel--fill">
            <StorageTreemap slices={slices} onSelectSlice={handleSelectSlice} />
          </div>
        </section>
      </div>
    </div>
  )
}
