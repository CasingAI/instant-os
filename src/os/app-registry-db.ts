/**
 * 应用注册表（App Registry）IndexedDB 底层。
 * 数据库 instant-os-app-registry 与文件系统层（applications 卷）完全独立；
 * 仅被 app-registry.ts（及测试）调用。
 *
 * - Object store: entries，复合主键 [appId, key]
 * - 记录只存 string value，语义与 localStorage 一致
 * - 额外 appId 索引，用于按命名空间枚举 / 字节统计
 */
import { beginIdbTransaction } from './idb-transaction.ts'

export const REGISTRY_DB_NAME = 'instant-os-app-registry'
export const REGISTRY_DB_VERSION = 2
export const REGISTRY_ENTRIES_STORE = 'entries'
export const REGISTRY_APP_ID_INDEX = 'appId'

export type RegistryEntry = {
  appId: string
  key: string
  value: string
  updatedAt: number
}

let dbPromise: Promise<IDBDatabase> | undefined

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'))
  })
}

function createRegistryEntriesStore(db: IDBDatabase): IDBObjectStore {
  const store = db.createObjectStore(REGISTRY_ENTRIES_STORE, {
    keyPath: ['appId', 'key'],
  })
  store.createIndex(REGISTRY_APP_ID_INDEX, 'appId', { unique: false })
  return store
}

export function openRegistryDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(REGISTRY_DB_NAME, REGISTRY_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(REGISTRY_ENTRIES_STORE)) {
        createRegistryEntriesStore(db)
        return
      }

      // v1 的 entries store 没有 keyPath（out-of-line keys），升级到 v2 时
      // 把旧记录迁移为以 [appId, key] 为 keyPath 的新 store。
      const transaction = request.transaction
      if (!transaction) {
        db.deleteObjectStore(REGISTRY_ENTRIES_STORE)
        createRegistryEntriesStore(db)
        return
      }

      const oldStore = transaction.objectStore(REGISTRY_ENTRIES_STORE)
      const getAllRequest = oldStore.getAll()
      getAllRequest.onsuccess = () => {
        const entries = (getAllRequest.result as RegistryEntry[] | undefined) ?? []
        db.deleteObjectStore(REGISTRY_ENTRIES_STORE)
        const newStore = createRegistryEntriesStore(db)
        for (const entry of entries) {
          if (entry && typeof entry.appId === 'string' && typeof entry.key === 'string') {
            newStore.put(entry)
          }
        }
      }
      getAllRequest.onerror = () => {
        db.deleteObjectStore(REGISTRY_ENTRIES_STORE)
        createRegistryEntriesStore(db)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开应用注册表数据库'))
  })
  return dbPromise
}

function entriesStore(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return beginIdbTransaction(db, REGISTRY_ENTRIES_STORE, mode).objectStore(REGISTRY_ENTRIES_STORE)
}

/** 应用当前已用字节（value 的 UTF-8 字节数之和） */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

export async function registryDbGet(appId: string, key: string): Promise<string | undefined> {
  const db = await openRegistryDb()
  const result = await requestToPromise(
    entriesStore(db, 'readonly').get([appId, key]) as IDBRequest<RegistryEntry | undefined>,
  )
  return result?.value
}

export async function registryDbPut(appId: string, key: string, value: string): Promise<void> {
  const db = await openRegistryDb()
  const entry: RegistryEntry = { appId, key, value, updatedAt: Date.now() }
  await requestToPromise(entriesStore(db, 'readwrite').put(entry))
}

export async function registryDbDelete(appId: string, key: string): Promise<void> {
  const db = await openRegistryDb()
  await requestToPromise(entriesStore(db, 'readwrite').delete([appId, key]))
}

/** 某应用命名空间下全部条目（含 value / updatedAt），用于粗粒度 hydrate */
export async function registryDbListEntries(appId: string): Promise<RegistryEntry[]> {
  const db = await openRegistryDb()
  const index = entriesStore(db, 'readonly').index(REGISTRY_APP_ID_INDEX)
  return requestToPromise(index.getAll(appId) as IDBRequest<RegistryEntry[]>)
}

export async function registryDbListKeys(appId: string): Promise<string[]> {
  const entries = await registryDbListEntries(appId)
  return entries.map((entry) => entry.key)
}

/** 全部命名空间及其字节数（配额统计 / 注册表管理面板） */
export async function registryDbGetBytesByApp(): Promise<Record<string, number>> {
  const db = await openRegistryDb()
  const entries = await requestToPromise(
    entriesStore(db, 'readonly').getAll() as IDBRequest<RegistryEntry[]>,
  )
  const byApp: Record<string, number> = {}
  for (const entry of entries) {
    byApp[entry.appId] = (byApp[entry.appId] ?? 0) + utf8ByteLength(entry.value)
  }
  return byApp
}

/** 存在数据的命名空间列表（注册表管理面板） */
export async function registryDbListApps(): Promise<string[]> {
  const byApp = await registryDbGetBytesByApp()
  return Object.keys(byApp)
}

/** 清空某应用命名空间（卸载 / 清理） */
export async function registryDbClearApp(appId: string): Promise<void> {
  const db = await openRegistryDb()
  const store = entriesStore(db, 'readwrite')
  const index = store.index(REGISTRY_APP_ID_INDEX)
  await new Promise<void>((resolve, reject) => {
    const cursorRequest = index.openCursor(IDBKeyRange.only(appId))
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (cursor) {
        cursor.delete()
        cursor.continue()
        return
      }
      resolve()
    }
    cursorRequest.onerror = () =>
      reject(cursorRequest.error ?? new Error('注册表清空失败'))
  })
}

/** 测试用：关闭并删除注册表 DB，重置单例 */
export async function resetRegistryDbForTests(): Promise<void> {
  if (dbPromise) {
    try {
      const db = await dbPromise
      db.close()
    } catch {
      // ignore open failures while resetting
    }
    dbPromise = undefined
  }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(REGISTRY_DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('无法删除注册表 IndexedDB'))
    request.onblocked = () => resolve()
  })
}
