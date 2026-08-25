/**
 * 内置应用注册表存储助手：把「单 key JSON 存储」的应用存储模块统一改造成
 * 异步注册表 API + 订阅（subscribeXxxStore / readXxxStore / writeXxxStore 模式）。
 *
 * 支持两种模式：
 *
 * 1. 多 key 字段模式（推荐）：通过 fields 把应用的顶层字段映射为独立 registry key。
 *    - 每个字段独立读写，写时 diff 只落变化字段。
 *    - 文本字段走 setText；JSON 字段走 setJson（normalize 接收已 parse 的值）。
 *    ```
 *    const store = createRegistryStore<WeatherStore>({
 *      appId: 'weather',
 *      defaultValue: emptyStore,
 *      fields: [
 *        { key: 'cities', valueType: 'json', read: s => s.cities,
 *          write: (v, d) => ({ ...d, cities: v }),
 *          normalize: raw => normalizeCities(raw) },
 *        { key: 'activeCityId', read: s => s.activeCityId,
 *          write: (v, d) => ({ ...d, activeCityId: v }),
 *          serialize: v => v ?? '', deserialize: raw => raw || undefined },
 *      ],
 *      changedEventName: 'instant-os:weather-store-changed',
 *    })
 *    ```
 *
 * 2. 单 key 兼容模式（旧签名）：整份 store 序列化到一个 key（默认按 JSON 写入）。
 */
import {
  applyRegistryBatch,
  createAppRegistry,
  getRegistryCacheEntries,
  isRegistryHydrated,
  type RegistryBatchItem,
} from './app-registry.ts'

export type RegistryTextField<T, V> = {
  key: string
  valueType?: 'text'
  read: (store: T) => V
  write: (value: V, current: T) => T
  serialize: (value: V) => string
  deserialize: (raw: string | undefined) => V
}

export type RegistryJsonField<T, V> = {
  key: string
  valueType: 'json'
  read: (store: T) => V
  write: (value: V, current: T) => T
  normalize: (raw: unknown) => V
}

export type RegistryField<T, V = unknown> = RegistryTextField<T, V> | RegistryJsonField<T, V>

export type RegistryStoreOptions<T> =
  | {
      appId: string
      key: string
      serialize: (store: T) => string
      deserialize: (raw: string | undefined) => T
      /** 兼容模式默认按 JSON 落盘 */
      valueType?: 'text' | 'json'
      changedEventName?: string
    }
  | {
      appId: string
      defaultValue: () => T
      fields: RegistryField<T, any>[]
      legacyKey?: string
      finalize?: (store: T) => T
      changedEventName?: string
    }

export type RegistryStore<T> = {
  subscribe: (listener: () => void) => () => void
  read: () => Promise<T>
  write: (store: T) => Promise<void>
  readSync: () => T | undefined
  hydrate: () => Promise<void>
  isHydrated: () => boolean
  keys: () => Promise<string[]>
}

function isFieldMode<T>(
  options: RegistryStoreOptions<T>,
): options is Extract<RegistryStoreOptions<T>, { fields: RegistryField<T, any>[] }> {
  return 'fields' in options
}

function isJsonField<T, V>(
  field: RegistryField<T, V>,
): field is RegistryJsonField<T, V> {
  return field.valueType === 'json'
}

function parseJsonRaw(raw: string | undefined): unknown {
  if (raw === undefined || raw === '') {
    return undefined
  }
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

const LEGACY_FALLBACK_KEY = 'store'

export function createRegistryStore<T>(options: RegistryStoreOptions<T>): RegistryStore<T> {
  if (isFieldMode(options)) {
    return createFieldRegistryStore(options)
  }
  return createLegacyRegistryStore(options)
}

function createFieldRegistryStore<T>(
  options: Extract<RegistryStoreOptions<T>, { fields: RegistryField<T, any>[] }>,
): RegistryStore<T> {
  const { appId, fields, defaultValue, changedEventName, finalize } = options
  const legacyKey = options.legacyKey ?? LEGACY_FALLBACK_KEY
  const registry = createAppRegistry(appId)
  const listeners = new Set<() => void>()

  type FieldRawPart = {
    raw: string | undefined
    valueType: string | undefined
  }

  let parsedCache: { parts: FieldRawPart[]; value: T } | undefined

  function notify(): void {
    parsedCache = undefined
    for (const listener of listeners) {
      listener()
    }
    if (changedEventName && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(changedEventName))
    }
  }

  /**
   * 用各字段 raw 字符串的引用做缓存键，禁止把整份 JSON 拼进签名。
   * iCode 的 projects 可达数十 MB；旧实现每次 readSync 都会拷贝并逐字比较，主线程会卡住。
   */
  function fieldRawParts(
    entries: ReturnType<typeof getRegistryCacheEntries>,
  ): FieldRawPart[] {
    return fields.map((field) => {
      const entry = entries?.[field.key]
      return { raw: entry?.raw, valueType: entry?.valueType }
    })
  }

  function fieldRawPartsMatch(left: FieldRawPart[], right: FieldRawPart[]): boolean {
    if (left.length !== right.length) {
      return false
    }
    for (let index = 0; index < left.length; index++) {
      if (left[index].raw !== right[index].raw || left[index].valueType !== right[index].valueType) {
        return false
      }
    }
    return true
  }

  function readMerged(): T {
    const entries = getRegistryCacheEntries(appId)
    const parts = fieldRawParts(entries)
    if (parsedCache && fieldRawPartsMatch(parsedCache.parts, parts)) {
      return parsedCache.value
    }
    const value = mergeFromEntries(entries)
    parsedCache = { parts, value }
    return value
  }

  function mergeFromEntries(
    entries: ReturnType<typeof getRegistryCacheEntries>,
  ): T {
    let draft = defaultValue()
    for (const field of fields) {
      const entry = entries?.[field.key]
      if (isJsonField(field)) {
        draft = field.write(field.normalize(parseJsonRaw(entry?.raw)), draft)
      } else {
        draft = field.write(field.deserialize(entry?.raw), draft)
      }
    }
    return finalize ? finalize(draft) : draft
  }

  function fieldWriteItem<V>(field: RegistryField<T, V>, store: T): RegistryBatchItem | undefined {
    if (isJsonField(field)) {
      const value = field.read(store)
      if (value === undefined) {
        return { key: field.key, value: undefined }
      }
      return { key: field.key, json: value }
    }
    return { key: field.key, text: field.serialize(field.read(store)) }
  }

  function encodedFieldValue<V>(field: RegistryField<T, V>, store: T): string | undefined {
    if (isJsonField(field)) {
      const value = field.read(store)
      if (value === undefined) {
        return undefined
      }
      return JSON.stringify(value)
    }
    return field.serialize(field.read(store))
  }

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
      const item = fieldWriteItem(field, merged)
      if (item && !('value' in item && item.value === undefined)) {
        writes.push(item)
      }
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

  async function retagFieldTypes(): Promise<void> {
    const entries = getRegistryCacheEntries(appId) ?? {}
    for (const field of fields) {
      const entry = entries[field.key]
      if (!entry) {
        continue
      }
      if (isJsonField(field)) {
        if (entry.raw === '') {
          await registry.removeItem(field.key)
          continue
        }
        if (entry.valueType !== 'json') {
          await registry.retag(field.key, 'json')
        }
        continue
      }
      if (entry.valueType !== 'text') {
        await registry.retag(field.key, 'text')
      }
    }
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async read() {
      await registry.hydrate()
      await runLegacyMigration()
      await retagFieldTypes()
      return readMerged()
    },

    async write(store: T) {
      await registry.hydrate()
      await runLegacyMigration()
      const snapshot = registry.snapshotSync() ?? {}
      const previous = parsedCache?.value
      const writes: RegistryBatchItem[] = []
      for (const field of fields) {
        if (previous !== undefined && field.read(store) === field.read(previous)) {
          continue
        }
        const encoded = encodedFieldValue(field, store)
        if (snapshot[field.key] === encoded) {
          continue
        }
        const item = fieldWriteItem(field, store)
        if (item) {
          writes.push(item)
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
      return readMerged()
    },

    async hydrate() {
      await registry.hydrate()
      await runLegacyMigration()
      await retagFieldTypes()
    },

    isHydrated() {
      return isRegistryHydrated(appId)
    },

    async keys() {
      await registry.hydrate()
      await runLegacyMigration()
      await retagFieldTypes()
      const snapshot = registry.snapshotSync() ?? {}
      return fields.map((field) => field.key).filter((key) => snapshot[key] !== undefined)
    },
  }
}

function createLegacyRegistryStore<T>(
  options: Extract<RegistryStoreOptions<T>, { key: string }>,
): RegistryStore<T> {
  const { appId, key, serialize, deserialize, changedEventName } = options
  const valueType = options.valueType ?? 'json'
  const registry = createAppRegistry(appId)
  const listeners = new Set<() => void>()

  let parsedCache: { raw: string | undefined; value: T } | undefined

  function notify(): void {
    parsedCache = undefined
    for (const listener of listeners) {
      listener()
    }
    if (changedEventName && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(changedEventName))
    }
  }

  function readDeserialized(raw: string | undefined): T {
    if (parsedCache && parsedCache.raw === raw) {
      return parsedCache.value
    }
    const value = deserialize(raw)
    parsedCache = { raw, value }
    return value
  }

  async function retagIfNeeded(): Promise<void> {
    const current = await registry.getType(key)
    const raw = await registry.getText(key)
    if (raw === undefined || current === valueType) {
      return
    }
    if (valueType === 'json' && raw === '') {
      await registry.removeItem(key)
      return
    }
    await registry.retag(key, valueType)
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async read() {
      await registry.hydrate()
      await retagIfNeeded()
      return readDeserialized(await registry.getText(key))
    },

    async write(store: T) {
      const raw = serialize(store)
      if (valueType === 'json') {
        await registry.setJson(key, JSON.parse(raw) as unknown)
      } else {
        await registry.setText(key, raw)
      }
      notify()
    },

    readSync() {
      if (!isRegistryHydrated(appId)) {
        return undefined
      }
      const snapshot = registry.snapshotSync()
      if (!snapshot) {
        return undefined
      }
      return readDeserialized(snapshot[key])
    },

    async hydrate() {
      await registry.hydrate()
      await retagIfNeeded()
    },

    isHydrated() {
      return isRegistryHydrated(appId)
    },

    async keys() {
      await registry.hydrate()
      await retagIfNeeded()
      const snapshot = registry.snapshotSync() ?? {}
      return snapshot[key] !== undefined ? [key] : []
    },
  }
}
