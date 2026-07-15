/** 清理 AI HTML，避免 target/_blank、内联事件、CSP 等绕过或阻断 Safari 内部导航 */
export function sanitizeHtmlForSafari(html: string): string {
  let result = html.replace(/<script[\s>][\s\S]*?<\/script>/gi, '')
  result = result.replace(
    /<meta[^>]+http-equiv\s*=\s*["']?Content-Security-Policy["']?[^>]*>/gi,
    '',
  )
  result = result.replace(/\s+target\s*=\s*["'][^"']*["']/gi, '')
  result = result.replace(/\s+on[a-z]+\s*=\s*["'][^"']*["']/gi, '')
  return result
}

function escapeBaseHref(url: string): string {
  return url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

export function injectPageBaseHref(html: string, pageUrl: string): string {
  if (!html.trim() || !pageUrl) {
    return html
  }

  const baseTag = `<base href="${escapeBaseHref(pageUrl)}">`
  const withoutBase = html.replace(/<base[\s>][^>]*>/gi, '')

  if (/<head[\s>]/i.test(withoutBase)) {
    return withoutBase.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n${baseTag}`)
  }

  if (/<html[\s>]/i.test(withoutBase)) {
    return withoutBase.replace(/<html(\s[^>]*)?>/i, (match) => `${match}\n<head>${baseTag}</head>`)
  }

  return `<head>${baseTag}</head>\n${withoutBase}`
}
