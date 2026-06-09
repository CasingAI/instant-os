import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'

export type EmojiFontMode = 'auto' | 'on' | 'off'

export type DisplaySettings = {
  emojiFontMode: EmojiFontMode
  /** User override: emoji vertical offset in em (unitless, relative to font-size). */
  emojiOffsetEm?: number
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

function normalizeEmojiOffsetEm(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }

  if (value < -0.5 || value > 0.5) {
    return undefined
  }

  return value
}

function normalizeDisplaySettings(raw: unknown): DisplaySettings {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_SETTINGS
  }

  const record = raw as Record<string, unknown>
  const settings: DisplaySettings = {
    emojiFontMode: normalizeEmojiFontMode(record.emojiFontMode),
  }

  const unifiedOffset = normalizeEmojiOffsetEm(record.emojiOffsetEm)
  const legacyIconOffset = normalizeEmojiOffsetEm(record.emojiOffsetIconEm)
  const legacyTextOffset = normalizeEmojiOffsetEm(record.emojiOffsetTextEm)
  const resolvedOffset = unifiedOffset ?? legacyIconOffset ?? legacyTextOffset

  if (resolvedOffset !== undefined) {
    settings.emojiOffsetEm = resolvedOffset
  }

  return settings
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

  if (settings.emojiOffsetEm !== undefined) {
    payload.emojiOffsetEm = settings.emojiOffsetEm
  }

  const serialized = JSON.stringify(payload)
  return writeLocalStorageItem(STORAGE_KEY, serialized)
}

export function patchDisplaySettings(patch: Partial<DisplaySettings>): boolean {
  return saveDisplaySettings({ ...loadDisplaySettings(), ...patch })
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
