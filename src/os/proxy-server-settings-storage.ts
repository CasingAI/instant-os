import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'

/** 与现有 CF Worker 约定一致：`{base}/-----{absoluteTargetUrl}` */
export const PROXY_SERVER_PATH_PREFIX = '/-----'

export type ProxyServerSettings = {
  version: 1
  /** Worker 根地址，无尾斜杠；空字符串表示未配置 */
  proxyBaseUrl: string
  /** 是否已连接（菜单栏图标、proxiedFetch 均依赖此项） */
  connected: boolean
}

export const PROXY_SERVER_SETTINGS_CHANGED_EVENT = 'instant-os:proxy-server-settings-changed'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.proxyServerSettings
/** 旧版「网络」设置键，读取时迁移一次 */
const LEGACY_STORAGE_KEY = 'instant-os-network-settings'

const DEFAULT_SETTINGS: ProxyServerSettings = {
  version: 1,
  proxyBaseUrl: '',
  connected: false,
}

export function normalizeProxyBaseUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) {
    return ''
  }
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return ''
    }
    // 去掉路径与查询，只保留 origin；用户若误带路径则丢弃
    return url.origin
  } catch {
    return ''
  }
}

function normalizeProxyServerSettings(raw: unknown): ProxyServerSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SETTINGS }
  }

  const record = raw as Record<string, unknown>
  const proxyBaseUrl =
    typeof record.proxyBaseUrl === 'string' ? normalizeProxyBaseUrl(record.proxyBaseUrl) : ''
  const connected = record.connected === true && proxyBaseUrl.length > 0

  return {
    version: 1,
    proxyBaseUrl,
    connected,
  }
}

function tryParseSettings(raw: string | undefined | null): ProxyServerSettings | undefined {
  if (!raw) {
    return undefined
  }
  try {
    return normalizeProxyServerSettings(JSON.parse(raw))
  } catch {
    return undefined
  }
}

export function loadProxyServerSettings(): ProxyServerSettings {
  try {
    const current = tryParseSettings(localStorage.getItem(STORAGE_KEY))
    if (current) {
      return current
    }

    const legacy = tryParseSettings(localStorage.getItem(LEGACY_STORAGE_KEY))
    if (legacy) {
      if (writeLocalStorageItem(STORAGE_KEY, JSON.stringify(legacy))) {
        try {
          localStorage.removeItem(LEGACY_STORAGE_KEY)
        } catch {
          // 忽略删旧键失败
        }
      }
      return legacy
    }

    return { ...DEFAULT_SETTINGS }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveProxyServerSettings(settings: ProxyServerSettings): boolean {
  const payload = normalizeProxyServerSettings(settings)
  if (!writeLocalStorageItem(STORAGE_KEY, JSON.stringify(payload))) {
    return false
  }
  window.dispatchEvent(new CustomEvent(PROXY_SERVER_SETTINGS_CHANGED_EVENT))
  return true
}

export function patchProxyServerSettings(patch: Partial<ProxyServerSettings>): boolean {
  return saveProxyServerSettings({ ...loadProxyServerSettings(), ...patch })
}

export function isProxyServerConnected(): boolean {
  return loadProxyServerSettings().connected
}

export function subscribeProxyServerSettings(listener: () => void): () => void {
  window.addEventListener(PROXY_SERVER_SETTINGS_CHANGED_EVENT, listener)
  return () => window.removeEventListener(PROXY_SERVER_SETTINGS_CHANGED_EVENT, listener)
}

export const OPEN_SETTINGS_PROXY_SERVER_EVENT = 'instant-os:open-settings-proxy-server'

let pendingOpenProxyServerView = false

export function openSettingsProxyServerView() {
  pendingOpenProxyServerView = true
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_PROXY_SERVER_EVENT))
}

export function consumePendingOpenProxyServerView(): boolean {
  if (!pendingOpenProxyServerView) {
    return false
  }
  pendingOpenProxyServerView = false
  return true
}
