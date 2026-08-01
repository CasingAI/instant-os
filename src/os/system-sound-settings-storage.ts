import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'

export const SYSTEM_SOUND_PACKS = [
  'minimal',
  'soft',
  'glass',
  'mechanical',
  'studio',
  'zen',
  'organic',
  'dreamy',
  'rubber',
  'scifi',
  'arcade',
  'cinematic',
] as const

export type SystemSoundPack = (typeof SYSTEM_SOUND_PACKS)[number]

/** 设置页展示用中文名（对应 iOS「铃声」一类可选音色）。 */
export const SYSTEM_SOUND_PACK_LABELS: Record<SystemSoundPack, string> = {
  minimal: '简约',
  soft: '柔和',
  glass: '玻璃',
  mechanical: '机械',
  studio: '录音室',
  zen: '禅意',
  organic: '自然',
  dreamy: '梦幻',
  rubber: '弹性',
  scifi: '科幻',
  arcade: '街机',
  cinematic: '电影',
}

export function systemSoundPackLabel(pack: SystemSoundPack): string {
  return SYSTEM_SOUND_PACK_LABELS[pack]
}

export type SystemSoundSettings = {
  version: 1
  /** 总开关；关闭后所有系统提示音静默。默认开启。 */
  enabled: boolean
  /** 音效风格包。默认 minimal（偏系统 UI）。 */
  pack: SystemSoundPack
  /** 0–1，默认 0.45。 */
  volume: number
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.systemSoundSettings

const DEFAULT_SETTINGS: SystemSoundSettings = {
  version: 1,
  enabled: true,
  pack: 'minimal',
  volume: 0.45,
}

function normalizePack(value: unknown): SystemSoundPack {
  if (typeof value === 'string' && (SYSTEM_SOUND_PACKS as readonly string[]).includes(value)) {
    return value as SystemSoundPack
  }
  return DEFAULT_SETTINGS.pack
}

function normalizeVolume(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS.volume
  }
  return Math.min(1, Math.max(0, value))
}

function normalizeSettings(raw: unknown): SystemSoundSettings {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_SETTINGS
  }
  const record = raw as Record<string, unknown>
  return {
    version: 1,
    enabled: record.enabled !== false,
    pack: normalizePack(record.pack),
    volume: normalizeVolume(record.volume),
  }
}

export function loadSystemSoundSettings(): SystemSoundSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_SETTINGS
    }
    return normalizeSettings(JSON.parse(raw))
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSystemSoundSettings(settings: SystemSoundSettings): boolean {
  const payload: SystemSoundSettings = {
    version: 1,
    enabled: settings.enabled,
    pack: normalizePack(settings.pack),
    volume: normalizeVolume(settings.volume),
  }
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(payload))
}

export function patchSystemSoundSettings(patch: Partial<SystemSoundSettings>): boolean {
  return saveSystemSoundSettings({ ...loadSystemSoundSettings(), ...patch })
}
