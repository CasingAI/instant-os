import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

// 拖角手势 + 弹簧收尾：手指直接捏住纸角（二维点 F 驱动变形），折痕随拖动转向、
// 纸角钉在指尖——iOS 6 的捏角模型。松手后沿「松手点 → 目标点」直线段弹簧滑向
// 合上（纸角原位）或全开（沿松手方向推到柱面+纸背完全滑出舞台的虚点），直线段
// 保证弹簧起点无跳变。标量 p 是 F 的对角投影（公式与旧版一致），仅供 CSS 两案、
// 开合阈值与贴纸显隐消费——两个便宜档的观感不变。
// session 结构照抄 use-desktop-page-pager：move/up 挂 document、setPointerCapture、unbind 收尾。

const TAP_THRESHOLD = 6
const SPRING_STIFFNESS = 170
const SPRING_DAMPING = 20
const SETTLE_EPS = 0.0015
/** 手指对角投影走到行程的 95% 即计为全开——开合阈值与旧版同一手感 */
const REACH_RATIO = 0.95
/** 全开目标 = 沿松手方向推到 2S+(2−π)R_max，再外推这个余量，保证柱面与纸背整体离台 */
const OPEN_MARGIN = 80

export type CurlVariantProps = {
  /** 卷曲进度 0..1（手指点的对角投影）：0 = 地图页完全盖住设置页，1 = 全部卷开 */
  p: number
  /** 手指捏的点（舞台坐标）；null = 静止合上（纸角在原位）。WebGL 案消费，CSS 两案忽略 */
  finger: { x: number; y: number } | null
  /** 舞台 CSS 像素尺寸（0 时表示尚未完成测量） */
  size: { w: number; h: number }
}

type Pt = { x: number; y: number }

type CurlDragSession = {
  pointerId: number
  moved: boolean
  startX: number
  startY: number
  captureTarget: HTMLElement | undefined
  unbindDocument: () => void
}

export type CurlGesture = {
  p: number
  finger: Pt | null
  size: { w: number; h: number }
  /** 挂到右下角折角热区元素上 */
  cornerOnPointerDown: (event: PointerEvent) => void
  /** 无拖拽时的开合切换（角标点按、键盘 Enter/空格共用） */
  toggle: () => void
  /** 自动演示：弹簧全开 → 停顿 → 弹簧收回 */
  autoPlay: () => void
}

/** 标量 p：手指点的对角投影，钳在 0..1（公式与旧版 progressFromPointer 一致） */
function progressFromFinger(finger: Pt | null, size: { w: number; h: number }): number {
  if (!finger || size.w <= 0 || size.h <= 0) {
    return 0
  }
  const reach = (size.w + size.h) * REACH_RATIO
  return Math.max(0, Math.min(1, (size.w - finger.x + size.h - finger.y - 12) / reach))
}

export function useCurlGesture(stageRef: { current: HTMLDivElement | null }): CurlGesture {
  const [finger, setFinger] = useState<Pt | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const fingerRef = useRef<Pt | null>(null)
  const sizeRef = useRef(size)
  const velocityRef = useRef(0)
  const rafRef = useRef<number | undefined>(undefined)
  const dragRef = useRef<CurlDragSession | undefined>(undefined)
  const autoTimerRef = useRef<number | undefined>(undefined)

  // 舞台实测尺寸（ResizeObserver 模式，同 segmented-control）
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) {
      return
    }
    const measure = () => {
      const w = stage.clientWidth
      const h = stage.clientHeight
      sizeRef.current = { w, h }
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [stageRef])

  const applyFinger = useCallback((next: Pt | null) => {
    fingerRef.current = next
    setFinger(next)
  }, [])

  const stopSpring = useCallback(() => {
    if (rafRef.current !== undefined) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = undefined
    }
    // 冻结即清速：否则弹簧途中抓住角标又原地点按，会把旧速度带进下一次弹簧。
    velocityRef.current = 0
  }, [])

  const corner = useCallback((): Pt => ({ x: sizeRef.current.w, y: sizeRef.current.h }), [])

  /** 全开目标虚点：沿 from−C 方向推到 2S+(2−π)R_max+余量（S=矩形沿该方向从 C
   *  到最远角的支撑距离）。推导：铰点距 C 为 t=(L+πR)/2，柱面向 C 侧鼓出 R，
   *  要求 t−R ≥ S 即 L ≥ 2S+(2−π)R，R 取上限 R_max。方向退化（F≈C）回退主对角。 */
  const openTarget = useCallback((from: Pt): Pt => {
    const { w, h } = sizeRef.current
    const dx = from.x - w
    const dy = from.y - h
    const len = Math.hypot(dx, dy)
    const ux = len > 0.5 ? dx / len : -Math.SQRT1_2
    const uy = len > 0.5 ? dy / len : -Math.SQRT1_2
    const support = Math.max(0, -w * ux - h * uy, -h * uy, -w * ux)
    const rMax = ((w + h) / Math.SQRT2) * 0.24
    const dist = 2 * support + (2 - Math.PI) * rMax + OPEN_MARGIN
    return { x: w + ux * dist, y: h + uy * dist }
  }, [])

  /** 沿「当前位置 → target」直线段弹簧（段参数 0..1，复用旧弹簧常数）。
   *  参数钳在 1：欠阻尼过冲若越过合上端点，F 会冲到 C 外侧、折痕翻面。 */
  const startSpring = useCallback(
    (target: Pt) => {
      stopSpring()
      const origin = fingerRef.current ?? corner()
      if (Math.abs(target.x - origin.x) < 0.5 && Math.abs(target.y - origin.y) < 0.5) {
        applyFinger(target)
        return
      }
      let s = 0
      let last = performance.now()
      const tick = (now: number) => {
        const dt = Math.min((now - last) / 1000, 1 / 30)
        last = now
        const v =
          velocityRef.current + (SPRING_STIFFNESS * (1 - s) - SPRING_DAMPING * velocityRef.current) * dt
        const next = s + v * dt
        if (next >= 1 - SETTLE_EPS) {
          applyFinger(target)
          velocityRef.current = 0
          rafRef.current = undefined
          return
        }
        s = Math.max(0, next)
        velocityRef.current = v
        applyFinger({
          x: origin.x + (target.x - origin.x) * s,
          y: origin.y + (target.y - origin.y) * s,
        })
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [applyFinger, corner, stopSpring],
  )

  const clearAutoTimer = useCallback(() => {
    if (autoTimerRef.current !== undefined) {
      window.clearTimeout(autoTimerRef.current)
      autoTimerRef.current = undefined
    }
  }, [])

  useEffect(
    () => () => {
      dragRef.current?.unbindDocument()
      dragRef.current = undefined
      stopSpring()
      clearAutoTimer()
    },
    [clearAutoTimer, stopSpring],
  )

  /** 无拖拽进行时的开合切换：角标点按与键盘激活共用同一判定 */
  const toggle = useCallback(() => {
    if (dragRef.current) {
      return
    }
    clearAutoTimer()
    const from = fingerRef.current ?? corner()
    startSpring(progressFromFinger(from, sizeRef.current) > 0.5 ? corner() : openTarget(from))
  }, [clearAutoTimer, corner, openTarget, startSpring])

  const cornerOnPointerDown = useCallback(
    (event: PointerEvent) => {
      if (event.button !== 0 || dragRef.current) {
        return
      }
      stopSpring()
      clearAutoTimer()

      const captureTarget =
        event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
      const session: CurlDragSession = {
        pointerId: event.pointerId,
        moved: false,
        startX: event.clientX,
        startY: event.clientY,
        captureTarget,
        unbindDocument: () => {},
      }
      captureTarget?.setPointerCapture(event.pointerId)

      const onDocumentMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== session.pointerId) {
          return
        }
        if (
          !session.moved &&
          Math.abs(moveEvent.clientX - session.startX) < TAP_THRESHOLD &&
          Math.abs(moveEvent.clientY - session.startY) < TAP_THRESHOLD
        ) {
          return
        }
        session.moved = true
        const stage = stageRef.current
        if (!stage) {
          return
        }
        // 手指钳在舞台内：越过纸角原位 C 会让折痕翻到页面外侧、整页错误卷起
        const rect = stage.getBoundingClientRect()
        applyFinger({
          x: Math.min(rect.width, Math.max(0, moveEvent.clientX - rect.left)),
          y: Math.min(rect.height, Math.max(0, moveEvent.clientY - rect.top)),
        })
      }
      const finish = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== session.pointerId) {
          return
        }
        session.unbindDocument()
        if (captureTarget?.hasPointerCapture(session.pointerId)) {
          captureTarget.releasePointerCapture(session.pointerId)
        }
        dragRef.current = undefined
        // 拖了：按过半阈值吸附到开/合；没拖（点按）：直接在开合之间切换
        if (session.moved) {
          const from = fingerRef.current ?? corner()
          startSpring(
            progressFromFinger(from, sizeRef.current) >= 0.5 ? corner() : openTarget(from),
          )
        } else {
          toggle()
        }
      }
      document.addEventListener('pointermove', onDocumentMove)
      document.addEventListener('pointerup', finish)
      document.addEventListener('pointercancel', finish)
      session.unbindDocument = () => {
        document.removeEventListener('pointermove', onDocumentMove)
        document.removeEventListener('pointerup', finish)
        document.removeEventListener('pointercancel', finish)
      }
      dragRef.current = session
    },
    [applyFinger, clearAutoTimer, corner, openTarget, startSpring, stopSpring, toggle],
  )

  const autoPlay = useCallback(() => {
    if (dragRef.current) {
      return
    }
    clearAutoTimer()
    startSpring(openTarget(corner()))
    autoTimerRef.current = window.setTimeout(() => startSpring(corner()), 1100)
  }, [clearAutoTimer, corner, openTarget, startSpring])

  return {
    p: progressFromFinger(finger, size),
    finger,
    size,
    cornerOnPointerDown,
    toggle,
    autoPlay,
  }
}
