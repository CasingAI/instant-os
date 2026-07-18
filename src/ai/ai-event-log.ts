import {
  clearAiEventLogStore,
  deleteAiEventLogById,
  loadAiEventLogsForDay,
  loadRecentAiEventLogs,
  persistAiEventLog,
} from './ai-event-log-storage.ts'
import {
  AI_EVENT_LOG_CHANGED_EVENT,
  getLiveAiEventLogCount,
  listLiveAiEventLogs,
  mergeLiveAndPersistedEventLogs,
  refreshLiveAiEventLogPerformance,
  startAiEventLogSession,
  type AiEventLogSessionHandle,
} from './ai-event-log-session.ts'
import type { AiEventLogInput, AiEventLogRecord } from './ai-event-log-types.ts'
import type { AiUsageContext } from './ai-usage-context.ts'
import {
  observeTokenCharsRatioFromEventLog,
  resetTokenCharsRatios,
} from './token-chars-ratio.ts'

export type {
  AiEventLogInput,
  AiEventLogMessage,
  AiEventLogRecord,
  AiEventLogStatus,
} from './ai-event-log-types.ts'
export {
  formatStreamEventResponse,
  serializeCompletionResponse,
  toEventLogMessages,
} from './ai-event-log-serialize.ts'
export {
  createAiRequestTiming,
  formatCharsPerSecond,
  formatDurationMs,
  formatTokensPerSecond,
  type AiRequestTimingTracker,
} from './ai-event-log-timing.ts'
export {
  AI_EVENT_LOG_CHANGED_EVENT,
  getLiveAiEventLogCount,
  listLiveAiEventLogs,
  refreshLiveAiEventLogPerformance,
  startAiEventLogSession,
  type AiEventLogSessionHandle,
}

function dispatchEventLogChanged(): void {
  window.dispatchEvent(new CustomEvent(AI_EVENT_LOG_CHANGED_EVENT))
}

/** 异步写入 AI 生成事件（IndexedDB）。一次性落盘；流式场景请用 startAiEventLogSession。 */
export function recordAiEventLog(context: AiUsageContext, input: AiEventLogInput): void {
  void persistAiEventLog(context, input)
    .then((record) => {
      if (record) {
        observeTokenCharsRatioFromEventLog(record)
        dispatchEventLogChanged()
      }
    })
    .catch(() => undefined)
}

/** 结束实时会话并落盘；保持同一事件 id。若会话已结束则忽略。 */
export function finishAiEventLogSession(
  session: AiEventLogSessionHandle,
  context: AiUsageContext,
  input: Parameters<AiEventLogSessionHandle['finish']>[0],
): void {
  const finishInput = session.finish(input)
  if (!finishInput) {
    return
  }
  recordAiEventLog(context, finishInput)
}

export async function loadRecentEventLogs(limit = 100): Promise<AiEventLogRecord[]> {
  const persisted = await loadRecentAiEventLogs(limit)
  return mergeLiveAndPersistedEventLogs(persisted, limit)
}

export async function loadEventLogsForDay(day: string): Promise<AiEventLogRecord[]> {
  const persisted = await loadAiEventLogsForDay(day)
  const live = listLiveAiEventLogs().filter((record) => record.day === day)
  if (live.length === 0) {
    return persisted
  }
  const liveIds = new Set(live.map((record) => record.id))
  return [...live, ...persisted.filter((record) => !liveIds.has(record.id))].sort(
    (left, right) => right.at - left.at,
  )
}

export async function deleteAiEventLog(id: string): Promise<void> {
  const deleted = await deleteAiEventLogById(id)
  if (deleted) {
    dispatchEventLogChanged()
  }
}

export async function clearAiEventLog(): Promise<void> {
  await clearAiEventLogStore()
  resetTokenCharsRatios()
  dispatchEventLogChanged()
}

export function formatEventLogRoleLabel(role: AiEventLogRecord['messages'][number]['role']): string {
  switch (role) {
    case 'system':
      return '系统'
    case 'user':
      return '用户'
    case 'assistant':
      return '助手'
    case 'tool':
      return '工具'
  }
}

export function formatEventLogStatusLabel(status: AiEventLogRecord['status']): string {
  switch (status) {
    case 'running':
      return '生成中'
    case 'success':
      return '成功'
    case 'aborted':
      return '已中止'
    case 'error':
      return '失败'
  }
}

export function summarizeEventLogResponse(response: string, maxLength = 120): string {
  const normalized = response.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return '（生成中…）'
  }
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}…`
}
