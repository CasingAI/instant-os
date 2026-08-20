import { useCallback, useRef } from 'preact/hooks'
import type { DesktopItemId } from '../os/desktop-folder-types.ts'

const LONG_PRESS_MS = 380
const TAP_THRESHOLD = 8

type UseDockIconReorderOptions = {
  itemId: DesktopItemId
  index: number
  disabled?: boolean
  reorderingEnabled: boolean
  onOpen: () => void
  onReorderStart: (
    itemId: DesktopItemId,
    index: number,
    clientX: number,
    clientY: number,
    grabOffsetX: number,
    grabOffsetY: number,
  ) => void
  onReorderMove: (clientX: number, clientY: number) => void
  onReorderEnd: () => void
}

export function useDockIconReorder({
  itemId,
  index,
  disabled = false,
  reorderingEnabled,
  onOpen,
  onReorderStart,
  onReorderMove,
  onReorderEnd,
}: UseDockIconReorderOptions) {
  const longPressTimerRef = useRef<number | undefined>(undefined)
  const reorderingRef = useRef(false)
  const startPointRef = useRef({ x: 0, y: 0 })
  const grabOffsetRef = useRef({ x: 0, y: 0 })
  const preventClickRef = useRef(false)

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== undefined) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = undefined
    }
  }, [])

  const onClick = useCallback(
    (event: MouseEvent) => {
      if (preventClickRef.current || disabled) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      onOpen()
    },
    [disabled, onOpen],
  )

  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      if (disabled || event.button !== 0 || reorderingEnabled) {
        return
      }

      clearLongPressTimer()
      reorderingRef.current = false
      preventClickRef.current = false
      startPointRef.current = { x: event.clientX, y: event.clientY }

      const iconEl = event.currentTarget
      if (iconEl instanceof HTMLElement) {
        const rect = iconEl.getBoundingClientRect()
        grabOffsetRef.current = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        }
      }

      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = undefined
        reorderingRef.current = true
        preventClickRef.current = true
        onReorderStart(
          itemId,
          index,
          startPointRef.current.x,
          startPointRef.current.y,
          grabOffsetRef.current.x,
          grabOffsetRef.current.y,
        )
      }, LONG_PRESS_MS)

      const onPointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startPointRef.current.x
        const deltaY = moveEvent.clientY - startPointRef.current.y

        if (!reorderingRef.current && Math.hypot(deltaX, deltaY) > TAP_THRESHOLD) {
          clearLongPressTimer()
          preventClickRef.current = true
        }

        if (reorderingRef.current) {
          moveEvent.stopPropagation()
          onReorderMove(moveEvent.clientX, moveEvent.clientY)
        }
      }

      const onPointerUp = () => {
        clearLongPressTimer()
        document.removeEventListener('pointermove', onPointerMove)
        document.removeEventListener('pointerup', onPointerUp)
        document.removeEventListener('pointercancel', onPointerUp)

        if (reorderingRef.current) {
          reorderingRef.current = false
          onReorderEnd()
        }
      }

      document.addEventListener('pointermove', onPointerMove)
      document.addEventListener('pointerup', onPointerUp)
      document.addEventListener('pointercancel', onPointerUp)
    },
    [
      itemId,
      clearLongPressTimer,
      disabled,
      index,
      onOpen,
      onReorderEnd,
      onReorderMove,
      onReorderStart,
      reorderingEnabled,
    ],
  )

  return {
    onClick,
    onPointerDown,
  }
}
