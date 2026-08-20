import { useCallback, useRef, useState } from 'preact/hooks'
import type { WindowBounds } from './window-metrics.ts'
import type { WindowSnap } from '../os/types.ts'
import {
  computeEdgeExtremeBounds,
  computeResizedBounds,
  computeSnappedEdgeExtremeBounds,
  computeSnappedResizedBounds,
  getResizeCursor,
  type ResizeDirection,
} from './window-resize.ts'

const DRAG_THRESHOLD = 3

type ResizeSession = {
  direction: ResizeDirection
  startX: number
  startY: number
  startBounds: WindowBounds
  frameEl: HTMLElement
  lastBounds: WindowBounds
  moved: boolean
}

function applyBoundsToFrame(frameEl: HTMLElement, bounds: WindowBounds) {
  frameEl.style.left = `${bounds.x}px`
  frameEl.style.top = `${bounds.y}px`
  frameEl.style.width = `${bounds.width}px`
  frameEl.style.height = `${bounds.height}px`
}

export function useWindowResize(
  windowId: string,
  getBounds: () => WindowBounds,
  onResize: (windowId: string, bounds: WindowBounds) => void,
  onFocus: (windowId: string) => void,
  enabled = true,
  snap?: WindowSnap,
) {
  const [resizing, setResizing] = useState(false)
  const resizeStateRef = useRef<ResizeSession | undefined>(undefined)
  const suppressClickRef = useRef(false)

  const onResizeHandlePointerDown = useCallback(
    (direction: ResizeDirection) => (event: PointerEvent) => {
      if (!enabled || event.button !== 0) return

      event.preventDefault()
      event.stopPropagation()
      onFocus(windowId)

      const handle = event.currentTarget as HTMLElement
      const frameEl = handle.closest('.window-frame')
      if (!(frameEl instanceof HTMLElement)) {
        return
      }

      const pointerId = event.pointerId
      try {
        handle.setPointerCapture(pointerId)
      } catch {
        // ignore
      }

      const startBounds = getBounds()
      resizeStateRef.current = {
        direction,
        startX: event.clientX,
        startY: event.clientY,
        startBounds,
        frameEl,
        lastBounds: startBounds,
        moved: false,
      }
      setResizing(true)

      const cursor = getResizeCursor(direction)
      document.body.style.cursor = cursor
      document.body.style.userSelect = 'none'

      const endResize = (commit: boolean) => {
        const session = resizeStateRef.current
        if (!session) {
          return
        }

        document.removeEventListener('pointermove', onPointerMove)
        document.removeEventListener('pointerup', onPointerUp)
        document.removeEventListener('pointercancel', onPointerCancel)

        suppressClickRef.current = session.moved
        if (commit && session.moved) {
          onResize(windowId, session.lastBounds)
        }
        resizeStateRef.current = undefined
        setResizing(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        try {
          handle.releasePointerCapture(pointerId)
        } catch {
          // ignore
        }
      }

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) {
          return
        }
        const session = resizeStateRef.current
        if (!session) {
          return
        }

        const deltaX = moveEvent.clientX - session.startX
        const deltaY = moveEvent.clientY - session.startY
        if (!session.moved && Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD) {
          session.moved = true
        }

        const nextBounds = snap
          ? computeSnappedResizedBounds(
              session.startBounds,
              session.direction,
              deltaX,
              deltaY,
              snap,
            )
          : computeResizedBounds(
              session.startBounds,
              session.direction,
              deltaX,
              deltaY,
            )
        session.lastBounds = nextBounds
        applyBoundsToFrame(session.frameEl, nextBounds)
      }

      const onPointerUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) {
          return
        }
        endResize(true)
      }

      const onPointerCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== pointerId) {
          return
        }
        endResize(false)
      }

      document.addEventListener('pointermove', onPointerMove)
      document.addEventListener('pointerup', onPointerUp)
      document.addEventListener('pointercancel', onPointerCancel)
    },
    [windowId, getBounds, onResize, onFocus, enabled, snap],
  )

  const onResizeHandleDoubleClick = useCallback(
    (direction: ResizeDirection) => (event: MouseEvent) => {
      if (!enabled || suppressClickRef.current) {
        suppressClickRef.current = false
        return
      }

      event.preventDefault()
      event.stopPropagation()
      onFocus(windowId)
      const bounds = getBounds()
      onResize(
        windowId,
        snap
          ? computeSnappedEdgeExtremeBounds(bounds, direction, snap)
          : computeEdgeExtremeBounds(bounds, direction),
      )
    },
    [windowId, getBounds, onResize, onFocus, enabled, snap],
  )

  return { resizing, onResizeHandlePointerDown, onResizeHandleDoubleClick }
}
