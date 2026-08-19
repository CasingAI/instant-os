import { useCallback, useEffect, useRef } from 'preact/hooks'

export const DESKTOP_EMPTY_HOLD_MS = 500
export const DESKTOP_EMPTY_TAP_THRESHOLD = 8

function isTapMovement(deltaX: number, deltaY: number): boolean {
  return Math.abs(deltaX) < DESKTOP_EMPTY_TAP_THRESHOLD && Math.abs(deltaY) < DESKTOP_EMPTY_TAP_THRESHOLD
}

function isPrimaryButtonStillDown(event: PointerEvent): boolean {
  return (event.buttons & 1) === 1
}

/** 按下只开始计时；松手才算点击。用于桌面空白处与程序坞两侧热区。 */
export function useDesktopEmptyPressHandlers(onTap: () => void, onHold: () => void) {
  const onTapRef = useRef(onTap)
  const onHoldRef = useRef(onHold)
  onTapRef.current = onTap
  onHoldRef.current = onHold

  const onPointerDown = useCallback((event: PointerEvent) => {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const pointerId = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    const captureTarget = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
    let holdFired = false
    let finished = false
    let holdTimer: number | undefined

    captureTarget?.setPointerCapture(pointerId)

    holdTimer = window.setTimeout(() => {
      holdTimer = undefined
      if (finished) {
        return
      }
      holdFired = true
      onHoldRef.current()
    }, DESKTOP_EMPTY_HOLD_MS)

    const finish = () => {
      if (finished) {
        return
      }
      finished = true
      if (holdTimer !== undefined) {
        window.clearTimeout(holdTimer)
        holdTimer = undefined
      }
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onCancel)
      if (captureTarget?.hasPointerCapture(pointerId)) {
        captureTarget.releasePointerCapture(pointerId)
      }
    }

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId || finished || holdFired) {
        return
      }
      if (isTapMovement(moveEvent.clientX - startX, moveEvent.clientY - startY)) {
        return
      }
      finish()
    }

    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId || finished || isPrimaryButtonStillDown(upEvent)) {
        return
      }
      const shouldTap = !holdFired && isTapMovement(upEvent.clientX - startX, upEvent.clientY - startY)
      finish()
      if (shouldTap) {
        onTapRef.current()
      }
    }

    const onCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) {
        return
      }
      finish()
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onCancel)
  }, [])

  return { onPointerDown }
}
