import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'

export type SystemEnvSettings = {
  version: 1
  entries: Record<string, string>
}

export const SYSTEM_ENV_SETTINGS_CHANGED_EVENT = 'instant-os:system-env-settings-changed'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.systemEnvSettings

/** Instant OS 内置系统默认环境变量（终端 / QuickJS 未覆盖时的起点）。 */
export const DEFAULT_SYSTEM_ENV_ENTRIES: Readonly<Record<string, string>> = {
  HOME: '/user',
  USER: 'user',
  PATH: '/bin:/usr/bin',
  LANG: 'zh_CN.UTF-8',
  NODE_ENV: 'development',
}

/** 键名：非空、无空白、不含 `=`。 */
export function isValidSystemEnvKey(key: string): boolean {
  if (!key) {
    return false
  }
  if (/\s/.test(key) || key.includes('=')) {
    return false
  }
  return true
}

export function normalizeSystemEnvEntries(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SYSTEM_ENV_ENTRIES }
  }

  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isValidSystemEnvKey(key)) {
      continue
    }
    if (typeof value !== 'string') {
      continue
    }
    result[key] = value
  }

  return result
}

function normalizeSystemEnvSettings(raw: unknown): SystemEnvSettings {
  if (!raw || typeof raw !== 'object') {
    return {
      version: 1,
      entries: { ...DEFAULT_SYSTEM_ENV_ENTRIES },
    }
  }

  const record = raw as Record<string, unknown>
  return {
    version: 1,
    entries: normalizeSystemEnvEntries(record.entries),
  }
}

export function loadSystemEnvSettings(): SystemEnvSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {
        version: 1,
        entries: { ...DEFAULT_SYSTEM_ENV_ENTRIES },
      }
    }
    return normalizeSystemEnvSettings(JSON.parse(raw))
  } catch {
    return {
      version: 1,
      entries: { ...DEFAULT_SYSTEM_ENV_ENTRIES },
    }
  }
}

/** 返回规范化后的环境变量浅拷贝，供终端 / QuickJS 创建使用。 */
export function getResolvedSystemEnv(): Record<string, string> {
  return { ...loadSystemEnvSettings().entries }
}

export function saveSystemEnvSettings(settings: SystemEnvSettings): boolean {
  const entries = normalizeSystemEnvEntries(settings.entries)
  const serialized = JSON.stringify({
    version: 1 as const,
    entries,
  })
  if (!writeLocalStorageItem(STORAGE_KEY, serialized)) {
    return false
  }
  window.dispatchEvent(new CustomEvent(SYSTEM_ENV_SETTINGS_CHANGED_EVENT))
  return true
}

export function resetSystemEnvSettings(): boolean {
  return saveSystemEnvSettings({
    version: 1,
    entries: { ...DEFAULT_SYSTEM_ENV_ENTRIES },
  })
}

/** 后写覆盖前写；供会话 spawn 时合并覆盖项。 */
export function mergeHostEnv(
  base: Record<string, string>,
  overrides?: Record<string, string>,
): Record<string, string> {
  if (overrides === undefined) {
    return { ...base }
  }
  return { ...base, ...overrides }
}

export function subscribeSystemEnvSettings(listener: () => void): () => void {
  window.addEventListener(SYSTEM_ENV_SETTINGS_CHANGED_EVENT, listener)
  return () => {
    window.removeEventListener(SYSTEM_ENV_SETTINGS_CHANGED_EVENT, listener)
  }
}
