import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'
import { osNowMs } from '../../os/os-clock.ts'

export type ChromoDownloadState = 'in-progress' | 'completed' | 'failed' | 'canceled'

export type ChromoDownloadReason =
  | 'content-disposition'
  | 'download-attr'
  | 'opaque-navigation'
  | 'blob'
  | 'data'
  | 'save-link'
  | 'save-network'
  | 'retry'

export type ChromoDownloadRecord = {
  id: string
  url: string
  filename: string
  mime?: string
  referrer?: string
  cookieHeader?: string
  reason?: ChromoDownloadReason
  state: ChromoDownloadState
  bytesReceived: number
  bytesTotal?: number
  startedAt: number
  endedAt?: number
  path?: string
  error?: string
}

type DownloadsStore = {
  items: ChromoDownloadRecord[]
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.chromoDownloads
const MAX_ITEMS = 200
const DOWNLOADS_CHANGED_EVENT = 'instant-os:chromo-downloads-changed'

const live = new Map<string, ChromoDownloadRecord>()
const listeners = new Set<() => void>()

function emptyStore(): DownloadsStore {
  return { items: [] }
}

function isDownloadRecord(value: unknown): value is ChromoDownloadRecord {
  if (!value || typeof value !== 'object') {
    return false
  }
  const item = value as Partial<ChromoDownloadRecord>
  return (
    typeof item.id === 'string' &&
    typeof item.url === 'string' &&
    typeof item.filename === 'string' &&
    typeof item.state === 'string' &&
    typeof item.bytesReceived === 'number' &&
    typeof item.startedAt === 'number'
  )
}

function loadStore(): DownloadsStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return emptyStore()
    }
    const parsed = JSON.parse(raw) as Partial<DownloadsStore>
    if (!Array.isArray(parsed.items)) {
      return emptyStore()
    }
    return {
      items: parsed.items.filter(isDownloadRecord).slice(0, MAX_ITEMS),
    }
  } catch {
    return emptyStore()
  }
}

function persistableRecord(record: ChromoDownloadRecord): ChromoDownloadRecord {
  if (record.state === 'completed') {
    const { cookieHeader: _cookie, ...rest } = record
    return rest
  }
  return record
}

function saveStore(store: DownloadsStore): boolean {
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify({ items: store.items.slice(0, MAX_ITEMS) }))
}

function emitChange(): void {
  for (const listener of listeners) {
    listener()
  }
  try {
    window.dispatchEvent(new CustomEvent(DOWNLOADS_CHANGED_EVENT))
  } catch {
    // tests without window listeners
  }
}

function mergeList(): ChromoDownloadRecord[] {
  const byId = new Map<string, ChromoDownloadRecord>()
  for (const item of loadStore().items) {
    byId.set(item.id, item)
  }
  for (const item of live.values()) {
    byId.set(item.id, item)
  }
  return [...byId.values()].sort((a, b) => b.startedAt - a.startedAt)
}

function persistMerged(): void {
  const items = mergeList().map(persistableRecord)
  saveStore({ items })
}

export function listChromoDownloads(): ChromoDownloadRecord[] {
  return mergeList()
}

export function getChromoDownload(id: string): ChromoDownloadRecord | undefined {
  return live.get(id) ?? loadStore().items.find((item) => item.id === id)
}

export function upsertChromoDownload(record: ChromoDownloadRecord, persist = true): ChromoDownloadRecord {
  live.set(record.id, record)
  if (persist) {
    persistMerged()
  }
  emitChange()
  return record
}

export function patchChromoDownload(
  id: string,
  patch: Partial<ChromoDownloadRecord>,
  persist = true,
): ChromoDownloadRecord | undefined {
  const current = getChromoDownload(id)
  if (!current) {
    return undefined
  }
  return upsertChromoDownload({ ...current, ...patch }, persist)
}

export function removeChromoDownloadRecord(id: string): void {
  live.delete(id)
  saveStore({ items: loadStore().items.filter((item) => item.id !== id) })
  emitChange()
}

export function clearFinishedChromoDownloads(): void {
  for (const [id, item] of live) {
    if (item.state !== 'in-progress') {
      live.delete(id)
    }
  }
  saveStore({
    items: loadStore().items.filter((item) => item.state === 'in-progress' || live.has(item.id)),
  })
  emitChange()
}

export function subscribeChromoDownloads(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function createChromoDownloadId(): string {
  return crypto.randomUUID()
}

export function newChromoDownloadRecord(
  partial: Omit<ChromoDownloadRecord, 'state' | 'bytesReceived' | 'startedAt'> & {
    state?: ChromoDownloadState
    bytesReceived?: number
    startedAt?: number
  },
): ChromoDownloadRecord {
  return {
    state: 'in-progress',
    bytesReceived: 0,
    startedAt: osNowMs(),
    ...partial,
  }
}

/** 刷新后仍标 in-progress 的记录：标失败，返回需删除的占位路径。 */
export function markInterruptedChromoDownloads(): string[] {
  const paths: string[] = []
  const next: ChromoDownloadRecord[] = []
  for (const item of mergeList()) {
    if (item.state !== 'in-progress') {
      next.push(item)
      continue
    }
    if (item.path) {
      paths.push(item.path)
    }
    const failed: ChromoDownloadRecord = {
      ...item,
      state: 'failed',
      endedAt: osNowMs(),
      error: item.error || '浏览器刷新后中断',
    }
    live.set(failed.id, failed)
    next.push(failed)
  }
  saveStore({ items: next.map(persistableRecord).slice(0, MAX_ITEMS) })
  emitChange()
  return paths
}

export function formatDownloadBytes(size: number | undefined): string {
  if (size == null || !Number.isFinite(size) || size < 0) {
    return '—'
  }
  if (size < 1024) {
    return `${Math.round(size)} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
