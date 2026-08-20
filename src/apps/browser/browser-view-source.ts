/** 将原始 HTML 转成「查看源代码」标签页可展示的等宽转义页（不走 AI）。 */

function escapeHtmlText(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/**
 * @param sourceHtml 页面原文（生成结果或本机文件），非 prepare 后的消毒 HTML
 * @param pageUrl 被查看的真实地址（不含 view-source: 前缀）
 */
export function htmlForViewSource(sourceHtml: string, pageUrl: string): string {
  const title = escapeHtmlText(`view-source:${pageUrl}`)
  const body = escapeHtmlText(sourceHtml)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>
html,body{margin:0;padding:0;background:#fff;color:#111}
body{padding:24px;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
</style></head><body>${body}</body></html>`
}
