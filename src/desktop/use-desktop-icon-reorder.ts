import { useCallback, useRef } from 'preact/hooks'
import type { AppId } from '../os/types.ts'

const LONG_PRESS_MS = 380
const TAP_THRESHOLD = 8

type UseDesktopIconReorderOptions = {
  appId: AppId
  globalIndex: number
  disabled?: boolean
  reorderingEnabled: boolean
  didSwipeRef: { current: boolean }
  onOpen: () => void
  onReorderStart: (appId: AppId, globalIndex: number, clientX: number, clientY: number) => void
  onReorderMove: (clientX: number, clientY: number) => void
  onReorderEnd: () => void
}

export function useDesktopIconReorder({
  appId,
  globalIndex,
  disabled = false,
  reorderingEnabled,
  didSwipeRef,
  onOpen,
  onReorderStart,
  onReorderMove,
  onReorderEnd,
}: UseDesktopIconReorderOptions) {
  const longPressTimerRef = useRef<number | undefined>(undefined)
  const reorderingRef = useRef(false)
  const startPointRef = useRef({ x: 0, y: 0 })

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== undefined) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = undefined
    }
  }, [])

  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      if (disabled || event.button !== 0 || reorderingEnabled) {
        return
      }

      clearLongPressTimer()
      reorderingRef.current = false
      startPointRef.current = { x: event.clientX, y: event.clientY }

      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = undefined
        reorderingRef.current = true
        onReorderStart(
          appId,
          globalIndex,
          startPointRef.current.x,
          startPointRef.current.y,
        )
      }, LONG_PRESS_MS)

      const onPointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startPointRef.current.x
        const deltaY = moveEvent.clientY - startPointRef.current.y

        if (!reorderingRef.current && Math.hypot(deltaX, deltaY) > TAP_THRESHOLD) {
          clearLongPressTimer()
        }

        if (reorderingRef.current) {
          moveEvent.stopPropagation()
          onReorderMove(moveEvent.clientX, moveEvent.clientY)
        }
      }

      const onPointerUp = (upEvent: PointerEvent) => {
        clearLongPressTimer()
        document.removeEventListener('pointermove', onPointerMove)
        document.removeEventListener('pointerup', onPointerUp)
        document.removeEventListener('pointercancel', onPointerUp)

        if (reorderingRef.current) {
          reorderingRef.current = false
          onReorderEnd()
          return
        }

        if (didSwipeRef.current) {
          return
        }

        const deltaX = upEvent.clientX - startPointRef.current.x
        const deltaY = upEvent.clientY - startPointRef.current.y
        if (Math.hypot(deltaX, deltaY) < TAP_THRESHOLD) {
          upEvent.stopPropagation()
          onOpen()
        }
      }

      document.addEventListener('pointermove', onPointerMove)
      document.addEventListener('pointerup', onPointerUp)
      document.addEventListener('pointercancel', onPointerUp)
    },
    [
      appId,
      clearLongPressTimer,
      didSwipeRef,
      disabled,
      globalIndex,
      onOpen,
      onReorderEnd,
      onReorderMove,
      onReorderStart,
      reorderingEnabled,
    ],
  )

  const onReorderPointerMove = useCallback(
    (event: PointerEvent) => {
      if (!reorderingEnabled) {
        return
      }
      onReorderMove(event.clientX, event.clientY)
    },
    [onReorderMove, reorderingEnabled],
  )

  const onReorderPointerUp = useCallback(
    (event: PointerEvent) => {
      if (!reorderingEnabled) {
        return
      }
      event.stopPropagation()
      onReorderEnd()
    },
    [onReorderEnd, reorderingEnabled],
  )

  return {
    onPointerDown,
    onReorderPointerMove,
    onReorderPointerUp,
  }
}
