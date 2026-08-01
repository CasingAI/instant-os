import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import './fixed-row-virtual-list.css'

const DEFAULT_ROW_HEIGHT = 32
const DEFAULT_OVERSCAN = 8

export type FixedRowVirtualListProps<T> = {
  items: readonly T[]
  itemKey: (item: T, index: number) => string
  renderItem: (item: T, index: number) => ComponentChildren
  rowHeight?: number
  overscan?: number
  className?: string
  /** 变化时滚动到该行（若在视口外则就近滚入） */
  scrollToIndex?: number
}

/**
 * 固定行高的虚拟列表：只挂载可见行 + overscan，避免超长列表 DOM 爆炸。
 * 行高固定；需要滚动到某行时，把 scrollTop 交给外层或传入初始滚动位置。
 */
export function FixedRowVirtualList<T>({
  items,
  itemKey,
  renderItem,
  rowHeight = DEFAULT_ROW_HEIGHT,
  overscan = DEFAULT_OVERSCAN,
  className = 'fixed-row-virtual-list',
  scrollToIndex,
}: FixedRowVirtualListProps<T>) {
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

  // 当前行变化时就近滚入视口（行在视口内则不动）
  useEffect(() => {
    if (scrollToIndex === undefined) return
    const el = scrollerRef.current
    if (!el) return
    const top = scrollToIndex * rowHeight
    const bottom = top + rowHeight
    if (top < el.scrollTop) {
      el.scrollTop = top
    } else if (bottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, bottom - el.clientHeight)
    }
  }, [scrollToIndex, rowHeight])

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
      <div class="fixed-row-virtual-list__spacer" style={{ height: `${totalHeight}px` }}>
        <div
          class="fixed-row-virtual-list__window"
          style={{ transform: `translateY(${offsetY}px)` }}
        >
          {visible.map((item, i) => {
            const index = startIndex + i
            return (
              <div
                key={itemKey(item, index)}
                class="fixed-row-virtual-list__row"
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
