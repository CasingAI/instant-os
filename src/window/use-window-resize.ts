import { useCallback, useRef, useState } from 'preact/hooks'
import type { WindowBounds } from './window-metrics.ts'
import {
  computeEdgeExtremeBounds,
  computeResizedBounds,
  getResizeCursor,
  type ResizeDirection,
} from './window-resize.ts'

const DRAG_THRESHOLD = 3

type ResizeSession = {
  direction: ResizeDirection
  startX: number
  startY: number
  startBounds: WindowBounds
  moved: boolean
}

export function useWindowResize(
  windowId: string,
  getBounds: () => WindowBounds,
  onResize: (windowId: string, bounds: WindowBounds) => void,
  onFocus: (windowId: string) => void,
  enabled = true,
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

      const startBounds = getBounds()
      resizeStateRef.current = {
        direction,
        startX: event.clientX,
        startY: event.clientY,
        startBounds,
        moved: false,
      }
      setResizing(true)

      const cursor = getResizeCursor(direction)
      document.body.style.cursor = cursor
      document.body.style.userSelect = 'none'

      const onPointerMove = (moveEvent: PointerEvent) => {
        const session = resizeStateRef.current
        if (!session) return

        const deltaX = moveEvent.clientX - session.startX
        const deltaY = moveEvent.clientY - session.startY
        if (!session.moved && Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD) {
          session.moved = true
        }

        const nextBounds = computeResizedBounds(
          session.startBounds,
          session.direction,
          deltaX,
          deltaY,
        )
        onResize(windowId, nextBounds)
      }

      const onPointerUp = () => {
        const session = resizeStateRef.current
        suppressClickRef.current = session?.moved ?? false
        resizeStateRef.current = undefined
        setResizing(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        document.removeEventListener('pointermove', onPointerMove)
        document.removeEventListener('pointerup', onPointerUp)
      }

      document.addEventListener('pointermove', onPointerMove)
      document.addEventListener('pointerup', onPointerUp)
    },
    [windowId, getBounds, onResize, onFocus, enabled],
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
      onResize(windowId, computeEdgeExtremeBounds(getBounds(), direction))
    },
    [windowId, getBounds, onResize, onFocus, enabled],
  )

  return { resizing, onResizeHandlePointerDown, onResizeHandleDoubleClick }
}
