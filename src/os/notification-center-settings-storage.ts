import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'

export type NotificationCenterSettings = {
  version: 1
  /** 通知中心列表页是否显示天气小组件。默认 true。 */
  showWeather: boolean
  /** 通知中心列表页是否显示股票小组件。默认 true。 */
  showStocks: boolean
}

export const NOTIFICATION_CENTER_SETTINGS_CHANGED_EVENT =
  'instant-os:notification-center-settings-changed'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.notificationCenterSettings

const DEFAULT_SETTINGS: NotificationCenterSettings = {
  version: 1,
  showWeather: true,
  showStocks: true,
}

function normalizeNotificationCenterSettings(raw: unknown): NotificationCenterSettings {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_SETTINGS
  }

  const record = raw as Record<string, unknown>
  return {
    version: 1,
    showWeather: record.showWeather !== false,
    showStocks: record.showStocks !== false,
  }
}

export function loadNotificationCenterSettings(): NotificationCenterSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_SETTINGS
    }
    return normalizeNotificationCenterSettings(JSON.parse(raw))
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveNotificationCenterSettings(settings: NotificationCenterSettings): boolean {
  const payload: NotificationCenterSettings = {
    version: 1,
    showWeather: settings.showWeather !== false,
    showStocks: settings.showStocks !== false,
  }
  if (!writeLocalStorageItem(STORAGE_KEY, JSON.stringify(payload))) {
    return false
  }
  window.dispatchEvent(new CustomEvent(NOTIFICATION_CENTER_SETTINGS_CHANGED_EVENT))
  return true
}

export function patchNotificationCenterSettings(
  patch: Partial<Omit<NotificationCenterSettings, 'version'>>,
): boolean {
  return saveNotificationCenterSettings({ ...loadNotificationCenterSettings(), ...patch })
}
