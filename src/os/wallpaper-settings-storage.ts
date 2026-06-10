import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'
import { DEFAULT_WALLPAPER_ID, getBuiltinWallpaper } from './wallpapers.ts'

export const WALLPAPER_SETTINGS_CHANGED_EVENT = 'instant-os:wallpaper-settings-changed'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.wallpaperSettings

export type WallpaperSettings = {
  wallpaperId: string
}

const DEFAULT_SETTINGS: WallpaperSettings = {
  wallpaperId: DEFAULT_WALLPAPER_ID,
}

function normalizeWallpaperSettings(raw: unknown): WallpaperSettings {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_SETTINGS
  }

  const record = raw as Record<string, unknown>
  const wallpaperId = typeof record.wallpaperId === 'string' ? record.wallpaperId : DEFAULT_WALLPAPER_ID

  if (!getBuiltinWallpaper(wallpaperId)) {
    return DEFAULT_SETTINGS
  }

  return { wallpaperId }
}

export function loadWallpaperSettings(): WallpaperSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_SETTINGS
    }
    return normalizeWallpaperSettings(JSON.parse(raw))
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveWallpaperSettings(settings: WallpaperSettings): boolean {
  const payload: WallpaperSettings = {
    wallpaperId: getBuiltinWallpaper(settings.wallpaperId)
      ? settings.wallpaperId
      : DEFAULT_WALLPAPER_ID,
  }

  const serialized = JSON.stringify(payload)
  const saved = writeLocalStorageItem(STORAGE_KEY, serialized)
  if (saved) {
    window.dispatchEvent(new CustomEvent(WALLPAPER_SETTINGS_CHANGED_EVENT))
  }
  return saved
}

export function patchWallpaperSettings(patch: Partial<WallpaperSettings>): boolean {
  return saveWallpaperSettings({ ...loadWallpaperSettings(), ...patch })
}
