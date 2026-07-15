import type { StorageWarningLevel } from './storage-warning.ts'

type StorageWarningNotificationListener = () => void

export type ActiveStorageWarningNotification = {
  level: StorageWarningLevel
  availablePercent: number
}

const listeners = new Set<StorageWarningNotificationListener>()

let active: ActiveStorageWarningNotification | undefined

function notifySubscribers() {
  for (const listener of listeners) {
    listener()
  }
}

export function getActiveStorageWarningNotification(): ActiveStorageWarningNotification | undefined {
  return active
}

export function activateStorageWarningNotification(
  notification: ActiveStorageWarningNotification,
): void {
  active = notification
  notifySubscribers()
}

export function dismissStorageWarningNotification(): void {
  if (!active) {
    return
  }
  active = undefined
  notifySubscribers()
}

export function subscribeStorageWarningNotification(
  listener: StorageWarningNotificationListener,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
