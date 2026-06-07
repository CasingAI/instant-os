import { injectPageBaseHref, injectSafariNavigationBridge, sanitizeHtmlForSafari } from './sanitize-html-for-safari.ts'
import { stabilizePartialHtml } from './extract-partial-html.ts'

export function prepareHtmlForSafariFrame(html: string, pageUrl: string): string {
  if (!html.trim()) {
    return ''
  }

  const stabilized = stabilizePartialHtml(html)
  const sanitized = sanitizeHtmlForSafari(stabilized)
  const withBase = injectPageBaseHref(sanitized, pageUrl)
  return injectSafariNavigationBridge(withBase, pageUrl)
}
