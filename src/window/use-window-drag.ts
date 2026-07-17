import { useCallback, useRef, useState } from 'preact/hooks'
import {
  clampFloatingPosition,
  detectSnapTarget,
  getSnapBounds,
  type SnapTarget,
} from './window-snap.ts'

const DRAG_THRESHOLD = 5
const DOUBLE_TAP_MS = 400
const DOUBLE_TAP_DISTANCE = 24

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
  frameEl: HTMLElement
  lastX: number
  lastY: number
  moved: boolean
}

type LastTap = {
  time: number
  x: number
  y: number
}

function applyPositionToFrame(frameEl: HTMLElement, x: number, y: number) {
  frameEl.style.left = `${x}px`
  frameEl.style.top = `${y}px`
}

export function useWindowDrag(
  windowId: string,
  isAnchored: boolean,
  getDragBounds: () => WindowBounds,
  onMove: (windowId: string, x: number, y: number) => void,
  onFocus: (windowId: string) => void,
  onReleaseAnchored: (windowId: string, clientX: number, clientY: number) => WindowBounds,
  onSnap: (windowId: string, target: SnapTarget) => void,
  onDoubleActivate?: () => void,
  enabled = true,
) {
  const [dragging, setDragging] = useState(false)
  const [snapPreview, setSnapPreview] = useState<SnapTarget | undefined>(undefined)
  const dragStateRef = useRef<DragSession | undefined>(undefined)
  const lastTapRef = useRef<LastTap | undefined>(undefined)

  const onTitlebarPointerDown = useCallback(
    (event: PointerEvent) => {
      if (!enabled || event.button !== 0) return

      const target = event.target as HTMLElement
      if (target.closest('.window-frame__control')) return

      const frameEl = (event.currentTarget as HTMLElement).closest('.window-frame')
      if (!(frameEl instanceof HTMLElement)) {
        return
      }

      onFocus(windowId)

      if (isAnchored) {
        dragStateRef.current = {
          phase: 'pending',
          startX: event.clientX,
          startY: event.clientY,
          offsetX: 0,
          offsetY: 0,
          dragBounds: getDragBounds(),
          frameEl,
          lastX: getDragBounds().x,
          lastY: getDragBounds().y,
          moved: false,
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
          frameEl,
          lastX: dragBounds.x,
          lastY: dragBounds.y,
          moved: false,
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
          frameEl: session.frameEl,
          lastX: dragBounds.x,
          lastY: dragBounds.y,
          moved: true,
        }
        dragStateRef.current = nextSession
        applyPositionToFrame(nextSession.frameEl, dragBounds.x, dragBounds.y)
        setDragging(true)
        return nextSession
      }

      const onPointerMove = (moveEvent: PointerEvent) => {
        const session = beginDragging(moveEvent) ?? dragStateRef.current
        if (!session || session.phase !== 'dragging') return

        if (!session.moved) {
          const deltaX = moveEvent.clientX - session.startX
          const deltaY = moveEvent.clientY - session.startY
          if (Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD) {
            session.moved = true
          }
        }

        const nextX = moveEvent.clientX - session.offsetX
        const nextY = moveEvent.clientY - session.offsetY
        const clamped = clampFloatingPosition(
          nextX,
          nextY,
          session.dragBounds.width,
          session.dragBounds.height,
        )
        session.lastX = clamped.x
        session.lastY = clamped.y
        applyPositionToFrame(session.frameEl, clamped.x, clamped.y)
        setSnapPreview(detectSnapTarget(moveEvent.clientX, moveEvent.clientY))
      }

      const onPointerUp = (upEvent: PointerEvent) => {
        const session = dragStateRef.current
        if (session?.phase === 'dragging') {
          const snapTarget = detectSnapTarget(upEvent.clientX, upEvent.clientY)
          if (snapTarget) {
            // Drag writes left/top directly on the frame. If the snap target
            // keeps the same y as React state (e.g. already under the menu bar),
            // reconciliation skips updating `top` and the window stays shifted
            // down. Sync DOM to snap bounds before state commit so y is correct.
            const bounds = getSnapBounds(snapTarget)
            applyPositionToFrame(session.frameEl, bounds.x, bounds.y)
            onSnap(windowId, snapTarget)
          } else if (session.moved) {
            applyPositionToFrame(session.frameEl, session.lastX, session.lastY)
            onMove(windowId, session.lastX, session.lastY)
          }
        }

        if (session && !session.moved && onDoubleActivate) {
          const lastTap = lastTapRef.current
          const now = performance.now()
          const isDoubleTap =
            !!lastTap &&
            now - lastTap.time <= DOUBLE_TAP_MS &&
            Math.hypot(upEvent.clientX - lastTap.x, upEvent.clientY - lastTap.y) <=
              DOUBLE_TAP_DISTANCE

          if (isDoubleTap) {
            lastTapRef.current = undefined
            upEvent.preventDefault()
            onDoubleActivate()
          } else {
            lastTapRef.current = { time: now, x: upEvent.clientX, y: upEvent.clientY }
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
    [windowId, isAnchored, getDragBounds, onMove, onFocus, onReleaseAnchored, onSnap, onDoubleActivate, enabled],
  )

  return { dragging, snapPreview, onTitlebarPointerDown }
}
