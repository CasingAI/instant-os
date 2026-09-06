import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { FixedRowVirtualList } from './fixed-row-virtual-list.tsx'
import './waterfall.css'

const DEFAULT_ITEM_HEIGHT = 96
const DEFAULT_MIN_ITEM_WIDTH = 88
const DEFAULT_GAP = 8
const DEFAULT_OVERSCAN = 3

export type WaterfallProps<T> = {
  items: readonly T[]
  itemKey: (item: T, index: number) => string
  renderItem: (item: T, index: number) => ComponentChildren
  /** 每格高度 px；行距 = itemHeight + gap */
  itemHeight?: number
  /** 列数；不给则按容器宽度与 minItemWidth 自适应 */
  columns?: number
  /** 自适应时每格最小宽度 px */
  minItemWidth?: number
  /** 格间距 px：横向由行内 grid 列间距消化，纵向计入行距 */
  gap?: number
  /** 视口外多渲染几行 */
  overscan?: number
  /** 变化时滚动到该条目（若在视口外则就近滚入） */
  scrollToIndex?: number
  /** items 为空时渲染的兜底内容 */
  empty?: ComponentChildren
  /** 追加到容器的修饰类 */
  className?: string
}

/**
 * 数据驱动的网格集合视图（一期网格摆法）：
 * 量容器宽度定列数 → 条目按列数切行 → 行交给 FixedRowVirtualList 虚拟滚动，行内 CSS grid 摆格。
 * 高度由外部容器给（flex 子元素或固定高），与 FixedRowVirtualList 同一约定。
 */
export function Waterfall<T>({
  items,
  itemKey,
  renderItem,
  itemHeight = DEFAULT_ITEM_HEIGHT,
  columns,
  minItemWidth = DEFAULT_MIN_ITEM_WIDTH,
  gap = DEFAULT_GAP,
  overscan = DEFAULT_OVERSCAN,
  scrollToIndex,
  empty,
  className,
}: WaterfallProps<T>) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const resolvedColumns =
    columns ?? Math.max(1, Math.floor((width + gap) / (minItemWidth + gap)) || 1)

  // 列数变化整表重切；条数不变则总行数不变、总高不变，滚动位置不跳
  const rows = useMemo(() => {
    const result: T[][] = []
    for (let i = 0; i < items.length; i += resolvedColumns) {
      result.push(items.slice(i, i + resolvedColumns))
    }
    return result
  }, [items, resolvedColumns])

  const scrollToRow =
    scrollToIndex !== undefined ? Math.floor(scrollToIndex / resolvedColumns) : undefined

  let content: ComponentChildren
  if (items.length === 0) {
    content = empty
  } else {
    content = (
      <FixedRowVirtualList
        className="fixed-row-virtual-list waterfall__scroller"
        items={rows}
        rowHeight={itemHeight + gap}
        overscan={overscan}
        scrollToIndex={scrollToRow}
        itemKey={(row, rowIndex) =>
          row.length > 0 ? itemKey(row[0], rowIndex * resolvedColumns) : `row-${rowIndex}`
        }
        renderItem={(row, rowIndex) => (
          <div
            class="waterfall__row"
            style={{
              gridTemplateColumns: `repeat(${resolvedColumns}, 1fr)`,
              columnGap: `${gap}px`,
            }}
          >
            {row.map((item, i) => {
              const index = rowIndex * resolvedColumns + i
              return (
                <div key={itemKey(item, index)} class="waterfall__cell" style={{ height: `${itemHeight}px` }}>
                  {renderItem(item, index)}
                </div>
              )
            })}
          </div>
        )}
      />
    )
  }

  return (
    <div ref={wrapRef} class={`waterfall${className ? ` ${className}` : ''}`}>
      {content}
    </div>
  )
}
