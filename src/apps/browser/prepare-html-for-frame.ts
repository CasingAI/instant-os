import { injectIframeEmojiFonts } from '../../fonts/inject-iframe-emoji-fonts.ts'
import { injectPageBaseHref, sanitizeHtmlForSafari } from './sanitize-html-for-safari.ts'
import { stabilizePartialHtml } from './extract-partial-html.ts'

export function prepareHtmlForSafariFrame(html: string, pageUrl: string): string {
  if (!html.trim()) {
    return ''
  }

  const stabilized = stabilizePartialHtml(html)
  const sanitized = sanitizeHtmlForSafari(stabilized)
  const withBase = injectPageBaseHref(sanitized, pageUrl)
  // 页内导航由父页 attachSafariFrameNavigation 接管，不再注入 iframe 脚本桥
  // （旧桥会 stopImmediatePropagation，一旦 postMessage 校验失败链接会全部失效）
  return injectIframeEmojiFonts(withBase)
}
