/**
 * 生成应用数据存储：委托给 App Registry（IndexedDB）。
 * - 同步 API 保留签名兼容，但底层读内存缓存 / 触发异步写入
 * - 首次打开由 generated-app.tsx 先 await hydrate 保证缓存就绪
 * - 写失败的真实错误通过 postMessage 回传 iframe（generated-app.tsx 处理）
 */
import type { GeneratedAppId } from './types.ts'
import { GENERATED_APP_DATA_KEY_PREFIX } from './device-storage.ts'
import {
  applyRegistryBatch,
  createAppRegistry,
  getRegistryCacheSnapshot,
  getRegistryUsedBytesSync,
  hydrateAppRegistry,
  type RegistryBatchFailure,
  type RegistryBatchItem,
} from './app-registry.ts'

export const GENERATED_APP_STORAGE_MESSAGE_TYPE = 'instant-os-app-storage' as const
export const GENERATED_APP_STORAGE_ERROR_MESSAGE_TYPE = 'instant-os-app-storage-error' as const

export type GeneratedAppDataStore = Record<string, string>

export type GeneratedAppStorageMessage = {
  type: typeof GENERATED_APP_STORAGE_MESSAGE_TYPE
  appId: GeneratedAppId
  data: GeneratedAppDataStore
}

export type GeneratedAppStorageErrorMessage = {
  type: typeof GENERATED_APP_STORAGE_ERROR_MESSAGE_TYPE
  appId: GeneratedAppId
  error: 'quota-exceeded' | 'unknown'
  failedKeys: string[]
  previousSnapshot: Record<string, string | undefined>
}

function isStringRecord(value: unknown): value is GeneratedAppDataStore {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }

  return Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'string')
}

/**
 * 同步读内存缓存；未 hydrate 时返回 {} 并触发后台 hydrate
 * （首次打开由 generated-app.tsx 渲染前 await hydrateAppRegistry 保证完整）。
 */
export function loadGeneratedAppData(appId: GeneratedAppId): GeneratedAppDataStore {
  const snapshot = getRegistryCacheSnapshot(appId)
  if (snapshot !== undefined) {
    return snapshot
  }
  void hydrateAppRegistry(appId)
  return {}
}

/**
 * 异步保存整份快照（生成应用桥用）：diff 出变更 key 后写入注册表。
 * 返回失败的 key（含写入前旧值），调用方负责回传 iframe。
 */
export async function saveGeneratedAppDataAsync(
  appId: GeneratedAppId,
  data: GeneratedAppDataStore,
): Promise<RegistryBatchFailure[]> {
  if (!isStringRecord(data)) {
    return []
  }

  const snapshot = getRegistryCacheSnapshot(appId) ?? {}
  const writes: RegistryBatchItem[] = []
  const keys = new Set([...Object.keys(snapshot), ...Object.keys(data)])
  for (const key of keys) {
    const next = data[key]
    const previous = snapshot[key]
    if (next === previous) {
      continue
    }
    writes.push(next === undefined ? { key, value: undefined } : { key, text: next })
  }

  if (writes.length === 0) {
    return []
  }

  return applyRegistryBatch(appId, writes)
}

/**
 * 同步保存整份快照（兼容旧调用点签名）：立即应用内存变更并触发异步落盘。
 * 真实错误通过 postMessage 回传（generated-app.tsx），返回 true 表示已接收。
 */
export function saveGeneratedAppData(appId: GeneratedAppId, data: GeneratedAppDataStore): boolean {
  if (!isStringRecord(data)) {
    return false
  }
  void saveGeneratedAppDataAsync(appId, data).then((failures) => {
    if (failures.length > 0) {
      console.error(`[app-registry] 生成应用数据写入失败：${appId}`, failures)
    }
  })
  return true
}

/** 清除应用命名空间：同步清内存，异步清 IndexedDB。返回 Promise 便于调用方等待落盘完成。 */
export function clearGeneratedAppData(appId: GeneratedAppId): Promise<void> {
  return createAppRegistry(appId).clear()
}

/** 同步读内存字节；未 hydrate 返回 0（配额预检 / 统计用） */
export function getGeneratedAppDataBytes(appId: GeneratedAppId): number {
  return getRegistryUsedBytesSync(appId)
}

export function isGeneratedAppStorageMessage(value: unknown): value is GeneratedAppStorageMessage {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }

  const message = value as Record<string, unknown>
  return (
    message.type === GENERATED_APP_STORAGE_MESSAGE_TYPE &&
    typeof message.appId === 'string' &&
    message.appId.startsWith('gen:') &&
    isStringRecord(message.data)
  )
}

export function isGeneratedAppStorageErrorMessage(
  value: unknown,
): value is GeneratedAppStorageErrorMessage {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }

  const message = value as Record<string, unknown>
  return (
    message.type === GENERATED_APP_STORAGE_ERROR_MESSAGE_TYPE &&
    typeof message.appId === 'string' &&
    message.appId.startsWith('gen:') &&
    (message.error === 'quota-exceeded' || message.error === 'unknown') &&
    Array.isArray(message.failedKeys) &&
    message.failedKeys.every((key) => typeof key === 'string') &&
    typeof message.previousSnapshot === 'object' &&
    message.previousSnapshot !== null
  )
}

/** localStorage 旧键前缀（迁移后仅用于设置页清理旧键展示） */
export function listLegacyGeneratedAppDataKeys(): string[] {
  const keys: string[] = []
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(GENERATED_APP_DATA_KEY_PREFIX)) {
        keys.push(key)
      }
    }
  } catch {
    return []
  }
  return keys
}
