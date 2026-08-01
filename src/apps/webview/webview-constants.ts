/** 离屏池中页面视口尺寸（无 chrome）；与 `.webview--offscreen` CSS 保持同步。 */
export const WEBVIEW_OFFSCREEN_VIEWPORT = { width: 960, height: 720 } as const

/** 主机侧拉取的页面 console 环形缓冲上限。 */
export const WEBVIEW_MAX_CONSOLE_ENTRIES = 1000

/** 主机侧 network 条目环形缓冲上限。 */
export const WEBVIEW_MAX_NETWORK_ENTRIES = 500

export function trimRingBuffer<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return items as T[]
  return items.slice(-max)
}
