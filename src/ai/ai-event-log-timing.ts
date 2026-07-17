import { osNowMs } from '../os/os-clock.ts'
import type { TokenUsageSnapshot } from '../apps/browser/browser-token-usage.ts'

/** 写入事件日志时可选的请求计时（由调用方在请求开始时创建）。 */
export type AiEventLogTimingInput = {
  startedAt: number
  startedRealAt: number
  firstTokenAt?: number
  firstTokenRealAt?: number
  endedAt?: number
  endedRealAt?: number
}

/** 持久化到事件记录上的性能字段。 */
export type AiEventLogPerformanceFields = {
  startedAt: number | undefined
  startedRealAt: number | undefined
  firstTokenAt: number | undefined
  firstTokenRealAt: number | undefined
  durationMs: number | undefined
  timeToFirstTokenMs: number | undefined
  completionTokensPerSecond: number | undefined
  responseCharCount: number | undefined
  responseCharsPerSecond: number | undefined
}

export type AiRequestTimingTracker = {
  markFirstToken: () => void
  toInput: () => AiEventLogTimingInput
}

/** 在发起 AI 请求前调用，用于采集整段耗时与首 token 延迟。 */
export function createAiRequestTiming(): AiRequestTimingTracker {
  const startedAt = osNowMs()
  const startedRealAt = Date.now()
  let firstTokenAt: number | undefined
  let firstTokenRealAt: number | undefined

  return {
    markFirstToken() {
      if (firstTokenRealAt !== undefined) {
        return
      }
      firstTokenAt = osNowMs()
      firstTokenRealAt = Date.now()
    },
    toInput() {
      return {
        startedAt,
        startedRealAt,
        firstTokenAt,
        firstTokenRealAt,
      }
    },
  }
}

function roundRate(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * 把原始计时 + token/响应正文整理成可持久化的性能字段。
 * 输出速度优先用「首 token → 结束」区间，避免把排队等待算进生成速度。
 */
export function resolveEventLogPerformance(
  timing: AiEventLogTimingInput | undefined,
  usage: TokenUsageSnapshot | undefined,
  response: string,
): AiEventLogPerformanceFields {
  const endedRealAt = timing?.endedRealAt ?? Date.now()
  const endedAt = timing?.endedAt ?? osNowMs()
  const responseCharCount = response.length

  if (!timing) {
    return {
      startedAt: undefined,
      startedRealAt: undefined,
      firstTokenAt: undefined,
      firstTokenRealAt: undefined,
      durationMs: undefined,
      timeToFirstTokenMs: undefined,
      completionTokensPerSecond: undefined,
      responseCharCount: responseCharCount > 0 ? responseCharCount : undefined,
      responseCharsPerSecond: undefined,
    }
  }

  const durationMs = Math.max(0, endedRealAt - timing.startedRealAt)
  const timeToFirstTokenMs =
    timing.firstTokenRealAt !== undefined
      ? Math.max(0, timing.firstTokenRealAt - timing.startedRealAt)
      : undefined

  const generationStartRealAt = timing.firstTokenRealAt ?? timing.startedRealAt
  const generationMs = Math.max(1, endedRealAt - generationStartRealAt)
  const generationSeconds = generationMs / 1000

  const completionTokens = usage?.completionTokens
  const completionTokensPerSecond =
    completionTokens !== undefined && completionTokens > 0
      ? roundRate(completionTokens / generationSeconds)
      : undefined

  const responseCharsPerSecond =
    responseCharCount > 0 ? roundRate(responseCharCount / generationSeconds) : undefined

  return {
    startedAt: timing.startedAt,
    startedRealAt: timing.startedRealAt,
    firstTokenAt: timing.firstTokenAt,
    firstTokenRealAt: timing.firstTokenRealAt,
    durationMs,
    timeToFirstTokenMs,
    completionTokensPerSecond,
    responseCharCount: responseCharCount > 0 ? responseCharCount : undefined,
    responseCharsPerSecond,
  }
}

export function formatDurationMs(ms: number | undefined): string {
  if (ms === undefined) {
    return '—'
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`
  }
  if (ms < 10_000) {
    return `${(ms / 1000).toFixed(1)} s`
  }
  return `${Math.round(ms / 1000)} s`
}

export function formatTokensPerSecond(rate: number | undefined): string {
  if (rate === undefined) {
    return '—'
  }
  if (rate >= 10_000) {
    return `${Math.round(rate / 1000)}k tok/s`
  }
  if (rate >= 1000) {
    const k = rate / 1000
    return `${k >= 10 || Number.isInteger(k) ? Math.round(k) : k.toFixed(1)}k tok/s`
  }
  if (rate >= 100) {
    return `${Math.round(rate)} tok/s`
  }
  return `${rate.toFixed(1)} tok/s`
}

export function formatCharsPerSecond(rate: number | undefined): string {
  if (rate === undefined) {
    return '—'
  }
  if (rate >= 100) {
    return `${Math.round(rate)} 字/s`
  }
  return `${rate.toFixed(1)} 字/s`
}
