import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { loadDevSettings, saveDevSettings } from './instant-os-dev-settings.ts'

export const FLOAT_BALL_SIZE_PX = 48
const DRAG_THRESHOLD_PX = 6
const EDGE_MARGIN_PX = 10

export type FloatBallPosition = {
  x: number
  y: number
}

function defaultFloatBallPosition(): FloatBallPosition {
  return {
    x: Math.max(EDGE_MARGIN_PX, window.innerWidth - FLOAT_BALL_SIZE_PX - 16),
    y: Math.max(EDGE_MARGIN_PX, window.innerHeight - FLOAT_BALL_SIZE_PX - 16),
  }
}

function clampPosition(position: FloatBallPosition): FloatBallPosition {
  const maxX = Math.max(EDGE_MARGIN_PX, window.innerWidth - FLOAT_BALL_SIZE_PX - EDGE_MARGIN_PX)
  const maxY = Math.max(EDGE_MARGIN_PX, window.innerHeight - FLOAT_BALL_SIZE_PX - EDGE_MARGIN_PX)

  return {
    x: Math.min(Math.max(position.x, EDGE_MARGIN_PX), maxX),
    y: Math.min(Math.max(position.y, EDGE_MARGIN_PX), maxY),
  }
}

function readInitialPosition(): FloatBallPosition {
  const settings = loadDevSettings()
  if (settings.floatBallX !== undefined && settings.floatBallY !== undefined) {
    return clampPosition({ x: settings.floatBallX, y: settings.floatBallY })
  }
  return defaultFloatBallPosition()
}

type DragState = {
  pointerId: number
  startClientX: number
  startClientY: number
  originX: number
  originY: number
  moved: boolean
}

export function useDraggableFloatBall(onTap: () => void) {
  const [position, setPosition] = useState<FloatBallPosition>(() => readInitialPosition())
  const dragRef = useRef<DragState | undefined>(undefined)

  useEffect(() => {
    const onResize = () => {
      setPosition((current) => clampPosition(current))
    }

    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const onPointerDown = useCallback((event: PointerEvent) => {
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: position.x,
      originY: position.y,
      moved: false,
    }
  }, [position.x, position.y])

  const onPointerMove = useCallback((event: PointerEvent) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    const deltaX = event.clientX - drag.startClientX
    const deltaY = event.clientY - drag.startClientY
    if (Math.abs(deltaX) > DRAG_THRESHOLD_PX || Math.abs(deltaY) > DRAG_THRESHOLD_PX) {
      drag.moved = true
    }

    setPosition(
      clampPosition({
        x: drag.originX + deltaX,
        y: drag.originY + deltaY,
      }),
    )
  }, [])

  const onPointerUp = useCallback((event: PointerEvent) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    const target = event.currentTarget as HTMLElement
    target.releasePointerCapture(event.pointerId)

    if (drag.moved) {
      setPosition((current) => {
        const clamped = clampPosition(current)
        saveDevSettings({ floatBallX: clamped.x, floatBallY: clamped.y })
        return clamped
      })
    } else {
      onTap()
    }

    dragRef.current = undefined
  }, [onTap])

  const onPointerCancel = useCallback((event: PointerEvent) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    dragRef.current = undefined
  }, [])

  return {
    position,
    pointerHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
  }
}
