import { getCachedSiteRootPage } from './browser-page-cache.ts'
import {
  isSameSite,
  isSiteRootUrl,
  isStartPageUrl,
  normalizeBrowserUrl,
  siteRootUrl,
} from './normalize-browser-url.ts'
import type { PageGenerationContext } from './generate-page-stream.ts'

export function buildPageGenerationContext(
  targetUrl: string,
  fromUrl: string | undefined,
  fromHtml: string | undefined,
): PageGenerationContext {
  const url = normalizeBrowserUrl(targetUrl)
  const context: PageGenerationContext = { url }

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
