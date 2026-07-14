import type { TokenUsageSnapshot } from '../apps/browser/browser-token-usage.ts'
import { addMsToCalendarInstant, calendarDayKey } from '../os/calendar-instant.ts'
import { getOsNowInstant, osDayKey } from '../os/os-clock.ts'
import { resolveActorLabel, type AiUsageContext } from './ai-usage-context.ts'
import {
  clearAiTokenUsageStore,
  initAiTokenUsageStorage,
  loadAiTokenUsageFromStore,
  loadAiUsageRequestsForDay,
  persistAiTokenUsage,
} from './ai-token-usage-storage.ts'

export type {
  ActorTokenUsage,
  AiTokenUsageRecord,
  AiUsageRequestRecord,
  BehaviorTokenUsage,
  DayTokenUsage,
} from './ai-token-usage-types.ts'
export type { AiUsageContext } from './ai-usage-context.ts'

import type {
  ActorTokenUsage,
  AiTokenUsageRecord,
  AiUsageRequestRecord,
  BehaviorTokenUsage,
  DayTokenUsage,
} from './ai-token-usage-types.ts'

export const AI_TOKEN_USAGE_CHANGED_EVENT = 'instant-os:ai-token-usage-changed'

function dispatchUsageChanged(): void {
  window.dispatchEvent(new CustomEvent(AI_TOKEN_USAGE_CHANGED_EVENT))
}

/** 仅当 API 返回有效 usage 时写入统计（异步持久化到数据空间）。 */
export function recordAiTokenUsage(
  context: AiUsageContext,
  usage: TokenUsageSnapshot | undefined,
): void {
  if (!usage || usage.totalTokens <= 0) {
    return
  }

  void persistAiTokenUsage(context, usage)
    .then(() => dispatchUsageChanged())
    .catch(() => undefined)
}

export async function loadAiTokenUsage(): Promise<AiTokenUsageRecord> {
  await initAiTokenUsageStorage()
  return loadAiTokenUsageFromStore()
}

export async function clearAiTokenUsage(): Promise<void> {
  await clearAiTokenUsageStore()
  dispatchUsageChanged()
}

export async function getAiUsageRequestsForDay(day: string): Promise<AiUsageRequestRecord[]> {
  return loadAiUsageRequestsForDay(day)
}

export function getActorUsageList(record: AiTokenUsageRecord): ActorTokenUsage[] {
  return Object.values(record.byActor).sort((left, right) => right.totalTokens - left.totalTokens)
}

export function getBehaviorUsageList(actor: ActorTokenUsage): BehaviorTokenUsage[] {
  return Object.values(actor.byBehavior).sort((left, right) => right.totalTokens - left.totalTokens)
}

export function getDayUsageList(record: AiTokenUsageRecord): DayTokenUsage[] {
  return Object.values(record.byDay).sort((left, right) => right.day.localeCompare(left.day))
}

export function formatUsageDayLabel(day: string): string {
  const [year, month, date] = day.split('-')
  if (!year || !month || !date) {
    return day
  }
  const todayKey = osDayKey()
  if (day === todayKey) {
    return '今天'
  }

  const yesterdayInstant = addMsToCalendarInstant(getOsNowInstant(), -86_400_000)
  const yesterdayKey = calendarDayKey(yesterdayInstant)
  if (day === yesterdayKey) {
    return '昨天'
  }

  return `${year}年${Number(month)}月${Number(date)}日`
}

export function formatUsageTime(at: number): string {
  return new Date(at).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function resolveRequestActorLabel(
  request: AiUsageRequestRecord,
  installedAppName?: string,
): string {
  if (installedAppName) {
    return installedAppName
  }
  return request.actorLabel || resolveActorLabel(request.actor)
}
