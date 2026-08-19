import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'
import { hostnameFromUrl } from './normalize-browser-url.ts'

export type TokenUsageSnapshot = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** 缓存命中的输入 token；是 promptTokens 的子集。缺省视为 0。 */
  cachedPromptTokens?: number
}

export function cachedPromptTokensOf(
  usage: Pick<TokenUsageSnapshot, 'cachedPromptTokens'> | undefined,
): number {
  const value = usage?.cachedPromptTokens ?? 0
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

export type DomainTokenUsage = {
  hostname: string
  promptTokens: number
  completionTokens: number
  cachedPromptTokens: number
  totalTokens: number
  pageCount: number
}

export type BrowserTokenUsageRecord = {
  totalPromptTokens: number
  totalCompletionTokens: number
  totalCachedPromptTokens: number
  totalTokens: number
  pageCount: number
  byDomain: Record<string, DomainTokenUsage>
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.safariTokenUsage

const EMPTY_RECORD: BrowserTokenUsageRecord = {
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalCachedPromptTokens: 0,
  totalTokens: 0,
  pageCount: 0,
  byDomain: {},
}

export function loadBrowserTokenUsage(): BrowserTokenUsageRecord {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return { ...EMPTY_RECORD, byDomain: {} }
    }
    const parsed = JSON.parse(raw) as BrowserTokenUsageRecord
    const byDomain: Record<string, DomainTokenUsage> = {}
    for (const [hostname, entry] of Object.entries(parsed.byDomain ?? {})) {
      byDomain[hostname] = {
        hostname: entry.hostname ?? hostname,
        promptTokens: entry.promptTokens ?? 0,
        completionTokens: entry.completionTokens ?? 0,
        cachedPromptTokens: entry.cachedPromptTokens ?? 0,
        totalTokens: entry.totalTokens ?? 0,
        pageCount: entry.pageCount ?? 0,
      }
    }
    return {
      totalPromptTokens: parsed.totalPromptTokens ?? 0,
      totalCompletionTokens: parsed.totalCompletionTokens ?? 0,
      totalCachedPromptTokens: parsed.totalCachedPromptTokens ?? 0,
      totalTokens: parsed.totalTokens ?? 0,
      pageCount: parsed.pageCount ?? 0,
      byDomain,
    }
  } catch {
    return { ...EMPTY_RECORD, byDomain: {} }
  }
}

export function saveBrowserTokenUsage(record: BrowserTokenUsageRecord): boolean {
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(record))
}

export function recordBrowserTokenUsage(url: string, usage: TokenUsageSnapshot): BrowserTokenUsageRecord {
  const hostname = hostnameFromUrl(url)
  const record = loadBrowserTokenUsage()

  const cachedPromptTokens = cachedPromptTokensOf(usage)
  record.totalPromptTokens += usage.promptTokens
  record.totalCompletionTokens += usage.completionTokens
  record.totalCachedPromptTokens += cachedPromptTokens
  record.totalTokens += usage.totalTokens
  record.pageCount += 1

  const existing = record.byDomain[hostname] ?? {
    hostname,
    promptTokens: 0,
    completionTokens: 0,
    cachedPromptTokens: 0,
    totalTokens: 0,
    pageCount: 0,
  }

  record.byDomain[hostname] = {
    hostname,
    promptTokens: existing.promptTokens + usage.promptTokens,
    completionTokens: existing.completionTokens + usage.completionTokens,
    cachedPromptTokens: existing.cachedPromptTokens + cachedPromptTokens,
    totalTokens: existing.totalTokens + usage.totalTokens,
    pageCount: existing.pageCount + 1,
  }

  saveBrowserTokenUsage(record)
  return record
}

export function getDomainUsageList(record: BrowserTokenUsageRecord): DomainTokenUsage[] {
  return Object.values(record.byDomain).sort((a, b) => b.totalTokens - a.totalTokens)
}
