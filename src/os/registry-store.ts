/**
 * 内置应用注册表存储助手：把「单 key JSON 存储」的应用存储模块统一改造成
 * 异步注册表 API + 订阅（subscribeXxxStore / readXxxStore / writeXxxStore 模式）。
 *
 * 支持两种模式：
 *
 * 1. 多 key 字段模式（推荐）：通过 fields 把应用的顶层字段映射为独立 registry key。
 *    - 每个字段独立读写，写时 diff 只落变化字段。
 *    - 注册表管理器可直接看到字段级 key，而非一个巨大的 store blob。
 *    ```
 *    const store = createRegistryStore<WeatherStore>({
 *      appId: 'weather',
 *      defaultValue: emptyStore,
 *      fields: [
 *        { key: 'cities', read: s => s.cities, write: (v, d) => ({ ...d, cities: v }),
 *          serialize: JSON.stringify, deserialize: raw => raw ? normalizeCities(JSON.parse(raw)) : [] },
 *        { key: 'activeCityId', read: s => s.activeCityId, write: (v, d) => ({ ...d, activeCityId: v }),
 *          serialize: v => v ?? '', deserialize: raw => raw || undefined },
 *      ],
 *      changedEventName: 'instant-os:weather-store-changed',
 *    })
 *    ```
 *
 * 2. 单 key 兼容模式（旧签名）：整份 store 序列化到一个 key（如 'store'）。
 *    ```
 *    const store = createRegistryStore<T>({ appId, key: 'store', serialize, deserialize, changedEventName })
 *    ```
 */
import {
  applyRegistryBatch,
  createAppRegistry,
  isRegistryHydrated,
  type RegistryBatchItem,
} from './app-registry.ts'

export type RegistryStoreOptions<T> =
  | {
      appId: string
      /** 兼容模式：整份 store 序列化到单个 key */
      key: string
      serialize: (store: T) => string
      deserialize: (raw: string | undefined) => T
      changedEventName?: string
    }
  | {
      appId: string
      /** 字段模式的拖底默认值（缺失字段 / 空数据时使用） */
      defaultValue: () => T
      fields: RegistryField<T, any>[]
      /** 旧版单 key（默认 'store'）存在时，首次访问自动按字段拆分迁移 */
      legacyKey?: string
      /** 合并所有字段后的整体归一化（用于跨字段不变量，如 activeCityId 必须在 cities 中） */
      finalize?: (store: T) => T
      changedEventName?: string
    }

/**
 * 多 key 模式下单个字段的映射定义：
 * - read：从完整 store 中取出该字段值
 * - write：把该字段值写回一份新的 store
 * - serialize / deserialize：字段值与 registry 字符串之间的转换
 */
export type RegistryField<T, V> = {
  key: string
  read: (store: T) => V
  write: (value: V, current: T) => T
  serialize: (value: V) => string
  deserialize: (raw: string | undefined) => V
}

export type RegistryStore<T> = {
  subscribe: (listener: () => void) => () => void
  read: () => Promise<T>
  write: (store: T) => Promise<void>
  /**
   * 同步读内存缓存（未 hydrate 或写入尚未完成时可能滞后）。
   * 仅用于「启动早期兜底展示」，常规路径一律用异步 read。
   */
  readSync: () => T | undefined
  hydrate: () => Promise<void>
  isHydrated: () => boolean
  /** 当前已落盘的字段 key 列表（管理 / 调试用） */
  keys: () => Promise<string[]>
}

function isFieldMode<T>(
  options: RegistryStoreOptions<T>,
): options is Extract<RegistryStoreOptions<T>, { fields: RegistryField<T, any>[] }> {
  return 'fields' in options
}

const LEGACY_FALLBACK_KEY = 'store'

export function createRegistryStore<T>(options: RegistryStoreOptions<T>): RegistryStore<T> {
  if (isFieldMode(options)) {
    return createFieldRegistryStore(options)
  }
  return createLegacyRegistryStore(options)
}

/**
 * 字段模式：整份 store 以顶层字段拆分到多个 registry key 存储。
 */
function createFieldRegistryStore<T>(
  options: Extract<RegistryStoreOptions<T>, { fields: RegistryField<T, any>[] }>,
): RegistryStore<T> {
  const { appId, fields, defaultValue, changedEventName, finalize } = options
  const legacyKey = options.legacyKey ?? LEGACY_FALLBACK_KEY
  const registry = createAppRegistry(appId)
  const listeners = new Set<() => void>()

  function notify(): void {
    for (const listener of listeners) {
      listener()
    }
    if (changedEventName && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(changedEventName))
    }
  }

  /** 从内存快照合并出完整 store */
  function mergeFromSnapshot(snapshot: Record<string, string> | undefined): T {
    if (!snapshot) {
      return defaultValue()
    }
    let draft = defaultValue()
    for (const field of fields) {
      draft = field.write(field.deserialize(snapshot[field.key]), draft)
    }
    return finalize ? finalize(draft) : draft
  }

  /**
   * 迁移旧版单 key 数据：若存在 legacyKey 且没有任何字段 key，则按字段拆分写入，
   * 全部成功后删除 legacyKey。幂等：字段 key 已存在或有写入失败则跳过/保留旧 key。
   */
  async function runLegacyMigration(): Promise<void> {
    if (!isRegistryHydrated(appId)) {
      await registry.hydrate()
    }
    const snapshot = registry.snapshotSync()
    if (!snapshot) {
      return
    }
    const anyFieldKey = fields.some((field) => snapshot[field.key] !== undefined)
    if (anyFieldKey) {
      return
    }
    const raw = snapshot[legacyKey]
    if (raw === undefined) {
      return
    }

    let legacy: unknown
    try {
      legacy = JSON.parse(raw)
    } catch {
      return
    }
    const isArray = Array.isArray(legacy)
    if ((!isArray && typeof legacy !== 'object') || legacy === null) {
      return
    }

    const merged: T = isArray
      ? (legacy as T)
      : ({ ...defaultValue(), ...(legacy as Record<string, unknown>) } as T)
    const writes: RegistryBatchItem[] = []
    for (const field of fields) {
      writes.push({ key: field.key, value: field.serialize(field.read(merged)) })
    }
    if (writes.length === 0) {
      return
    }

    const failures = await applyRegistryBatch(appId, writes)
    if (failures.length > 0) {
      return
    }
    await registry.removeItem(legacyKey)
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async read() {
      await registry.hydrate()
      await runLegacyMigration()
      return mergeFromSnapshot(registry.snapshotSync())
    },

    async write(store: T) {
      await registry.hydrate()
      await runLegacyMigration()
      const snapshot = registry.snapshotSync() ?? {}
      const writes: RegistryBatchItem[] = []
      for (const field of fields) {
        const serialized = field.serialize(field.read(store))
        if (snapshot[field.key] !== serialized) {
          writes.push({ key: field.key, value: serialized })
        }
      }
      if (writes.length === 0) {
        return
      }
      const failures = await applyRegistryBatch(appId, writes)
      if (failures.length > 0) {
        throw failures[0].error
      }
      notify()
    },

    readSync() {
      if (!isRegistryHydrated(appId)) {
        return undefined
      }
      return mergeFromSnapshot(registry.snapshotSync())
    },

    async hydrate() {
      await registry.hydrate()
      await runLegacyMigration()
    },

    isHydrated() {
      return isRegistryHydrated(appId)
    },

    async keys() {
      await registry.hydrate()
      await runLegacyMigration()
      const snapshot = registry.snapshotSync() ?? {}
      return fields.map((field) => field.key).filter((key) => snapshot[key] !== undefined)
    },
  }
}

/**
 * 兼容模式：整份 store 序列化到单个 key（旧签名）。
 */
function createLegacyRegistryStore<T>(
  options: Extract<RegistryStoreOptions<T>, { key: string }>,
): RegistryStore<T> {
  const { appId, key, serialize, deserialize, changedEventName } = options
  const registry = createAppRegistry(appId)
  const listeners = new Set<() => void>()

  function notify(): void {
    for (const listener of listeners) {
      listener()
    }
    if (changedEventName && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(changedEventName))
    }
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async read() {
      const raw = await registry.getItem(key)
      return deserialize(raw)
    },

    async write(store: T) {
      await registry.setItem(key, serialize(store))
      notify()
    },

    readSync() {
      if (!isRegistryHydrated(appId)) {
        return undefined
      }
      const snapshot = registry.snapshotSync()
      return snapshot ? deserialize(snapshot[key]) : undefined
    },

    async hydrate() {
      await registry.hydrate()
    },

    isHydrated() {
      return isRegistryHydrated(appId)
    },

    async keys() {
      await registry.hydrate()
      const snapshot = registry.snapshotSync() ?? {}
      return snapshot[key] !== undefined ? [key] : []
    },
  }
}
