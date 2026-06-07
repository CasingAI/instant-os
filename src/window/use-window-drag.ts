import { useCallback, useRef, useState } from 'preact/hooks'
import {
  clampFloatingPosition,
  detectSnapTarget,
  type SnapTarget,
} from './window-snap.ts'

const DRAG_THRESHOLD = 5

type WindowBounds = {
  x: number
  y: number
  width: number
  height: number
}

type DragSession = {
  phase: 'pending' | 'dragging'
  startX: number
  startY: number
  offsetX: number
  offsetY: number
  dragBounds: WindowBounds
}

export function useWindowDrag(
  windowId: string,
  isAnchored: boolean,
  getDragBounds: () => WindowBounds,
  onMove: (windowId: string, x: number, y: number) => void,
  onFocus: (windowId: string) => void,
  onReleaseAnchored: (windowId: string, clientX: number, clientY: number) => WindowBounds,
  onSnap: (windowId: string, target: SnapTarget) => void,
  enabled = true,
) {
  const [dragging, setDragging] = useState(false)
  const [snapPreview, setSnapPreview] = useState<SnapTarget | undefined>(undefined)
  const dragStateRef = useRef<DragSession | undefined>(undefined)

  const onTitlebarPointerDown = useCallback(
    (event: PointerEvent) => {
      if (!enabled || event.button !== 0) return

      const target = event.target as HTMLElement
      if (target.closest('.window-frame__control')) return

      onFocus(windowId)

      if (isAnchored) {
        dragStateRef.current = {
          phase: 'pending',
          startX: event.clientX,
          startY: event.clientY,
          offsetX: 0,
          offsetY: 0,
          dragBounds: getDragBounds(),
        }
      } else {
        const dragBounds = getDragBounds()
        dragStateRef.current = {
          phase: 'dragging',
          startX: event.clientX,
          startY: event.clientY,
          offsetX: event.clientX - dragBounds.x,
          offsetY: event.clientY - dragBounds.y,
          dragBounds,
        }
        setDragging(true)
      }

      setSnapPreview(undefined)

      const beginDragging = (moveEvent: PointerEvent) => {
        const session = dragStateRef.current
        if (!session || session.phase === 'dragging') return session

        const deltaX = moveEvent.clientX - session.startX
        const deltaY = moveEvent.clientY - session.startY
        if (Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return session

        const dragBounds = onReleaseAnchored(windowId, moveEvent.clientX, moveEvent.clientY)
        const nextSession: DragSession = {
          phase: 'dragging',
          startX: session.startX,
          startY: session.startY,
          offsetX: moveEvent.clientX - dragBounds.x,
          offsetY: moveEvent.clientY - dragBounds.y,
          dragBounds,
        }
        dragStateRef.current = nextSession
        setDragging(true)
        return nextSession
      }

      const onPointerMove = (moveEvent: PointerEvent) => {
        const session = beginDragging(moveEvent) ?? dragStateRef.current
        if (!session || session.phase !== 'dragging') return

        const nextX = moveEvent.clientX - session.offsetX
        const nextY = moveEvent.clientY - session.offsetY
        const clamped = clampFloatingPosition(nextX, nextY, session.dragBounds.width)
        onMove(windowId, clamped.x, clamped.y)
        setSnapPreview(detectSnapTarget(moveEvent.clientX, moveEvent.clientY))
      }

      const onPointerUp = (upEvent: PointerEvent) => {
        const session = dragStateRef.current
        if (session?.phase === 'dragging') {
          const snapTarget = detectSnapTarget(upEvent.clientX, upEvent.clientY)
          if (snapTarget) {
            onSnap(windowId, snapTarget)
          }
        }

        dragStateRef.current = undefined
        setDragging(false)
        setSnapPreview(undefined)
        document.removeEventListener('pointermove', onPointerMove)
        document.removeEventListener('pointerup', onPointerUp)
      }

      document.addEventListener('pointermove', onPointerMove)
      document.addEventListener('pointerup', onPointerUp)
      event.preventDefault()
    },
    [windowId, isAnchored, getDragBounds, onMove, onFocus, onReleaseAnchored, onSnap, enabled],
  )

  return { dragging, snapPreview, onTitlebarPointerDown }
}
