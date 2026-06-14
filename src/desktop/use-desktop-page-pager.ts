import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

const SNAP_RATIO = 0.18
const TAP_THRESHOLD = 8

type PagerSession = {
  startX: number
  startY: number
  dragging: boolean
  pointerId: number
  captureTarget: HTMLElement | undefined
}

export function useDesktopPagePager(
  pageCount: number,
  pagerWidth: number,
  enabled: boolean,
  onEmptyTap?: (event: PointerEvent) => void,
) {
  const [currentPage, setCurrentPage] = useState(0)
  const [dragOffset, setDragOffset] = useState(0)
  const [animating, setAnimating] = useState(false)
  const didSwipeRef = useRef(false)
  const sessionRef = useRef<PagerSession | undefined>(undefined)

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
    (page: number) => {
      const nextPage = Math.max(0, Math.min(page, pageCount - 1))
      setCurrentPage(nextPage)
      setDragOffset(0)
      setAnimating(true)
    },
    [pageCount],
  )

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
