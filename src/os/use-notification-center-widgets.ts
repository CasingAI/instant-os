import { useCallback, useEffect, useState } from 'preact/hooks'
import {
  bootstrapWeatherStoreFromWidgetCache,
  ensureMyLocationFromNotification,
  getWidgetDisplayWeather,
  readWeatherStore,
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

function resolveWeatherFromStore(): NotificationWeather | undefined {
  const store = bootstrapWeatherStoreFromWidgetCache(weatherCache)
  return getWidgetDisplayWeather(store)
}

function applyWeatherDisplay(weather: NotificationWeather): void {
  weatherCache = weather
  saveNotificationCenterWidgetsCache({ weather })
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
  const [weather, setWeather] = useState<NotificationWeather | undefined>(() =>
    resolveWeatherFromStore() ?? weatherCache,
  )
  const [stocks, setStocks] = useState<NotificationStockSnapshot | undefined>(stocksCache)
  const [weatherState, setWeatherState] = useState<WidgetLoadState>('idle')
  const [stocksState, setStocksState] = useState<WidgetLoadState>('idle')
  const [weatherError, setWeatherError] = useState<string | undefined>(undefined)
  const [stocksError, setStocksError] = useState<string | undefined>(undefined)

  const syncWeatherFromStore = useCallback(() => {
    const next = resolveWeatherFromStore()
    if (next) {
      applyWeatherDisplay(next)
      setWeather(next)
      setWeatherState('idle')
      setWeatherError(undefined)
    }
  }, [])

  useEffect(() => {
    const onWeatherChanged = () => syncWeatherFromStore()
    window.addEventListener('instant-os:weather-widget-changed', onWeatherChanged)
    window.addEventListener('instant-os:weather-store-changed', onWeatherChanged)
    return () => {
      window.removeEventListener('instant-os:weather-widget-changed', onWeatherChanged)
      window.removeEventListener('instant-os:weather-store-changed', onWeatherChanged)
    }
  }, [syncWeatherFromStore])

  const loadWeatherIfNeeded = useCallback(async () => {
    const fromStore = resolveWeatherFromStore()
    if (fromStore) {
      applyWeatherDisplay(fromStore)
      setWeather(fromStore)
      setWeatherState('idle')
      return
    }

    if (weatherCache) {
      ensureMyLocationFromNotification(weatherCache)
      const synced = getWidgetDisplayWeather(readWeatherStore()) ?? weatherCache
      applyWeatherDisplay(synced)
      setWeather(synced)
      setWeatherState('idle')
      return
    }

    setWeatherState('loading')
    setWeatherError(undefined)

    try {
      const data = await generateFakeWeather()
      ensureMyLocationFromNotification(data)
      const synced = getWidgetDisplayWeather(readWeatherStore()) ?? data
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
    if (stocksCache) {
      setStocks(stocksCache)
      return
    }

    setStocksState('loading')
    setStocksError(undefined)

    try {
      const data = await generateFakeStockSnapshot()
      stocksCache = data
      saveNotificationCenterWidgetsCache({ stocks: data })
      setStocks(data)
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
