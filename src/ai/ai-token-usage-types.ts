export type BehaviorTokenUsage = {
  behavior: string
  label: string
  promptTokens: number
  completionTokens: number
  cachedPromptTokens: number
  totalTokens: number
  requestCount: number
}

export type ActorTokenUsage = {
  actor: string
  label: string
  promptTokens: number
  completionTokens: number
  cachedPromptTokens: number
  totalTokens: number
  requestCount: number
  byBehavior: Record<string, BehaviorTokenUsage>
}

export type DayTokenUsage = {
  day: string
  promptTokens: number
  completionTokens: number
  cachedPromptTokens: number
  totalTokens: number
  requestCount: number
}

export const UNKNOWN_AI_USAGE_MODEL = 'unknown'
export const UNKNOWN_AI_USAGE_MODEL_LABEL = '未知'

export type ModelTokenUsage = {
  model: string
  promptTokens: number
  completionTokens: number
  cachedPromptTokens: number
  /** 读到过缓存的请求的输入 tokens；命中率分母。无缓存请求不计入。 */
  cacheReadPromptTokens: number
  totalTokens: number
  requestCount: number
}

export type AiUsageRequestRecord = {
  id: string
  day: string
  at: number
  actor: string
  behavior: string
  actorLabel: string
  behaviorLabel: string
  model?: string
  promptTokens: number
  completionTokens: number
  cachedPromptTokens: number
  totalTokens: number
}

export type AiTokenUsageRecord = {
  totalPromptTokens: number
  totalCompletionTokens: number
  totalCachedPromptTokens: number
  totalTokens: number
  requestCount: number
  byActor: Record<string, ActorTokenUsage>
  byDay: Record<string, DayTokenUsage>
  byModel: Record<string, ModelTokenUsage>
}
