import { estimateTokensFromText } from '../apps/browser/estimate-token-usage.ts'
import type { TokenUsageSnapshot } from '../apps/browser/browser-token-usage.ts'
import { osDayKey, osNowMs } from '../os/os-clock.ts'
import { resolveEventLogPerformance } from './ai-event-log-timing.ts'
import { resolveActorLabel, type AiUsageContext } from './ai-usage-context.ts'
import type {
  AiEventLogInput,
  AiEventLogMessage,
  AiEventLogRecord,
  AiEventLogStatus,
} from './ai-event-log-types.ts'
import { ensureTokenCharsRatioHydrated } from './token-chars-ratio.ts'

export const AI_EVENT_LOG_CHANGED_EVENT = 'instant-os:ai-event-log-changed'

const LIVE_UPDATE_MIN_INTERVAL_MS = 200

type LiveSessionState = {
  record: AiEventLogRecord
  context: AiUsageContext
  timingStartedAt: number
  timingStartedRealAt: number
  firstTokenAt: number | undefined
  firstTokenRealAt: number | undefined
  lastDispatchAt: number
  pendingDispatch: ReturnType<typeof setTimeout> | undefined
}

const liveSessions = new Map<string, LiveSessionState>()

function dispatchEventLogChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AI_EVENT_LOG_CHANGED_EVENT))
  }
}

function createEventId(at: number): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `evt:${crypto.randomUUID()}`
  }
  return `evt:${at}-${Math.random().toString(36).slice(2, 10)}`
}

function scheduleDispatch(state: LiveSessionState, force = false): void {
  const now = Date.now()
  if (force || now - state.lastDispatchAt >= LIVE_UPDATE_MIN_INTERVAL_MS) {
    if (state.pendingDispatch) {
      clearTimeout(state.pendingDispatch)
      state.pendingDispatch = undefined
    }
    state.lastDispatchAt = now
    dispatchEventLogChanged()
    return
  }

  if (state.pendingDispatch) {
    return
  }

  const delay = LIVE_UPDATE_MIN_INTERVAL_MS - (now - state.lastDispatchAt)
  state.pendingDispatch = setTimeout(() => {
    state.pendingDispatch = undefined
    state.lastDispatchAt = Date.now()
    dispatchEventLogChanged()
  }, Math.max(0, delay))
}

function estimateCompletionUsage(
  response: string,
  promptTokens: number | undefined,
  model: string | undefined,
): TokenUsageSnapshot | undefined {
  const completionTokens = response.trim() ? estimateTokensFromText(response, model) : 0
  if (completionTokens <= 0 && (promptTokens === undefined || promptTokens <= 0)) {
    return undefined
  }
  const safePrompt = promptTokens ?? 0
  return {
    promptTokens: safePrompt,
    completionTokens,
    totalTokens: safePrompt + completionTokens,
  }
}

function applyLivePerformance(state: LiveSessionState): void {
  const performance = resolveEventLogPerformance(
    {
      startedAt: state.timingStartedAt,
      startedRealAt: state.timingStartedRealAt,
      firstTokenAt: state.firstTokenAt,
      firstTokenRealAt: state.firstTokenRealAt,
    },
    state.record.promptTokens !== undefined || state.record.completionTokens !== undefined
      ? {
          promptTokens: state.record.promptTokens ?? 0,
          completionTokens: state.record.completionTokens ?? 0,
          totalTokens:
            state.record.totalTokens ??
            (state.record.promptTokens ?? 0) + (state.record.completionTokens ?? 0),
        }
      : undefined,
    state.record.response,
  )

  state.record.startedAt = performance.startedAt
  state.record.startedRealAt = performance.startedRealAt
  state.record.firstTokenAt = performance.firstTokenAt
  state.record.firstTokenRealAt = performance.firstTokenRealAt
  state.record.durationMs = performance.durationMs
  state.record.timeToFirstTokenMs = performance.timeToFirstTokenMs
  state.record.completionTokensPerSecond = performance.completionTokensPerSecond
  state.record.responseCharCount = performance.responseCharCount
  state.record.responseCharsPerSecond = performance.responseCharsPerSecond
  state.record.at = osNowMs()
  state.record.realAt = Date.now()
}

export type AiEventLogSessionHandle = {
  readonly id: string
  markFirstToken: () => void
  update: (patch: {
    response?: string
    usage?: TokenUsageSnapshot
    /** 未提供 usage 时是否用响应正文估算 token（默认 true） */
    estimateUsage?: boolean
  }) => void
  finish: (input: {
    response: string
    usage?: TokenUsageSnapshot
    usageEstimated?: boolean
    status?: Exclude<AiEventLogStatus, 'running'>
    errorMessage?: string
  }) => AiEventLogInput | undefined
  /** 会话仍存活时快照当前记录（用于外部调试）。 */
  snapshot: () => AiEventLogRecord | undefined
}

/** 开始一条可实时更新的事件日志会话（内存层；结束时再落盘）。 */
export function startAiEventLogSession(
  context: AiUsageContext,
  input: {
    model?: string
    thinkingEnabled?: boolean
    messages: AiEventLogMessage[]
  },
): AiEventLogSessionHandle {
  const startedAt = osNowMs()
  const startedRealAt = Date.now()
  const id = createEventId(startedAt)
  const record: AiEventLogRecord = {
    id,
    day: osDayKey(),
    at: startedAt,
    realAt: startedRealAt,
    actor: context.actor,
    behavior: context.behavior,
    actorLabel: context.actorLabel ?? resolveActorLabel(context.actor),
    behaviorLabel: context.behaviorLabel ?? context.behavior,
    model: input.model,
    thinkingEnabled: input.thinkingEnabled,
    messages: input.messages,
    response: '',
    promptTokens: undefined,
    completionTokens: undefined,
    totalTokens: undefined,
    usageEstimated: undefined,
    status: 'running',
    errorMessage: undefined,
    startedAt,
    startedRealAt,
    firstTokenAt: undefined,
    firstTokenRealAt: undefined,
    durationMs: 0,
    timeToFirstTokenMs: undefined,
    completionTokensPerSecond: undefined,
    responseCharCount: undefined,
    responseCharsPerSecond: undefined,
  }

  const state: LiveSessionState = {
    record,
    context,
    timingStartedAt: startedAt,
    timingStartedRealAt: startedRealAt,
    firstTokenAt: undefined,
    firstTokenRealAt: undefined,
    lastDispatchAt: 0,
    pendingDispatch: undefined,
  }
  liveSessions.set(id, state)
  scheduleDispatch(state, true)
  void ensureTokenCharsRatioHydrated()

  return {
    id,
    markFirstToken() {
      const current = liveSessions.get(id)
      if (!current || current.firstTokenRealAt !== undefined) {
        return
      }
      current.firstTokenAt = osNowMs()
      current.firstTokenRealAt = Date.now()
      applyLivePerformance(current)
      scheduleDispatch(current, true)
    },
    update(patch) {
      const current = liveSessions.get(id)
      if (!current || current.record.status !== 'running') {
        return
      }

      if (patch.response !== undefined) {
        current.record.response = patch.response
      }

      if (patch.usage) {
        current.record.promptTokens = patch.usage.promptTokens
        current.record.completionTokens = patch.usage.completionTokens
        current.record.totalTokens = patch.usage.totalTokens
        current.record.usageEstimated = false
      } else if (patch.estimateUsage !== false) {
        const estimated = estimateCompletionUsage(
          current.record.response,
          current.record.promptTokens,
          current.record.model,
        )
        if (estimated) {
          current.record.completionTokens = estimated.completionTokens
          current.record.totalTokens = estimated.totalTokens
          if (current.record.promptTokens === undefined) {
            current.record.promptTokens = estimated.promptTokens
          }
          current.record.usageEstimated = true
        }
      }

      applyLivePerformance(current)
      scheduleDispatch(current)
    },
    finish(input) {
      const current = liveSessions.get(id)
      if (!current) {
        return undefined
      }

      if (current.pendingDispatch) {
        clearTimeout(current.pendingDispatch)
        current.pendingDispatch = undefined
      }

      liveSessions.delete(id)

      const timing = {
        startedAt: current.timingStartedAt,
        startedRealAt: current.timingStartedRealAt,
        firstTokenAt: current.firstTokenAt,
        firstTokenRealAt: current.firstTokenRealAt,
      }

      const finishInput: AiEventLogInput = {
        id,
        model: current.record.model,
        thinkingEnabled: current.record.thinkingEnabled,
        messages: current.record.messages,
        response: input.response,
        usage: input.usage,
        usageEstimated: input.usageEstimated,
        status: input.status ?? 'success',
        errorMessage: input.errorMessage,
        timing,
      }

      dispatchEventLogChanged()
      return finishInput
    },
    snapshot() {
      const current = liveSessions.get(id)
      if (!current) {
        return undefined
      }
      applyLivePerformance(current)
      return { ...current.record }
    },
  }
}

/**
 * 刷新所有进行中会话的耗时/速度字段（供性能监视器定时 tick）。
 * 只更新内存态，不派发变更事件，避免监听方再次调用时同步递归。
 */
export function refreshLiveAiEventLogPerformance(): boolean {
  if (liveSessions.size === 0) {
    return false
  }
  for (const state of liveSessions.values()) {
    applyLivePerformance(state)
  }
  return true
}

export function listLiveAiEventLogs(): AiEventLogRecord[] {
  const records: AiEventLogRecord[] = []
  for (const state of liveSessions.values()) {
    applyLivePerformance(state)
    records.push({ ...state.record })
  }
  return records.sort((left, right) => right.at - left.at)
}

export function getLiveAiEventLogCount(): number {
  return liveSessions.size
}

export function mergeLiveAndPersistedEventLogs(
  persisted: AiEventLogRecord[],
  limit: number,
): AiEventLogRecord[] {
  const live = listLiveAiEventLogs()
  if (live.length === 0) {
    return persisted.slice(0, limit)
  }

  const liveIds = new Set(live.map((record) => record.id))
  const merged = [...live, ...persisted.filter((record) => !liveIds.has(record.id))]
  merged.sort((left, right) => right.at - left.at)
  return merged.slice(0, limit)
}
