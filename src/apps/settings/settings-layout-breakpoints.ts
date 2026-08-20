import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

/** 与 settings.css 中 @container app-window (min-width: 700px) 保持一致。 */
export const SETTINGS_WIDE_LAYOUT_MIN_WIDTH = 700

/**
 * 账户页弹出菜单 vs 推子页的分界。
 * 低于此宽度才走子页；应明显小于侧栏布局阈值，避免「已有侧栏但内容区偏窄」时误触子页。
 * 与 settings.css 中 @container app-window (max-width: 540px) 同量级。
 */
export const SETTINGS_ACCOUNT_POPOVER_MIN_WIDTH = 520

function useMeasuredMinWidth(minWidth: number): {
  hostRef: (node: HTMLElement | null) => void
  meetsMinWidth: boolean
} {
  const [meetsMinWidth, setMeetsMinWidth] = useState(false)
  const observerRef = useRef<ResizeObserver | undefined>()

  const hostRef = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = undefined

    if (!node) {
      return
    }

    const sync = () => {
      const next = node.clientWidth >= minWidth
      setMeetsMinWidth((current) => (current === next ? current : next))
    }

    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(node)
    observerRef.current = observer
  }, [minWidth])

  useEffect(() => {
    return () => observerRef.current?.disconnect()
  }, [])

  return { hostRef, meetsMinWidth }
}

export function useSettingsWideLayout(): {
  hostRef: (node: HTMLElement | null) => void
  wideLayout: boolean
} {
  const { hostRef, meetsMinWidth } = useMeasuredMinWidth(SETTINGS_WIDE_LAYOUT_MIN_WIDTH)
  return { hostRef, wideLayout: meetsMinWidth }
}

export function useSettingsAccountPopoverLayout(): {
  hostRef: (node: HTMLElement | null) => void
  usePopover: boolean
} {
  const { hostRef, meetsMinWidth } = useMeasuredMinWidth(SETTINGS_ACCOUNT_POPOVER_MIN_WIDTH)
  return { hostRef, usePopover: meetsMinWidth }
}
