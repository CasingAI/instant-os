/**
 * 分辨率自动对齐 —— 宿主侧通道（机制 + 语义层）。
 *
 * 数据流（见 todo/vm-resolution-auto-align/00-overview.md §4）：
 *   ResizeObserver → debounce → 阈值 → clamp
 *     → postMessage `instant-vm:set-resolution`
 *     → 运行时把 (w<<16)|h 写进 v86 io 表 RESOLUTION_CHANNEL_PORT 的 read32 闭包
 *     → 客机代理主动 IN 轮询，值变化才 ChangeDisplaySettingsEx。
 *
 * 目标分辨率 = iframe 的 CSS 像素尺寸，1:1 不做 DPR 放大（2026-08-27 定案：
 * 客机画面按 CSS 像素渲染，不追求物理像素对齐）。
 *
 * 本模块只负责宿主这半条链，不触碰 v86，也不直接依赖 DOM 全局：
 * ResizeObserver、定时器全部可注入，因此防抖、阈值、
 * 32 位打包、开关语义都能在 Node 单测里完整验证。
 */

import {
  INSTANT_VM_RESOLUTION_MAX_HEIGHT,
  INSTANT_VM_RESOLUTION_MAX_WIDTH,
  type InstantVmStartMessage,
} from './virtual-machine-protocol.ts'

/** 客机代理轮询的 io 端口；候选依据见 00-overview.md §8.5（0xE000 高段空区）。 */
export const RESOLUTION_CHANNEL_PORT = 0xe000

/** 客机侧最低可用模式（XP 标准 VGA 也至少有 640×480），更小的视口不切模式。 */
export const RESOLUTION_MIN_WIDTH = 640
export const RESOLUTION_MIN_HEIGHT = 480

/** 与 00-overview.md §5 的接线参数一致：debounce ~300ms、阈值 ~80px。 */
export const RESOLUTION_DEBOUNCE_MS = 300
export const RESOLUTION_CHANGE_THRESHOLD_PX = 80

export type ResolutionTarget = {
  width: number
  height: number
}

/**
 * clamp 目标分辨率。超过 v86 硬上限压回上限（00 §9：clamp 后仍交给客机白名单裁决）；
 * 低于下限返回 undefined —— 视口太小时保持客机现状，而不是反向缩小字体到不可用。
 */
export function clampResolutionTarget(
  width: number,
  height: number,
): ResolutionTarget | undefined {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined
  }
  if (width < RESOLUTION_MIN_WIDTH || height < RESOLUTION_MIN_HEIGHT) {
    return undefined
  }
  return {
    width: Math.min(Math.round(width), INSTANT_VM_RESOLUTION_MAX_WIDTH),
    height: Math.min(Math.round(height), INSTANT_VM_RESOLUTION_MAX_HEIGHT),
  }
}

/**
 * 打包成端口 read32 的 32 位值 `(w<<16)|h`。
 * clamp 必须发生在移位之前（00 §8.4），所以这里先走 clamp，任何一侧非法都返回
 * 0（= 无目标，客机代理按「保持现状」处理）。
 */
export function packResolutionValue(width: number, height: number): number {
  const target = clampResolutionTarget(width, height)
  if (!target) {
    return 0
  }
  return (target.width << 16) | target.height
}

/** `packResolutionValue` 的逆运算；0 表示无目标。 */
export function unpackResolutionValue(value: number): ResolutionTarget | undefined {
  if (!Number.isInteger(value) || value <= 0) {
    return undefined
  }
  const width = (value >>> 16) & 0xffff
  const height = value & 0xffff
  if (width <= 0 || height <= 0) {
    return undefined
  }
  return { width, height }
}

/** 视口 CSS 尺寸 → 客机目标像素（1:1，不乘 DPR；clamp 与取整在这里做）。 */
export function resolutionTargetFromViewport(
  cssWidth: number,
  cssHeight: number,
): ResolutionTarget | undefined {
  return clampResolutionTarget(cssWidth, cssHeight)
}

/** 与上次已生效目标相比，任一轴变化达到阈值才值得让客机重排。 */
export function isResolutionTargetChanged(
  previous: ResolutionTarget | undefined,
  next: ResolutionTarget,
  thresholdPx = RESOLUTION_CHANGE_THRESHOLD_PX,
): boolean {
  if (!previous) {
    return true
  }
  return (
    Math.abs(next.width - previous.width) >= thresholdPx ||
    Math.abs(next.height - previous.height) >= thresholdPx
  )
}

/** start 消息是否要求分辨率自动对齐；省略/关闭都按关。 */
export function resolutionAutoAlignEnabled(
  startMessage: InstantVmStartMessage | undefined,
): boolean {
  return startMessage?.config.resolutionAutoAlign === true
}

/** ResizeObserver 的最小面：单元素 observe/disconnect，测试可注入假实现。 */
export type ResizeLikeObserver = {
  observe(target: Element): void
  disconnect(): void
}

export type ResolutionAlignerOptions = {
  /** 目标确定后回调（已 debounce、已过阈值、已 clamp）。 */
  onTarget: (target: ResolutionTarget) => void
  debounceMs?: number
  thresholdPx?: number
  /** 测量视口尺寸，默认 getBoundingClientRect；测试注入固定值。 */
  measure?: (element: Element) => { width: number; height: number }
  /** 定时器调度，默认 setTimeout；测试注入假时钟。 */
  schedule?: (callback: () => void, ms: number) => () => void
  /** 构造 ResizeObserver；测试注入假观察器。 */
  createObserver?: (callback: () => void) => ResizeLikeObserver
}

export type ResolutionAligner = {
  observe(element: Element): void
  disconnect(): void
}

/**
 * 把宿主视口尺寸变成低频的 set-resolution 消息。
 * 防反馈震荡的关键：只观察「外层视口」（iframe 所在的布局容器，尺寸由宿主窗口
 * 决定），绝不观察由客机画面撑开的元素；连续 resize 在 debounce 窗口内合并成
 * 最后一次的值。
 */
export function createResolutionAligner(options: ResolutionAlignerOptions): ResolutionAligner {
  const debounceMs = options.debounceMs ?? RESOLUTION_DEBOUNCE_MS
  const thresholdPx = options.thresholdPx ?? RESOLUTION_CHANGE_THRESHOLD_PX
  const measure =
    options.measure ??
    ((element: Element) => {
      const rect = element.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    })
  const schedule =
    options.schedule ??
    ((callback: () => void, ms: number) => {
      const timer = globalThis.setTimeout(callback, ms)
      return () => globalThis.clearTimeout(timer)
    })
  const createObserver =
    options.createObserver ??
    ((callback: () => void) => {
      const observer = new ResizeObserver(() => callback())
      return {
        observe: (target: Element) => observer.observe(target),
        disconnect: () => observer.disconnect(),
      }
    })

  let element: Element | undefined
  let observer: ResizeLikeObserver | undefined
  let cancelDebounce: (() => void) | undefined
  let committed: ResolutionTarget | undefined
  let disconnected = false

  const evaluate = () => {
    if (disconnected || !element) {
      return
    }
    const { width, height } = measure(element)
    const target = resolutionTargetFromViewport(width, height)
    if (!target || !isResolutionTargetChanged(committed, target, thresholdPx)) {
      return
    }
    committed = target
    options.onTarget(target)
  }

  return {
    observe(target: Element) {
      if (disconnected || observer) {
        return
      }
      element = target
      observer = createObserver(() => {
        cancelDebounce?.()
        cancelDebounce = schedule(evaluate, debounceMs)
      })
      observer.observe(target)
      // 挂上就对齐一次当前视口，客机代理一开机轮询就能拿到现值。
      evaluate()
    },
    disconnect() {
      if (disconnected) {
        return
      }
      disconnected = true
      cancelDebounce?.()
      cancelDebounce = undefined
      observer?.disconnect()
      observer = undefined
      element = undefined
    },
  }
}
