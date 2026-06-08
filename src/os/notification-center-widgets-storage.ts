import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'
import type {
  NotificationStockItem,
  NotificationStockSnapshot,
  NotificationWeather,
} from './notification-center-widget-types.ts'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.notificationCenterWidgets

export type NotificationCenterWidgetsCache = {
  weather?: NotificationWeather
  stocks?: NotificationStockSnapshot
}

function normalizeWeather(raw: unknown): NotificationWeather | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }

  const record = raw as Record<string, unknown>
  if (
    typeof record.city !== 'string' ||
    typeof record.condition !== 'string' ||
    typeof record.wind !== 'string' ||
    typeof record.emoji !== 'string' ||
    typeof record.summary !== 'string'
  ) {
    return undefined
  }

  return {
    city: record.city.trim(),
    condition: record.condition.trim(),
    temperatureC: Math.round(Number(record.temperatureC)),
    highC: Math.round(Number(record.highC)),
    lowC: Math.round(Number(record.lowC)),
    humidity: Math.max(0, Math.min(100, Math.round(Number(record.humidity)))),
    wind: record.wind.trim(),
    emoji: record.emoji.trim(),
    summary: record.summary.trim(),
  }
}

function normalizeStockItem(raw: unknown): NotificationStockItem | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }

  const record = raw as Record<string, unknown>
  if (typeof record.symbol !== 'string' || typeof record.name !== 'string') {
    return undefined
  }

  return {
    symbol: record.symbol.trim().toUpperCase(),
    name: record.name.trim(),
    price: Number(record.price),
    change: Number(record.change),
    changePercent: Number(record.changePercent),
  }
}

function normalizeStockSnapshot(raw: unknown): NotificationStockSnapshot | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }

  const record = raw as Record<string, unknown>
  if (typeof record.marketName !== 'string' || typeof record.headline !== 'string') {
    return undefined
  }

  if (!Array.isArray(record.items)) {
    return undefined
  }

  const items = record.items
    .map((item) => normalizeStockItem(item))
    .filter((item): item is NotificationStockItem => item !== undefined)
    .slice(0, 4)

  if (items.length === 0) {
    return undefined
  }

  return {
    marketName: record.marketName.trim(),
    headline: record.headline.trim(),
    items,
  }
}

function normalizeCache(raw: unknown): NotificationCenterWidgetsCache {
  if (!raw || typeof raw !== 'object') {
    return {}
  }

  const record = raw as Record<string, unknown>
  const weather = normalizeWeather(record.weather)
  const stocks = normalizeStockSnapshot(record.stocks)

  return {
    weather,
    stocks,
  }
}

export function loadNotificationCenterWidgetsCache(): NotificationCenterWidgetsCache {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {}
    }
    return normalizeCache(JSON.parse(raw))
  } catch {
    return {}
  }
}

export function saveNotificationCenterWidgetsCache(patch: NotificationCenterWidgetsCache): boolean {
  const merged: NotificationCenterWidgetsCache = {
    ...loadNotificationCenterWidgetsCache(),
    ...patch,
  }

  if (!merged.weather && !merged.stocks) {
    try {
      localStorage.removeItem(STORAGE_KEY)
      return true
    } catch {
      return false
    }
  }

  const payload: NotificationCenterWidgetsCache = {
    weather: merged.weather,
    stocks: merged.stocks,
  }

  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(payload))
}
