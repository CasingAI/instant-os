import type { RefObject } from 'preact'
import { useRef } from 'preact/hooks'

/** 拖拽把手需要的最小指针事件面（preact 的 PointerEvent 结构上兼容）。 */
export type ListPointerEvent = {
  clientY: number
  pointerId: number
  currentTarget: EventTarget & Element
}

type ReorderDrag = {
  rows: HTMLElement[]
  fromIndex: number
  toIndex: number
  height: number
  startY: number
}

type UseReorderDragOptions = {
  /** 容器根节点：重排按整表查询 [data-list-item-id] 行序。 */
  rootRef: RefObject<HTMLElement | null>
  editing?: boolean
  onReorder?: (fromId: string, toId: string) => void
  /** 拖动中浮起行挂的类（grouped/plain 两支类名宇宙独立，由容器按 variant 传入）。 */
  draggingClass: string
  /** 让位行挂的类。 */
  shiftClass: string
}

/**
 * 拖拽重排机制（与变体观感无关，List grouped/plain 两支共用）：
 * 把手按住捕获指针，拖动行跟随指针、越过节行让位，松手清场并上报 fromId→toId。
 * 行视觉类名由调用方传入——这里只做行序数学与 DOM 类切换，不关心样式归属。
 */
export function useReorderDrag({
  rootRef,
  editing,
  onReorder,
  draggingClass,
  shiftClass,
}: UseReorderDragOptions) {
  const dragRef = useRef<ReorderDrag | null>(null)

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
    rows[fromIndex].classList.add(draggingClass)
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
      row.classList.add(shiftClass)
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
      row.classList.remove(draggingClass, shiftClass)
    })
    if (fromIndex !== toIndex) {
      const fromId = rows[fromIndex].dataset.listItemId
      const toId = rows[toIndex].dataset.listItemId
      if (fromId && toId) onReorder?.(fromId, toId)
    }
  }

  return { beginReorder, moveReorder, endReorder }
}
