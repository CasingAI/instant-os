import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../os/device-storage.ts'

/** 单个模型的定价快照；单位统一为「每百万 token 的货币价格」 */
export type ModelPricingEntry = {
  inputPricePerMillion: number
  outputPricePerMillion: number
  currency: 'USD' | 'CNY'
  /** 上下文窗口（token）；远端未提供时缺省 */
  contextWindow?: number
}

/**
 * 定价缓存：key 为 `${providerId}:${modelId}`。
 * 与预设模型清单解耦——预设决定有哪些模型，缓存只记录最近一次的远端价格。
 */
export type ModelPricingCache = {
  version: 1
  /** 远端数据写入本地的时间戳 */
  lastFetch: number
  prices: Record<string, ModelPricingEntry>
}

export const AI_MODEL_PRICING_CHANGED_EVENT = 'instant-os:ai-model-pricing-changed'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.modelPricingCache

const DEFAULT_CACHE: ModelPricingCache = {
  version: 1,
  lastFetch: 0,
  prices: {},
}

export function pricingCacheKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`
}

function normalizePricingEntry(raw: unknown): ModelPricingEntry | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const record = raw as Record<string, unknown>
  const input = record.inputPricePerMillion
  const output = record.outputPricePerMillion
  if (
    typeof input !== 'number' ||
    !Number.isFinite(input) ||
    input < 0 ||
    typeof output !== 'number' ||
    !Number.isFinite(output) ||
    output < 0
  ) {
    return undefined
  }
  const currency = record.currency === 'CNY' ? 'CNY' : 'USD'
  const contextRaw = record.contextWindow
  const contextWindow =
    typeof contextRaw === 'number' &&
    Number.isFinite(contextRaw) &&
    Math.floor(contextRaw) >= 1
      ? Math.floor(contextRaw)
      : undefined
  return {
    inputPricePerMillion: input,
    outputPricePerMillion: output,
    currency,
    ...(contextWindow !== undefined ? { contextWindow } : {}),
  }
}

function normalizeModelPricingCache(raw: unknown): ModelPricingCache {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_CACHE, prices: {} }
  }
  const record = raw as Record<string, unknown>
  const lastFetch =
    typeof record.lastFetch === 'number' && record.lastFetch > 0 ? record.lastFetch : 0
  const prices: Record<string, ModelPricingEntry> = {}
  if (record.prices && typeof record.prices === 'object') {
    for (const [key, value] of Object.entries(record.prices as Record<string, unknown>)) {
      const entry = normalizePricingEntry(value)
      if (entry) {
        prices[key] = entry
      }
    }
  }
  return { version: 1, lastFetch, prices }
}

export function loadModelPricingCache(): ModelPricingCache {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return { ...DEFAULT_CACHE, prices: {} }
    }
    return normalizeModelPricingCache(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_CACHE, prices: {} }
  }
}

export function saveModelPricingCache(cache: ModelPricingCache): boolean {
  const payload = normalizeModelPricingCache(cache)
  if (!writeLocalStorageItem(STORAGE_KEY, JSON.stringify(payload))) {
    return false
  }
  window.dispatchEvent(new CustomEvent(AI_MODEL_PRICING_CHANGED_EVENT))
  return true
}

export function clearModelPricingCache(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    return
  }
  window.dispatchEvent(new CustomEvent(AI_MODEL_PRICING_CHANGED_EVENT))
}

/** 查询指定模型的缓存定价；无缓存返回 undefined */
export function getModelPricing(
  providerId: string,
  modelId: string,
): ModelPricingEntry | undefined {
  return loadModelPricingCache().prices[pricingCacheKey(providerId, modelId)]
}

export function subscribeModelPricingCache(listener: () => void): () => void {
  window.addEventListener(AI_MODEL_PRICING_CHANGED_EVENT, listener)
  return () => window.removeEventListener(AI_MODEL_PRICING_CHANGED_EVENT, listener)
}

/** 将每百万 token 价格格式化为短文本，如 `$2.50 / 1M` */
export function formatPricePerMillion(entry: ModelPricingEntry | undefined): string {
  if (!entry) return '—'
  const symbol = entry.currency === 'CNY' ? '¥' : '$'
  const format = (value: number) =>
    value >= 100 ? value.toFixed(1) : value >= 1 ? value.toFixed(2) : value.toFixed(3)
  return `${symbol}${format(entry.inputPricePerMillion)} / ${symbol}${format(
    entry.outputPricePerMillion,
  )} / 1M`
}

/** 按输入/输出 token 与单价估算本次请求成本 */
export function estimateRequestCost(
  pricing: ModelPricingEntry,
  promptTokens: number,
  completionTokens: number,
): number {
  const prompt = Math.max(0, promptTokens)
  const completion = Math.max(0, completionTokens)
  return (
    (prompt * pricing.inputPricePerMillion +
      completion * pricing.outputPricePerMillion) /
    1_000_000
  )
}

/** 格式化请求成本，如 `$0.0123` */
export function formatRequestCost(
  amount: number,
  currency: ModelPricingEntry['currency'],
): string {
  const symbol = currency === 'CNY' ? '¥' : '$'
  if (!Number.isFinite(amount) || amount < 0) return '—'
  if (amount === 0) return `${symbol}0`
  if (amount >= 1) return `${symbol}${amount.toFixed(2)}`
  if (amount >= 0.01) return `${symbol}${amount.toFixed(3)}`
  return `${symbol}${amount.toFixed(4)}`
}
