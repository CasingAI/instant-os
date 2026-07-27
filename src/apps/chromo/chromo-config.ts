export const CHROMO_WORKER_ORIGIN = 'https://virtual-chromo.r6sg.workers.dev'

/** 每个 BrowserContext（标签页）独立 session，cookie / storage 按 session 隔离。 */
export function chromoViewerUrl(sessionId: string): string {
  return `${CHROMO_WORKER_ORIGIN}/s/${encodeURIComponent(sessionId)}/`
}

export const CHROMO_DEFAULT_NEW_TAB_URL = 'https://example.com'

/** 地址栏占位 / 新标签默认显示；不会自动导航，需用户按 Enter */
export const CHROMO_OMNIBOX_PLACEHOLDER = '输入网址后按 Enter'

/** virtual-chromo RPC 默认超时（见 docs/protocol.md） */
export const CHROMO_DEFAULT_RPC_TIMEOUT = 30_000

/** VC_SCREENSHOT 默认超时（DOM rasterize 较慢） */
export const CHROMO_DEFAULT_SCREENSHOT_TIMEOUT = 60_000
