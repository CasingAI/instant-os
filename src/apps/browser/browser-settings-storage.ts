import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'

export type BrowserSettings = {
  version: 2
  /** 允许 AI 在站点于系统日期下不存在时返回 SITE_NOT_FOUND；默认关闭。 */
  allowAiRefuseSite: boolean
  /**
   * 全屏时始终显示浏览器工具栏（标签栏、地址栏、书签栏）；默认开启。
   * 关闭后与 Chrome 相同：全屏时工具栏自动隐藏，鼠标移到顶部才露出。
   */
  alwaysShowToolbarInFullscreen: boolean
  /** 地址栏未聚焦时始终显示含协议的完整网址；关闭时仅显示域名。 */
  alwaysShowFullUrl: boolean
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.safariSettings

const DEFAULT_SETTINGS: BrowserSettings = {
  version: 2,
  allowAiRefuseSite: false,
  alwaysShowToolbarInFullscreen: true,
  alwaysShowFullUrl: false,
}

function normalizeBrowserSettings(raw: unknown): BrowserSettings {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_SETTINGS
  }

  const record = raw as Record<string, unknown>
  const storedVersion = typeof record.version === 'number' ? record.version : 1
  // v1 曾误默认写入 false；升级到 v2 时恢复为默认勾选
  const alwaysShowToolbarInFullscreen =
    storedVersion >= 2 ? record.alwaysShowToolbarInFullscreen !== false : true

  return {
    version: 2,
    allowAiRefuseSite: record.allowAiRefuseSite === true,
    alwaysShowToolbarInFullscreen,
    alwaysShowFullUrl: record.alwaysShowFullUrl === true,
  }
}

export function loadBrowserSettings(): BrowserSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_SETTINGS
    }
    const normalized = normalizeBrowserSettings(JSON.parse(raw))
    const parsed = JSON.parse(raw) as { version?: number }
    if (parsed.version !== 2) {
      saveBrowserSettings(normalized)
    }
    return normalized
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveBrowserSettings(settings: BrowserSettings): boolean {
  const normalized = normalizeBrowserSettings({ ...settings, version: 2 })
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(normalized))
}

export function patchBrowserSettings(patch: Partial<Omit<BrowserSettings, 'version'>>): boolean {
  return saveBrowserSettings({ ...loadBrowserSettings(), ...patch, version: 2 })
}

export function isAiRefuseSiteAllowed(): boolean {
  return loadBrowserSettings().allowAiRefuseSite
}
