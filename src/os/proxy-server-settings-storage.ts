import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'
import { osOpenApp } from './os-open-app-bridge.ts'

/**
 * 与 virtual-chromo 宿主 CORS relay 约定一致：`{base}/-----{absoluteTargetUrl}`。
 * Chromo / WebView 浏览与宿主 proxiedFetch 共用同一 Worker origin。
 */
export const PROXY_SERVER_PATH_PREFIX = '/-----'

/** Instant 共享 virtual-chromo Worker（仅在用户显式选择「Instant 共享」时使用） */
export const PROXY_SERVER_SHARED_ORIGIN = 'https://virtual-chromo.r6sg.workers.dev'

export type ProxyServerPresetId = 'off' | 'shared' | 'custom'

export type ProxyServerSettings = {
  version: 2
  preset: ProxyServerPresetId
  /** 自定义 Worker 根地址；preset 为 custom 时生效 */
  customProxyBaseUrl: string
  /** 宿主出网（菜单栏图标、proxiedFetch）；浏览只要求已解析到 origin */
  connected: boolean
}

export const PROXY_SERVER_PRESET_OPTIONS = [
  { id: 'off', label: '关闭' },
  { id: 'shared', label: 'Instant 共享' },
  { id: 'custom', label: '自定义' },
] as const

export const PROXY_SERVER_SETTINGS_CHANGED_EVENT = 'instant-os:proxy-server-settings-changed'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.proxyServerSettings
/** 旧版「网络」设置键，读取时迁移一次 */
const LEGACY_STORAGE_KEY = 'instant-os-network-settings'

const DEFAULT_SETTINGS: ProxyServerSettings = {
  version: 2,
  preset: 'off',
  customProxyBaseUrl: '',
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

/** 由 preset 解析当前 Worker origin；关闭或自定义无效时返回 undefined */
function resolveStoredProxyBaseUrl(settings: ProxyServerSettings): string | undefined {
  if (settings.preset === 'off') {
    return undefined
  }
  if (settings.preset === 'shared') {
    return PROXY_SERVER_SHARED_ORIGIN
  }
  return normalizeProxyBaseUrl(settings.customProxyBaseUrl) || undefined
}

export function resolveProxyBaseUrl(settings: ProxyServerSettings = loadProxyServerSettings()): string | undefined {
  return resolveStoredProxyBaseUrl(settings)
}

function migrateV1(record: Record<string, unknown>): ProxyServerSettings {
  const proxyBaseUrl =
    typeof record.proxyBaseUrl === 'string' ? normalizeProxyBaseUrl(record.proxyBaseUrl) : ''
  if (!proxyBaseUrl) {
    return { ...DEFAULT_SETTINGS }
  }
  const connected = record.connected === true
  if (proxyBaseUrl === PROXY_SERVER_SHARED_ORIGIN) {
    return {
      version: 2,
      preset: 'shared',
      customProxyBaseUrl: '',
      connected,
    }
  }
  return {
    version: 2,
    preset: 'custom',
    customProxyBaseUrl: proxyBaseUrl,
    connected,
  }
}

function normalizeProxyServerSettings(raw: unknown): ProxyServerSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SETTINGS }
  }

  const record = raw as Record<string, unknown>
  const presetRaw = record.preset
  const hasV2Shape =
    record.version === 2 ||
    presetRaw === 'off' ||
    presetRaw === 'shared' ||
    presetRaw === 'custom'

  if (!hasV2Shape) {
    return migrateV1(record)
  }

  // 旧版 instant-free preset 已并入免费额度 Provider，回退为 off
  const preset: ProxyServerPresetId =
    presetRaw === 'shared' || presetRaw === 'custom' || presetRaw === 'off'
      ? presetRaw
      : 'off'
  const customProxyBaseUrl =
    typeof record.customProxyBaseUrl === 'string'
      ? normalizeProxyBaseUrl(record.customProxyBaseUrl)
      : typeof record.proxyBaseUrl === 'string' && preset === 'custom'
        ? normalizeProxyBaseUrl(record.proxyBaseUrl)
        : ''
  const origin =
    preset === 'shared'
      ? PROXY_SERVER_SHARED_ORIGIN
      : preset === 'custom'
        ? customProxyBaseUrl
        : ''
  const connected = record.connected === true && origin.length > 0

  return {
    version: 2,
    preset,
    customProxyBaseUrl,
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
  // 已选共享/有效自定义即视为可用；浏览与宿主出网同一条件，不再另设开关
  return resolveProxyBaseUrl() !== undefined
}

export function subscribeProxyServerSettings(listener: () => void): () => void {
  window.addEventListener(PROXY_SERVER_SETTINGS_CHANGED_EVENT, listener)
  return () => window.removeEventListener(PROXY_SERVER_SETTINGS_CHANGED_EVENT, listener)
}

export const OPEN_SETTINGS_PROXY_SERVER_EVENT = 'instant-os:open-settings-proxy-server'

let pendingOpenProxyServerView = false

export function openSettingsProxyServerView() {
  try {
    osOpenApp('settings')
  } catch {
    // 系统尚未挂载 openApp（极少见）；仍保留 pending，设置打开后会 consume
  }
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
