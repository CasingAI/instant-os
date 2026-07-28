import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

/** 进入窄屏布局的上限（含），与 window-snap 中 NARROW_WORK_AREA_WIDTH 对齐 */
export const APP_NARROW_LAYOUT_MAX_WIDTH = 520

/**
 * 退出窄屏布局的下限（不含）。
 * 与进入阈值拉开滞回，避免卡在临界宽度时布局来回跳。
 */
export const APP_NARROW_LAYOUT_EXIT_WIDTH = 580

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
      const width = node.clientWidth
      setNarrow((current) => {
        if (current) {
          return width < APP_NARROW_LAYOUT_EXIT_WIDTH
        }
        return width <= APP_NARROW_LAYOUT_MAX_WIDTH
      })
      setLayoutReady((ready) => ready || true)
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
