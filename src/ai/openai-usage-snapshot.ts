import type { TokenUsageSnapshot } from '../apps/browser/browser-token-usage.ts'

export type OpenAiUsageLike = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_tokens_details?: {
    cached_tokens?: number | null
  } | null
  prompt_cache_hit_tokens?: number
  cache_read_input_tokens?: number
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined
}

function readCachedPromptTokens(usage: OpenAiUsageLike, promptTokens: number): number {
  const details = usage.prompt_tokens_details
  const candidates = [
    details && typeof details === 'object' ? details.cached_tokens : undefined,
    usage.prompt_cache_hit_tokens,
    usage.cache_read_input_tokens,
  ]
  for (const candidate of candidates) {
    const value = finiteNonNegative(candidate)
    if (value !== undefined) {
      return Math.min(Math.floor(value), promptTokens)
    }
  }
  return 0
}

export function snapshotFromOpenAiUsage(
  usage: OpenAiUsageLike | null | undefined,
): TokenUsageSnapshot | undefined {
  if (!usage) {
    return undefined
  }

  const promptTokens = usage.prompt_tokens ?? 0
  const completionTokens = usage.completion_tokens ?? 0
  const totalTokens = usage.total_tokens ?? promptTokens + completionTokens
  if (totalTokens <= 0) {
    return undefined
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cachedPromptTokens: readCachedPromptTokens(usage, promptTokens),
  }
}
