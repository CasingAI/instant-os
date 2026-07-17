import type { AiEventLogRecord } from '../../ai/ai-event-log-types.ts'

export type AiPerformanceSample = {
  id: string
  at: number
  actorLabel: string
  behaviorLabel: string
  model: string | undefined
  completionTokens: number
  durationMs: number
  timeToFirstTokenMs: number | undefined
  tokensPerSecond: number
  charsPerSecond: number | undefined
  live: boolean
  usageEstimated: boolean
}

export type ActorSpeedSummary = {
  actorLabel: string
  sampleCount: number
  averageTokensPerSecond: number
  averageDurationMs: number
  liveCount: number
}

export type AiPerformanceAnalysis = {
  totalRecords: number
  sampleCount: number
  liveCount: number
  samples: AiPerformanceSample[]
  averageTokensPerSecond: number | undefined
  medianTokensPerSecond: number | undefined
  maxTokensPerSecond: number | undefined
  averageTtftMs: number | undefined
  averageDurationMs: number | undefined
  byActor: ActorSpeedSummary[]
}

function average(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function median(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined
  }
  const sorted = [...values].sort((left, right) => left - right)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2
  }
  return sorted[mid]
}

export function analyzeAiEventPerformance(records: AiEventLogRecord[]): AiPerformanceAnalysis {
  const samples: AiPerformanceSample[] = []

  for (const record of records) {
    if (record.status !== 'success' && record.status !== 'running') {
      continue
    }
    const tokensPerSecond = record.completionTokensPerSecond
    const durationMs = record.durationMs
    const completionTokens = record.completionTokens
    if (
      tokensPerSecond === undefined ||
      durationMs === undefined ||
      completionTokens === undefined ||
      completionTokens <= 0 ||
      tokensPerSecond <= 0
    ) {
      continue
    }

    samples.push({
      id: record.id,
      at: record.at,
      actorLabel: record.actorLabel || record.actor,
      behaviorLabel: record.behaviorLabel || record.behavior,
      model: record.model,
      completionTokens,
      durationMs,
      timeToFirstTokenMs: record.timeToFirstTokenMs,
      tokensPerSecond,
      charsPerSecond: record.responseCharsPerSecond,
      live: record.status === 'running',
      usageEstimated: record.usageEstimated === true,
    })
  }

  samples.sort((left, right) => left.at - right.at)

  const speeds = samples.map((sample) => sample.tokensPerSecond)
  const durations = samples.map((sample) => sample.durationMs)
  const ttfts = samples
    .map((sample) => sample.timeToFirstTokenMs)
    .filter((value): value is number => value !== undefined)
  const liveCount = samples.filter((sample) => sample.live).length

  const actorMap = new Map<
    string,
    { speeds: number[]; durations: number[]; liveCount: number }
  >()
  for (const sample of samples) {
    const existing = actorMap.get(sample.actorLabel) ?? {
      speeds: [],
      durations: [],
      liveCount: 0,
    }
    existing.speeds.push(sample.tokensPerSecond)
    existing.durations.push(sample.durationMs)
    if (sample.live) {
      existing.liveCount += 1
    }
    actorMap.set(sample.actorLabel, existing)
  }

  const byActor = [...actorMap.entries()]
    .map(([actorLabel, stats]) => ({
      actorLabel,
      sampleCount: stats.speeds.length,
      averageTokensPerSecond: average(stats.speeds) ?? 0,
      averageDurationMs: average(stats.durations) ?? 0,
      liveCount: stats.liveCount,
    }))
    .sort((left, right) => right.averageTokensPerSecond - left.averageTokensPerSecond)

  return {
    totalRecords: records.length,
    sampleCount: samples.length,
    liveCount,
    samples,
    averageTokensPerSecond: average(speeds),
    medianTokensPerSecond: median(speeds),
    maxTokensPerSecond: speeds.length > 0 ? Math.max(...speeds) : undefined,
    averageTtftMs: average(ttfts),
    averageDurationMs: average(durations),
    byActor,
  }
}
