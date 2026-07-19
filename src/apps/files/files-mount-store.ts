import {
  isMountLocationId,
  makeMountLocationId,
  newMountLocationKey,
  type MountFilesLocationId,
} from './files-types.ts'

export const FILES_MOUNTS_DB_NAME = 'instant-os-files-mounts'
export const FILES_MOUNTS_DB_VERSION = 1
export const FILES_MOUNTS_STORE = 'mounts'

export type FilesMountRecord = {
  id: MountFilesLocationId
  label: string
  handle: FileSystemDirectoryHandle
}

export const FILES_MOUNTS_CHANGED_EVENT = 'instant-os-files-mounts-changed'

let dbPromise: Promise<IDBDatabase> | undefined
let memoryCache: FilesMountRecord[] | undefined

function openMountsDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(FILES_MOUNTS_DB_NAME, FILES_MOUNTS_DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(FILES_MOUNTS_STORE)) {
        db.createObjectStore(FILES_MOUNTS_STORE, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      dbPromise = undefined
      reject(request.error ?? new Error('无法打开挂载 IndexedDB'))
    }
  })

  return dbPromise
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'))
  })
}

function waitForTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务已中止'))
  })
}

function emitMountsChanged(): void {
  window.dispatchEvent(new Event(FILES_MOUNTS_CHANGED_EVENT))
}

function setCache(records: FilesMountRecord[]): void {
  memoryCache = records
}

export function getCachedMounts(): readonly FilesMountRecord[] {
  return memoryCache ?? []
}

export function getCachedMount(id: string): FilesMountRecord | undefined {
  if (!isMountLocationId(id)) return undefined
  return getCachedMounts().find((item) => item.id === id)
}

export async function listMounts(): Promise<FilesMountRecord[]> {
  const db = await openMountsDb()
  const tx = db.transaction(FILES_MOUNTS_STORE, 'readonly')
  const store = tx.objectStore(FILES_MOUNTS_STORE)
  const records = await requestToPromise(store.getAll() as IDBRequest<FilesMountRecord[]>)
  await waitForTransaction(tx)
  const sorted = [...records].sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans'))
  setCache(sorted)
  return sorted
}

export async function getMount(id: MountFilesLocationId): Promise<FilesMountRecord | undefined> {
  const cached = getCachedMount(id)
  if (cached) return cached

  const db = await openMountsDb()
  const tx = db.transaction(FILES_MOUNTS_STORE, 'readonly')
  const store = tx.objectStore(FILES_MOUNTS_STORE)
  const record = await requestToPromise(store.get(id) as IDBRequest<FilesMountRecord | undefined>)
  await waitForTransaction(tx)
  return record
}

export function canMountDirectories(): boolean {
  return typeof window.showDirectoryPicker === 'function'
}

export async function pickDirectoryToMount(): Promise<FileSystemDirectoryHandle> {
  if (!canMountDirectories() || !window.showDirectoryPicker) {
    throw new Error('当前浏览器不支持挂载本机文件夹')
  }
  return window.showDirectoryPicker({ mode: 'readwrite' })
}

export async function addMount(handle: FileSystemDirectoryHandle): Promise<FilesMountRecord> {
  const existing = await listMounts()
  for (const item of existing) {
    if (await item.handle.isSameEntry(handle)) {
      return item
    }
  }

  const record: FilesMountRecord = {
    id: makeMountLocationId(
      newMountLocationKey(new Set(existing.map((item) => item.id))),
    ),
    label: handle.name || '已挂载',
    handle,
  }

  const db = await openMountsDb()
  const tx = db.transaction(FILES_MOUNTS_STORE, 'readwrite')
  const store = tx.objectStore(FILES_MOUNTS_STORE)
  store.put(record)
  await waitForTransaction(tx)

  setCache(
    [...existing, record].sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans')),
  )
  emitMountsChanged()
  return record
}

export async function removeMount(id: MountFilesLocationId): Promise<void> {
  const db = await openMountsDb()
  const tx = db.transaction(FILES_MOUNTS_STORE, 'readwrite')
  const store = tx.objectStore(FILES_MOUNTS_STORE)
  store.delete(id)
  await waitForTransaction(tx)

  setCache(getCachedMounts().filter((item) => item.id !== id))
  emitMountsChanged()
}
