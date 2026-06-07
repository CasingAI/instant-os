function wrapHtmlFragment(fragment: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif; }
</style>
</head>
<body>${fragment}</body>
</html>`
}

function findHtmlDocumentStart(text: string): number {
  const doctype = text.search(/<!DOCTYPE\s+html/i)
  if (doctype >= 0) {
    return doctype
  }

  return text.search(/<html[\s>]/i)
}

export function extractPartialHtmlFromStream(text: string): string {
  let cleaned = text.trim()
  if (!cleaned) {
    return ''
  }

  const fenceIndex = cleaned.search(/```(?:html)?\s*/i)
  if (fenceIndex >= 0) {
    cleaned = cleaned.slice(fenceIndex).replace(/^```(?:html)?\s*/i, '')
  }

  cleaned = cleaned.replace(/\n?```[\s\S]*$/, '').trim()

  const docStart = findHtmlDocumentStart(cleaned)
  if (docStart >= 0) {
    return cleaned.slice(docStart)
  }

  const tagStart = cleaned.search(/<[a-z!/][^>]*/i)
  if (tagStart < 0) {
    return ''
  }

  return wrapHtmlFragment(cleaned.slice(tagStart))
}

/** 补全流式输出中未闭合的标签，避免 iframe 解析后 body 为空 */
export function stabilizePartialHtml(html: string): string {
  let result = html.trim()
  if (!result) {
    return ''
  }

  result = result.replace(/<[^>]*$/, '')

  const scriptOpen = result.search(/<script[\s>]/i)
  if (scriptOpen >= 0) {
    const afterScript = result.slice(scriptOpen)
    if (!/<\/script>/i.test(afterScript)) {
      result = result.slice(0, scriptOpen)
    }
  }

  const lower = result.toLowerCase()
  if (lower.includes('</html>')) {
    return result
  }

  const bodyIndex = result.search(/<body[\s>]/i)
  if (bodyIndex >= 0) {
    const headPart = result.slice(0, bodyIndex)
    if (/<style[^>]*>/i.test(headPart) && !/<\/style>/i.test(headPart)) {
      result = `${headPart}</style>\n${result.slice(bodyIndex)}`
    }
  }

  if (/<body[\s>]/i.test(result) && !/<\/body>/i.test(result)) {
    result += '\n</body>'
  } else if (/<\/head>/i.test(result) && !/<body[\s>]/i.test(result)) {
    result += '\n<body></body>'
  } else if (/<head[\s>]/i.test(result) && !/<\/head>/i.test(result)) {
    result += '\n</head>\n<body></body>'
  }

  if (!/<\/html>/i.test(result)) {
    result += '\n</html>'
  }

  return result
}

export function extractTitleFromPartialHtml(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!match?.[1]) {
    return undefined
  }

  const title = match[1].replace(/\s+/g, ' ').trim()
  return title || undefined
}

export const STREAMING_PLACEHOLDER_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; background: transparent; }
</style>
</head>
<body></body>
</html>`
