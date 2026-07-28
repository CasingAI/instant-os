export const CHROMO_WORKER_ORIGIN =
  import.meta.env.DEV ? 'http://localhost:8787' : 'https://virtual-chromo.r6sg.workers.dev'

/** 单用户全局 viewer 入口；cookie / storage / hot cache 全局共享。 */
export const CHROMO_VIEWER_URL = `${CHROMO_WORKER_ORIGIN}/viewer`

export const CHROMO_DEFAULT_NEW_TAB_URL = 'https://example.com'

/** 地址栏占位 / 新标签默认显示；不会自动导航，需用户按 Enter */
export const CHROMO_OMNIBOX_PLACEHOLDER = '输入网址后按 Enter'

/** virtual-chromo RPC 默认超时（见 docs/protocol.md） */
export const CHROMO_DEFAULT_RPC_TIMEOUT = 30_000

/** VC_SCREENSHOT 默认超时（DOM rasterize 较慢） */
export const CHROMO_DEFAULT_SCREENSHOT_TIMEOUT = 60_000
