export type BehaviorTokenUsage = {
  behavior: string
  label: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  requestCount: number
}

export type ActorTokenUsage = {
  actor: string
  label: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  requestCount: number
  byBehavior: Record<string, BehaviorTokenUsage>
}

export type DayTokenUsage = {
  day: string
  promptTokens: number
  completionTokens: number
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
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export type AiTokenUsageRecord = {
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  requestCount: number
  byActor: Record<string, ActorTokenUsage>
  byDay: Record<string, DayTokenUsage>
}
