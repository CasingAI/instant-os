import { osNowMs } from '../../os/os-clock.ts'
import {
  clearAllSafariPageCache,
  clearSafariPageCacheByHostname,
  deleteSafariPageCacheRecord,
  getAllSafariPageCacheRecords,
  getSafariPageCacheBytes,
  putSafariPageCacheRecord,
} from '../../os/device-data-storage.ts'
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

let memoryStore: PageCacheStore = emptyStore()
let ready = false
let readyPromise: Promise<void> | undefined
let reportedCacheBytes = 0

function emptyStore(): PageCacheStore {
  return { pages: {} }
}

function cacheKey(url: string): string {
  return normalizeBrowserUrl(url)
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^www\./, '')
}

function canonicalizePageCacheStore(store: PageCacheStore): PageCacheStore {
  const nextPages: Record<string, CachedPageRecord> = {}

  for (const [key, record] of Object.entries(store.pages)) {
    const canonicalKey = cacheKey(key)
    const existing = nextPages[canonicalKey]
    if (!existing || record.cachedAt > existing.cachedAt) {
      nextPages[canonicalKey] = { ...record, url: canonicalKey }
    }
  }

  return { pages: nextPages }
}

function recordFromStoreEntry(record: CachedPageRecord): Parameters<typeof putSafariPageCacheRecord>[0] {
  return {
    url: record.url,
    hostname: normalizeHostname(hostnameFromUrl(record.url)),
    title: record.title,
    html: record.html,
    pageTokens: record.pageTokens,
    cachedAt: record.cachedAt,
  }
}

async function loadStoreFromIndexedDb(): Promise<PageCacheStore> {
  const records = await getAllSafariPageCacheRecords()
  const pages: Record<string, CachedPageRecord> = {}
  for (const record of records) {
    pages[record.url] = {
      url: record.url,
      title: record.title,
      html: record.html,
      pageTokens: record.pageTokens,
      cachedAt: record.cachedAt,
    }
  }
  return canonicalizePageCacheStore({ pages })
}

async function hydratePageCacheStore(): Promise<void> {
  memoryStore = await loadStoreFromIndexedDb()
  reportedCacheBytes = await getSafariPageCacheBytes()
  ready = true
}

export function initBrowserPageCache(): Promise<void> {
  if (ready) {
    return Promise.resolve()
  }
  if (!readyPromise) {
    readyPromise = hydratePageCacheStore().catch((error) => {
      readyPromise = undefined
      throw error
    })
  }
  return readyPromise
}

function ensureReadyForSyncRead(): void {
  if (!ready && !readyPromise) {
    void initBrowserPageCache()
  }
}

async function persistPage(record: CachedPageRecord): Promise<boolean> {
  const ok = await putSafariPageCacheRecord(recordFromStoreEntry(record))
  if (ok) {
    reportedCacheBytes = await getSafariPageCacheBytes()
  } else {
    delete memoryStore.pages[record.url]
  }
  return ok
}

export function getCachedPage(url: string): CachedPageRecord | undefined {
  if (isStartPageUrl(url)) {
    return undefined
  }
  ensureReadyForSyncRead()
  return memoryStore.pages[cacheKey(url)]
}

export function saveCachedPage(
  record: Omit<CachedPageRecord, 'cachedAt'> & { cachedAt?: number },
): boolean {
  if (isStartPageUrl(record.url)) {
    return true
  }

  ensureReadyForSyncRead()
  const key = cacheKey(record.url)
  const nextRecord: CachedPageRecord = {
    url: key,
    title: record.title,
    html: record.html,
    pageTokens: record.pageTokens,
    cachedAt: record.cachedAt ?? osNowMs(),
  }
  memoryStore.pages[key] = nextRecord
  void persistPage(nextRecord)
  return true
}

export function removeCachedPage(url: string): boolean {
  ensureReadyForSyncRead()
  delete memoryStore.pages[cacheKey(url)]
  void deleteSafariPageCacheRecord(cacheKey(url)).then(() =>
    getSafariPageCacheBytes().then((bytes) => {
      reportedCacheBytes = bytes
    }),
  )
  return true
}

export function getBrowserPageCacheStorageBytes(): number {
  ensureReadyForSyncRead()
  return reportedCacheBytes
}

export function getCachedPageCount(): number {
  ensureReadyForSyncRead()
  return Object.keys(memoryStore.pages).length
}

export function getSiteCacheSummaries(): SiteCacheSummary[] {
  ensureReadyForSyncRead()
  const byHost = new Map<string, SiteCacheSummary>()

  for (const record of Object.values(memoryStore.pages)) {
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
  memoryStore = emptyStore()
  reportedCacheBytes = 0
  void clearAllSafariPageCache()
}

export function clearSitePageCache(hostname: string): void {
  const normalizedHost = normalizeHostname(hostname)
  const nextPages: Record<string, CachedPageRecord> = {}

  for (const [key, record] of Object.entries(memoryStore.pages)) {
    if (hostnameFromUrl(record.url) !== normalizedHost) {
      nextPages[key] = record
    }
  }

  memoryStore = { pages: nextPages }
  void clearSafariPageCacheByHostname(hostname).then(() =>
    getSafariPageCacheBytes().then((bytes) => {
      reportedCacheBytes = bytes
    }),
  )
}
