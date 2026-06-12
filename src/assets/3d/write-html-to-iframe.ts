/** 向 iframe 写入 HTML（继承父页面 origin；优于 srcDoc 的 opaque null origin）。 */
export function writeHtmlToIframe(iframe: HTMLIFrameElement | null, html: string): boolean {
  if (!iframe || !html.trim()) {
    return false
  }

  const doc = iframe.contentDocument ?? iframe.contentWindow?.document
  if (!doc) {
    return false
  }

  doc.open()
  doc.write(html)
  doc.close()
  return true
}

export function ensureIframeBlankDocument(iframe: HTMLIFrameElement | null): void {
  if (!iframe) {
    return
  }

  if (!iframe.src || iframe.src === 'about:blank') {
    iframe.src = 'about:blank'
  }
}
