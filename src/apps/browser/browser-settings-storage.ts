import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'

export type BrowserSettings = {
  version: 1
  /** 允许 AI 在站点于系统日期下不存在时返回 SITE_NOT_FOUND；默认关闭。 */
  allowAiRefuseSite: boolean
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.safariSettings

const DEFAULT_SETTINGS: BrowserSettings = {
  version: 1,
  allowAiRefuseSite: false,
}

function normalizeBrowserSettings(raw: unknown): BrowserSettings {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_SETTINGS
  }

  const record = raw as Record<string, unknown>
  return {
    version: 1,
    allowAiRefuseSite: record.allowAiRefuseSite === true,
  }
}

export function loadBrowserSettings(): BrowserSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_SETTINGS
    }
    return normalizeBrowserSettings(JSON.parse(raw))
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveBrowserSettings(settings: BrowserSettings): boolean {
  const normalized = normalizeBrowserSettings(settings)
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(normalized))
}

export function patchBrowserSettings(patch: Partial<Omit<BrowserSettings, 'version'>>): boolean {
  return saveBrowserSettings({ ...loadBrowserSettings(), ...patch, version: 1 })
}

export function isAiRefuseSiteAllowed(): boolean {
  return loadBrowserSettings().allowAiRefuseSite
}
