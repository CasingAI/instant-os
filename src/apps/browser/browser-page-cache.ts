import {
  DEVICE_STORAGE_KEYS,
  getLocalStorageKeyBytes,
  writeLocalStorageItem,
} from '../../os/device-storage.ts'
import {
  hostnameFromUrl,
  isStartPageUrl,
  normalizeBrowserUrl,
  siteRootUrl,
} from './normalize-browser-url.ts'

export type CachedPageRecord = {
  url: string
  title: string
  html: string
  pageTokens: number | undefined
  cachedAt: number
}

type PageCacheStore = {
  pages: Record<string, CachedPageRecord>
}

export type SiteCacheSummary = {
  hostname: string
  pageCount: number
  bytes: number
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.safariPageCache

function emptyStore(): PageCacheStore {
  return { pages: {} }
}

function cacheKey(url: string): string {
  return normalizeBrowserUrl(url)
}

function migratePageCacheStore(store: PageCacheStore): PageCacheStore {
  const nextPages: Record<string, CachedPageRecord> = {}
  let changed = false

  for (const [key, record] of Object.entries(store.pages)) {
    const canonicalKey = cacheKey(key)
    if (canonicalKey !== key) {
      changed = true
    }

    const existing = nextPages[canonicalKey]
    if (!existing || record.cachedAt > existing.cachedAt) {
      nextPages[canonicalKey] = { ...record, url: canonicalKey }
    }
  }

  if (!changed) {
    return store
  }

  saveStore({ pages: nextPages })
  return { pages: nextPages }
}

function loadStore(): PageCacheStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return emptyStore()
    }
    const parsed = JSON.parse(raw) as PageCacheStore
    if (!parsed.pages || typeof parsed.pages !== 'object') {
      return emptyStore()
    }
    return migratePageCacheStore(parsed)
  } catch {
    return emptyStore()
  }
}

function saveStore(store: PageCacheStore): boolean {
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(store))
}

export function getCachedPage(url: string): CachedPageRecord | undefined {
  if (isStartPageUrl(url)) {
    return undefined
  }
  return loadStore().pages[cacheKey(url)]
}

export function saveCachedPage(record: Omit<CachedPageRecord, 'cachedAt'> & { cachedAt?: number }): boolean {
  if (isStartPageUrl(record.url)) {
    return true
  }

  const store = loadStore()
  const key = cacheKey(record.url)
  store.pages[key] = {
    url: key,
    title: record.title,
    html: record.html,
    pageTokens: record.pageTokens,
    cachedAt: record.cachedAt ?? Date.now(),
  }
  return saveStore(store)
}

export function removeCachedPage(url: string): boolean {
  const store = loadStore()
  delete store.pages[cacheKey(url)]
  return saveStore(store)
}

export function getBrowserPageCacheStorageBytes(): number {
  return getLocalStorageKeyBytes(STORAGE_KEY)
}

export function getCachedPageCount(): number {
  return Object.keys(loadStore().pages).length
}

export function getSiteCacheSummaries(): SiteCacheSummary[] {
  const store = loadStore()
  const byHost = new Map<string, SiteCacheSummary>()

  for (const record of Object.values(store.pages)) {
    const hostname = hostnameFromUrl(record.url)
    const recordBytes = new TextEncoder().encode(JSON.stringify(record)).length
    const existing = byHost.get(hostname) ?? { hostname, pageCount: 0, bytes: 0 }
    existing.pageCount += 1
    existing.bytes += recordBytes
    byHost.set(hostname, existing)
  }

  return [...byHost.values()].sort((a, b) => b.bytes - a.bytes)
}

export function getCachedSiteRootPage(url: string): CachedPageRecord | undefined {
  const root = siteRootUrl(url)
  if (isStartPageUrl(root)) {
    return undefined
  }
  return getCachedPage(root)
}

export function clearAllPageCache(): void {
  saveStore(emptyStore())
}

export function clearSitePageCache(hostname: string): void {
  const normalizedHost = hostname.replace(/^www\./, '')
  const store = loadStore()
  const nextPages: Record<string, CachedPageRecord> = {}

  for (const [key, record] of Object.entries(store.pages)) {
    if (hostnameFromUrl(record.url) !== normalizedHost) {
      nextPages[key] = record
    }
  }

  saveStore({ pages: nextPages })
}
