/**
 * 应用注册表（App Registry）公共 API。
 *
 * - 每个应用一个命名空间（createAppRegistry(appId)），只能读写自己的键
 * - 粗粒度按需 hydrate：首次访问某应用的任意 key 时整包读入内存
 * - 同步内存缓存 + 异步 IndexedDB 落盘（写失败回滚内存并抛错）
 * - 单应用 5 MB 配额（与 localStorage 设备容量一致）
 * - createGlobalRegistry() 仅供注册表管理面板：可读 / 删任意命名空间，不允许写入
 */
import {
  registryDbClearApp,
  registryDbDelete,
  registryDbGet,
  registryDbGetBytesByApp,
  registryDbListApps,
  registryDbListEntries,
  registryDbPut,
  utf8ByteLength,
  type RegistryEntry,
} from './app-registry-db.ts'

export const APP_REGISTRY_QUOTA_BYTES = 5 * 1024 * 1024

export class RegistryQuotaExceededError extends Error {
  constructor(appId: string) {
    super(`应用数据超出配额（5 MB 上限）：${appId}`)
    this.name = 'RegistryQuotaExceededError'
  }
}

export class RegistryWriteError extends Error {
  constructor(appId: string, key: string, cause?: unknown) {
    super(`注册表写入失败：${appId} / ${key}`)
    this.name = 'RegistryWriteError'
    if (cause !== undefined) {
      this.cause = cause
    }
  }
}

type AppCache = Map<string, string>

const cache = new Map<string, AppCache>()
const hydrated = new Set<string>()
const hydratePromises = new Map<string, Promise<void>>()

export async function hydrateAppRegistry(appId: string): Promise<void> {
  if (hydrated.has(appId)) {
    return
  }
  const existing = hydratePromises.get(appId)
  if (existing) {
    return existing
  }

  const promise = (async () => {
    const entries = await registryDbListEntries(appId)
    const map = new Map<string, string>()
    for (const entry of entries) {
      map.set(entry.key, entry.value)
    }
    cache.set(appId, map)
    hydrated.add(appId)
  })()

  hydratePromises.set(appId, promise)
  try {
    await promise
  } finally {
    hydratePromises.delete(appId)
  }
}

function requireHydrated(appId: string): AppCache {
  if (!hydrated.has(appId)) {
    throw new Error(`注册表命名空间未 hydrate：${appId}`)
  }
  return cache.get(appId)!
}

function usedBytesOfMap(map: AppCache): number {
  let total = 0
  for (const value of map.values()) {
    total += utf8ByteLength(value)
  }
  return total
}

/** 同步读内存快照；未 hydrate 返回 undefined（生成应用桥 / 统计用） */
export function getRegistryCacheSnapshot(appId: string): Record<string, string> | undefined {
  const map = cache.get(appId)
  if (!map) {
    return undefined
  }
  const snapshot: Record<string, string> = {}
  for (const [key, value] of map) {
    snapshot[key] = value
  }
  return snapshot
}

/** 同步读内存字节；未 hydrate 返回 0（生成应用配额预检注入用） */
export function getRegistryUsedBytesSync(appId: string): number {
  const map = cache.get(appId)
  return map ? usedBytesOfMap(map) : 0
}

/** 是否已 hydrate（统计页避免重复触发） */
export function isRegistryHydrated(appId: string): boolean {
  return hydrated.has(appId)
}

/** 测试用：清空内存缓存与 hydrate 状态（不触碰 IndexedDB） */
export function __resetRegistryCacheForTest(): void {
  cache.clear()
  hydrated.clear()
  hydratePromises.clear()
}

export type AppRegistry = {
  getItem(key: string): Promise<string | undefined>
  /** 失败时抛 RegistryQuotaExceededError / RegistryWriteError */
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
  keys(): Promise<string[]>
  clear(): Promise<void>
  /** 内存缓存当前字节（不触发 IndexedDB） */
  usedBytesSync(): number
  /** 内存快照（未 hydrate 返回 undefined） */
  snapshotSync(): Record<string, string> | undefined
  /** 强制 hydrate（幂等） */
  hydrate(): Promise<void>
}

export function createAppRegistry(appId: string): AppRegistry {
  if (!appId) {
    throw new Error('注册表 appId 不能为空')
  }

  const assertKey = (key: string): void => {
    if (typeof key !== 'string') {
      throw new TypeError('注册表 key 必须为 string')
    }
  }

  return {
    async getItem(key) {
      assertKey(key)
      await hydrateAppRegistry(appId)
      const map = requireHydrated(appId)
      return map.has(key) ? map.get(key) : undefined
    },

    async setItem(key, value) {
      assertKey(key)
      if (typeof value !== 'string') {
        throw new TypeError('注册表 value 必须为 string')
      }
      await hydrateAppRegistry(appId)
      const map = requireHydrated(appId)

      const previous = map.get(key)
      const projected =
        usedBytesOfMap(map) - utf8ByteLength(previous ?? '') + utf8ByteLength(value)
      if (projected > APP_REGISTRY_QUOTA_BYTES) {
        throw new RegistryQuotaExceededError(appId)
      }

      map.set(key, value)
      try {
        await registryDbPut(appId, key, value)
      } catch (error) {
        if (previous === undefined) {
          map.delete(key)
        } else {
          map.set(key, previous)
        }
        if (error instanceof RegistryQuotaExceededError) {
          throw error
        }
        throw new RegistryWriteError(appId, key, error)
      }
    },

    async removeItem(key) {
      assertKey(key)
      await hydrateAppRegistry(appId)
      const map = requireHydrated(appId)
      if (!map.has(key)) {
        return
      }
      map.delete(key)
      try {
        await registryDbDelete(appId, key)
      } catch (error) {
        // 删除失败时恢复内存；应用数据仍在，最坏情况是重复出现
        const raw = await registryDbGet(appId, key).catch(() => undefined)
        if (raw !== undefined) {
          map.set(key, raw)
        }
        throw new RegistryWriteError(appId, key, error)
      }
    },

    async keys() {
      await hydrateAppRegistry(appId)
      const map = requireHydrated(appId)
      return Array.from(map.keys())
    },

    async clear() {
      await hydrateAppRegistry(appId)
      // 先同步清空内存（后续 hydrate 短路，不会读回旧数据），再异步清 IndexedDB
      cache.set(appId, new Map())
      await registryDbClearApp(appId)
    },

    usedBytesSync() {
      return getRegistryUsedBytesSync(appId)
    },

    snapshotSync() {
      return getRegistryCacheSnapshot(appId)
    },

    hydrate() {
      return hydrateAppRegistry(appId)
    },
  }
}

export type RegistryBatchItem = {
  key: string
  /** undefined 表示删除该 key */
  value: string | undefined
}

export type RegistryBatchFailure = {
  key: string
  previous: string | undefined
  error: RegistryQuotaExceededError | RegistryWriteError
}

/**
 * 批量应用一个应用的变更（生成应用桥用）。
 * 逐 key 顺序应用：配额预检基于当前内存态，某个 key 失败不影响后续 key 继续写入；
 * 失败的 key 回滚内存旧值并返回，调用方负责把错误回传给写入方。
 */
export async function applyRegistryBatch(
  appId: string,
  items: RegistryBatchItem[],
): Promise<RegistryBatchFailure[]> {
  await hydrateAppRegistry(appId)
  const map = requireHydrated(appId)

  const previousByKey = new Map<string, string | undefined>()
  for (const item of items) {
    previousByKey.set(item.key, map.get(item.key))
  }

  const failures: RegistryBatchFailure[] = []
  for (const item of items) {
    const previous = previousByKey.get(item.key)
    const isDelete = item.value === undefined
    const newBytes =
      usedBytesOfMap(map) -
      utf8ByteLength(previous ?? '') +
      utf8ByteLength(item.value ?? '')
    if (newBytes > APP_REGISTRY_QUOTA_BYTES) {
      failures.push({
        key: item.key,
        previous,
        error: new RegistryQuotaExceededError(appId),
      })
      continue
    }

    if (isDelete) {
      map.delete(item.key)
    } else {
      map.set(item.key, item.value!)
    }

    try {
      if (isDelete) {
        await registryDbDelete(appId, item.key)
      } else {
        await registryDbPut(appId, item.key, item.value!)
      }
    } catch (error) {
      if (previous === undefined) {
        map.delete(item.key)
      } else {
        map.set(item.key, previous)
      }
      failures.push({
        key: item.key,
        previous,
        error: new RegistryWriteError(appId, item.key, error),
      })
    }
  }

  return failures
}

export type GlobalNamespaceInfo = {
  appId: string
  bytes: number
  keyCount: number
  updatedAt: number
}

export type GlobalRegistry = {
  /** 全部命名空间（只含非空命名空间）概要 */
  listNamespaces(): Promise<GlobalNamespaceInfo[]>
  /** 某命名空间全部条目（管理面板逐 key 查看） */
  listNamespaceEntries(appId: string): Promise<RegistryEntry[]>
  getItem(appId: string, key: string): Promise<string | undefined>
  removeItem(appId: string, key: string): Promise<void>
  clearNamespace(appId: string): Promise<void>
  bytesByApp(): Promise<Record<string, number>>
}

/**
 * 注册表管理面板专用：可读 / 删任意命名空间，不允许写入（避免破坏应用数据）。
 */
export function createGlobalRegistry(): GlobalRegistry {
  const invalidateMemory = (appId: string): void => {
    // 管理面板删除后，若该应用已 hydrate，同步内存态避免陈旧数据
    if (hydrated.has(appId)) {
      cache.delete(appId)
      hydrated.delete(appId)
    }
  }

  return {
    async listNamespaces() {
      const apps = await registryDbListApps()
      const namespaces: GlobalNamespaceInfo[] = []
      for (const appId of apps) {
        const entries = await registryDbListEntries(appId)
        let bytes = 0
        let latest = 0
        for (const entry of entries) {
          bytes += utf8ByteLength(entry.value)
          if (entry.updatedAt > latest) {
            latest = entry.updatedAt
          }
        }
        namespaces.push({ appId, bytes, keyCount: entries.length, updatedAt: latest })
      }
      return namespaces
    },

    async listNamespaceEntries(appId) {
      return registryDbListEntries(appId)
    },

    async getItem(appId, key) {
      return registryDbGet(appId, key)
    },

    async removeItem(appId, key) {
      await registryDbDelete(appId, key)
      invalidateMemory(appId)
    },

    async clearNamespace(appId) {
      await registryDbClearApp(appId)
      invalidateMemory(appId)
    },

    async bytesByApp() {
      const byApp = await registryDbGetBytesByApp()
      for (const appId of hydrated) {
        const map = cache.get(appId)
        if (map) {
          byApp[appId] = usedBytesOfMap(map)
        }
      }
      return byApp
    },
  }
}
