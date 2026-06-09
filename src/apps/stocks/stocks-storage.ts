import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'
import type {
  NotificationStockItem,
  NotificationStockSnapshot,
} from '../../os/notification-center-widget-types.ts'
import { saveNotificationCenterWidgetsCache } from '../../os/notification-center-widgets-storage.ts'
import type { StockBoard, StockDetail, StocksStore, StockWatchEntry } from './stocks-types.ts'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.stocks

function emptyStore(): StocksStore {
  return {
    defaultWatchId: undefined,
    defaultDisplay: 'default-watch',
    marketBoard: undefined,
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

function normalizeMarketBoard(raw: unknown): StockBoard | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const record = raw as Record<string, unknown>
  if (typeof record.marketName !== 'string' || typeof record.headline !== 'string' || !Array.isArray(record.items)) {
    return undefined
  }

  const items = record.items
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return undefined
      }
      const stock = item as Record<string, unknown>
      if (typeof stock.symbol !== 'string' || typeof stock.name !== 'string') {
        return undefined
      }
      return {
        symbol: stock.symbol.trim().toUpperCase(),
        name: stock.name.trim(),
        price: Number(stock.price),
        change: Number(stock.change),
        changePercent: Number(stock.changePercent),
      }
    })
    .filter((item): item is NotificationStockItem => item !== undefined)
    .slice(0, 10)

  if (items.length === 0) {
    return undefined
  }

  const indices = Array.isArray(record.indices)
    ? record.indices
        .map((item) => {
          if (!item || typeof item !== 'object') {
            return undefined
          }
          const index = item as Record<string, unknown>
          if (typeof index.name !== 'string') {
            return undefined
          }
          return {
            name: index.name.trim(),
            value: Number(index.value),
            change: Number(index.change),
            changePercent: Number(index.changePercent),
          }
        })
        .filter((item): item is StockBoard['indices'][number] => item !== undefined)
        .slice(0, 3)
    : []

  return {
    marketName: record.marketName.trim(),
    headline: record.headline.trim(),
    indices,
    items,
  }
}

function resolveActiveWatchId(
  store: Pick<StocksStore, 'defaultDisplay' | 'defaultWatchId' | 'activeWatchId' | 'watchlist'>,
): string | undefined {
  const { watchlist, activeWatchId, defaultDisplay, defaultWatchId } = store

  if (activeWatchId && watchlist.some((item) => item.id === activeWatchId)) {
    return activeWatchId
  }

  if (defaultDisplay === 'market-board') {
    return undefined
  }

  if (defaultDisplay === 'default-watch' && defaultWatchId && watchlist.some((item) => item.id === defaultWatchId)) {
    return defaultWatchId
  }

  if (
    defaultDisplay !== 'market-board' &&
    defaultDisplay !== 'default-watch' &&
    watchlist.some((item) => item.id === defaultDisplay)
  ) {
    return defaultDisplay
  }

  if (defaultWatchId && watchlist.some((item) => item.id === defaultWatchId)) {
    return defaultWatchId
  }

  return watchlist[0]?.id
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

  const marketBoard = normalizeMarketBoard(record.marketBoard)
  const defaultWatchId =
    typeof record.defaultWatchId === 'string' && watchlist.some((item) => item.id === record.defaultWatchId)
      ? record.defaultWatchId
      : undefined

  let defaultDisplay: StocksStore['defaultDisplay'] =
    record.defaultDisplay === 'default-watch' ||
    record.defaultDisplay === 'market-board' ||
    typeof record.defaultDisplay === 'string'
      ? (record.defaultDisplay as StocksStore['defaultDisplay'])
      : 'default-watch'

  if (
    defaultDisplay !== 'market-board' &&
    defaultDisplay !== 'default-watch' &&
    !watchlist.some((item) => item.id === defaultDisplay)
  ) {
    defaultDisplay = defaultWatchId ? 'default-watch' : marketBoard ? 'market-board' : 'default-watch'
  }

  if (defaultDisplay === 'default-watch' && !defaultWatchId) {
    defaultDisplay = marketBoard ? 'market-board' : 'default-watch'
  }

  const partial = { defaultDisplay, defaultWatchId, watchlist, activeWatchId: undefined as string | undefined }
  const validActiveWatchId = resolveActiveWatchId({
    ...partial,
    activeWatchId: typeof record.activeWatchId === 'string' ? record.activeWatchId : undefined,
  })

  return {
    defaultWatchId,
    defaultDisplay,
    marketBoard,
    watchlist,
    activeWatchId: validActiveWatchId,
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

export function compactNotificationItemToDetail(
  item: NotificationStockItem,
  snapshot?: NotificationStockSnapshot,
): StockDetail {
  const prevClose = item.price - item.change
  return {
    symbol: item.symbol,
    name: item.name,
    exchange: snapshot?.marketName ?? '主板',
    price: item.price,
    change: item.change,
    changePercent: item.changePercent,
    open: prevClose,
    high: item.price,
    low: prevClose,
    prevClose,
    volume: '—',
    marketCap: '—',
    summary: snapshot?.headline ?? item.name,
  }
}

export function detailToNotificationItem(detail: StockDetail): NotificationStockItem {
  return {
    symbol: detail.symbol,
    name: detail.name,
    price: detail.price,
    change: detail.change,
    changePercent: detail.changePercent,
  }
}

export function snapshotToStockBoard(snapshot: NotificationStockSnapshot): StockBoard {
  return {
    marketName: snapshot.marketName,
    headline: snapshot.headline,
    indices: [],
    items: snapshot.items,
  }
}

export function toNotificationStockSnapshot(board: StockBoard): NotificationStockSnapshot {
  return {
    marketName: board.marketName,
    headline: board.headline,
    items: board.items.slice(0, 4),
  }
}

export function getActiveWatch(store: StocksStore) {
  if (!store.activeWatchId) {
    return undefined
  }
  return store.watchlist.find((item) => item.id === store.activeWatchId)
}

export function getDefaultWatch(store: StocksStore) {
  if (!store.defaultWatchId) {
    return undefined
  }
  return store.watchlist.find((item) => item.id === store.defaultWatchId)
}

export function isWidgetDefaultWatch(store: StocksStore, watchId: string | undefined): boolean {
  if (!watchId) {
    return false
  }
  if (store.defaultDisplay === 'default-watch') {
    return store.defaultWatchId === watchId
  }
  return store.defaultDisplay === watchId
}

function watchToWidgetSnapshot(watch: StockWatchEntry): NotificationStockSnapshot | undefined {
  if (!watch.detail) {
    return undefined
  }
  return {
    marketName: watch.exchange ?? '自选',
    headline: watch.detail.summary,
    items: [detailToNotificationItem(watch.detail)],
  }
}

export function getWidgetDisplaySnapshot(store: StocksStore): NotificationStockSnapshot | undefined {
  if (store.defaultDisplay === 'market-board') {
    if (store.marketBoard) {
      return toNotificationStockSnapshot(store.marketBoard)
    }
    const defaultWatch = getDefaultWatch(store)
    if (defaultWatch) {
      return watchToWidgetSnapshot(defaultWatch)
    }
    return undefined
  }

  if (store.defaultDisplay === 'default-watch') {
    const watch = getDefaultWatch(store)
    if (watch) {
      return watchToWidgetSnapshot(watch)
    }
  }

  const watch = store.watchlist.find((item) => item.id === store.defaultDisplay)
  if (watch) {
    return watchToWidgetSnapshot(watch)
  }

  if (store.marketBoard) {
    return toNotificationStockSnapshot(store.marketBoard)
  }

  const items = store.watchlist
    .map((item) => item.detail)
    .filter((detail): detail is StockDetail => detail !== undefined)
    .map((detail) => detailToNotificationItem(detail))
    .slice(0, 4)

  if (items.length === 0) {
    return undefined
  }

  return {
    marketName: '自选股',
    headline: '自选行情',
    items,
  }
}

export function syncWidgetStocksFromStore(store: StocksStore = readStocksStore()): void {
  const stocks = getWidgetDisplaySnapshot(store)
  if (!stocks) {
    return
  }
  saveNotificationCenterWidgetsCache({ stocks })
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('instant-os:stocks-widget-changed'))
  }
}

export function ensureDefaultWatchFromNotification(snapshot: NotificationStockSnapshot): StocksStore {
  const store = readStocksStore()

  if (store.defaultWatchId) {
    const next = store.marketBoard ? store : { ...store, marketBoard: snapshotToStockBoard(snapshot) }
    if (next !== store) {
      writeStocksStore(next)
      syncWidgetStocksFromStore(next)
    }
    return next
  }

  const first = snapshot.items[0]
  if (!first) {
    return store
  }

  const detail = compactNotificationItemToDetail(first, snapshot)
  let next = upsertWatchEntry(store, {
    symbol: first.symbol,
    name: first.name,
    detail,
  })

  const watchId = createWatchId(first.symbol)
  next = {
    ...next,
    defaultWatchId: watchId,
    defaultDisplay: 'default-watch',
    activeWatchId: watchId,
    marketBoard: next.marketBoard ?? snapshotToStockBoard(snapshot),
  }

  writeStocksStore(next)
  syncWidgetStocksFromStore(next)
  return next
}

export function bootstrapStocksStoreFromWidgetCache(
  snapshot: NotificationStockSnapshot | undefined,
): StocksStore {
  let store = readStocksStore()
  let changed = false

  if (!store.marketBoard && snapshot) {
    store = { ...store, marketBoard: snapshotToStockBoard(snapshot) }
    changed = true
  }

  if (!store.defaultWatchId) {
    if (store.watchlist.length > 0) {
      const primary = store.watchlist[0]
      store = {
        ...store,
        defaultWatchId: primary.id,
        defaultDisplay:
          store.defaultDisplay === 'market-board' ? store.defaultDisplay : 'default-watch',
      }
      changed = true
    } else if (snapshot) {
      return ensureDefaultWatchFromNotification(snapshot)
    }
  }

  if (!store.marketBoard && store.defaultDisplay === 'market-board' && store.defaultWatchId) {
    store = { ...store, defaultDisplay: 'default-watch' }
    changed = true
  }

  const resolvedActiveWatchId = resolveActiveWatchId(store)
  if (store.activeWatchId !== resolvedActiveWatchId) {
    store = { ...store, activeWatchId: resolvedActiveWatchId }
    changed = true
  }

  if (changed) {
    writeStocksStore(store)
    syncWidgetStocksFromStore(store)
  }

  return store
}

export function setDefaultDisplay(defaultDisplay: StocksStore['defaultDisplay']): StocksStore {
  const store = { ...readStocksStore(), defaultDisplay }
  writeStocksStore(store)
  syncWidgetStocksFromStore(store)
  return store
}

export function updateMarketBoard(board: StockBoard): StocksStore {
  const store = { ...readStocksStore(), marketBoard: board }
  writeStocksStore(store)
  if (store.defaultDisplay === 'market-board') {
    syncWidgetStocksFromStore(store)
  }
  return store
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

  return { ...store, watchlist, activeWatchId: id }
}

export function setActiveWatch(watchId: string): StocksStore {
  const store = { ...readStocksStore(), activeWatchId: watchId }
  writeStocksStore(store)
  return store
}

export function clearActiveWatch(): StocksStore {
  const store = { ...readStocksStore(), activeWatchId: undefined }
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

  if (
    next.defaultDisplay === watchId ||
    (next.defaultDisplay === 'default-watch' && next.defaultWatchId === watchId)
  ) {
    syncWidgetStocksFromStore(next)
  }

  return next
}

export function removeWatchEntry(watchId: string): StocksStore {
  const store = readStocksStore()
  if (store.defaultWatchId === watchId) {
    return store
  }

  const watchlist = store.watchlist.filter((item) => item.id !== watchId)
  let activeWatchId = store.activeWatchId
  if (activeWatchId === watchId) {
    activeWatchId = store.defaultWatchId ?? watchlist[0]?.id
  }

  let defaultDisplay = store.defaultDisplay
  if (defaultDisplay === watchId) {
    defaultDisplay = store.defaultWatchId ? 'default-watch' : 'market-board'
  }

  const next = { ...store, watchlist, activeWatchId, defaultDisplay }
  writeStocksStore(next)
  syncWidgetStocksFromStore(next)
  return next
}
