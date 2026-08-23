/**
 * 应用注册表（App Registry）公共 API。
 *
 * - 每个应用一个命名空间（createAppRegistry(appId)），只能读写自己的键
 * - 粗粒度按需 hydrate：首次访问某应用的任意 key 时整包读入内存
 * - 同步内存缓存 + 异步 IndexedDB 落盘（写失败回滚内存并抛错）
 * - 配额计入数据空间总上限（core IndexedDB + 文件 + 注册表合计），无单应用封顶
 * - 值仍是字符串，valueType 区分 text / json；旧记录缺省为 untyped
 * - gen: 命名空间 hydrate 时把 untyped 惰性打成 text
 * - createGlobalRegistry() 仅供注册表应用：可读 / 写 / 删任意命名空间
 */
import {
  entryValueType,
  registryDbClearApp,
  registryDbDelete,
  registryDbGet,
  registryDbGetBytesByApp,
  registryDbListApps,
  registryDbListEntries,
  registryDbPut,
  utf8ByteLength,
  type RegistryEntry,
  type RegistryStoredValueType,
  type RegistryValueType,
} from './app-registry-db.ts'
import {
  getDataCapacityBytes,
  getCombinedDataStorageBytes,
} from './device-data-storage.ts'
import { formatStorageSize } from './format-storage-size.ts'

export type { RegistryStoredValueType, RegistryValueType } from './app-registry-db.ts'

export const APP_REGISTRY_CHANGED_EVENT = 'instant-os:app-registry-changed'

let dataCapacityOverride: number | undefined

export function __setRegistryDataCapacityForTest(bytes: number | undefined): void {
  dataCapacityOverride = bytes
}

function registryDataCapacityBytes(): number {
  return dataCapacityOverride ?? getDataCapacityBytes()
}

export class RegistryQuotaExceededError extends Error {
  constructor(appId: string) {
    super(`数据空间已满（${formatStorageSize(registryDataCapacityBytes())} 上限）：${appId}`)
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

export class RegistryTypeError extends Error {
  constructor(appId: string, key: string, actual: RegistryValueType) {
    super(`注册表键不是 JSON 类型：${appId} / ${key}（${actual}）`)
    this.name = 'RegistryTypeError'
  }
}

type CacheEntry = {
  raw: string
  valueType: RegistryValueType
}

type AppCache = Map<string, CacheEntry>

const cache = new Map<string, AppCache>()
const hydrated = new Set<string>()
const hydratePromises = new Map<string, Promise<void>>()

function cacheEntryFromRecord(entry: RegistryEntry): CacheEntry {
  return { raw: entry.value, valueType: entryValueType(entry) }
}

function emitAppRegistryChanged(appId: string): void {
  if (typeof window === 'undefined') {
    return
  }
  window.dispatchEvent(new CustomEvent(APP_REGISTRY_CHANGED_EVENT, { detail: { appId } }))
}

export function subscribeAppRegistryChanged(listener: (appId: string) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }
  const handler = (event: Event) => {
    const appId = (event as CustomEvent<{ appId?: string }>).detail?.appId
    if (typeof appId === 'string' && appId.length > 0) {
      listener(appId)
    }
  }
  window.addEventListener(APP_REGISTRY_CHANGED_EVENT, handler)
  return () => window.removeEventListener(APP_REGISTRY_CHANGED_EVENT, handler)
}

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
    const map = new Map<string, CacheEntry>()
    const retagGenerated = appId.startsWith('gen:')
    for (const entry of entries) {
      const type = entryValueType(entry)
      if (retagGenerated && type === 'untyped') {
        map.set(entry.key, { raw: entry.value, valueType: 'text' })
        await registryDbPut(appId, entry.key, entry.value, 'text', entry.updatedAt)
        continue
      }
      map.set(entry.key, cacheEntryFromRecord(entry))
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
  for (const entry of map.values()) {
    total += utf8ByteLength(entry.raw)
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
  for (const [key, entry] of map) {
    snapshot[key] = entry.raw
  }
  return snapshot
}

/** 同步读带类型的内存快照；未 hydrate 返回 undefined */
export function getRegistryCacheEntries(
  appId: string,
): Record<string, CacheEntry> | undefined {
  const map = cache.get(appId)
  if (!map) {
    return undefined
  }
  const snapshot: Record<string, CacheEntry> = {}
  for (const [key, entry] of map) {
    snapshot[key] = { ...entry }
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
  dataCapacityOverride = undefined
}

async function assertFitsDataCapacity(appId: string, projectedAppBytes: number): Promise<void> {
  const byApp = await registryDbGetBytesByApp()
  let registryOthers = 0
  for (const [id, bytes] of Object.entries(byApp)) {
    if (id !== appId) {
      registryOthers += bytes
    }
  }
  let combined = 0
  try {
    combined = await getCombinedDataStorageBytes()
  } catch {
    combined = 0
  }
  if (registryOthers + projectedAppBytes + combined > registryDataCapacityBytes()) {
    throw new RegistryQuotaExceededError(appId)
  }
}

/** 生成应用 iframe：当前应用已用 + 数据空间剩余 */
export async function getRegistryWriteLimitBytes(appId: string): Promise<number> {
  const used = getRegistryUsedBytesSync(appId)
  const byApp = await registryDbGetBytesByApp()
  let registryOthers = 0
  for (const [id, bytes] of Object.entries(byApp)) {
    if (id !== appId) {
      registryOthers += bytes
    }
  }
  let combined = 0
  try {
    combined = await getCombinedDataStorageBytes()
  } catch {
    combined = 0
  }
  const remaining = Math.max(
    0,
    registryDataCapacityBytes() - combined - registryOthers - used,
  )
  return used + remaining
}

function stringifyJson(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined
  }
  const encoded = JSON.stringify(value)
  return encoded === undefined ? undefined : encoded
}

async function writeRaw(
  appId: string,
  key: string,
  value: string,
  valueType: RegistryStoredValueType,
): Promise<void> {
  const map = requireHydrated(appId)
  const previous = map.get(key)
  const projected =
    usedBytesOfMap(map) - utf8ByteLength(previous?.raw ?? '') + utf8ByteLength(value)
  try {
    await assertFitsDataCapacity(appId, projected)
  } catch (error) {
    if (error instanceof RegistryQuotaExceededError) {
      throw error
    }
    throw new RegistryWriteError(appId, key, error)
  }

  const next: CacheEntry = { raw: value, valueType }
  map.set(key, next)
  try {
    await registryDbPut(appId, key, value, valueType)
    emitAppRegistryChanged(appId)
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
}

async function deleteKey(appId: string, key: string): Promise<void> {
  const map = requireHydrated(appId)
  if (!map.has(key)) {
    return
  }
  const previous = map.get(key)
  map.delete(key)
  try {
    await registryDbDelete(appId, key)
    emitAppRegistryChanged(appId)
  } catch (error) {
    const restored = await registryDbGet(appId, key).catch(() => undefined)
    if (restored) {
      map.set(key, cacheEntryFromRecord(restored))
    } else if (previous) {
      map.set(key, previous)
    }
    throw new RegistryWriteError(appId, key, error)
  }
}

export type AppRegistry = {
  getText(key: string): Promise<string | undefined>
  /** 失败时抛 RegistryQuotaExceededError / RegistryWriteError */
  setText(key: string, value: string): Promise<void>
  getJson(key: string): Promise<unknown>
  /** 失败时抛 RegistryQuotaExceededError / RegistryWriteError；undefined 删除该键 */
  setJson(key: string, value: unknown): Promise<void>
  getType(key: string): Promise<RegistryValueType | undefined>
  /** 保留 raw，仅改类型标签（内部应用字段惰性打标） */
  retag(key: string, valueType: RegistryStoredValueType): Promise<void>
  removeItem(key: string): Promise<void>
  keys(): Promise<string[]>
  clear(): Promise<void>
  usedBytesSync(): number
  snapshotSync(): Record<string, string> | undefined
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
    async getText(key) {
      assertKey(key)
      await hydrateAppRegistry(appId)
      return requireHydrated(appId).get(key)?.raw
    },

    async setText(key, value) {
      assertKey(key)
      if (typeof value !== 'string') {
        throw new TypeError('注册表 value 必须为 string')
      }
      await hydrateAppRegistry(appId)
      await writeRaw(appId, key, value, 'text')
    },

    async getJson(key) {
      assertKey(key)
      await hydrateAppRegistry(appId)
      const entry = requireHydrated(appId).get(key)
      if (!entry) {
        return undefined
      }
      if (entry.valueType !== 'json') {
        throw new RegistryTypeError(appId, key, entry.valueType)
      }
      return JSON.parse(entry.raw) as unknown
    },

    async setJson(key, value) {
      assertKey(key)
      await hydrateAppRegistry(appId)
      const encoded = stringifyJson(value)
      if (encoded === undefined) {
        await deleteKey(appId, key)
        return
      }
      await writeRaw(appId, key, encoded, 'json')
    },

    async getType(key) {
      assertKey(key)
      await hydrateAppRegistry(appId)
      return requireHydrated(appId).get(key)?.valueType
    },

    async retag(key, valueType) {
      assertKey(key)
      await hydrateAppRegistry(appId)
      const map = requireHydrated(appId)
      const entry = map.get(key)
      if (!entry || entry.valueType === valueType) {
        return
      }
      const next: CacheEntry = { raw: entry.raw, valueType }
      map.set(key, next)
      try {
        await registryDbPut(appId, key, entry.raw, valueType, Date.now())
      } catch (error) {
        map.set(key, entry)
        throw new RegistryWriteError(appId, key, error)
      }
    },

    async removeItem(key) {
      assertKey(key)
      await hydrateAppRegistry(appId)
      await deleteKey(appId, key)
    },

    async keys() {
      await hydrateAppRegistry(appId)
      return Array.from(requireHydrated(appId).keys())
    },

    async clear() {
      await hydrateAppRegistry(appId)
      cache.set(appId, new Map())
      await registryDbClearApp(appId)
      emitAppRegistryChanged(appId)
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

export type RegistryBatchItem =
  | { key: string; value: undefined }
  | { key: string; text: string }
  | { key: string; json: unknown }

export type RegistryBatchFailure = {
  key: string
  previous: string | undefined
  error: RegistryQuotaExceededError | RegistryWriteError
}

function batchNextRaw(item: RegistryBatchItem): {
  raw: string | undefined
  valueType: RegistryStoredValueType
} {
  if ('text' in item) {
    return { raw: item.text, valueType: 'text' }
  }
  if ('json' in item) {
    return { raw: stringifyJson(item.json), valueType: 'json' }
  }
  return { raw: undefined, valueType: 'text' }
}

/**
 * 批量应用一个应用的变更（生成应用桥 / 字段 store 用）。
 * 逐 key 顺序应用：配额预检基于当前内存态，某个 key 失败不影响后续 key 继续写入；
 * 失败的 key 回滚内存旧值并返回，调用方负责把错误回传给写入方。
 */
export async function applyRegistryBatch(
  appId: string,
  items: RegistryBatchItem[],
): Promise<RegistryBatchFailure[]> {
  await hydrateAppRegistry(appId)
  const map = requireHydrated(appId)

  const previousByKey = new Map<string, CacheEntry | undefined>()
  for (const item of items) {
    previousByKey.set(item.key, map.get(item.key))
  }

  const failures: RegistryBatchFailure[] = []
  for (const item of items) {
    const previous = previousByKey.get(item.key)
    const next = batchNextRaw(item)
    const newBytes =
      usedBytesOfMap(map) -
      utf8ByteLength(previous?.raw ?? '') +
      utf8ByteLength(next.raw ?? '')
    try {
      await assertFitsDataCapacity(appId, newBytes)
    } catch (error) {
      if (error instanceof RegistryQuotaExceededError) {
        failures.push({
          key: item.key,
          previous: previous?.raw,
          error,
        })
        continue
      }
      failures.push({
        key: item.key,
        previous: previous?.raw,
        error: new RegistryWriteError(appId, item.key, error),
      })
      continue
    }

    if (next.raw === undefined) {
      map.delete(item.key)
    } else {
      map.set(item.key, { raw: next.raw, valueType: next.valueType })
    }

    try {
      if (next.raw === undefined) {
        await registryDbDelete(appId, item.key)
      } else {
        await registryDbPut(appId, item.key, next.raw, next.valueType)
      }
    } catch (error) {
      if (previous === undefined) {
        map.delete(item.key)
      } else {
        map.set(item.key, previous)
      }
      failures.push({
        key: item.key,
        previous: previous?.raw,
        error: new RegistryWriteError(appId, item.key, error),
      })
    }
  }

  if (failures.length < items.length) {
    emitAppRegistryChanged(appId)
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
  listNamespaces(): Promise<GlobalNamespaceInfo[]>
  listNamespaceEntries(appId: string): Promise<RegistryEntry[]>
  getItem(appId: string, key: string): Promise<string | undefined>
  setText(appId: string, key: string, value: string): Promise<void>
  setJson(appId: string, key: string, value: unknown): Promise<void>
  removeItem(appId: string, key: string): Promise<void>
  clearNamespace(appId: string): Promise<void>
  bytesByApp(): Promise<Record<string, number>>
}

function assertRegistryKey(key: string): void {
  if (typeof key !== 'string') {
    throw new TypeError('注册表 key 必须为 string')
  }
}

/**
 * 注册表应用专用：可读 / 写 / 删任意命名空间。
 * 写入走 hydrate + writeRaw，与目标应用的内存缓存保持一致。
 */
export function createGlobalRegistry(): GlobalRegistry {
  const invalidateMemory = (appId: string): void => {
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
      await hydrateAppRegistry(appId)
      return registryDbListEntries(appId)
    },

    async getItem(appId, key) {
      const entry = await registryDbGet(appId, key)
      return entry?.value
    },

    async setText(appId, key, value) {
      assertRegistryKey(key)
      if (typeof value !== 'string') {
        throw new TypeError('注册表 value 必须为 string')
      }
      await hydrateAppRegistry(appId)
      await writeRaw(appId, key, value, 'text')
    },

    async setJson(appId, key, value) {
      assertRegistryKey(key)
      await hydrateAppRegistry(appId)
      const encoded = stringifyJson(value)
      if (encoded === undefined) {
        await deleteKey(appId, key)
        return
      }
      await writeRaw(appId, key, encoded, 'json')
    },

    async removeItem(appId, key) {
      await registryDbDelete(appId, key)
      invalidateMemory(appId)
      emitAppRegistryChanged(appId)
    },

    async clearNamespace(appId) {
      await registryDbClearApp(appId)
      invalidateMemory(appId)
      emitAppRegistryChanged(appId)
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
