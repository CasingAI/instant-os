import { playSystemErrorSound } from './system-sounds.ts'
import type { BuiltinAppId } from './types.ts'

export type OsNotificationPhase = 'running' | 'success' | 'failure' | 'warning' | 'neutral'

export type OsNotificationIcon =
  | { kind: 'tile'; emoji: string; color: string }
  | { kind: 'app'; appId: BuiltinAppId }

export type OsNotificationAction = {
  id: string
  label: string
  tone?: 'primary' | 'secondary'
}

export type OsNotificationProgress = {
  percent: number
  statLabel?: string
  statValue?: string
  textLength?: number
}

export type OsNotification = {
  id: string
  title: string
  subtitle: string
  phase: OsNotificationPhase
  icon: OsNotificationIcon
  progress?: OsNotificationProgress
  body?: string
  sticky?: boolean
  banner?: 'none' | 'once' | 'progress'
  streamSlug?: string
  streamKind?: 'install' | 'book'
  actions?: OsNotificationAction[]
}

export type OsNotificationHandlers = {
  onAction?: Record<string, () => void>
  onDismiss?: () => void
}

export const OS_TEST_NOTIFICATION_ID = 'system:test-notification'

type Listener = () => void

const listeners = new Set<Listener>()
let notifications: OsNotification[] = []
const handlersById = new Map<string, OsNotificationHandlers>()
const bannerGenerationById = new Map<string, number>()

function notifySubscribers() {
  for (const listener of listeners) {
    listener()
  }
}

function resolveSticky(record: OsNotification): boolean {
  if (record.sticky !== undefined) {
    return record.sticky
  }
  return record.phase === 'running'
}

function normalizeRecord(record: OsNotification): OsNotification {
  return {
    ...record,
    sticky: resolveSticky(record),
    banner: record.banner ?? 'none',
  }
}

export function getOsNotifications(): readonly OsNotification[] {
  return notifications
}

export function getOsNotification(id: string): OsNotification | undefined {
  return notifications.find((item) => item.id === id)
}

export function getOsNotificationBannerGeneration(id: string): number {
  return bannerGenerationById.get(id) ?? 0
}

export function isOsNotificationDismissible(notification: OsNotification): boolean {
  return notification.phase !== 'running' && notification.sticky !== true
}

export function postOsNotification(
  record: OsNotification,
  handlers?: OsNotificationHandlers,
): void {
  const next = normalizeRecord(record)
  const existingIndex = notifications.findIndex((item) => item.id === next.id)
  const previous = existingIndex >= 0 ? notifications[existingIndex] : undefined
  if (handlers) {
    handlersById.set(next.id, handlers)
  } else if (!previous) {
    handlersById.delete(next.id)
  }
  if (previous && JSON.stringify(previous) === JSON.stringify(next)) {
    return
  }
  if (existingIndex >= 0) {
    notifications = [
      ...notifications.slice(0, existingIndex),
      next,
      ...notifications.slice(existingIndex + 1),
    ]
  } else {
    notifications = [...notifications, next]
  }
  bannerGenerationById.set(next.id, (bannerGenerationById.get(next.id) ?? 0) + 1)
  if (next.phase === 'failure' && previous?.phase !== 'failure') {
    playSystemErrorSound()
  }
  notifySubscribers()
}

export function invokeOsNotificationAction(id: string, actionId: string): void {
  handlersById.get(id)?.onAction?.[actionId]?.()
}

export function dismissOsNotification(id: string, options?: { skipOnDismiss?: boolean }): void {
  const existing = notifications.find((item) => item.id === id)
  if (!existing) {
    return
  }
  const handlers = handlersById.get(id)
  handlersById.delete(id)
  bannerGenerationById.delete(id)
  notifications = notifications.filter((item) => item.id !== id)
  notifySubscribers()
  if (!options?.skipOnDismiss) {
    handlers?.onDismiss?.()
  }
}

export function clearDismissibleOsNotifications(): void {
  const keep: OsNotification[] = []
  const dismissedHandlers: OsNotificationHandlers[] = []
  for (const item of notifications) {
    if (!isOsNotificationDismissible(item)) {
      keep.push(item)
      continue
    }
    const handlers = handlersById.get(item.id)
    handlersById.delete(item.id)
    bannerGenerationById.delete(item.id)
    if (handlers) {
      dismissedHandlers.push(handlers)
    }
  }
  notifications = keep
  notifySubscribers()
  for (const handlers of dismissedHandlers) {
    handlers.onDismiss?.()
  }
}

export function subscribeOsNotifications(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
