import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'

export type SystemDebugLogSettings = {
  /**
   * 系统诊断日志总开关（默认关）。
   * 打开后会在高危路径（VFS / QuickJS / npm run / 虚拟机）上产生少量开销，
   * 换取独立 Worker 黑匣子面包屑；关闭时埋点只读一次内存布尔。
   */
  enabled: boolean
}

export const SYSTEM_DEBUG_LOG_SETTINGS_CHANGED_EVENT =
  'instant-os:system-debug-log-settings-changed'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.systemDebugLogSettings

const DEFAULT_SETTINGS: SystemDebugLogSettings = {
  enabled: false,
}

function normalize(raw: unknown): SystemDebugLogSettings {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_SETTINGS
  }
  const record = raw as Record<string, unknown>
  return {
    enabled: record.enabled === true,
  }
}

/**
 * 内存缓存：热路径只读这颗布尔。
 * 禁止每次埋点都 localStorage.getItem + JSON.parse（旧实现最大的性能坑，
 * 见 todo/system-debug-log-worker.md 6.2）。启动读一次；本标签保存时直接更新；
 * 其它标签的变更靠 storage 事件失效缓存。
 */
let cachedSettings: SystemDebugLogSettings | undefined

export function loadSystemDebugLogSettings(): SystemDebugLogSettings {
  if (cachedSettings !== undefined) {
    return cachedSettings
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    cachedSettings = raw !== null ? normalize(JSON.parse(raw)) : DEFAULT_SETTINGS
  } catch {
    cachedSettings = DEFAULT_SETTINGS
  }
  return cachedSettings
}

export function saveSystemDebugLogSettings(settings: SystemDebugLogSettings): boolean {
  const serialized = JSON.stringify({ enabled: settings.enabled })
  if (!writeLocalStorageItem(STORAGE_KEY, serialized)) {
    return false
  }
  cachedSettings = settings
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

if (typeof window !== 'undefined') {
  // 其它标签修改开关时失效本标签缓存（下次 isSystemDebugLogEnabled 重读一次）
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      cachedSettings = undefined
    }
  })
}
