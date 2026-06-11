import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

/** 与 window-snap 中 NARROW_WORK_AREA_WIDTH 保持一致 */
export const APP_NARROW_LAYOUT_MAX_WIDTH = 640

export function useAppNarrowLayout(): {
  hostRef: (node: HTMLElement | null) => void
  narrowLayout: boolean
} {
  const [narrow, setNarrow] = useState(false)
  const observerRef = useRef<ResizeObserver | undefined>()

  const hostRef = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = undefined

    if (!node) {
      return
    }

    const sync = () => {
      setNarrow(node.clientWidth <= APP_NARROW_LAYOUT_MAX_WIDTH)
    }

    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(node)
    observerRef.current = observer
  }, [])

  useEffect(() => {
    return () => observerRef.current?.disconnect()
  }, [])

  return { hostRef, narrowLayout: narrow }
}
