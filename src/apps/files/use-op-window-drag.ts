import { useCallback, useRef, useState } from 'preact/hooks'
import { clampFloatingPosition } from '../../window/window-snap.ts'
import type { FilesOpWindowPosition } from './files-op-window-position.ts'

const DRAG_THRESHOLD = 5

type DragSession = {
  panel: HTMLElement
  startX: number
  startY: number
  originX: number
  originY: number
  width: number
  height: number
  moving: boolean
}

/**
 * 迷你窗拖动手势：pointerdown 捕获后过 5px 阈值才开始拖，
 * 拖动中直接写面板 left/top（复用 clampFloatingPosition 夹紧视口），
 * 松手把最终位置交给 onPositionChange 提交。
 * 与 window 的 useWindowDrag 手法一致，但不依赖 .window-frame 结构。
 */
export function useOpWindowDrag(params: {
  panelRef: { current: HTMLDivElement | null }
  getPosition: () => FilesOpWindowPosition
  onPositionChange: (pos: FilesOpWindowPosition) => void
}) {
  const { panelRef, getPosition, onPositionChange } = params
  const [dragging, setDragging] = useState(false)
  const sessionRef = useRef<DragSession | undefined>(undefined)
  /** 最近一次手势是否真正移动过（供点击类行为判断：圆柄拖动后不展开） */
  const movedRef = useRef(false)

  const restoreOrigin = (session: DragSession) => {
    session.panel.style.left = `${session.originX}px`
    session.panel.style.top = `${session.originY}px`
  }

  const startDrag = useCallback(
    (event: PointerEvent) => {
      if (event.button !== 0) return
      const panel = panelRef.current
      if (!panel) return
      const target = event.target as HTMLElement | null
      if (target?.closest?.('button, [data-op-window-no-drag]')) return

      const pos = getPosition()
      const session: DragSession = {
        panel,
        startX: event.clientX,
        startY: event.clientY,
        originX: pos.x,
        originY: pos.y,
        width: panel.offsetWidth,
        height: panel.offsetHeight,
        moving: false,
      }
      sessionRef.current = session
      movedRef.current = false

      const cleanup = () => {
        sessionRef.current = undefined
        panel.removeEventListener('pointermove', onMove)
        panel.removeEventListener('pointerup', onUp)
        panel.removeEventListener('pointercancel', onCancel)
      }

      const onMove = (moveEvent: PointerEvent) => {
        const current = sessionRef.current
        if (!current || current.panel !== panel) return
        const dx = moveEvent.clientX - current.startX
        const dy = moveEvent.clientY - current.startY
        if (!current.moving && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        if (!current.moving) {
          current.moving = true
          movedRef.current = true
          setDragging(true)
        }
        const clamped = clampFloatingPosition(
          current.originX + dx,
          current.originY + dy,
          current.width,
          current.height,
        )
        panel.style.left = `${clamped.x}px`
        panel.style.top = `${clamped.y}px`
        // 实时提交：迷你窗每 250ms 因进度刷新重渲染，若不更新 state
        // 会被内联样式复位回拖前位置
        onPositionChange({ x: clamped.x, y: clamped.y })
      }

      const onUp = (upEvent: PointerEvent) => {
        const current = sessionRef.current
        if (!current || current.panel !== panel) return
        const dx = upEvent.clientX - current.startX
        const dy = upEvent.clientY - current.startY
        cleanup()
        setDragging(false)
        if (!current.moving) return
        const clamped = clampFloatingPosition(
          current.originX + dx,
          current.originY + dy,
          current.width,
          current.height,
        )
        panel.style.left = `${clamped.x}px`
        panel.style.top = `${clamped.y}px`
        onPositionChange({ x: clamped.x, y: clamped.y })
      }

      const onCancel = () => {
        const current = sessionRef.current
        if (!current || current.panel !== panel) return
        cleanup()
        setDragging(false)
        restoreOrigin(current)
      }

      try {
        panel.setPointerCapture(event.pointerId)
      } catch {
        cleanup()
        return
      }
      panel.addEventListener('pointermove', onMove)
      panel.addEventListener('pointerup', onUp)
      panel.addEventListener('pointercancel', onCancel)
    },
    [getPosition, onPositionChange, panelRef],
  )

  return { dragging, startDrag, movedRef }
}