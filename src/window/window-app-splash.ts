/** 新建窗口启动层最短盖住时间。 */
export const WINDOW_SPLASH_MIN_MS = 400
/** 启动层淡出时长，与 CSS transition 对齐。 */
export const WINDOW_SPLASH_FADE_MS = 200
/** 启动层图标基准（实现前客户区占位尺寸）。 */
export const WINDOW_SPLASH_ICON_BASE_PX = 64
/** 默认 2 倍；大窗口最高 4 倍。 */
export const WINDOW_SPLASH_ICON_MIN_PX = WINDOW_SPLASH_ICON_BASE_PX * 2
export const WINDOW_SPLASH_ICON_MAX_PX = WINDOW_SPLASH_ICON_BASE_PX * 4
/** 按窗口短边的比例放大，小窗不低于 2 倍。 */
const WINDOW_SPLASH_ICON_SHORT_RATIO = 0.25

export function windowSplashIconSize(width: number, height: number): number {
  const short = Math.max(1, Math.min(width, height))
  const raw = short * WINDOW_SPLASH_ICON_SHORT_RATIO
  return Math.round(
    Math.min(WINDOW_SPLASH_ICON_MAX_PX, Math.max(WINDOW_SPLASH_ICON_MIN_PX, raw)),
  )
}

export function remainingWindowSplashMs(params: {
  shownAt: number
  now: number
  contentReady: boolean
  minMs?: number
}): number | undefined {
  if (!params.contentReady) return undefined
  const minMs = params.minMs ?? WINDOW_SPLASH_MIN_MS
  return Math.max(0, minMs - (params.now - params.shownAt))
}

export function canRevealWindowSplash(params: {
  shownAt: number
  now: number
  contentReady: boolean
  minMs?: number
}): boolean {
  return remainingWindowSplashMs(params) === 0
}
