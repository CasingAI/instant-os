import type { ComponentChildren, JSX } from 'preact'
import { createContext } from 'preact'
import { useContext, useEffect, useRef, useState } from 'preact/hooks'
import './list.css'

type ListProps = {
  /** 追加到容器的 app 局部修饰类（如 registry__key-list）。 */
  class?: string
  /** 表头内容（span 序列）；有值时渲染 settings__list-head 容器。 */
  head?: ComponentChildren
  /** 追加到表头的变体类（settings__list-head--tokens 等）。 */
  headClass?: string
  /** 滚动体变体类（settings__list-body--apps 等）；有值时 children 包进 settings__list-body。 */
  bodyClass?: string
  /** 节标题（盒子外上方，settings__section-title）。 */
  title?: ComponentChildren
  /** 节脚注（盒子外下方，settings__section-footnote）。 */
  footnote?: ComponentChildren
  /** 右缘 A-Z 索引条：自动收集子级 ListSection 并支持点击/沿条拖动跳节。 */
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
 * iOS 设置风格的分组列表容器（settings__list）。行内容放 ListItem 或
 * SettingsNavRow 等行组件；样式沿用 settings.css，新能力样式在 list.css。
 */
export function List({
  class: listClass,
  head,
  headClass,
  bodyClass,
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
  const indexStripRef = useRef<HTMLDivElement>(null)
  const [sections, setSections] = useState<ListSectionAnchor[]>([])
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

  const jumpTo = (key: string) => {
    rootRef.current
      ?.querySelector<HTMLElement>(`[data-list-section="${key}"]`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  const jumpFromPointer = (clientY: number) => {
    const strip = indexStripRef.current
    if (!strip) return
    for (const letter of Array.from(strip.querySelectorAll<HTMLElement>('[data-letter]'))) {
      const rect = letter.getBoundingClientRect()
      if (clientY >= rect.top && clientY <= rect.bottom) {
        jumpTo(letter.dataset.letter ?? '')
        return
      }
    }
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

  const rootClass = joinClass(
    'settings__list',
    [listClass, indexBar ? 'list--anchored' : '', editing ? 'list--editing' : '']
      .filter(Boolean)
      .join(' '),
  )

  return (
    <ListContext.Provider value={contextValue}>
      {title !== undefined && <div class="settings__section-title">{title}</div>}
      <div ref={rootRef} class={rootClass} {...rest}>
        {head !== undefined && (
          <div class={joinClass('settings__list-head', headClass)}>{head}</div>
        )}
        {bodyClass !== undefined ? (
          <div class={joinClass('settings__list-body', bodyClass)}>{children}</div>
        ) : (
          children
        )}
        {indexBar && sections.length > 0 && (
          <div
            ref={indexStripRef}
            class="list__index-bar"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              jumpFromPointer(event.clientY)
            }}
            onPointerMove={(event) => {
              if (event.buttons & 1) jumpFromPointer(event.clientY)
            }}
            onPointerUp={() => undefined}
          >
            {sections.map((section) => (
              <span
                key={section.key}
                data-letter={section.key}
                class="list__index-letter"
              >
                {section.label}
              </span>
            ))}
          </div>
        )}
      </div>
      {footnote !== undefined && <p class="settings__section-footnote">{footnote}</p>}
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

/** 供 ListItem 之外的场景读取 List 结合状态（当前仅内部使用）。 */
export function useListContext(): ListContextValue {
  return useContext(ListContext)
}

export { ListContext }
