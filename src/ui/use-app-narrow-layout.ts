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
   * 窄/宽翻转延迟到「宽度稳定 settleMs 后」才提交——每次尺寸事件都会重置
   * 计时器，事件停了才切换。指针拖拽调宽（.window-frame--resizing 挂着）
   * 期间不提交，等松手、宽度停变后才提交，形变动画才能拿到稳定的起止点。
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
  const layoutReadyRef = useRef(false)

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
      layoutReadyRef.current = false
      setLayoutReady(false)
      return
    }

    const sync = () => {
      const width = node.clientWidth
      const snapped =
        snapForceRef.current &&
        !!node.closest('.window-frame--snapped-left, .window-frame--snapped-right')
      const target = snapped || (narrowRef.current ? width < exitRef.current : width <= enterRef.current)

      // 首次测量立刻落定：settle 只保护之后的翻转，避免挂载后先闪一帧错形态
      if (!layoutReadyRef.current) {
        layoutReadyRef.current = true
        setLayoutReady(true)
        narrowRef.current = target
        setNarrow(target)
        return
      }

      // settle 开启时：指针拖拽中（--resizing 挂着）宽度在流式变化——期间
      // 不提交翻转（撤销待提交的计时器即可），形态保持不变，滞回死区防来回
      // 抖动；松手拿掉 --resizing 后宽度停变，才走 settle 提交，消费方的
      // 形变动画拿得到稳定的起止点。settle=0 的调用方保持逐帧跟随。
      if (settleRef.current > 0 && node.closest('.window-frame--resizing')) {
        if (pendingRef.current) {
          clearTimeout(pendingRef.current.timer)
          pendingRef.current = undefined
        }
        return
      }
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

    // 吸附态（同宽吸附↔悬浮）与拖边缘（--resizing 挂/卸）都可能在宽度不变
    // 时改变形态提交时机。仅在真正用到这两路时观察，避免拖拽改写其它应用的形态。
    if (snapForceRef.current || settleRef.current > 0) {
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
