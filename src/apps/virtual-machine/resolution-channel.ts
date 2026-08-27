/**
 * 分辨率自动对齐 —— 宿主侧通道（机制 + 语义层）。
 *
 * 数据流（见 todo/vm-resolution-auto-align/00-overview.md §4）：
 *   ResizeObserver → debounce → 阈值 → clamp
 *     → postMessage `instant-vm:set-resolution`
 *     → 运行时把 (w<<16)|h 写进 v86 io 表 RESOLUTION_CHANNEL_PORT 的 read32 闭包
 *     → 客机代理主动 IN 轮询，值变化才 ChangeDisplaySettingsEx。
 *
 * 目标分辨率 = 从标准档位表里选出的客机档位（2026-08-27 定案，取代同日早些的
 * 「CSS 1:1 直发」）。运行时日志（.zcode/debug/20260827-res-align.log）
 * 证明直发 CSS 有两个致命伤：
 *   a) DPR=2 的 Retina 上面板 CSS 高度常低于 480，clamp 返回 undefined 导致
 *      对齐器全程沉默，客机停在旧的大分辨率；
 *   b) 客机「只选覆盖档」向上跳档（1096×618 → 1152×864），配合「原始」
 *      显示模式呈现为裁切放大——「画面被放大很多倍」的直接来源。
 * 现改为宿主侧直接从标准档位表选档：拉伸/等比最大化实际可见面积（黑边最少），
 * 「原始」只取放得下视口的最大档；发出的就是客机会应用的精确值，
 * 精确命中代理的 exact 分支。小视口自然落到 640×480 地板，
 * 「低于下限沉默」路径不复存在。测量基准仍是 CSS 像素，不涉及 DPR。
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
 * clamp 目标分辨率（协议层护栏：postMessage 值先过这里再打包）。
 * 超过 v86 硬上限压回上限（00 §9）；低于客机最低可用模式返回 0（= 无目标，
 * 客机代理保持现状）。视口→档位的语义换算不在这里，见 selectResolutionMode。
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

/** XP/VGA·VBE 常见标准档位（宿主侧就近选档用；640×480/2560×1600 同时是协议地板与天花板）。 */
export const INSTANT_VM_RESOLUTION_MODES = [
  { width: 640, height: 480 },
  { width: 800, height: 600 },
  { width: 1024, height: 768 },
  { width: 1152, height: 864 },
  { width: 1280, height: 720 },
  { width: 1280, height: 800 },
  { width: 1280, height: 960 },
  { width: 1280, height: 1024 },
  { width: 1440, height: 900 },
  { width: 1600, height: 900 },
  { width: 1600, height: 1200 },
  { width: 1680, height: 1050 },
  { width: 1920, height: 1080 },
  { width: 1920, height: 1200 },
  { width: 2048, height: 1536 },
  { width: 2560, height: 1440 },
  { width: 2560, height: 1600 },
] as const

/**
 * 从标准档位里挑客机目标。两种策略：
 * - native（原始）：只在两维都放得下视口的档位里取面积最大的——画布按
 *   客机px=CSS px 1:1 显示，任何超尺寸都会被裁切滚动，「看全桌面」优先；
 *   连 640×480 都放不下时回落地板档（裁切不可避免）。
 * - 其余（拉伸/等比会等比缩放适配视口）：最大化实际可见面积（黑边最少）；
 *   同比例族并列时取面积最接近视口的一档。
 * 发出去的都是客机枚举得到的真实档位——代理 find_matching_mode 的精确匹配
 * 分支原样应用，不再触发「只选覆盖档」的向上跳档。
 */
/** 宿主选档参考的显示模式；取值与协议 InstantVmDisplayMode 一致。 */
export type ResolutionDisplayMode = 'stretch' | 'contain' | 'native'

export function selectResolutionMode(
  cssWidth: number,
  cssHeight: number,
  displayMode?: ResolutionDisplayMode,
): ResolutionTarget | undefined {
  if (
    !Number.isFinite(cssWidth) ||
    !Number.isFinite(cssHeight) ||
    cssWidth <= 0 ||
    cssHeight <= 0
  ) {
    return undefined
  }
  const cssArea = cssWidth * cssHeight
  let best: ResolutionTarget | undefined
  let bestScore = 0
  let bestTieLogDiff = Number.POSITIVE_INFINITY
  let bestArea = 0
  for (const mode of INSTANT_VM_RESOLUTION_MODES) {
    const area = mode.width * mode.height
    if (displayMode === 'native') {
      // 下取：两维都放得下视口的档位里取面积最大者（放不下只会被裁切滚动）。
      if (mode.width <= cssWidth && mode.height <= cssHeight && area > bestArea) {
        best = { width: mode.width, height: mode.height }
        bestArea = area
      }
      continue
    }
    // 可见画面最大化：显示管线把画布按 s=min(vw/mw, vh/mh) 等比缩放进视口，
    // 实际画入面积 = s²·mw·mh = min(vw²·mh/mw, vh²·mw/mh)。最大化它即最小化
    // 黑边占比；理论上限恰为视口自身面积，且只有宽高比与面板完全一致的档位
    // 才能达到——评分天然「比例匹配优先、大小其次」。同一比例族的档位 m 值
    // 完全相等，此时用 |ln(档位面积/视口面积)| 最近者定名次（同族里选密度
    // 最接近视口的那档）。
    const score = Math.min(
      (cssWidth * cssWidth * mode.height) / mode.width,
      (cssHeight * cssHeight * mode.width) / mode.height,
    )
    const tieLogDiff = Math.abs(Math.log(area / cssArea))
    // 相对容差：分离浮点噪声、保留同族精确相等（1e-12 远大于 2^-52 舍入）。
    if (best === undefined || score > bestScore * (1 + 1e-12)) {
      best = { width: mode.width, height: mode.height }
      bestScore = score
      bestTieLogDiff = tieLogDiff
      bestArea = area
    } else if (score > bestScore * (1 - 1e-12) && tieLogDiff < bestTieLogDiff) {
      best = { width: mode.width, height: mode.height }
      bestScore = Math.max(bestScore, score)
      bestTieLogDiff = tieLogDiff
      bestArea = area
    }
  }
  if (displayMode === 'native') {
    // 连地板档都放不下的小视口：裁切已不可避免，落地板档保持「有目标可发」。
    const [floor] = INSTANT_VM_RESOLUTION_MODES
    return best ?? { width: floor.width, height: floor.height }
  }
  return best
}

/**
 * 视口 CSS 尺寸 → 客机目标（标准档位就近吸附；不乘 DPR）。
 * 非法输入仍返回 undefined；任何正尺寸都有合法档位可回。
 */
export function resolutionTargetFromViewport(
  cssWidth: number,
  cssHeight: number,
  displayMode?: ResolutionDisplayMode,
): ResolutionTarget | undefined {
  return selectResolutionMode(cssWidth, cssHeight, displayMode)
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
  /** 目标确定后回调（已 debounce、已过阈值、已选档）。 */
  onTarget: (target: ResolutionTarget) => void
  debounceMs?: number
  thresholdPx?: number
  /** 当前显示模式；native 走「放得下的最大档」下取策略，其余就近。 */
  displayMode?: ResolutionDisplayMode
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
    const target = resolutionTargetFromViewport(width, height, options.displayMode)
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
