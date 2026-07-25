import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../os/device-storage.ts'
import type { ModelPricingEntry } from './ai-model-pricing-cache.ts'

/** OpenRouter 单条绑定定价：模型 slug + Provider 通道 */
export type OpenRouterPricingEntry = ModelPricingEntry & {
  modelId: string
  providerTag: string
  modelName?: string
  providerName?: string
}

export type OpenRouterPricingCache = {
  version: 1
  lastFetch: number
  /** key = `${modelId}::${providerTag}` */
  prices: Record<string, OpenRouterPricingEntry>
}

export const OPENROUTER_PRICING_CHANGED_EVENT = 'instant-os:openrouter-pricing-changed'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.openRouterPricingCache

const DEFAULT_CACHE: OpenRouterPricingCache = {
  version: 1,
  lastFetch: 0,
  prices: {},
}

export function openRouterPricingCacheKey(modelId: string, providerTag: string): string {
  return `${modelId}::${providerTag}`
}

function normalizeEntry(raw: unknown): OpenRouterPricingEntry | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  const input = record.inputPricePerMillion
  const output = record.outputPricePerMillion
  const modelId = typeof record.modelId === 'string' ? record.modelId.trim() : ''
  const providerTag =
    typeof record.providerTag === 'string' ? record.providerTag.trim() : ''
  if (
    !modelId ||
    !providerTag ||
    typeof input !== 'number' ||
    !Number.isFinite(input) ||
    input < 0 ||
    typeof output !== 'number' ||
    !Number.isFinite(output) ||
    output < 0
  ) {
    return undefined
  }
  const modelName =
    typeof record.modelName === 'string' && record.modelName.trim()
      ? record.modelName.trim()
      : undefined
  const providerName =
    typeof record.providerName === 'string' && record.providerName.trim()
      ? record.providerName.trim()
      : undefined
  return {
    modelId,
    providerTag,
    inputPricePerMillion: input,
    outputPricePerMillion: output,
    currency: 'USD',
    ...(modelName ? { modelName } : {}),
    ...(providerName ? { providerName } : {}),
  }
}

function normalizeCache(raw: unknown): OpenRouterPricingCache {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_CACHE, prices: {} }
  }
  const record = raw as Record<string, unknown>
  const lastFetch =
    typeof record.lastFetch === 'number' && record.lastFetch > 0 ? record.lastFetch : 0
  const prices: Record<string, OpenRouterPricingEntry> = {}
  if (record.prices && typeof record.prices === 'object') {
    for (const [key, value] of Object.entries(
      record.prices as Record<string, unknown>,
    )) {
      const entry = normalizeEntry(value)
      if (entry) {
        prices[key] = entry
      }
    }
  }
  return { version: 1, lastFetch, prices }
}

export function loadOpenRouterPricingCache(): OpenRouterPricingCache {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return { ...DEFAULT_CACHE, prices: {} }
    }
    return normalizeCache(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_CACHE, prices: {} }
  }
}

export function saveOpenRouterPricingCache(cache: OpenRouterPricingCache): boolean {
  const payload = normalizeCache(cache)
  if (!writeLocalStorageItem(STORAGE_KEY, JSON.stringify(payload))) {
    return false
  }
  window.dispatchEvent(new CustomEvent(OPENROUTER_PRICING_CHANGED_EVENT))
  return true
}

/** 合并写入若干条目，保留未触及的旧绑定价 */
export function mergeOpenRouterPricingEntries(
  entries: readonly OpenRouterPricingEntry[],
  lastFetch = Date.now(),
): boolean {
  const cache = loadOpenRouterPricingCache()
  const prices = { ...cache.prices }
  for (const entry of entries) {
    prices[openRouterPricingCacheKey(entry.modelId, entry.providerTag)] = entry
  }
  return saveOpenRouterPricingCache({
    version: 1,
    lastFetch,
    prices,
  })
}

export function getOpenRouterPricing(
  modelId: string,
  providerTag: string,
): OpenRouterPricingEntry | undefined {
  return loadOpenRouterPricingCache().prices[
    openRouterPricingCacheKey(modelId, providerTag)
  ]
}

export function subscribeOpenRouterPricingCache(listener: () => void): () => void {
  window.addEventListener(OPENROUTER_PRICING_CHANGED_EVENT, listener)
  return () => window.removeEventListener(OPENROUTER_PRICING_CHANGED_EVENT, listener)
}
