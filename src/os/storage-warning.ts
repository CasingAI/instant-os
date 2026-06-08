import {
  DEVICE_CAPACITY_BYTES,
  getTotalLocalStorageBytes,
  STORAGE_CHANGED_EVENT,
} from './device-storage.ts'

export { STORAGE_CHANGED_EVENT }
export const OPEN_SETTINGS_USAGE_EVENT = 'instant-os:open-settings-usage'

const COOLDOWN_MS = 5 * 60 * 1000
const LAST_SENT_KEY = 'instant-os-storage-warning-last-sent-at'

export type StorageWarningLevel = 10 | 20

export type StorageWarningNotification = {
  level: StorageWarningLevel
  availablePercent: number
}

const warningState = {
  recoveredAbove20: true,
  recoveredAbove10: true,
}

export function getAvailableStoragePercent(): number {
  const used = getTotalLocalStorageBytes()
  const available = Math.max(0, DEVICE_CAPACITY_BYTES - used)
  return (available / DEVICE_CAPACITY_BYTES) * 100
}

export function openSettingsUsageView() {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_USAGE_EVENT))
}

function canSendNotification(): boolean {
  try {
    const raw = sessionStorage.getItem(LAST_SENT_KEY)
    if (!raw) {
      return true
    }
    return Date.now() - Number(raw) >= COOLDOWN_MS
  } catch {
    return true
  }
}

function markNotificationSent() {
  try {
    sessionStorage.setItem(LAST_SENT_KEY, String(Date.now()))
  } catch {
    // ignore
  }
}

export function evaluateStorageWarning(): StorageWarningNotification | undefined {
  const availablePercent = getAvailableStoragePercent()

  if (availablePercent >= 20) {
    warningState.recoveredAbove20 = true
    warningState.recoveredAbove10 = true
    return undefined
  }

  if (availablePercent >= 10) {
    warningState.recoveredAbove10 = true
  }

  if (!canSendNotification()) {
    return undefined
  }

  if (availablePercent < 10 && warningState.recoveredAbove10) {
    warningState.recoveredAbove10 = false
    warningState.recoveredAbove20 = false
    markNotificationSent()
    return { level: 10, availablePercent }
  }

  if (availablePercent < 20 && warningState.recoveredAbove20) {
    warningState.recoveredAbove20 = false
    markNotificationSent()
    return { level: 20, availablePercent }
  }

  return undefined
}

export function messageForStorageWarning(level: StorageWarningLevel): {
  title: string
  subtitle: string
} {
  if (level === 10) {
    return {
      title: '存储空间严重不足',
      subtitle: '可用空间已不足 10%，请尽快清理',
    }
  }

  return {
    title: '存储空间不足',
    subtitle: '可用空间已不足 20%，建议查看用量',
  }
}
