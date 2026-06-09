import type { NotificationStockItem, NotificationStockSnapshot } from '../../os/notification-center-widget-types.ts'

export type StockIndex = {
  name: string
  value: number
  change: number
  changePercent: number
}

export type StockBoard = NotificationStockSnapshot & {
  indices: StockIndex[]
  items: NotificationStockItem[]
}

export type StockDetail = NotificationStockItem & {
  exchange: string
  open: number
  high: number
  low: number
  prevClose: number
  volume: string
  marketCap: string
  summary: string
}

export type StockSearchSuggestion = {
  symbol: string
  name: string
  exchange: string
  subtitle: string
}

export type StockWatchEntry = {
  id: string
  symbol: string
  name: string
  exchange: string | undefined
  detail: StockDetail | undefined
}

export type StocksDefaultDisplay = 'default-watch' | 'market-board' | string

export type StocksStore = {
  defaultWatchId: string | undefined
  defaultDisplay: StocksDefaultDisplay
  marketBoard: StockBoard | undefined
  watchlist: StockWatchEntry[]
  activeWatchId: string | undefined
}
