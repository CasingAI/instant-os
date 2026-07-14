import {
  clearAiEventLogStore,
  deleteAiEventLogById,
  loadAiEventLogsForDay,
  loadRecentAiEventLogs,
  persistAiEventLog,
} from './ai-event-log-storage.ts'
import type { AiEventLogInput, AiEventLogRecord } from './ai-event-log-types.ts'
import type { AiUsageContext } from './ai-usage-context.ts'

export type { AiEventLogInput, AiEventLogMessage, AiEventLogRecord } from './ai-event-log-types.ts'
export {
  formatStreamEventResponse,
  serializeCompletionResponse,
  toEventLogMessages,
} from './ai-event-log-serialize.ts'

export const AI_EVENT_LOG_CHANGED_EVENT = 'instant-os:ai-event-log-changed'

function dispatchEventLogChanged(): void {
  window.dispatchEvent(new CustomEvent(AI_EVENT_LOG_CHANGED_EVENT))
}

/** 异步写入 AI 生成事件（IndexedDB）。 */
export function recordAiEventLog(context: AiUsageContext, input: AiEventLogInput): void {
  void persistAiEventLog(context, input)
    .then((record) => {
      if (record) {
        dispatchEventLogChanged()
      }
    })
    .catch(() => undefined)
}

export async function loadRecentEventLogs(limit = 100): Promise<AiEventLogRecord[]> {
  return loadRecentAiEventLogs(limit)
}

export async function loadEventLogsForDay(day: string): Promise<AiEventLogRecord[]> {
  return loadAiEventLogsForDay(day)
}

export async function deleteAiEventLog(id: string): Promise<void> {
  const deleted = await deleteAiEventLogById(id)
  if (deleted) {
    dispatchEventLogChanged()
  }
}

export async function clearAiEventLog(): Promise<void> {
  await clearAiEventLogStore()
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

export function summarizeEventLogResponse(response: string, maxLength = 120): string {
  const normalized = response.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}…`
}
