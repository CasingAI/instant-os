import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'

/** 模型权重从哪里拉：远端网关（R2）或本站同源 `/assets`。默认远端。 */
export type ModelSource = 'remote' | 'local'

export type ModelSourceSettings = {
  source: ModelSource
}

export const MODEL_SOURCE_SETTINGS_CHANGED_EVENT = 'instant-os:model-source-settings-changed'

export const MODEL_SOURCE_OPTIONS = [
  { id: 'remote', label: '远端（模型网关）' },
  { id: 'local', label: '同源（本站 /assets）' },
] as const

const STORAGE_KEY = DEVICE_STORAGE_KEYS.modelSourceSettings
const DEFAULT_SETTINGS: ModelSourceSettings = { source: 'remote' }

const IDB_NAME = 'instant-os-model-source'
const IDB_STORE = 'settings'
const IDB_KEY = 'source'

function isModelSource(value: unknown): value is ModelSource {
  return value === 'remote' || value === 'local'
}

function normalize(raw: unknown): ModelSourceSettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_SETTINGS
  const source = (raw as Record<string, unknown>).source
  return { source: isModelSource(source) ? source : DEFAULT_SETTINGS.source }
}

function openSourceDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('model-source idb open failed'))
  })
}

async function writeSourceIdb(source: ModelSource): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const db = await openSourceDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('model-source idb write failed'))
      tx.objectStore(IDB_STORE).put(source, IDB_KEY)
    })
  } finally {
    db.close()
  }
}

async function readSourceIdb(): Promise<ModelSource | undefined> {
  if (typeof indexedDB === 'undefined') return undefined
  const db = await openSourceDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const request = tx.objectStore(IDB_STORE).get(IDB_KEY)
      request.onsuccess = () => {
        resolve(isModelSource(request.result) ? request.result : undefined)
      }
      request.onerror = () => reject(request.error ?? new Error('model-source idb read failed'))
    })
  } finally {
    db.close()
  }
}

export function loadModelSourceSettings(): ModelSourceSettings {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return normalize(JSON.parse(raw))
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function saveModelSourceSettings(settings: ModelSourceSettings): Promise<boolean> {
  const next: ModelSourceSettings = { source: settings.source === 'local' ? 'local' : 'remote' }
  const serialized = JSON.stringify(next)
  if (typeof localStorage !== 'undefined' && !writeLocalStorageItem(STORAGE_KEY, serialized)) {
    return false
  }
  try {
    await writeSourceIdb(next.source)
  } catch {
    // Worker 镜像失败时主线程仍可用 localStorage
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(MODEL_SOURCE_SETTINGS_CHANGED_EVENT))
  }
  return true
}

export async function patchModelSourceSettings(
  patch: Partial<ModelSourceSettings>,
): Promise<ModelSourceSettings> {
  const next = { ...loadModelSourceSettings(), ...patch }
  await saveModelSourceSettings(next)
  return next
}

/**
 * 实际下载用的来源。主线程读 localStorage；推理 Worker 没有 localStorage，读镜像的 IndexedDB。
 * 都读不到则远端。
 */
export async function resolveModelSource(): Promise<ModelSource> {
  try {
    if (typeof localStorage !== 'undefined') {
      const source = loadModelSourceSettings().source
      void writeSourceIdb(source).catch(() => undefined)
      return source
    }
  } catch {
    // Worker 或禁用存储
  }
  try {
    return (await readSourceIdb()) ?? DEFAULT_SETTINGS.source
  } catch {
    return DEFAULT_SETTINGS.source
  }
}

export function subscribeModelSourceSettings(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener(MODEL_SOURCE_SETTINGS_CHANGED_EVENT, listener)
  return () => window.removeEventListener(MODEL_SOURCE_SETTINGS_CHANGED_EVENT, listener)
}
