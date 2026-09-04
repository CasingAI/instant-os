import type { ComponentChildren, JSX } from 'preact'
import { createContext } from 'preact'
import { useContext, useEffect, useRef, useState } from 'preact/hooks'
import './list.css'

type ListProps = {
  /** 追加到容器的局部修饰类。 */
  class?: string
  /** 表头内容（span 序列）；有值时渲染 list__head 容器。 */
  head?: ComponentChildren
  /** 追加到表头的附加类。 */
  headClass?: string
  /** 追加到滚动体的附加类；配合 scrollable 使用。 */
  bodyClass?: string
  /** 滚动体：children 包进 list__body（max-height 280 + overflow auto）。 */
  scrollable?: boolean
  /** 节标题（盒子外上方）。 */
  title?: ComponentChildren
  /** 节脚注（盒子外下方）。 */
  footnote?: ComponentChildren
  /** 右缘 A-Z 索引条：自动收集子级 ListSection 并支持点击/沿条拖动跳节；槽位放不下完整字母时按 iOS 方式等分压缩、隔位 • 占位，槽位连圆点都放不下时只渲染采样字母（触点始终按全节等比映射，显示与触点不同步）。 */
  indexBar?: boolean
  /** 编辑模式：ListItem 行出现减号删除钮与拖拽排序把手。 */
  editing?: boolean
  /** 受控单选：配合 ListItem 的 id 使用。 */
  selectedId?: string
  onSelect?: (id: string) => void
  /** 编辑模式：确认删除某行（id 为 ListItem 的 id）。 */
  onDelete?: (id: string) => void
  /** 编辑模式：拖拽重排落定（fromId 行移到 toId 行的位置）。 */
  onReorder?: (fromId: string, toId: string) => void
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'class' | 'onSelect'>

function joinClass(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base
}

/** iOS 式索引压缩阈值：每槽低于该高度（10px 字形 + ~3px 呼吸）视为放不下完整字母，进入压缩档。 */
const MIN_INDEX_SLOT_PX = 13

/** 压缩档步距：1 = 全字母；n = 每 n 槽显示 1 个真实字母，其余槽显示 •（触点不分家）。 */
function indexStrideFor(height: number, count: number): number {
  if (height <= 0 || count <= 0) return 1
  const maxShown = Math.max(1, Math.floor(height / MIN_INDEX_SLOT_PX))
  return count > maxShown ? Math.ceil(count / maxShown) : 1
}

/** List ↔ ListItem 结合上下文：受控单选 + 编辑态 + 拖拽重排。 */
type ListContextValue = {
  selectedId?: string
  onSelect?: (id: string) => void
  editing?: boolean
  onDelete?: (id: string) => void
  onReorder?: (fromId: string, toId: string) => void
  beginReorder?: (event: ListPointerEvent, id: string) => void
  moveReorder?: (event: ListPointerEvent) => void
  endReorder?: () => void
}

/** 拖拽把手需要的最小指针事件面（preact 的 PointerEvent 结构上兼容）。 */
export type ListPointerEvent = {
  clientY: number
  pointerId: number
  currentTarget: EventTarget & Element
}

const ListContext = createContext<ListContextValue>({})

type ListSectionAnchor = {
  key: string
  label: string
}

type ReorderDrag = {
  rows: HTMLElement[]
  fromIndex: number
  toIndex: number
  height: number
  startY: number
}

/**
 * iOS 设置风格的分组列表容器。行内容放 ListItem（或过渡期旧家族行组件，
 * 它们自带样式）；容器、行、状态观感全部自有于 list.css，不依赖任何外部
 * 作用域——换肤/暗色只需覆盖 --list-* token。
 */
export function List({
  class: listClass,
  head,
  headClass,
  bodyClass,
  scrollable,
  title,
  footnote,
  indexBar,
  editing,
  selectedId,
  onSelect,
  onDelete,
  onReorder,
  children,
  ...rest
}: ListProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const indexStripRef = useRef<HTMLDivElement>(null)
  const [sections, setSections] = useState<ListSectionAnchor[]>([])
  // 按住/拖动索引条时命中的字母：整条挂 --pressed、当前字母挂 --active（悬停反馈由 CSS :hover 负责）
  const [activeLetter, setActiveLetter] = useState<string | null>(null)
  // 索引条槽位高度，压缩档的判定输入；量到 0 说明窗口隐藏，维持上次值
  const [indexStripHeight, setIndexStripHeight] = useState(0)
  const dragRef = useRef<ReorderDrag | null>(null)

  useEffect(() => {
    if (!indexBar) return
    const root = rootRef.current
    if (!root) return
    const collect = () => {
      const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-list-section]'))
      setSections(
        nodes
          .map((node) => ({
            key: node.dataset.listSection ?? '',
            label: node.dataset.listSectionLabel ?? node.dataset.listSection ?? '',
          }))
          .filter((section) => section.key !== ''),
      )
    }
    collect()
    const observer = new MutationObserver(collect)
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [indexBar])

  // 索引条随节集合条件渲染，挂载后才开始测量；ResizeObserver 跟随窗口/卡片高度变化
  const stripMounted = sections.length > 0
  useEffect(() => {
    if (!indexBar || !stripMounted) return
    const strip = indexStripRef.current
    if (!strip) return
    const measure = () => {
      const height = strip.clientHeight
      if (height > 0) setIndexStripHeight(height)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(strip)
    return () => observer.disconnect()
  }, [indexBar, stripMounted])

  // 只滚 .list__body：scrollIntoView 会沿祖先链把 ui-kit 内容区/窗口一起带走。
  // 没有滚动体时不跳（indexBar 本就要求 scrollable），不回退到会泄漏的整页滚动。
  const jumpTo = (key: string, behavior: ScrollBehavior) => {
    const body = bodyRef.current
    if (!body) return
    const section = body.querySelector<HTMLElement>(`[data-list-section="${key}"]`)
    if (!section) return
    const top =
      section.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop
    body.scrollTo({ top, behavior })
  }

  // 全节等比映射：Y 占比 → 节序号。显示层在极端档只渲染采样字母，
  // 触点分辨率仍是全节——显示与触点不同步（iOS 同样如此）
  const jumpFromPointer = (clientY: number, behavior: ScrollBehavior) => {
    const strip = indexStripRef.current
    if (!strip || sections.length === 0) return
    const rect = strip.getBoundingClientRect()
    if (rect.height <= 0) return
    const ratio = (clientY - rect.top) / rect.height
    const index = Math.max(0, Math.min(sections.length - 1, Math.floor(ratio * sections.length)))
    const section = sections[index]
    setActiveLetter(section.key)
    jumpTo(section.key, behavior)
  }

  const beginReorder = (event: ListPointerEvent, id: string) => {
    const root = rootRef.current
    if (!editing || !onReorder || !root) return
    const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-list-item-id]'))
    const fromIndex = rows.findIndex((row) => row.dataset.listItemId === id)
    if (fromIndex < 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      rows,
      fromIndex,
      toIndex: fromIndex,
      height: rows[fromIndex].offsetHeight,
      startY: event.clientY,
    }
    rows[fromIndex].classList.add('list__row--dragging')
  }

  const moveReorder = (event: ListPointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const dy = event.clientY - drag.startY
    const last = drag.rows.length - 1
    const toIndex = Math.max(0, Math.min(last, drag.fromIndex + Math.round(dy / drag.height)))
    drag.rows[drag.fromIndex].style.transform = `translateY(${dy}px)`
    if (toIndex === drag.toIndex) return
    drag.rows.forEach((row, i) => {
      if (i === drag.fromIndex) return
      row.classList.add('list-item--shift')
      if (i > drag.fromIndex && i <= toIndex) row.style.transform = `translateY(${-drag.height}px)`
      else if (i < drag.fromIndex && i >= toIndex) row.style.transform = `translateY(${drag.height}px)`
      else row.style.transform = ''
    })
    drag.toIndex = toIndex
  }

  const endReorder = () => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    const { rows, fromIndex, toIndex } = drag
    rows.forEach((row) => {
      row.style.transform = ''
      row.classList.remove('list__row--dragging', 'list-item--shift')
    })
    if (fromIndex !== toIndex) {
      const fromId = rows[fromIndex].dataset.listItemId
      const toId = rows[toIndex].dataset.listItemId
      if (fromId && toId) onReorder?.(fromId, toId)
    }
  }

  const contextValue: ListContextValue = {
    selectedId,
    onSelect,
    editing,
    onDelete,
    onReorder,
    beginReorder,
    moveReorder,
    endReorder,
  }

  const indexStride = indexStrideFor(indexStripHeight, sections.length)

  // 极端压缩档：槽位不足 8px 时连 6px 圆点都装不下——非采样位不再渲染，采样字母 flex:1 等分
  // 全条（indexStrideFor 保证采样数 ≤ ⌊条高/13⌋，每槽 ≥13px 装得下字形）；触点由
  // jumpFromPointer 按全节等比映射，显示与触点不同步。slot < 8 蕴含 stride > 1
  // （stride=1 必有 slot ≥ 13px），极端档恒是压缩档的子集
  const indexSlotPx = sections.length > 0 ? indexStripHeight / sections.length : 0
  const indexExtreme = indexSlotPx > 0 && indexSlotPx < 8

  const rootClass = joinClass(
    'list',
    [listClass, indexBar ? 'list--anchored' : '', editing ? 'list--editing' : '']
      .filter(Boolean)
      .join(' '),
  )

  return (
    <ListContext.Provider value={contextValue}>
      {title !== undefined && <div class="list__title">{title}</div>}
      <div ref={rootRef} class={rootClass} {...rest}>
        {head !== undefined && (
          <div class={joinClass('list__head', headClass)}>{head}</div>
        )}
        {scrollable ? (
          <div ref={bodyRef} class={joinClass('list__body', bodyClass)}>
            {children}
          </div>
        ) : (
          children
        )}
        {indexBar && sections.length > 0 && (
          <div
            ref={indexStripRef}
            class={joinClass(
              'list__index-bar',
              `${indexStride > 1 ? 'list__index-bar--compressed' : ''}${
                activeLetter !== null ? ' list__index-bar--pressed' : ''
              }`,
            )}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              jumpFromPointer(event.clientY, 'smooth')
            }}
            onPointerMove={(event) => {
              if (event.buttons & 1) jumpFromPointer(event.clientY, 'auto')
            }}
            onPointerUp={() => setActiveLetter(null)}
            onPointerCancel={() => setActiveLetter(null)}
          >
            {sections.map((section, i) => {
              // 压缩档：非采样槽位显示 •，槽位照旧等分（触点全节等比映射，不依赖 span 命中）。
              // 极端压缩档（槽位 < 8px、连圆点都装不下）时非采样位不渲染，采样字母等分全条。
              if (
                indexExtreme &&
                indexStride > 1 &&
                i % indexStride !== 0 &&
                i !== sections.length - 1
              ) {
                return null
              }
              // 压缩档：非采样槽位显示 •，槽位照旧等分；被按住的位揭示真实字母
              const elided =
                indexStride > 1 &&
                i % indexStride !== 0 &&
                i !== sections.length - 1 &&
                activeLetter !== section.key
              return (
                <span
                  key={section.key}
                  class={joinClass(
                    'list__index-letter',
                    `${elided ? 'list__index-letter--elided ' : ''}${
                      activeLetter === section.key ? 'list__index-letter--active' : ''
                    }`,
                  )}
                >
                  {elided ? '•' : section.label}
                </span>
              )
            })}
          </div>
        )}
      </div>
      {footnote !== undefined && <p class="list__footnote">{footnote}</p>}
    </ListContext.Provider>
  )
}

/**
 * 索引分组：盒内小节标题行 + 行内容；id 同时作为 List indexBar 的跳转锚点。
 */
export function ListSection({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ComponentChildren
}) {
  return (
    <div data-list-section={id} data-list-section-label={title}>
      <div class="list-section__title">{title}</div>
      {children}
    </div>
  )
}

/**
 * 分组盒尾部的居中添加行（iOS「＋ 添加…」样式）：放在 List 内所有行之后，
 * 与上方行的分隔线由上一行的 border-bottom 提供，自身不画顶线。
 */
export function ListAddRow({
  label,
  onClick,
  disabled,
  class: rowClass,
}: {
  /** 添加动作文案，如「添加模型…」。 */
  label: ComponentChildren
  onClick?: () => void
  disabled?: boolean
  class?: string
}) {
  return (
    <button
      type="button"
      class={joinClass('list-add-row', rowClass)}
      disabled={disabled}
      onClick={onClick}
    >
      <span class="list-add-row__plus" aria-hidden="true" />
      {label}
    </button>
  )
}

/** 供 ListItem 之外的场景读取 List 结合状态（当前仅内部使用）。 */
export function useListContext(): ListContextValue {
  return useContext(ListContext)
}

export { ListContext }
