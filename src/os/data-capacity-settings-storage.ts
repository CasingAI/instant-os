import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'

/** 数据空间默认上限 8 GB */
export const DEFAULT_DATA_CAPACITY_BYTES = 8 * 1024 * 1024 * 1024

/** 用户可在设置中升级到的最大上限 64 GB */
export const DATA_CAPACITY_MAX_BYTES = 64 * 1024 * 1024 * 1024

/** 非法值对齐用的粒度；界面只提供下列档位 */
export const DATA_CAPACITY_STEP_BYTES = 1 * 1024 * 1024 * 1024

/** 数据空间档位：8 / 16 / 32 / 64 GB */
export const DATA_CAPACITY_PLAN_BYTES = [
  DEFAULT_DATA_CAPACITY_BYTES,
  16 * 1024 * 1024 * 1024,
  32 * 1024 * 1024 * 1024,
  DATA_CAPACITY_MAX_BYTES,
] as const

export const DATA_CAPACITY_CHANGED_EVENT = 'instant-os:data-capacity-changed'

/** 全部标准档；若当前不在标准档，按大小插入当前值。 */
export function listDataCapacityPlans(currentBytes: number): number[] {
  const current = clampDataCapacityBytes(currentBytes)
  const plans = new Set<number>(DATA_CAPACITY_PLAN_BYTES)
  plans.add(current)
  return [...plans].sort((a, b) => a - b)
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.dataCapacitySettings

type DataCapacitySettings = {
  capacityBytes: number
}

function normalizeCapacityBytes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return DEFAULT_DATA_CAPACITY_BYTES
  }
  return clampDataCapacityBytes(value)
}

function normalizeSettings(raw: unknown): DataCapacitySettings {
  if (!raw || typeof raw !== 'object') {
    return { capacityBytes: DEFAULT_DATA_CAPACITY_BYTES }
  }
  const record = raw as Record<string, unknown>
  return {
    capacityBytes: normalizeCapacityBytes(record.capacityBytes),
  }
}

export function clampDataCapacityBytes(value: number): number {
  const rounded =
    Math.round(value / DATA_CAPACITY_STEP_BYTES) * DATA_CAPACITY_STEP_BYTES
  return Math.max(
    DEFAULT_DATA_CAPACITY_BYTES,
    Math.min(DATA_CAPACITY_MAX_BYTES, rounded),
  )
}

export function loadDataCapacityBytes(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_DATA_CAPACITY_BYTES
    }
    return normalizeSettings(JSON.parse(raw)).capacityBytes
  } catch {
    return DEFAULT_DATA_CAPACITY_BYTES
  }
}

export function saveDataCapacityBytes(bytes: number): boolean {
  const current = loadDataCapacityBytes()
  const next = clampDataCapacityBytes(bytes)
  if (next === current) {
    return true
  }
  const serialized = JSON.stringify({ capacityBytes: next } satisfies DataCapacitySettings)
  if (!writeLocalStorageItem(STORAGE_KEY, serialized)) {
    return false
  }
  window.dispatchEvent(new CustomEvent(DATA_CAPACITY_CHANGED_EVENT))
  return true
}
