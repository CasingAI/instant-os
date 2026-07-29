export const PAGE_WORKER_ORIGIN =
  import.meta.env.DEV ? 'http://localhost:8787' : 'https://virtual-chromo.r6sg.workers.dev'

/** @deprecated Prefer PAGE_WORKER_ORIGIN */
export const CHROMO_WORKER_ORIGIN = PAGE_WORKER_ORIGIN

/** 单用户全局 viewer 入口；cookie / storage / hot cache 全局共享。 */
export const PAGE_VIEWER_URL = `${PAGE_WORKER_ORIGIN}/viewer`

/** @deprecated Prefer PAGE_VIEWER_URL */
export const CHROMO_VIEWER_URL = PAGE_VIEWER_URL

/** Worker 上的新标签空白页（viewer 自动加载；地址栏保持空）。 */
export const PAGE_BLANK_PATH = '/blank.html'

/** @deprecated Prefer PAGE_BLANK_PATH */
export const CHROMO_BLANK_PATH = PAGE_BLANK_PATH

export const PAGE_DEFAULT_NEW_TAB_URL = 'https://example.com'

/** @deprecated Prefer PAGE_DEFAULT_NEW_TAB_URL */
export const CHROMO_DEFAULT_NEW_TAB_URL = PAGE_DEFAULT_NEW_TAB_URL

/** 地址栏占位 / 新标签默认显示；不会自动导航，需用户按 Enter */
export const PAGE_OMNIBOX_PLACEHOLDER = '输入网址后按 Enter'

/** @deprecated Prefer PAGE_OMNIBOX_PLACEHOLDER */
export const CHROMO_OMNIBOX_PLACEHOLDER = PAGE_OMNIBOX_PLACEHOLDER

/** virtual-chromo RPC 默认超时（见 docs/protocol.md） */
export const PAGE_DEFAULT_RPC_TIMEOUT = 30_000

/** @deprecated Prefer PAGE_DEFAULT_RPC_TIMEOUT */
export const CHROMO_DEFAULT_RPC_TIMEOUT = PAGE_DEFAULT_RPC_TIMEOUT

/** VC_SCREENSHOT 默认超时（DOM rasterize 较慢） */
export const PAGE_DEFAULT_SCREENSHOT_TIMEOUT = 60_000

/** @deprecated Prefer PAGE_DEFAULT_SCREENSHOT_TIMEOUT */
export const CHROMO_DEFAULT_SCREENSHOT_TIMEOUT = PAGE_DEFAULT_SCREENSHOT_TIMEOUT
