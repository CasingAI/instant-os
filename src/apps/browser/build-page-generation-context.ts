import { getCachedSiteRootPage } from './browser-page-cache.ts'
import {
  isSameSite,
  isSiteRootUrl,
  isStartPageUrl,
  normalizeBrowserUrl,
  siteRootUrl,
} from './normalize-browser-url.ts'
import type { PageGenerationContext, PageViewportSize } from './generate-page-stream.ts'

export function readBrowserViewportSize(
  element: HTMLElement | undefined,
): PageViewportSize | undefined {
  if (!element) {
    return undefined
  }

  const rect = element.getBoundingClientRect()
  const width = Math.round(rect.width)
  const height = Math.round(rect.height)
  if (width <= 0 || height <= 0) {
    return undefined
  }

  return {
    width,
    height,
    devicePixelRatio: window.devicePixelRatio,
  }
}

export function buildPageGenerationContext(
  targetUrl: string,
  fromUrl: string | undefined,
  fromHtml: string | undefined,
  viewport?: PageViewportSize,
): PageGenerationContext {
  const url = normalizeBrowserUrl(targetUrl)
  const context: PageGenerationContext = {
    url,
    userAgent: navigator.userAgent,
    viewport,
  }

  if (fromUrl && !isStartPageUrl(fromUrl) && isSameSite(fromUrl, url) && fromHtml) {
    context.referrerUrl = normalizeBrowserUrl(fromUrl)
    context.referrerHtml = fromHtml
    return context
  }

  const root = siteRootUrl(url)
  if (!isSiteRootUrl(url)) {
    const rootPage = getCachedSiteRootPage(url)
    if (rootPage?.html) {
      context.siteRootUrl = root
      context.siteRootHtml = rootPage.html
    }
  }

  return context
}
