export const CHROMO_WORKER_ORIGIN = 'https://virtual-chromo.r6sg.workers.dev'

/** iframe 入口用 Worker 根路径 `/`，不要用 `/viewer.html`。 */
export const CHROMO_VIEWER_URL = `${CHROMO_WORKER_ORIGIN}/`

export const CHROMO_DEFAULT_NEW_TAB_URL = 'https://example.com'

/** 地址栏占位 / 新标签默认显示；不会自动导航，需用户按 Enter */
export const CHROMO_OMNIBOX_PLACEHOLDER = '输入网址后按 Enter'

/** virtual-chromo RPC 默认超时（见 docs/protocol.md） */
export const CHROMO_DEFAULT_RPC_TIMEOUT = 30_000
