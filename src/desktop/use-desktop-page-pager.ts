import type { RefObject } from 'preact'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

const SNAP_RATIO = 0.18
const TAP_THRESHOLD = 8
const WHEEL_PAGE_THRESHOLD = 40
/** 切页后的最短间隔，避开同一甩动前半段的连触发。 */
const WHEEL_MIN_LOCK_MS = 220
/** 低于此值视为波谷，之后的新冲量可连续翻页。 */
const WHEEL_SETTLE_DELTA = 12
/** 波谷之后，单次 |deltaX| 达到此值视为下一次滑动。 */
const WHEEL_REFIRE_IMPULSE = 28
/** 完全停歇后重置手势状态。 */
const WHEEL_GESTURE_END_MS = 140

type PagerSession = {
  startX: number
  startY: number
  dragging: boolean
  pointerId: number
  captureTarget: HTMLElement | undefined
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

export function useDesktopPagePager(
  pageCount: number,
  pagerWidth: number,
  enabled: boolean,
  onEmptyTap?: (event: PointerEvent) => void,
  navEnabled = false,
  wheelTargetRef?: RefObject<HTMLElement | null>,
) {
  const [currentPage, setCurrentPage] = useState(0)
  const [dragOffset, setDragOffset] = useState(0)
  const [animating, setAnimating] = useState(false)
  const didSwipeRef = useRef(false)
  const sessionRef = useRef<PagerSession | undefined>(undefined)
  const currentPageRef = useRef(currentPage)
  const pageCountRef = useRef(pageCount)
  const wheelAccumRef = useRef(0)
  const wheelLockedRef = useRef(false)
  const wheelSeenSettleRef = useRef(false)
  const wheelLockAtRef = useRef(0)
  const wheelIdleTimerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    currentPageRef.current = currentPage
  }, [currentPage])

  useEffect(() => {
    pageCountRef.current = pageCount
  }, [pageCount])

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, Math.max(0, pageCount - 1)))
  }, [pageCount])

  useEffect(() => {
    if (!animating) {
      return
    }

    const timer = window.setTimeout(() => setAnimating(false), 360)
    return () => window.clearTimeout(timer)
  }, [animating, currentPage])

  const goToPage = useCallback(
    (page: number, allowPendingLastPage = false) => {
      // 拖拽新建页时，目标索引可能是「即将显示」的最后一页（当前渲染的页数尚未 +1）。
      const maxPage = pageCountRef.current - 1 + (allowPendingLastPage ? 1 : 0)
      const nextPage = Math.max(0, Math.min(page, maxPage))
      setCurrentPage(nextPage)
      setDragOffset(0)
      setAnimating(true)
    },
    [],
  )

  useEffect(() => {
    if (!enabled || !navEnabled || pageCount <= 1) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        return
      }
      if (isEditableKeyboardTarget(event.target)) {
        return
      }

      event.preventDefault()
      goToPage(event.key === 'ArrowLeft' ? currentPageRef.current - 1 : currentPageRef.current + 1)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, goToPage, navEnabled, pageCount])

  useEffect(() => {
    const target = wheelTargetRef?.current
    if (!enabled || !navEnabled || pageCount <= 1 || !target) {
      return
    }

    const resetWheelGesture = () => {
      wheelAccumRef.current = 0
      wheelLockedRef.current = false
      wheelSeenSettleRef.current = false
      wheelLockAtRef.current = 0
      if (wheelIdleTimerRef.current !== undefined) {
        window.clearTimeout(wheelIdleTimerRef.current)
        wheelIdleTimerRef.current = undefined
      }
    }

    const armWheelGestureEnd = () => {
      if (wheelIdleTimerRef.current !== undefined) {
        window.clearTimeout(wheelIdleTimerRef.current)
      }
      wheelIdleTimerRef.current = window.setTimeout(() => {
        wheelLockedRef.current = false
        wheelSeenSettleRef.current = false
        wheelAccumRef.current = 0
        wheelIdleTimerRef.current = undefined
      }, WHEEL_GESTURE_END_MS)
    }

    const fireWheelPage = (direction: 1 | -1) => {
      wheelAccumRef.current = 0
      wheelLockedRef.current = true
      wheelSeenSettleRef.current = false
      wheelLockAtRef.current = performance.now()
      goToPage(currentPageRef.current + direction)
    }

    const onWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey) {
        return
      }
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) {
        return
      }
      if (isEditableKeyboardTarget(event.target)) {
        return
      }

      // 阻止触控板横向滑动触发浏览器前进/后退。
      event.preventDefault()
      armWheelGestureEnd()

      const deltaX = event.deltaX
      const absDeltaX = Math.abs(deltaX)

      if (wheelLockedRef.current) {
        // 大力一滑的惯性会持续高 delta：等出现波谷后，新的冲量才算下一次滑动。
        if (performance.now() - wheelLockAtRef.current < WHEEL_MIN_LOCK_MS) {
          return
        }
        if (absDeltaX <= WHEEL_SETTLE_DELTA) {
          wheelSeenSettleRef.current = true
          return
        }
        if (wheelSeenSettleRef.current && absDeltaX >= WHEEL_REFIRE_IMPULSE) {
          fireWheelPage(deltaX > 0 ? 1 : -1)
        }
        return
      }

      if (
        wheelAccumRef.current !== 0 &&
        Math.sign(deltaX) !== 0 &&
        Math.sign(deltaX) !== Math.sign(wheelAccumRef.current)
      ) {
        wheelAccumRef.current = 0
      }

      wheelAccumRef.current += deltaX
      if (Math.abs(wheelAccumRef.current) < WHEEL_PAGE_THRESHOLD) {
        return
      }

      fireWheelPage(wheelAccumRef.current > 0 ? 1 : -1)
    }

    target.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      target.removeEventListener('wheel', onWheel)
      resetWheelGesture()
    }
  }, [enabled, goToPage, navEnabled, pageCount, wheelTargetRef])

  const translateX = -currentPage * pagerWidth + dragOffset

  const cancelInteraction = useCallback(() => {
    const session = sessionRef.current
    if (session?.captureTarget?.hasPointerCapture(session.pointerId)) {
      session.captureTarget.releasePointerCapture(session.pointerId)
    }

    sessionRef.current = undefined
    setDragOffset(0)
    setAnimating(false)
  }, [])

  useEffect(() => {
    if (!enabled) {
      cancelInteraction()
    }
  }, [cancelInteraction, enabled])

  const applyRubberBand = useCallback(
    (offset: number) => {
      if (pageCount <= 1) {
        return offset * 0.28
      }

      if (currentPage === 0 && offset > 0) {
        return offset * 0.28
      }

      if (currentPage === pageCount - 1 && offset < 0) {
        return offset * 0.28
      }

      return offset
    },
    [currentPage, pageCount],
  )

  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      if (!enabled || event.button !== 0 || pagerWidth <= 0) {
        return
      }

      sessionRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        dragging: false,
        pointerId: event.pointerId,
        captureTarget: event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined,
      }
      setAnimating(false)
    },
    [enabled, pagerWidth],
  )

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const session = sessionRef.current
      if (!session || !enabled) {
        return
      }

      const deltaX = event.clientX - session.startX
      const deltaY = event.clientY - session.startY

      if (!session.dragging) {
        if (Math.abs(deltaX) < TAP_THRESHOLD && Math.abs(deltaY) < TAP_THRESHOLD) {
          return
        }

        if (Math.abs(deltaX) <= Math.abs(deltaY)) {
          sessionRef.current = undefined
          return
        }

        session.dragging = true
        session.captureTarget?.setPointerCapture(event.pointerId)
      }

      setDragOffset(applyRubberBand(deltaX))
    },
    [applyRubberBand, enabled],
  )

  const onPointerUp = useCallback(
    (event: PointerEvent) => {
      const session = sessionRef.current
      if (!session) {
        return
      }

      if (session.captureTarget?.hasPointerCapture(session.pointerId)) {
        session.captureTarget.releasePointerCapture(session.pointerId)
      }

      sessionRef.current = undefined

      if (!enabled || !session.dragging) {
        setDragOffset(0)
        if (enabled && onEmptyTap) {
          const deltaX = event.clientX - session.startX
          const deltaY = event.clientY - session.startY
          if (Math.abs(deltaX) < TAP_THRESHOLD && Math.abs(deltaY) < TAP_THRESHOLD) {
            onEmptyTap(event)
          }
        }
        return
      }

      const deltaX = event.clientX - session.startX
      didSwipeRef.current = true
      requestAnimationFrame(() => {
        didSwipeRef.current = false
      })

      let nextPage = currentPage
      if (deltaX <= -pagerWidth * SNAP_RATIO) {
        nextPage = currentPage + 1
      } else if (deltaX >= pagerWidth * SNAP_RATIO) {
        nextPage = currentPage - 1
      }

      goToPage(nextPage)
    },
    [currentPage, enabled, goToPage, onEmptyTap, pagerWidth],
  )

  const onPointerCancel = useCallback(() => {
    cancelInteraction()
    setAnimating(true)
  }, [cancelInteraction])

  return {
    currentPage,
    goToPage,
    didSwipeRef,
    translateX,
    animating,
    cancelInteraction,
    pagePagerHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
  }
}
