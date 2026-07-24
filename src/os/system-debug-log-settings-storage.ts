import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'

export type SystemDebugLogSettings = {
  /** 记录 npm run / QuickJS / VFS 采样面包屑（默认开） */
  enabled: boolean
}

export const SYSTEM_DEBUG_LOG_SETTINGS_CHANGED_EVENT =
  'instant-os:system-debug-log-settings-changed'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.systemDebugLogSettings

const DEFAULT_SETTINGS: SystemDebugLogSettings = {
  enabled: true,
}

function normalize(raw: unknown): SystemDebugLogSettings {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_SETTINGS
  }
  const record = raw as Record<string, unknown>
  return {
    enabled: record.enabled !== false,
  }
}

export function loadSystemDebugLogSettings(): SystemDebugLogSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_SETTINGS
    }
    return normalize(JSON.parse(raw))
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSystemDebugLogSettings(settings: SystemDebugLogSettings): boolean {
  const serialized = JSON.stringify({ enabled: settings.enabled })
  if (!writeLocalStorageItem(STORAGE_KEY, serialized)) {
    return false
  }
  window.dispatchEvent(new CustomEvent(SYSTEM_DEBUG_LOG_SETTINGS_CHANGED_EVENT))
  return true
}

export function patchSystemDebugLogSettings(
  patch: Partial<SystemDebugLogSettings>,
): SystemDebugLogSettings {
  const next = { ...loadSystemDebugLogSettings(), ...patch }
  saveSystemDebugLogSettings(next)
  return next
}

export function isSystemDebugLogEnabled(): boolean {
  return loadSystemDebugLogSettings().enabled
}
