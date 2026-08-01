import { playSystemErrorSound } from './system-sounds.ts'

export type AppNotification = {
  id: string
  appName: string
  appSlug: string
  iconEmoji: string
  themeColor: string
  error: string
  failedAt: number
}

type AppNotificationListener = () => void

const listeners = new Set<AppNotificationListener>()

let notifications: AppNotification[] = []

function notifySubscribers() {
  for (const listener of listeners) {
    listener()
  }
}

export function getAppNotifications(): AppNotification[] {
  return notifications
}

export function addAppNotification(notification: AppNotification) {
  const existingIndex = notifications.findIndex((n) => n.id === notification.id)
  if (existingIndex >= 0) {
    notifications = [
      ...notifications.slice(0, existingIndex),
      notification,
      ...notifications.slice(existingIndex + 1),
    ]
  } else {
    notifications = [...notifications, notification]
  }
  playSystemErrorSound()
  notifySubscribers()
}

export function dismissAppNotification(id: string) {
  const index = notifications.findIndex((n) => n.id === id)
  if (index < 0) {
    return
  }
  notifications = [...notifications.slice(0, index), ...notifications.slice(index + 1)]
  notifySubscribers()
}

export function clearAppNotifications() {
  if (notifications.length === 0) {
    return
  }
  notifications = []
  notifySubscribers()
}

export function subscribeAppNotifications(listener: AppNotificationListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
