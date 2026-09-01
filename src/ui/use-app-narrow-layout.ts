import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

/** 进入窄屏布局的上限（含），与 window-snap 中 NARROW_WORK_AREA_WIDTH 对齐 */
export const APP_NARROW_LAYOUT_MAX_WIDTH = 520

/**
 * 退出窄屏布局的下限（不含）。
 * 与进入阈值拉开滞回，避免卡在临界宽度时布局来回跳。
 */
export const APP_NARROW_LAYOUT_EXIT_WIDTH = 580

export type AppNarrowLayoutOptions = {
  /** 覆盖进入窄屏的进入阈值（默认 APP_NARROW_LAYOUT_MAX_WIDTH） */
  enterWidth?: number
  /** 覆盖退出窄屏的退出阈值（默认 APP_NARROW_LAYOUT_EXIT_WIDTH） */
  exitWidth?: number
  /**
   * 宽度持续变化期间（窗口尺寸动画、拖拽调整边缘），窄/宽翻转延迟到
   * 「宽度稳定 settleMs 后」才提交——每次尺寸事件都会重置计时器，事件
   * 停了才切换，保证形态切换只发生一次且发生在窗口落定之后。
   * 默认 0 = 测量即提交（与旧行为一致）。
   */
  settleMs?: number
  /**
   * 宿主位于左右半屏吸附窗口（.window-frame--snapped-left/right）内时
   * 强制窄形态——半屏吸附按窄布局处理，不受宽度滞回死区影响。
   * 最大化（--maximized）不受影响，仍按宽度判定。默认 false。
   */
  snapForcesNarrow?: boolean
}

export function useAppNarrowLayout(options?: AppNarrowLayoutOptions): {
  hostRef: (node: HTMLElement | null) => void
  narrowLayout: boolean
  /** 宿主节点完成首次宽度测量后为 true，避免把挂载前的默认 false 当成宽屏 */
  layoutReady: boolean
} {
  const [narrow, setNarrow] = useState(false)
  const [layoutReady, setLayoutReady] = useState(false)
  const observerRef = useRef<ResizeObserver | undefined>()
  const mutationRef = useRef<MutationObserver | undefined>()
  // 参数经 ref 读取：宿主回调只挂一次，运行期改参数即时生效
  const enterRef = useRef<number>(options?.enterWidth ?? APP_NARROW_LAYOUT_MAX_WIDTH)
  const exitRef = useRef<number>(options?.exitWidth ?? APP_NARROW_LAYOUT_EXIT_WIDTH)
  const settleRef = useRef<number>(options?.settleMs ?? 0)
  const snapForceRef = useRef<boolean>(options?.snapForcesNarrow ?? false)
  enterRef.current = options?.enterWidth ?? APP_NARROW_LAYOUT_MAX_WIDTH
  exitRef.current = options?.exitWidth ?? APP_NARROW_LAYOUT_EXIT_WIDTH
  settleRef.current = options?.settleMs ?? 0
  snapForceRef.current = options?.snapForcesNarrow ?? false

  // 窄态现值与待提交目标走 ref：RO / mutation 回调读最新值，
  // 且滞回比较基于「已提交」的窄态，而非动画中途的中间态
  const narrowRef = useRef(false)
  const pendingRef = useRef<{ timer: number; target: boolean } | undefined>(undefined)

  const hostRef = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect()
    mutationRef.current?.disconnect()
    observerRef.current = undefined
    mutationRef.current = undefined
    if (pendingRef.current) {
      clearTimeout(pendingRef.current.timer)
      pendingRef.current = undefined
    }

    if (!node) {
      setLayoutReady(false)
      return
    }

    const sync = () => {
      const width = node.clientWidth
      setLayoutReady((ready) => ready || true)
      const snapped =
        snapForceRef.current &&
        !!node.closest('.window-frame--snapped-left, .window-frame--snapped-right')
      const target = snapped || (narrowRef.current ? width < exitRef.current : width <= enterRef.current)
      if (target === narrowRef.current) {
        // 目标与现值一致：撤销还在等待的翻转
        if (pendingRef.current) {
          clearTimeout(pendingRef.current.timer)
          pendingRef.current = undefined
        }
        return
      }
      const settleMs = settleRef.current
      if (settleMs <= 0) {
        narrowRef.current = target
        setNarrow(target)
        return
      }
      // 每次尺寸事件都重置计时器：事件流停了（窗口落定/手停）才提交
      if (pendingRef.current) clearTimeout(pendingRef.current.timer)
      const timer = window.setTimeout(() => {
        pendingRef.current = undefined
        narrowRef.current = target
        setNarrow(target)
      }, settleMs)
      pendingRef.current = { timer, target }
    }

    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(node)
    observerRef.current = observer

    // 吸附态可能在不改变宽度的情况下切换（同宽吸附↔悬浮），
    // 观察所在窗口根的 class 变化（吸附类名挂在 .window-frame 上）
    if (snapForceRef.current) {
      const frame = node.closest('.window-frame')
      if (frame instanceof HTMLElement) {
        const mutation = new MutationObserver(sync)
        mutation.observe(frame, { attributes: true, attributeFilter: ['class'] })
        mutationRef.current = mutation
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect()
      mutationRef.current?.disconnect()
      if (pendingRef.current) {
        clearTimeout(pendingRef.current.timer)
        pendingRef.current = undefined
      }
    }
  }, [])

  return { hostRef, narrowLayout: narrow, layoutReady }
}
