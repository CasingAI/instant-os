import {
  DEVICE_STORAGE_KEYS,
  writeLocalStorageItem,
} from './device-storage.ts'
import {
  WORKER_HEAP_SERVICE_IDS,
  type ServiceStartupType,
  type WorkerHeapServiceId,
} from './worker-heap-reports.ts'

export type ServiceStartupSettings = {
  version: 1
  /** 各服务的启动类型覆盖；未写入的服务使用 defaultStartupType */
  types: Partial<Record<WorkerHeapServiceId, ServiceStartupType>>
}

export const SERVICE_STARTUP_SETTINGS_CHANGED_EVENT =
  'instant-os:service-startup-settings-changed'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.serviceStartupSettings

const DEFAULT_SETTINGS: ServiceStartupSettings = {
  version: 1,
  types: {},
}

function isSelectableServiceStartupType(
  value: unknown,
): value is Exclude<ServiceStartupType, 'disabled'> {
  return value === 'auto' || value === 'auto-delayed' || value === 'manual'
}

function normalizeServiceStartupSettings(raw: unknown): ServiceStartupSettings {
  const settings: ServiceStartupSettings = { version: 1, types: {} }
  if (!raw || typeof raw !== 'object') return settings
  const record = raw as Record<string, unknown>
  const typesRaw =
    record.types && typeof record.types === 'object'
      ? (record.types as Record<string, unknown>)
      : {}
  for (const id of WORKER_HEAP_SERVICE_IDS) {
    const value = typesRaw[id]
    // 「禁用」易导致请求被拒等异常，不再接受；旧数据回落为手动
    if (value === 'disabled') {
      settings.types[id] = 'manual'
    } else if (isSelectableServiceStartupType(value)) {
      settings.types[id] = value
    }
  }
  return settings
}

export function loadServiceStartupSettings(): ServiceStartupSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS, types: {} }
    return normalizeServiceStartupSettings(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_SETTINGS, types: {} }
  }
}

export function saveServiceStartupSettings(settings: ServiceStartupSettings): boolean {
  const payload = normalizeServiceStartupSettings(settings)
  if (!writeLocalStorageItem(STORAGE_KEY, JSON.stringify(payload))) {
    return false
  }
  window.dispatchEvent(new CustomEvent(SERVICE_STARTUP_SETTINGS_CHANGED_EVENT))
  return true
}

export function patchServiceStartupType(
  id: WorkerHeapServiceId,
  startupType: ServiceStartupType,
): boolean {
  if (startupType === 'disabled') {
    return false
  }
  const settings = loadServiceStartupSettings()
  return saveServiceStartupSettings({
    ...settings,
    types: { ...settings.types, [id]: startupType },
  })
}

/** 读取某服务的有效启动类型（设置覆盖优先，否则用默认值） */
export function getServiceStartupType(
  id: WorkerHeapServiceId,
  defaultType: ServiceStartupType = 'manual',
): ServiceStartupType {
  const resolved = loadServiceStartupSettings().types[id] ?? defaultType
  return resolved === 'disabled' ? 'manual' : resolved
}

export function subscribeServiceStartupSettings(listener: () => void): () => void {
  window.addEventListener(SERVICE_STARTUP_SETTINGS_CHANGED_EVENT, listener)
  return () => window.removeEventListener(SERVICE_STARTUP_SETTINGS_CHANGED_EVENT, listener)
}
