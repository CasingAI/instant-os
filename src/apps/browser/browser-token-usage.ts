import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'
import { hostnameFromUrl } from './normalize-browser-url.ts'

export type TokenUsageSnapshot = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export type DomainTokenUsage = {
  hostname: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  pageCount: number
}

export type BrowserTokenUsageRecord = {
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  pageCount: number
  byDomain: Record<string, DomainTokenUsage>
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.safariTokenUsage

const EMPTY_RECORD: BrowserTokenUsageRecord = {
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
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
    return {
      totalPromptTokens: parsed.totalPromptTokens ?? 0,
      totalCompletionTokens: parsed.totalCompletionTokens ?? 0,
      totalTokens: parsed.totalTokens ?? 0,
      pageCount: parsed.pageCount ?? 0,
      byDomain: parsed.byDomain ?? {},
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

  record.totalPromptTokens += usage.promptTokens
  record.totalCompletionTokens += usage.completionTokens
  record.totalTokens += usage.totalTokens
  record.pageCount += 1

  const existing = record.byDomain[hostname] ?? {
    hostname,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    pageCount: 0,
  }

  record.byDomain[hostname] = {
    hostname,
    promptTokens: existing.promptTokens + usage.promptTokens,
    completionTokens: existing.completionTokens + usage.completionTokens,
    totalTokens: existing.totalTokens + usage.totalTokens,
    pageCount: existing.pageCount + 1,
  }

  saveBrowserTokenUsage(record)
  return record
}

export function getDomainUsageList(record: BrowserTokenUsageRecord): DomainTokenUsage[] {
  return Object.values(record.byDomain).sort((a, b) => b.totalTokens - a.totalTokens)
}
