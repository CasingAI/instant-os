import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

/** 与 icode.css 中 @container app-window (max-width: 640px) 保持一致 */
export const ICODE_NARROW_LAYOUT_MAX_WIDTH = 640

export function useIcodeNarrowLayout(): {
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
      setNarrow(node.clientWidth <= ICODE_NARROW_LAYOUT_MAX_WIDTH)
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
