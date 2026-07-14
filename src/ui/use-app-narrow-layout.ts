import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

/** 与 window-snap 中 NARROW_WORK_AREA_WIDTH 保持一致 */
export const APP_NARROW_LAYOUT_MAX_WIDTH = 640

export function useAppNarrowLayout(): {
  hostRef: (node: HTMLElement | null) => void
  narrowLayout: boolean
  /** 宿主节点完成首次宽度测量后为 true，避免把挂载前的默认 false 当成宽屏 */
  layoutReady: boolean
} {
  const [narrow, setNarrow] = useState(false)
  const [layoutReady, setLayoutReady] = useState(false)
  const observerRef = useRef<ResizeObserver | undefined>()

  const hostRef = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = undefined

    if (!node) {
      setLayoutReady(false)
      return
    }

    const sync = () => {
      setNarrow(node.clientWidth <= APP_NARROW_LAYOUT_MAX_WIDTH)
      setLayoutReady(true)
    }

    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(node)
    observerRef.current = observer
  }, [])

  useEffect(() => {
    return () => observerRef.current?.disconnect()
  }, [])

  return { hostRef, narrowLayout: narrow, layoutReady }
}
