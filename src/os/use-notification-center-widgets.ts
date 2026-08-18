import { useCallback, useEffect, useState } from 'preact/hooks'
import {
  bootstrapStocksStoreFromWidgetCache,
  ensureDefaultWatchFromNotification,
  getWidgetDisplaySnapshot,
  readStocksStore,
} from '../apps/stocks/stocks-storage.ts'
import {
  bootstrapWeatherStoreFromWidgetCache,
  ensureMyLocationFromNotification,
  getWidgetDisplayWeather,
} from '../apps/weather/weather-storage.ts'
import { generateFakeStockSnapshot, generateFakeWeather } from './generate-notification-widgets.ts'
import {
  loadNotificationCenterWidgetsCache,
  saveNotificationCenterWidgetsCache,
} from './notification-center-widgets-storage.ts'
import type {
  NotificationStockSnapshot,
  NotificationWeather,
  WidgetLoadState,
} from './notification-center-widget-types.ts'

const initialCache = loadNotificationCenterWidgetsCache()

let weatherCache = initialCache.weather
let stocksCache = initialCache.stocks

async function resolveWeatherFromStore(): Promise<NotificationWeather | undefined> {
  const store = await bootstrapWeatherStoreFromWidgetCache(weatherCache)
  return getWidgetDisplayWeather(store)
}

function applyWeatherDisplay(weather: NotificationWeather): void {
  weatherCache = weather
  saveNotificationCenterWidgetsCache({ weather })
}

async function resolveStocksFromStore(): Promise<NotificationStockSnapshot | undefined> {
  const store = await readStocksStore()
  return getWidgetDisplaySnapshot(store)
}

function applyStocksDisplay(stocks: NotificationStockSnapshot): void {
  stocksCache = stocks
  saveNotificationCenterWidgetsCache({ stocks })
}

type WidgetCache = {
  weather: NotificationWeather | undefined
  weatherState: WidgetLoadState
  weatherError: string | undefined
  stocks: NotificationStockSnapshot | undefined
  stocksState: WidgetLoadState
  stocksError: string | undefined
}

export function useNotificationCenterWidgets(enabled: boolean): WidgetCache {
  const [weather, setWeather] = useState<NotificationWeather | undefined>(() => weatherCache)
  const [stocks, setStocks] = useState<NotificationStockSnapshot | undefined>(() => stocksCache)
  const [weatherState, setWeatherState] = useState<WidgetLoadState>('idle')
  const [stocksState, setStocksState] = useState<WidgetLoadState>('idle')
  const [weatherError, setWeatherError] = useState<string | undefined>(undefined)
  const [stocksError, setStocksError] = useState<string | undefined>(undefined)

  const syncWeatherFromStore = useCallback(async () => {
    const next = await resolveWeatherFromStore()
    if (next) {
      applyWeatherDisplay(next)
      setWeather(next)
      setWeatherState('idle')
      setWeatherError(undefined)
    }
  }, [])

  const syncStocksFromStore = useCallback(async () => {
    const next = await resolveStocksFromStore()
    if (next) {
      applyStocksDisplay(next)
      setStocks(next)
      setStocksState('idle')
      setStocksError(undefined)
    }
  }, [])

  useEffect(() => {
    const onWeatherChanged = () => void syncWeatherFromStore()
    window.addEventListener('instant-os:weather-widget-changed', onWeatherChanged)
    window.addEventListener('instant-os:weather-store-changed', onWeatherChanged)
    return () => {
      window.removeEventListener('instant-os:weather-widget-changed', onWeatherChanged)
      window.removeEventListener('instant-os:weather-store-changed', onWeatherChanged)
    }
  }, [syncWeatherFromStore])

  useEffect(() => {
    const onStocksChanged = () => void syncStocksFromStore()
    window.addEventListener('instant-os:stocks-widget-changed', onStocksChanged)
    window.addEventListener('instant-os:stocks-store-changed', onStocksChanged)
    return () => {
      window.removeEventListener('instant-os:stocks-widget-changed', onStocksChanged)
      window.removeEventListener('instant-os:stocks-store-changed', onStocksChanged)
    }
  }, [syncStocksFromStore])

  const loadWeatherIfNeeded = useCallback(async () => {
    const fromStore = await resolveWeatherFromStore()
    if (fromStore) {
      applyWeatherDisplay(fromStore)
      setWeather(fromStore)
      setWeatherState('idle')
      return
    }

    if (weatherCache) {
      await ensureMyLocationFromNotification(weatherCache)
      const synced = (await resolveWeatherFromStore()) ?? weatherCache
      applyWeatherDisplay(synced)
      setWeather(synced)
      setWeatherState('idle')
      return
    }

    setWeatherState('loading')
    setWeatherError(undefined)

    try {
      const data = await generateFakeWeather()
      await ensureMyLocationFromNotification(data)
      const synced = (await resolveWeatherFromStore()) ?? data
      applyWeatherDisplay(synced)
      setWeather(synced)
      setWeatherState('idle')
    } catch (error) {
      setWeatherState('error')
      setWeatherError(error instanceof Error ? error.message : '天气生成失败')
      if (weatherCache) {
        setWeather(weatherCache)
      }
    }
  }, [])

  const loadStocksIfNeeded = useCallback(async () => {
    await bootstrapStocksStoreFromWidgetCache(stocksCache)
    const fromStore = await resolveStocksFromStore()
    if (fromStore) {
      applyStocksDisplay(fromStore)
      setStocks(fromStore)
      setStocksState('idle')
      return
    }

    if (stocksCache) {
      await ensureDefaultWatchFromNotification(stocksCache)
      const synced = (await resolveStocksFromStore()) ?? stocksCache
      applyStocksDisplay(synced)
      setStocks(synced)
      setStocksState('idle')
      return
    }

    setStocksState('loading')
    setStocksError(undefined)

    try {
      const data = await generateFakeStockSnapshot()
      await ensureDefaultWatchFromNotification(data)
      const synced = (await resolveStocksFromStore()) ?? data
      applyStocksDisplay(synced)
      setStocks(synced)
      setStocksState('idle')
    } catch (error) {
      setStocksState('error')
      setStocksError(error instanceof Error ? error.message : '行情生成失败')
      if (stocksCache) {
        setStocks(stocksCache)
      }
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      return
    }

    void loadWeatherIfNeeded()
    void loadStocksIfNeeded()
  }, [enabled, loadWeatherIfNeeded, loadStocksIfNeeded])

  return {
    weather,
    weatherState,
    weatherError,
    stocks,
    stocksState,
    stocksError,
  }
}
