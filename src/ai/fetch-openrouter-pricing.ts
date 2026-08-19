import { loadAccountSettings } from '../os/account-settings-storage.ts'
import { patchBackgroundRefreshTaskState } from '../os/background-refresh-settings-storage.ts'
import {
  isProxyServerConnected,
  proxiedFetch,
} from '../os/proxy-server-api.ts'
import {
  dismissOsNotification,
  postOsNotification,
} from '../os/os-notifications.ts'
import type { PricingRefreshOutcome } from './fetch-model-pricing.ts'
import {
  getOpenRouterPricing,
  mergeOpenRouterPricingEntries,
  type OpenRouterPricingEntry,
} from './openrouter-pricing-cache.ts'

const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1'
/** 两次 OpenRouter 请求之间的间隔 */
export const OPENROUTER_PRICING_REQUEST_GAP_MS = 30_000

function taskStatePatchFailure(): { lastResult: 'failure'; lastAttemptAt: number } {
  return { lastResult: 'failure', lastAttemptAt: Date.now() }
}

export type OpenRouterModelSearchHit = {
  id: string
  name: string
  promptPerMillion: number
  completionPerMillion: number
  contextLength?: number
}

export type OpenRouterEndpointHit = {
  providerTag: string
  providerName: string
  promptPerMillion: number
  completionPerMillion: number
  contextLength?: number
}

function perTokenToPerMillion(raw: unknown): number {
  const value = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN
  if (!Number.isFinite(value) || value < 0) return 0
  return value * 1_000_000
}

function parseContextLength(raw: unknown): number | undefined {
  const value = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN
  if (!Number.isFinite(value)) return undefined
  const tokens = Math.floor(value)
  return tokens >= 1 ? tokens : undefined
}

async function openRouterFetch(url: string): Promise<Response> {
  try {
    return await fetch(url)
  } catch {
    if (!isProxyServerConnected()) {
      throw new Error('无法直连 OpenRouter，请先在「系统设置 → 云服务」中配置并连接后重试')
    }
    return proxiedFetch(url)
  }
}

function splitModelId(modelId: string): { author: string; slug: string } | undefined {
  const trimmed = modelId.trim()
  const slash = trimmed.indexOf('/')
  if (slash <= 0 || slash >= trimmed.length - 1) return undefined
  return {
    author: trimmed.slice(0, slash),
    slug: trimmed.slice(slash + 1),
  }
}

export function collectOpenRouterBindings(): Array<{
  modelId: string
  providerTag: string
}> {
  const settings = loadAccountSettings()
  if (!settings) return []
  const seen = new Set<string>()
  const bindings: Array<{ modelId: string; providerTag: string }> = []
  for (const provider of settings.providers) {
    for (const model of provider.enabledModels) {
      const binding = model.openRouterPricing
      if (!binding) continue
      const key = `${binding.modelId}::${binding.providerTag}`
      if (seen.has(key)) continue
      seen.add(key)
      bindings.push({
        modelId: binding.modelId,
        providerTag: binding.providerTag,
      })
    }
  }
  return bindings
}

export async function searchOpenRouterModels(
  query: string,
): Promise<OpenRouterModelSearchHit[]> {
  const trimmed = query.trim()
  if (!trimmed) return []
  const url = `${OPENROUTER_API_BASE}/models?q=${encodeURIComponent(trimmed)}`
  const response = await openRouterFetch(url)
  if (!response.ok) {
    throw new Error(`OpenRouter 搜索失败（HTTP ${response.status}）`)
  }
  const json = (await response.json()) as { data?: unknown }
  if (!Array.isArray(json.data)) return []
  const hits: OpenRouterModelSearchHit[] = []
  for (const item of json.data) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    if (!id) continue
    const name =
      typeof record.name === 'string' && record.name.trim() ? record.name.trim() : id
    const pricing =
      record.pricing && typeof record.pricing === 'object'
        ? (record.pricing as Record<string, unknown>)
        : undefined
    const contextLength = parseContextLength(record.context_length)
    hits.push({
      id,
      name,
      promptPerMillion: perTokenToPerMillion(pricing?.prompt),
      completionPerMillion: perTokenToPerMillion(pricing?.completion),
      ...(contextLength !== undefined ? { contextLength } : {}),
    })
  }
  return hits
}

export async function fetchOpenRouterEndpoints(
  modelId: string,
): Promise<OpenRouterEndpointHit[]> {
  const parts = splitModelId(modelId)
  if (!parts) {
    throw new Error('OpenRouter 模型 id 须为 author/slug 形式')
  }
  const url = `${OPENROUTER_API_BASE}/models/${encodeURIComponent(parts.author)}/${encodeURIComponent(parts.slug)}/endpoints`
  const response = await openRouterFetch(url)
  if (!response.ok) {
    throw new Error(`获取 Provider 列表失败（HTTP ${response.status}）`)
  }
  const json = (await response.json()) as { data?: unknown }
  const data =
    json.data && typeof json.data === 'object'
      ? (json.data as Record<string, unknown>)
      : (json as Record<string, unknown>)
  const endpoints = Array.isArray(data.endpoints) ? data.endpoints : []
  const modelContextLength = parseContextLength(data.context_length)
  const hits: OpenRouterEndpointHit[] = []
  for (const item of endpoints) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const providerTag =
      typeof record.tag === 'string' && record.tag.trim()
        ? record.tag.trim()
        : typeof record.provider_name === 'string'
          ? record.provider_name.trim()
          : ''
    if (!providerTag) continue
    const providerName =
      typeof record.provider_name === 'string' && record.provider_name.trim()
        ? record.provider_name.trim()
        : providerTag
    const pricing =
      record.pricing && typeof record.pricing === 'object'
        ? (record.pricing as Record<string, unknown>)
        : undefined
    const contextLength =
      parseContextLength(record.context_length) ?? modelContextLength
    hits.push({
      providerTag,
      providerName,
      promptPerMillion: perTokenToPerMillion(pricing?.prompt),
      completionPerMillion: perTokenToPerMillion(pricing?.completion),
      ...(contextLength !== undefined ? { contextLength } : {}),
    })
  }
  return hits
}

/** 拉取单个绑定通道的单价并写入缓存 */
export async function bindOpenRouterPricing(params: {
  modelId: string
  providerTag: string
  modelName?: string
  providerName?: string
}): Promise<OpenRouterPricingEntry> {
  const endpoints = await fetchOpenRouterEndpoints(params.modelId)
  const match =
    endpoints.find((item) => item.providerTag === params.providerTag) ??
    endpoints.find(
      (item) =>
        item.providerName.toLowerCase() === params.providerTag.toLowerCase(),
    )
  if (!match) {
    throw new Error(`未找到 Provider「${params.providerTag}」的定价`)
  }
  const entry: OpenRouterPricingEntry = {
    modelId: params.modelId,
    providerTag: match.providerTag,
    modelName: params.modelName,
    providerName: params.providerName ?? match.providerName,
    inputPricePerMillion: match.promptPerMillion,
    outputPricePerMillion: match.completionPerMillion,
    currency: 'USD',
    ...(match.contextLength !== undefined
      ? { contextLength: match.contextLength }
      : {}),
  }
  if (!mergeOpenRouterPricingEntries([entry])) {
    throw new Error('写入 OpenRouter 定价缓存失败（存储空间可能已满）')
  }
  return entry
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export const OPENROUTER_PRICING_NOTIFICATION_SLUG = 'system:openrouter-pricing'

const OPENROUTER_PRICING_TILE = { kind: 'tile' as const, emoji: '🔄', color: '#34a0a4' }

function openRouterPricingHandlers() {
  return {
    onAction: {
      dismiss: () => dismissOsNotification(OPENROUTER_PRICING_NOTIFICATION_SLUG),
    },
  }
}

function postOpenRouterPricingNotification(input: {
  phase: 'running' | 'success' | 'failure'
  current: number
  total: number
  subtitle: string
  error?: string
}): void {
  const percent = input.total <= 0 ? 0 : Math.round((input.current / input.total) * 100)
  postOsNotification(
    {
      id: OPENROUTER_PRICING_NOTIFICATION_SLUG,
      title: 'OpenRouter 模型定价',
      subtitle: input.subtitle,
      phase: input.phase,
      icon: OPENROUTER_PRICING_TILE,
      ...(input.phase === 'running'
        ? {
            progress: {
              percent,
              statLabel: '已更新',
              statValue: `${input.current}/${input.total}`,
            },
            banner: 'progress' as const,
          }
        : {
            banner: 'once' as const,
            actions: [{ id: 'dismiss', label: '忽略' }],
          }),
      ...(input.error ? { body: input.error } : {}),
    },
    input.phase === 'running' ? undefined : openRouterPricingHandlers(),
  )
}

/**
 * 刷新账户中已绑定的 OpenRouter 定价。
 * 无绑定则零网络成功；有绑定则串行请求，间隔 30 秒，并更新通知中心进度。
 */
export async function refreshBoundOpenRouterPricing(): Promise<PricingRefreshOutcome> {
  const bindings = collectOpenRouterBindings()
  if (bindings.length === 0) {
    dismissOsNotification(OPENROUTER_PRICING_NOTIFICATION_SLUG)
    const now = Date.now()
    patchBackgroundRefreshTaskState('openrouter-model-pricing', {
      lastSuccessAt: now,
      lastAttemptAt: now,
      lastResult: 'success',
    })
    return {
      ok: true,
      updatedCount: 0,
      message: '当前没有绑定 OpenRouter 定价，已跳过',
    }
  }

  postOpenRouterPricingNotification({
    phase: 'running',
    current: 0,
    total: bindings.length,
    subtitle: '正在更新',
  })

  let updatedCount = 0
  const errors: string[] = []

  try {
    for (let index = 0; index < bindings.length; index++) {
      const binding = bindings[index]
      postOpenRouterPricingNotification({
        phase: 'running',
        current: index,
        total: bindings.length,
        subtitle: '正在更新',
      })
      try {
        const previous = getOpenRouterPricing(binding.modelId, binding.providerTag)
        await bindOpenRouterPricing({
          modelId: binding.modelId,
          providerTag: binding.providerTag,
          modelName: previous?.modelName,
          providerName: previous?.providerName,
        })
        updatedCount += 1
      } catch (error) {
        const reason = error instanceof Error ? error.message : '未知错误'
        errors.push(`${binding.modelId}（${binding.providerTag}）：${reason}`)
      }

      postOpenRouterPricingNotification({
        phase: 'running',
        current: index + 1,
        total: bindings.length,
        subtitle: '正在更新',
      })

      if (index < bindings.length - 1) {
        await sleep(OPENROUTER_PRICING_REQUEST_GAP_MS)
      }
    }

    if (updatedCount === 0) {
      const errorText = errors.join('；') || '全部绑定更新失败'
      patchBackgroundRefreshTaskState('openrouter-model-pricing', taskStatePatchFailure())
      postOpenRouterPricingNotification({
        phase: 'failure',
        current: bindings.length,
        total: bindings.length,
        subtitle: '更新失败',
        error: errorText,
      })
      return {
        ok: false,
        updatedCount: 0,
        message: `刷新失败：${errorText}`,
      }
    }

    const now = Date.now()
    patchBackgroundRefreshTaskState('openrouter-model-pricing', {
      lastSuccessAt: now,
      lastAttemptAt: now,
      lastResult: errors.length > 0 ? 'failure' : 'success',
    })
    const message =
      errors.length > 0
        ? `已更新 ${updatedCount}/${bindings.length} 个绑定（部分失败）`
        : `已更新 ${updatedCount} 个 OpenRouter 绑定定价`
    postOpenRouterPricingNotification({
      phase: errors.length > 0 ? 'failure' : 'success',
      current: bindings.length,
      total: bindings.length,
      subtitle: errors.length > 0 ? '更新失败' : '更新完成 · 已就绪',
      ...(errors.length > 0 ? { error: errors.join('；') } : {}),
    })
    return {
      ok: errors.length === 0,
      updatedCount,
      message,
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : '未知错误'
    patchBackgroundRefreshTaskState('openrouter-model-pricing', taskStatePatchFailure())
    postOpenRouterPricingNotification({
      phase: 'failure',
      current: updatedCount,
      total: bindings.length,
      subtitle: '更新失败',
      error: reason,
    })
    return { ok: false, updatedCount, message: `刷新失败：${reason}` }
  }
}
