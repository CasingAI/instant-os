/**
 * AttuneBench 进度/结果持久化。
 * 分层：localStorage 只存 KB 级元数据（run 配置、状态、完成标记、skipped），
 * 结果本体（EMRunOutput）存 IndexedDB，避免 5MB 上限与全量序列化卡顿。
 */

import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'
import type { EMRunOutput } from './types.ts'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.attunebench

const RESULTS_DB_NAME = 'instant-os-attunebench-results'
const RESULTS_DB_VERSION = 1
const RESULTS_STORE_NAME = 'results'

export type AttuneBenchRunConfig = {
  subset: string
  modelRefKey: string
  modes: string[]
  judgeModelRefKey: string | null
  conversationIds: string[]
}

export type RunStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error'

export type AttuneBenchCellKey = {
  conversationId: string
  mode: string
}

export type AttuneBenchStore = {
  runs: Record<
    string,
    {
      id: string
      createdAt: string
      config: AttuneBenchRunConfig
      status: RunStatus
      /** 已完成（可展示报告）的 (对话×模式) 完成标记；结果本体在 IndexedDB */
      completed: Record<string, true>
      /** 已失败并跳过，用于错误提示 */
      skipped: Array<{ conversationId: string; mode: string; error: string }>
    }
  >
}

function makeCellKey(cell: AttuneBenchCellKey): string {
  return `${cell.conversationId}::${cell.mode}`
}

function emptyStore(): AttuneBenchStore {
  return { runs: {} }
}

export function readAttuneBenchStore(): AttuneBenchStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyStore()
    const parsed = JSON.parse(raw) as AttuneBenchStore
    if (!parsed || typeof parsed.runs !== 'object') return emptyStore()
    return parsed
  } catch {
    return emptyStore()
  }
}

function writeStore(store: AttuneBenchStore): void {
  const ok = writeLocalStorageItem(STORAGE_KEY, JSON.stringify(store))
  if (!ok) {
    throw new Error('评测进度写入设备存储失败（localStorage 空间不足）')
  }
}

// ---------------------------------------------------------------------------
// 结果 IndexedDB
// ---------------------------------------------------------------------------

function openResultsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(RESULTS_DB_NAME, RESULTS_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(RESULTS_STORE_NAME)) {
        db.createObjectStore(RESULTS_STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function idbResultsPut(db: IDBDatabase, key: string, value: EMRunOutput): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RESULTS_STORE_NAME, 'readwrite')
    tx.objectStore(RESULTS_STORE_NAME).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** 按 key 前缀读取全部结果（key = `${runId}::`） */
function idbResultsGetByPrefix(db: IDBDatabase, prefix: string): Promise<EMRunOutput[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RESULTS_STORE_NAME, 'readonly')
    const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`)
    const request = tx.objectStore(RESULTS_STORE_NAME).openCursor(range)
    const outputs: EMRunOutput[] = []
    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) {
        outputs.push(cursor.value as EMRunOutput)
        cursor.continue()
      } else {
        resolve(outputs)
      }
    }
    request.onerror = () => reject(request.error)
  })
}

function resultsKey(runId: string, cell: AttuneBenchCellKey): string {
  return `${runId}::${makeCellKey(cell)}`
}

// ---------------------------------------------------------------------------
// run 生命周期
// ---------------------------------------------------------------------------

/** 创建一次新的评测 run，返回 runId */
export function createAttuneBenchRun(
  config: AttuneBenchRunConfig,
): { store: AttuneBenchStore; run: AttuneBenchStore['runs'][string] } {
  const store = readAttuneBenchStore()
  const id = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const run = {
    id,
    createdAt: new Date().toISOString(),
    config,
    status: 'idle' as RunStatus,
    completed: {} as Record<string, true>,
    skipped: [] as Array<{ conversationId: string; mode: string; error: string }>,
  }
  store.runs[id] = run
  writeStore(store)
  return { store, run }
}

export function deleteAttuneBenchRun(runId: string): void {
  const store = readAttuneBenchStore()
  delete store.runs[runId]
  writeStore(store)
  // 结果本体留在 IndexedDB，由浏览器配额管理；必要时可在此清理
}

/** 列出需要执行的所有 (对话×模式) 单元，并判断哪些已存在（断点续跑） */
export function listPendingCells(runId: string): {
  pending: AttuneBenchCellKey[]
  completed: AttuneBenchCellKey[]
  store: AttuneBenchStore
  run: AttuneBenchStore['runs'][string]
} {
  const store = readAttuneBenchStore()
  const run = store.runs[runId]
  const runOrFallback = run ?? {
    id: runId,
    createdAt: '',
    config: { subset: '', modelRefKey: '', modes: [], judgeModelRefKey: null, conversationIds: [] },
    status: 'idle' as RunStatus,
    completed: {},
    skipped: [],
  }
  if (!run) return { pending: [], completed: [], store, run: runOrFallback }

  const pending: AttuneBenchCellKey[] = []
  const completed: AttuneBenchCellKey[] = []
  for (const conversationId of run.config.conversationIds) {
    for (const mode of run.config.modes) {
      const key = makeCellKey({ conversationId, mode })
      if (run.completed[key]) {
        completed.push({ conversationId, mode })
      } else {
        pending.push({ conversationId, mode })
      }
    }
  }
  return { pending, completed, store, run }
}

/** 保存一个完成的单元结果：先写 IndexedDB，成功后更新 localStorage 完成标记 */
export async function saveCompletedCell(
  runId: string,
  cell: AttuneBenchCellKey,
  output: EMRunOutput,
): Promise<AttuneBenchStore> {
  const db = await openResultsDb()
  await idbResultsPut(db, resultsKey(runId, cell), output)

  const store = readAttuneBenchStore()
  const run = store.runs[runId]
  if (!run) return store
  run.completed[makeCellKey(cell)] = true
  writeStore(store)
  return store
}

/** 记录一个失败跳过的单元 */
export function recordSkippedCell(
  runId: string,
  cell: AttuneBenchCellKey,
  error: string,
): AttuneBenchStore {
  const store = readAttuneBenchStore()
  const run = store.runs[runId]
  if (!run) return store
  run.skipped.push({ conversationId: cell.conversationId, mode: cell.mode, error })
  writeStore(store)
  return store
}

/** 更新 run 状态 */
export function updateRunStatus(
  runId: string,
  status: RunStatus,
): AttuneBenchStore {
  const store = readAttuneBenchStore()
  const run = store.runs[runId]
  if (!run) return store
  run.status = status
  writeStore(store)
  return store
}

/** 获取某 run 的已完成结果列表（从 IndexedDB 读取） */
export async function getCompletedOutputs(runId: string): Promise<EMRunOutput[]> {
  const store = readAttuneBenchStore()
  const run = store.runs[runId]
  if (!run) return []
  const db = await openResultsDb()
  return idbResultsGetByPrefix(db, `${runId}::`)
}

export { makeCellKey, emptyStore }
