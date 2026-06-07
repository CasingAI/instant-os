import { normalizeBrowserUrl } from './normalize-browser-url.ts'

/** iframe 内 document.baseURI 会落在 Vite 开发服务器上，需用模拟页 URL 作基准 */
export function resolveBrowserNavigationUrl(
  href: string,
  pageBaseUrl: string,
): string | undefined {
  if (!href || href === '#' || href.startsWith('javascript:')) {
    return undefined
  }

  try {
    return new URL(href, pageBaseUrl).href
  } catch {
    return undefined
  }
}

/** 拦截误解析到 Instant OS 宿主页面（localhost:5173 等）的导航 */
export function isEmbeddedAppOrigin(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.origin === window.location.origin
  } catch {
    return false
  }
}

export function isSameDocumentUrl(urlA: string, urlB: string): boolean {
  try {
    const left = new URL(normalizeBrowserUrl(urlA))
    const right = new URL(normalizeBrowserUrl(urlB))
    left.hash = ''
    right.hash = ''
    return left.href === right.href
  } catch {
    return normalizeBrowserUrl(urlA) === normalizeBrowserUrl(urlB)
  }
}

export function resolveFrameLinkUrl(link: Element, pageBaseUrl: string): string | undefined {
  const hrefAttr = link.getAttribute('href') ?? ''
  if (!hrefAttr || hrefAttr === '#' || hrefAttr.startsWith('javascript:')) {
    return undefined
  }

  const resolved = resolveBrowserNavigationUrl(hrefAttr, pageBaseUrl)
  if (!resolved || isEmbeddedAppOrigin(resolved)) {
    return undefined
  }

  return resolved
}

export function resolveFrameImageUrl(image: Element, pageBaseUrl: string): string | undefined {
  const srcAttr = image.getAttribute('src') ?? ''
  if (!srcAttr || srcAttr.startsWith('javascript:')) {
    return undefined
  }

  const resolved = resolveBrowserNavigationUrl(srcAttr, pageBaseUrl)
  if (!resolved || isEmbeddedAppOrigin(resolved)) {
    return undefined
  }

  return resolved
}

export function buildFormNavigationUrl(form: HTMLFormElement, pageBaseUrl: string): string | undefined {
  try {
    const action = form.getAttribute('action') || pageBaseUrl
    const target = new URL(action, pageBaseUrl)
    const data = new FormData(form)
    data.forEach((value, key) => {
      target.searchParams.set(key, String(value))
    })
    return target.href
  } catch {
    return undefined
  }
}
