import { normalizeInstantShellUrl } from '../terminal/instant-shell/instant-shell-url.ts'

const BLOCKED_SCHEME_RE = /^(javascript|data|file|blob|vbscript|about):/i

/** 将 Markdown 内链解析为可在 Chromo 打开的 http(s) URL；不可打开则返回 undefined */
export function resolveMarkdownLinkHref(rawHref: string): string | undefined {
  const href = rawHref.trim()
  if (!href || href === '#' || href.startsWith('#')) {
    return undefined
  }
  if (BLOCKED_SCHEME_RE.test(href)) {
    return undefined
  }
  try {
    return normalizeInstantShellUrl(href)
  } catch {
    return undefined
  }
}

/** 拦截 Markdown 容器内的外链点击，避免整页跳转 */
export function handleMarkdownLinkClick(
  event: MouseEvent,
  openUrl: (url: string) => void,
): void {
  if (event.defaultPrevented || event.button !== 0) {
    return
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return
  }

  const anchor = (event.target as HTMLElement | null)?.closest('a')
  if (!anchor) {
    return
  }

  const rawHref = anchor.getAttribute('href')
  if (!rawHref) {
    return
  }

  if (BLOCKED_SCHEME_RE.test(rawHref.trim())) {
    event.preventDefault()
    return
  }

  const url = resolveMarkdownLinkHref(rawHref)
  if (!url) {
    return
  }

  event.preventDefault()
  openUrl(url)
}
