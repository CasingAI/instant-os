/**
 * 系统诊断日志独立 IndexedDB 库（只有诊断 Worker 打开并长期持有）。
 *
 * - 不在 instant-os-data / instant-os-files 里加 store，不进数据空间容量记账；
 * - 只保留少量覆盖写快照（live + previous + 最近若干份未响应快照），自带死上限；
 * - 写失败静默丢弃并由 Worker 计数，绝不在主线程重试。
 *
 * 库名/存储名一旦上线不可改（老标签的残留要能被新标签读到）。
 */

export const SYSTEM_DEBUG_LOG_DB_NAME = 'instant-os-system-debug-log'
export const SYSTEM_DEBUG_LOG_DB_VERSION = 1
const SNAPSHOT_STORE = 'snapshots'

/** 库内最多保留的「未响应」快照份数（覆盖最旧） */
export const UNRESPONSIVE_SNAPSHOT_LIMIT = 3

/** 落盘记录：正文全部是已处理好的字符串行 */
export type StoredSystemDebugSnapshot = {
  key: string
  savedAt: number
  kind: 'live' | 'previous' | 'unresponsive' | 'legacy'
  timeline: {
    id: number
    at: number
    layer: string
    op: string
    detail?: string
    durationMs?: number
    repeat?: number
  }[]
  hot: {
    id: number
    at: number
    layer: string
    op: string
    detail?: string
    durationMs?: number
    repeat?: number
  }[]
  counters: Record<
    string,
    { count: number; entries: number; dropped: number; totalMs: number; slowestMs: number; lastAt: number }
  >
  note?: string
}

export function isStoredSystemDebugSnapshot(value: unknown): value is StoredSystemDebugSnapshot {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  return typeof record.key === 'string' && Array.isArray(record.timeline) && Array.isArray(record.hot)
}

export function openSystemDebugLogDb(): Promise<IDBDatabase | undefined> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(undefined)
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(SYSTEM_DEBUG_LOG_DB_NAME, SYSTEM_DEBUG_LOG_DB_VERSION)
    } catch {
      resolve(undefined)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => {
      resolve(request.result)
    }
    request.onerror = () => {
      resolve(undefined)
    }
    request.onblocked = () => {
      // 其它标签的旧版本连接阻塞了升级：放弃持久化，内存环照常工作
      resolve(undefined)
    }
  })
}

function runStoreRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result)
    }
    request.onerror = () => {
      reject(request.error ?? new Error('idb request failed'))
    }
  })
}

export async function putSystemDebugSnapshot(
  db: IDBDatabase,
  snapshot: StoredSystemDebugSnapshot,
): Promise<void> {
  const tx = db.transaction(SNAPSHOT_STORE, 'readwrite')
  await runStoreRequest(tx.objectStore(SNAPSHOT_STORE).put(snapshot))
}

export async function getAllSystemDebugSnapshots(
  db: IDBDatabase,
): Promise<StoredSystemDebugSnapshot[]> {
  const tx = db.transaction(SNAPSHOT_STORE, 'readonly')
  const all = await runStoreRequest<unknown[]>(tx.objectStore(SNAPSHOT_STORE).getAll())
  return all.filter(isStoredSystemDebugSnapshot)
}

export async function deleteSystemDebugSnapshot(db: IDBDatabase, key: string): Promise<void> {
  const tx = db.transaction(SNAPSHOT_STORE, 'readwrite')
  await runStoreRequest(tx.objectStore(SNAPSHOT_STORE).delete(key))
}

export async function clearSystemDebugStore(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(SNAPSHOT_STORE, 'readwrite')
  await runStoreRequest(tx.objectStore(SNAPSHOT_STORE).clear())
}

/** 占用估算：库内全部快照序列化后的近似字符数（Worker 冷路径执行） */
export async function estimateSystemDebugStoreBytes(db: IDBDatabase): Promise<number> {
  const snapshots = await getAllSystemDebugSnapshots(db)
  let bytes = 0
  for (const snapshot of snapshots) {
    bytes += JSON.stringify(snapshot).length
  }
  return bytes
}
