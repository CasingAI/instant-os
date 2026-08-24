import { resolveProxyBaseUrl } from '../os/proxy-server-settings-storage.ts'

/** 设置页自定义输入框占位示例 */
export const PROXY_SERVER_URL_PLACEHOLDER = 'https://your-worker.workers.dev'

/**
 * Chromo / WebView 与宿主 proxiedFetch 共用的 Worker origin。
 * 来自系统设置的 preset（共享 / 自定义）；关闭或未填自定义时返回 undefined。
 */
export function getPageWorkerOrigin(): string | undefined {
  return resolveProxyBaseUrl()
}

export function isPageWorkerConfigured(): boolean {
  return getPageWorkerOrigin() !== undefined
}

/**
 * Viewer 入口。未配置代理时返回 undefined。
 * 传入 clientId 时带查询参数，让每个标签的外壳文档身份不同，避免同 src 串台。
 */
export function getPageViewerUrl(clientId?: string): string | undefined {
  const origin = getPageWorkerOrigin()
  if (!origin) {
    return undefined
  }
  const url = new URL('/viewer', `${origin}/`)
  if (clientId) {
    url.searchParams.set('vcid', clientId)
  }
  return url.href
}

/** @deprecated Prefer getPageWorkerOrigin() */
export const PAGE_WORKER_ORIGIN = ''

/** @deprecated Prefer getPageWorkerOrigin() */
export const CHROMO_WORKER_ORIGIN = ''

/** @deprecated Prefer getPageViewerUrl() */
export const PAGE_VIEWER_URL = ''

/** @deprecated Prefer getPageViewerUrl() */
export const CHROMO_VIEWER_URL = ''

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
