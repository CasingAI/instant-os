import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'

const DEFAULT_ROW_HEIGHT = 32
const DEFAULT_OVERSCAN = 8

export type GithubChangesVirtualListProps<T> = {
  items: readonly T[]
  itemKey: (item: T, index: number) => string
  renderItem: (item: T, index: number) => ComponentChildren
  rowHeight?: number
  overscan?: number
  className?: string
}

/**
 * 固定行高的虚拟列表：只挂载可见行 + overscan，避免上千变更时 DOM 爆炸。
 */
export function GithubChangesVirtualList<T>({
  items,
  itemKey,
  renderItem,
  rowHeight = DEFAULT_ROW_HEIGHT,
  overscan = DEFAULT_OVERSCAN,
  className = 'github-desktop__changes-list',
}: GithubChangesVirtualListProps<T>) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const update = () => {
      setViewportHeight(el.clientHeight)
      setScrollTop(el.scrollTop)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [items.length])

  const onScroll = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    setScrollTop(el.scrollTop)
  }, [])

  const { startIndex, endIndex, offsetY, totalHeight } = useMemo(() => {
    const total = items.length * rowHeight
    if (items.length === 0 || viewportHeight <= 0) {
      return { startIndex: 0, endIndex: 0, offsetY: 0, totalHeight: total }
    }
    const rawStart = Math.floor(scrollTop / rowHeight)
    const visibleCount = Math.ceil(viewportHeight / rowHeight)
    const start = Math.max(0, rawStart - overscan)
    const end = Math.min(items.length, rawStart + visibleCount + overscan)
    return {
      startIndex: start,
      endIndex: end,
      offsetY: start * rowHeight,
      totalHeight: total,
    }
  }, [items.length, rowHeight, scrollTop, viewportHeight, overscan])

  const visible = items.slice(startIndex, endIndex)

  return (
    <div ref={scrollerRef} class={className} onScroll={onScroll}>
      <div
        class="github-desktop__changes-virtual-spacer"
        style={{ height: `${totalHeight}px` }}
      >
        <div
          class="github-desktop__changes-virtual-window"
          style={{ transform: `translateY(${offsetY}px)` }}
        >
          {visible.map((item, i) => {
            const index = startIndex + i
            return (
              <div
                key={itemKey(item, index)}
                class="github-desktop__changes-virtual-row"
                style={{ height: `${rowHeight}px` }}
              >
                {renderItem(item, index)}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
