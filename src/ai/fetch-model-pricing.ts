import { PriceTokenClient, type ModelPricing } from 'pricetoken'
import { patchBackgroundRefreshTaskState } from '../os/background-refresh-settings-storage.ts'
import {
  AI_PROVIDER_PRESETS,
  isKnownModel,
  normalizeStoredModel,
  type AiProviderId,
} from './ai-providers.ts'
import {
  pricingCacheKey,
  saveModelPricingCache,
  type ModelPricingCache,
  type ModelPricingEntry,
} from './ai-model-pricing-cache.ts'

export type PricingRefreshOutcome = {
  ok: boolean
  /** 成功写入的定价条目数 */
  updatedCount: number
  message: string
}

/** 定价数据源（pricetoken SDK 的默认 baseUrl），仅用于设置页展示 */
export const DEFAULT_PRICING_API_URL = 'https://pricetoken.ai'

/** 该任务在背景刷新设置中的存储字段，失败时统一写入 */
const TASK_STATE_PATCH_FAILURE = { lastResult: 'failure' as const }

/**
 * 定价数据源：pricetoken.ai 官方 SDK。
 * SDK 内部使用原生 fetch 访问 https://pricetoken.ai（该 API 面向浏览器开放），
 * 默认货币 USD；免费额度 30 次/小时，远高于本系统最小刷新间隔（1 小时）。
 * 注意：SDK 不支持注入 proxiedFetch，因此不经系统代理服务器转发。
 */
const client = new PriceTokenClient()

/** SDK provider 字符串 → 本系统 providerId；不认识返回 undefined */
function normalizeSdkProvider(provider: string): AiProviderId | undefined {
  const normalized = provider.trim().toLowerCase()
  if (normalized === 'openai') return 'openai'
  if (normalized === 'deepseek') return 'deepseek'
  if (normalized === 'mimo' || normalized === 'xiaomi') return 'mimo'
  return undefined
}

/** 预设模型 id → providerId 索引（用于无 provider 对应时的全局兜底匹配） */
function buildPresetIndex(): Map<string, AiProviderId> {
  const index = new Map<string, AiProviderId>()
  for (const preset of AI_PROVIDER_PRESETS) {
    if (preset.id === 'custom') continue
    for (const model of preset.models) {
      index.set(model.id, preset.id)
    }
  }
  return index
}

/**
 * 把 SDK 返回的定价映射到本系统的 `${providerId}:${modelId}` 缓存键。
 * - provider 一致时先经 normalizeStoredModel 做旧名规范化
 *   （如 deepseek-chat → deepseek-v4-flash），再匹配预设；
 * - 否则按 modelId 在全部预设中兜底匹配（如 gpt-4o → openai）。
 * 仅保留已知预设模型，其余供应商（anthropic、google 等）丢弃。
 */
export function mapSdkPricingToTable(
  models: readonly ModelPricing[],
): Record<string, ModelPricingEntry> {
  const presetIndex = buildPresetIndex()
  const prices: Record<string, ModelPricingEntry> = {}

  for (const model of models) {
    const entry: ModelPricingEntry = {
      inputPricePerMillion: model.inputPerMTok,
      outputPricePerMillion: model.outputPerMTok,
      currency: 'USD',
    }

    const providerId = normalizeSdkProvider(model.provider)
    if (providerId) {
      const normalized = normalizeStoredModel(providerId, model.modelId)
      if (isKnownModel(providerId, normalized)) {
        prices[pricingCacheKey(providerId, normalized)] = entry
        continue
      }
    }

    const fallbackProvider = presetIndex.get(model.modelId)
    if (fallbackProvider) {
      prices[pricingCacheKey(fallbackProvider, model.modelId)] = entry
    }
  }
  return prices
}

/**
 * 拉取一次远端定价并写入缓存。
 * lastSuccessAt 只在成功时更新；失败仅记录结果标记。
 */
export async function refreshModelPricing(): Promise<PricingRefreshOutcome> {
  try {
    const models = await client.getPricing()
    const prices = mapSdkPricingToTable(models)
    const updatedCount = Object.keys(prices).length
    if (updatedCount === 0) {
      patchBackgroundRefreshTaskState('model-pricing', TASK_STATE_PATCH_FAILURE)
      return {
        ok: false,
        updatedCount: 0,
        message: '远端响应中没有匹配到本系统的模型定价',
      }
    }

    const cache: ModelPricingCache = {
      version: 1,
      lastFetch: Date.now(),
      prices,
    }
    if (!saveModelPricingCache(cache)) {
      patchBackgroundRefreshTaskState('model-pricing', TASK_STATE_PATCH_FAILURE)
      return {
        ok: false,
        updatedCount: 0,
        message: '写入本地缓存失败（存储空间可能已满）',
      }
    }

    patchBackgroundRefreshTaskState('model-pricing', {
      lastSuccessAt: cache.lastFetch,
      lastResult: 'success',
    })
    return {
      ok: true,
      updatedCount,
      message: `已更新 ${updatedCount} 个模型的定价`,
    }
  } catch (error) {
    patchBackgroundRefreshTaskState('model-pricing', TASK_STATE_PATCH_FAILURE)
    const reason = error instanceof Error ? error.message : '未知错误'
    return { ok: false, updatedCount: 0, message: `刷新失败：${reason}` }
  }
}
