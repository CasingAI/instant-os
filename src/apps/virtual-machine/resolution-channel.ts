/**
 * 分辨率自动对齐 —— 宿主侧通道（机制 + 语义层）。
 *
 * 数据流（见 todo/vm-resolution-auto-align/00-overview.md §4 与
 * todo/vm-arbitrary-resolution/00-overview.md §2）：
 *   ResizeObserver → debounce → 阈值 → clamp → 8px 网格
 *     → postMessage `instant-vm:set-resolution`
 *     → 运行时把 (w<<16)|h 写进闭包：
 *       a. COM1 串口帧 → res-agent（ring3，枚举→精确匹配→切换）；
 *       b. io 读端口 0xE001/0xE002/0xE003 → boxvnt 驱动动态模式（ring0）。
 *
 * 目标分辨率 = 视口 CSS 像素任意直推（2026-08-27 vm-arbitrary-resolution
 * 定案，取代同日早间的「标准档位选档」）。历史包袱说明：CSS 直发在无驱动
 * 改造时有两个致命伤（Retina 小视口低于 480 导致沉默、「只选覆盖档」向上
 * 跳档放大），当时改走 17 档吸附；boxvnt 驱动支持任意模式后，这两个问题
 * 都不复存在——低于 640×480 仍沉默（保持现状），其余逐像素贴合视口。
 * selectResolutionMode/17 档表保留：驱动未装等回退场景的程序化参考，
 * 以及对未来「显式选档」功能的复用。
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
 * 从标准档位里挑客机目标（17 档表就近吸附；vm-arbitrary-resolution 后
 * 已不是生产路径——resolutionTargetFromViewport 改为任意直推，本函数
 * 保留给驱动未装等回退场景的程序化参考与既有测试）。两种策略：
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
 * 视口 CSS 尺寸 → 客机目标（任意直推，不再吸附档位表）。
 *
 * todo/vm-arbitrary-resolution 定案：客机装上 boxvnt 改造驱动后，任何
 * 640×480–2560×1600 之间的分辨率都能精确设置（驱动动态模式 + 密阶梯
 * 兜底），宿主直接把视口尺寸四舍五入到 8px 网格发下去即可——与驱动
 * vmpValidateMode 的 HorzRes % 8 校验、密阶梯步长三方对齐。
 * displayMode 不再影响目标（拉伸/等比/原始都追求逐像素贴合视口），
 * 参数保留是为了兼容既有调用点。
 * 低于 640×480 的视口仍返回 undefined（客机保持现状，02 手册第 4 步）。
 */
export const RESOLUTION_GRID_PX = 8

export function resolutionTargetFromViewport(
  cssWidth: number,
  cssHeight: number,
  _displayMode?: ResolutionDisplayMode,
): ResolutionTarget | undefined {
  const target = clampResolutionTarget(cssWidth, cssHeight)
  if (!target) {
    return undefined
  }
  return {
    width: Math.round(target.width / RESOLUTION_GRID_PX) * RESOLUTION_GRID_PX,
    height: Math.round(target.height / RESOLUTION_GRID_PX) * RESOLUTION_GRID_PX,
  }
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
