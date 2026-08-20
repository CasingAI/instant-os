export const CHROMO_INTERNAL_SCHEME = 'browser'
export const CHROMO_INTERNAL_PAGES = ['history', 'bookmarks', 'settings'] as const

export type ChromoInternalPage = (typeof CHROMO_INTERNAL_PAGES)[number]

const INTERNAL_TITLES: Record<ChromoInternalPage, string> = {
  history: '历史记录',
  bookmarks: '书签',
  settings: '设置',
}

const INTERNAL_PROTOCOLS = new Set(['browser:', 'chromo:', 'chrome:'])

export function chromoInternalUrl(page: ChromoInternalPage): string {
  return `${CHROMO_INTERNAL_SCHEME}://${page}`
}

export function parseChromoInternalPage(input: string): ChromoInternalPage | undefined {
  const trimmed = input.trim()
  if (!trimmed) {
    return undefined
  }

  let candidate = trimmed
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    candidate = `${CHROMO_INTERNAL_SCHEME}://${candidate}`
  }

  try {
    const parsed = new URL(candidate)
    if (!INTERNAL_PROTOCOLS.has(parsed.protocol.toLowerCase())) {
      return undefined
    }
    const host = parsed.hostname.toLowerCase()
    if (host === 'history' || host === 'bookmarks' || host === 'settings') {
      return host
    }
    return undefined
  } catch {
    return undefined
  }
}

export function normalizeChromoInternalUrl(input: string): string | undefined {
  const page = parseChromoInternalPage(input)
  return page ? chromoInternalUrl(page) : undefined
}

export function isChromoInternalUrl(input: string): boolean {
  return Boolean(parseChromoInternalPage(input))
}

/** Viewer 空白页/旧页事件不得覆盖 browser:// 内部页。 */
export function shouldIgnoreChromoViewerNavigation(
  tabUrl: string,
  requestedUrl?: string,
): boolean {
  return isChromoInternalUrl(requestedUrl ?? '') || isChromoInternalUrl(tabUrl)
}

export function chromoInternalPageTitle(page: ChromoInternalPage): string {
  return INTERNAL_TITLES[page]
}

export function chromoPageTitle(url: string): string {
  const page = parseChromoInternalPage(url)
  if (page) {
    return chromoInternalPageTitle(page)
  }
  return url
}
