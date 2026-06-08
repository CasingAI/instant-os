import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'
import type { StockDetail, StocksStore, StockWatchEntry } from './stocks-types.ts'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.stocks

function emptyStore(): StocksStore {
  return {
    watchlist: [],
    activeWatchId: undefined,
  }
}

function normalizeDetail(raw: unknown): StockDetail | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const record = raw as Record<string, unknown>
  if (typeof record.symbol !== 'string' || typeof record.name !== 'string') {
    return undefined
  }
  return raw as StockDetail
}

function normalizeWatchEntry(raw: unknown): StockWatchEntry | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const record = raw as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.symbol !== 'string' || typeof record.name !== 'string') {
    return undefined
  }
  return {
    id: record.id,
    symbol: record.symbol.trim().toUpperCase(),
    name: record.name.trim(),
    exchange: typeof record.exchange === 'string' ? record.exchange.trim() : undefined,
    detail: normalizeDetail(record.detail),
  }
}

function normalizeStore(raw: unknown): StocksStore {
  if (!raw || typeof raw !== 'object') {
    return emptyStore()
  }
  const record = raw as Record<string, unknown>
  const watchlist = Array.isArray(record.watchlist)
    ? record.watchlist
        .map((item) => normalizeWatchEntry(item))
        .filter((item): item is StockWatchEntry => item !== undefined)
    : []

  return {
    watchlist,
    activeWatchId: typeof record.activeWatchId === 'string' ? record.activeWatchId : undefined,
  }
}

function loadStore(): StocksStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return emptyStore()
    }
    return normalizeStore(JSON.parse(raw))
  } catch {
    return emptyStore()
  }
}

function saveStore(store: StocksStore): boolean {
  const ok = writeLocalStorageItem(STORAGE_KEY, JSON.stringify(store))
  if (ok && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('instant-os:stocks-store-changed'))
  }
  return ok
}

export function readStocksStore(): StocksStore {
  return loadStore()
}

export function writeStocksStore(store: StocksStore): boolean {
  return saveStore(store)
}

export function createWatchId(symbol: string): string {
  return symbol.trim().toUpperCase()
}

export function getActiveWatch(store: StocksStore) {
  if (!store.activeWatchId) {
    return undefined
  }
  return store.watchlist.find((item) => item.id === store.activeWatchId)
}

export function upsertWatchEntry(
  store: StocksStore,
  input: {
    symbol: string
    name: string
    exchange?: string
    detail: StockDetail
  },
): StocksStore {
  const id = createWatchId(input.symbol)
  const entry: StockWatchEntry = {
    id,
    symbol: input.symbol.trim().toUpperCase(),
    name: input.name.trim(),
    exchange: input.exchange?.trim() || input.detail.exchange,
    detail: input.detail,
  }

  const existingIndex = store.watchlist.findIndex((item) => item.id === id)
  const watchlist =
    existingIndex >= 0
      ? store.watchlist.map((item, index) => (index === existingIndex ? { ...item, ...entry } : item))
      : [...store.watchlist, entry]

  return { watchlist, activeWatchId: id }
}

export function setActiveWatch(watchId: string): StocksStore {
  const store = { ...readStocksStore(), activeWatchId: watchId }
  writeStocksStore(store)
  return store
}

export function updateWatchDetail(watchId: string, detail: StockDetail): StocksStore {
  const store = readStocksStore()
  const watchlist = store.watchlist.map((item) =>
    item.id === watchId
      ? {
          ...item,
          symbol: detail.symbol,
          name: detail.name,
          exchange: detail.exchange,
          detail,
        }
      : item,
  )
  const next = { ...store, watchlist }
  writeStocksStore(next)
  return next
}

export function removeWatchEntry(watchId: string): StocksStore {
  const store = readStocksStore()
  const watchlist = store.watchlist.filter((item) => item.id !== watchId)
  let activeWatchId = store.activeWatchId
  if (activeWatchId === watchId) {
    activeWatchId = watchlist[0]?.id
  }
  const next = { ...store, watchlist, activeWatchId }
  writeStocksStore(next)
  return next
}
