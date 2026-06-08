/** Write HTML into an iframe so it inherits the parent origin (unlike srcDoc → opaque null). */
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
