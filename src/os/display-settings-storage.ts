import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'

export type EmojiFontMode = 'auto' | 'on' | 'off'

export type DisplaySettings = {
  emojiFontMode: EmojiFontMode
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.displaySettings

const DEFAULT_SETTINGS: DisplaySettings = {
  emojiFontMode: 'auto',
}

function normalizeEmojiFontMode(value: unknown): EmojiFontMode {
  if (value === 'auto' || value === 'on' || value === 'off') {
    return value
  }
  return 'auto'
}

function normalizeDisplaySettings(raw: unknown): DisplaySettings {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_SETTINGS
  }

  const record = raw as Record<string, unknown>
  return {
    emojiFontMode: normalizeEmojiFontMode(record.emojiFontMode),
  }
}

export function loadDisplaySettings(): DisplaySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_SETTINGS
    }
    return normalizeDisplaySettings(JSON.parse(raw))
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveDisplaySettings(settings: DisplaySettings): boolean {
  const payload: DisplaySettings = {
    emojiFontMode: settings.emojiFontMode,
  }
  const serialized = JSON.stringify(payload)
  return writeLocalStorageItem(STORAGE_KEY, serialized)
}

export function emojiFontLabel(mode: EmojiFontMode): string {
  if (mode === 'auto') {
    return '自动'
  }
  if (mode === 'on') {
    return '开启'
  }
  return '关闭'
}
