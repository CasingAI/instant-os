import type {
  AiTokenUsageRecord,
  AiUsageRequestRecord,
  ModelTokenUsage,
} from './ai-token-usage-types.ts'
import { UNKNOWN_AI_USAGE_MODEL } from './ai-token-usage-types.ts'

function usageModelKey(model: string | undefined): string {
  const trimmed = model?.trim()
  return trimmed ? trimmed : UNKNOWN_AI_USAGE_MODEL
}

/** 有缓存命中时，本次 prompt 计入命中率分母；否则为 0。 */
export function cacheReadPromptTokensFromUsage(
  cachedPromptTokens: number,
  promptTokens: number,
): number {
  if (!(Number.isFinite(cachedPromptTokens) && cachedPromptTokens > 0)) {
    return 0
  }
  return Number.isFinite(promptTokens) && promptTokens > 0 ? promptTokens : 0
}

export function formatCacheHitRate(cachedPromptTokens: number, cacheReadPromptTokens: number): string {
  if (cacheReadPromptTokens <= 0) {
    return '—'
  }
  return `${Math.round((Math.max(0, cachedPromptTokens) / cacheReadPromptTokens) * 100)}%`
}

export function summaryNeedsCacheReadPromptRebuild(
  parsed: { byModel?: Record<string, { cacheReadPromptTokens?: number }> },
): boolean {
  return Object.values(parsed.byModel ?? {}).some(
    (model) => typeof model.cacheReadPromptTokens !== 'number',
  )
}

export function rebuildModelCacheReadPromptTokens(
  summary: AiTokenUsageRecord,
  requests: readonly Pick<
    AiUsageRequestRecord,
    'model' | 'promptTokens' | 'cachedPromptTokens'
  >[],
): AiTokenUsageRecord {
  const totals: Record<string, number> = {}
  for (const request of requests) {
    const added = cacheReadPromptTokensFromUsage(
      request.cachedPromptTokens ?? 0,
      request.promptTokens ?? 0,
    )
    if (added <= 0) {
      continue
    }
    const key = usageModelKey(request.model)
    totals[key] = (totals[key] ?? 0) + added
  }

  const byModel: Record<string, ModelTokenUsage> = {}
  for (const [key, model] of Object.entries(summary.byModel ?? {})) {
    byModel[key] = {
      ...model,
      cacheReadPromptTokens: totals[key] ?? 0,
    }
  }
  return { ...summary, byModel }
}
