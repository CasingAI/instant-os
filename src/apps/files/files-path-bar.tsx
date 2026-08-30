import type { ComponentChildren } from 'preact'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { formatStorageSize } from '../../os/format-storage-size.ts'

export type FilesPathBarSegment = {
  key: string
  label: string
  /** 卷根为 undefined */
  folderId: string | undefined
  current: boolean
}

type FilesPathBarProps = {
  segments: readonly FilesPathBarSegment[]
  absolutePath: string
  /** 当前容器已用空间（undefined 则不显示） */
  usedBytes?: number
  onNavigate: (folderId: string | undefined) => void
}

type VisibleLayout = {
  head: FilesPathBarSegment[]
  collapsed: FilesPathBarSegment[]
  tail: FilesPathBarSegment[]
}

const ELLIPSIS_WIDTH = 36
const CHEVRON_WIDTH = 14
const HOST_PAD = 16

function Chevron() {
  return (
    <span class="files__path-bar-chevron" aria-hidden="true">
      ›
    </span>
  )
}

function SegmentButton({
  segment,
  onNavigate,
}: {
  segment: FilesPathBarSegment
  onNavigate: (folderId: string | undefined) => void
}) {
  if (segment.current) {
    return (
      <span class="files__path-bar-segment files__path-bar-segment--current" title={segment.label}>
        {segment.label}
      </span>
    )
  }

  return (
    <button
      type="button"
      class="files__path-bar-segment"
      title={segment.label}
      onClick={() => onNavigate(segment.folderId)}
    >
      {segment.label}
    </button>
  )
}

function layoutForWidths(
  segments: readonly FilesPathBarSegment[],
  widths: number[],
  available: number,
): VisibleLayout {
  if (segments.length === 0) {
    return { head: [], collapsed: [], tail: [] }
  }
  if (segments.length === 1) {
    return { head: [], collapsed: [], tail: [segments[0]] }
  }

  const chevrons = (segments.length - 1) * CHEVRON_WIDTH
  const full = widths.reduce((sum, w) => sum + w, 0) + chevrons
  if (full <= available || widths.length !== segments.length) {
    return { head: [], collapsed: [], tail: [...segments] }
  }

  const first = segments[0]
  const last = segments[segments.length - 1]
  const firstW = widths[0] ?? 0
  const lastW = widths[widths.length - 1] ?? 0
  let used = firstW + lastW + ELLIPSIS_WIDTH + CHEVRON_WIDTH * 2

  const tail: FilesPathBarSegment[] = [last]
  let consumeFrom = segments.length - 2
  while (consumeFrom >= 1) {
    const w = (widths[consumeFrom] ?? 0) + CHEVRON_WIDTH
    if (used + w > available) break
    used += w
    tail.unshift(segments[consumeFrom])
    consumeFrom -= 1
  }

  const collapsed = segments.slice(1, consumeFrom + 1)
  if (collapsed.length === 0) {
    return { head: [], collapsed: [], tail: [...segments] }
  }

  return { head: [first], collapsed, tail }
}

function appendSegments(
  nodes: ComponentChildren[],
  items: readonly FilesPathBarSegment[],
  keyPrefix: string,
  onNavigate: (folderId: string | undefined) => void,
  leadingChevron: boolean,
) {
  for (let index = 0; index < items.length; index += 1) {
    if (leadingChevron || index > 0) {
      nodes.push(<Chevron key={`${keyPrefix}-c-${index}`} />)
    }
    nodes.push(
      <SegmentButton
        key={items[index].key}
        segment={items[index]}
        onNavigate={onNavigate}
      />,
    )
  }
}

export function FilesPathBar({ segments, absolutePath, usedBytes, onNavigate }: FilesPathBarProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const sizeRef = useRef<HTMLSpanElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [availableWidth, setAvailableWidth] = useState(0)
  const [segmentWidths, setSegmentWidths] = useState<number[]>([])
  const [menuOpen, setMenuOpen] = useState(false)

  const segmentKey = useMemo(() => segments.map((item) => item.key).join('\0'), [segments])

  // 右侧「已用」尺寸占位宽度要从路径可用宽度里扣掉，长路径才不会顶到尺寸文字
  const updateAvailableWidth = () => {
    const host = hostRef.current
    if (!host) return
    const sizeWidth = sizeRef.current?.offsetWidth ?? 0
    setAvailableWidth(Math.max(0, host.clientWidth - HOST_PAD - sizeWidth))
  }

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return

    updateAvailableWidth()
    const observer = new ResizeObserver(updateAvailableWidth)
    observer.observe(host)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // usedBytes 变化会改变尺寸占位宽度，重算一次可用宽度
  useLayoutEffect(() => {
    updateAvailableWidth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usedBytes])

  useLayoutEffect(() => {
    const row = measureRef.current
    if (!row) return
    const buttons = [...row.querySelectorAll<HTMLElement>('[data-path-measure]')]
    setSegmentWidths(buttons.map((node) => node.getBoundingClientRect().width))
  }, [segmentKey, segments])

  const layout = useMemo(
    () => layoutForWidths(segments, segmentWidths, availableWidth),
    [availableWidth, segmentWidths, segments],
  )

  useEffect(() => {
    setMenuOpen(false)
  }, [segmentKey])

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      setMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  if (segments.length === 0) return undefined

  const showCollapsed = layout.collapsed.length > 0
  const nodes: ComponentChildren[] = []

  if (!showCollapsed) {
    appendSegments(nodes, layout.tail, 'all', onNavigate, false)
  } else {
    appendSegments(nodes, layout.head, 'head', onNavigate, false)
    if (layout.head.length > 0) {
      nodes.push(<Chevron key="before-ellipsis" />)
    }
    nodes.push(
      <span key="ellipsis-wrap" class="files__path-bar-ellipsis-wrap" ref={menuRef}>
        <button
          type="button"
          class="files__path-bar-ellipsis"
          aria-label="更多路径"
          aria-expanded={menuOpen}
          onClick={(event) => {
            event.stopPropagation()
            setMenuOpen((open) => !open)
          }}
        >
          …
        </button>
        {menuOpen ? (
          <div class="files__path-bar-menu" role="menu">
            {[...layout.collapsed].reverse().map((segment) => (
              <button
                key={segment.key}
                type="button"
                class="files__path-bar-menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  onNavigate(segment.folderId)
                }}
              >
                {segment.label}
              </button>
            ))}
          </div>
        ) : undefined}
      </span>,
    )
    appendSegments(nodes, layout.tail, 'tail', onNavigate, true)
  }

  return (
    <div class="files__path-bar" ref={hostRef} title={absolutePath}>
      <div class="files__path-bar-measure" ref={measureRef} aria-hidden="true">
        {segments.map((segment) => (
          <span key={segment.key} data-path-measure class="files__path-bar-segment">
            {segment.label}
          </span>
        ))}
      </div>
      <nav class="files__path-bar-row" aria-label="当前位置路径">
        {nodes}
      </nav>
      {usedBytes !== undefined ? (
        <span class="files__path-bar-size" ref={sizeRef}>
          已用 {formatStorageSize(usedBytes)}
        </span>
      ) : undefined}
    </div>
  )
}
