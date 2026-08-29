import { useCallback, useRef } from 'preact/hooks'

/**
 * 虚拟机列表行拖拽重排：长按进入拖拽态，与系统 Dock / 桌面图标同款交互
 * （同款长按时长与位移阈值）。拖拽中条目在列表里实时让位，不需要浮层。
 */
const LONG_PRESS_MS = 380
const TAP_THRESHOLD = 8

type UseVirtualMachineRowReorderOptions = {
  itemId: string
  index: number
  disabled?: boolean
  /** 已有拖拽会话进行中：忽略新的按下，防止多指并发起拖。 */
  reorderingEnabled: boolean
  onOpen: () => void
  onReorderStart: (itemId: string, index: number) => void
  onReorderMove: (clientY: number) => void
  onReorderEnd: () => void
}

export function useVirtualMachineRowReorder({
  itemId,
  index,
  disabled = false,
  reorderingEnabled,
  onOpen,
  onReorderStart,
  onReorderMove,
  onReorderEnd,
}: UseVirtualMachineRowReorderOptions) {
  const longPressTimerRef = useRef<number | undefined>(undefined)
  const reorderingRef = useRef(false)
  const startPointRef = useRef({ x: 0, y: 0 })
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

      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = undefined
        reorderingRef.current = true
        preventClickRef.current = true
        onReorderStart(itemId, index)
      }, LONG_PRESS_MS)

      const onPointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startPointRef.current.x
        const deltaY = moveEvent.clientY - startPointRef.current.y

        if (!reorderingRef.current && Math.hypot(deltaX, deltaY) > TAP_THRESHOLD) {
          clearLongPressTimer()
          preventClickRef.current = true
        }

        if (reorderingRef.current) {
          onReorderMove(moveEvent.clientY)
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
