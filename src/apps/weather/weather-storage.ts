import {
  DEVICE_STORAGE_KEYS,
  writeLocalStorageItem,
} from '../../os/device-storage.ts'
import type { NotificationWeather } from '../../os/notification-center-widget-types.ts'
import { saveNotificationCenterWidgetsCache } from '../../os/notification-center-widgets-storage.ts'
import type { WeatherDetail, WeatherStore } from './weather-types.ts'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.weather

function emptyStore(): WeatherStore {
  return {
    myLocationCityId: undefined,
    defaultDisplay: 'my-location',
    cities: [],
    activeCityId: undefined,
  }
}

function normalizeWeatherDetail(raw: unknown): WeatherDetail | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }

  const record = raw as Record<string, unknown>
  if (typeof record.city !== 'string' || typeof record.condition !== 'string') {
    return undefined
  }

  return raw as WeatherDetail
}

function normalizeStore(raw: unknown): WeatherStore {
  if (!raw || typeof raw !== 'object') {
    return emptyStore()
  }

  const record = raw as Record<string, unknown>
  const cities = Array.isArray(record.cities)
    ? record.cities
        .map((item): WeatherStore['cities'][number] | undefined => {
          if (!item || typeof item !== 'object') {
            return undefined
          }
          const city = item as Record<string, unknown>
          if (typeof city.id !== 'string' || typeof city.name !== 'string') {
            return undefined
          }
          return {
            id: city.id,
            name: city.name,
            region: typeof city.region === 'string' ? city.region : undefined,
            weather: normalizeWeatherDetail(city.weather),
          }
        })
        .filter((item): item is WeatherStore['cities'][number] => item !== undefined)
    : []

  const myLocationCityId =
    typeof record.myLocationCityId === 'string' ? record.myLocationCityId : undefined
  const activeCityId = typeof record.activeCityId === 'string' ? record.activeCityId : undefined

  const validMyLocationId =
    myLocationCityId && cities.some((city) => city.id === myLocationCityId)
      ? myLocationCityId
      : undefined

  let resolvedDefaultDisplay: WeatherStore['defaultDisplay'] =
    record.defaultDisplay === 'my-location' || typeof record.defaultDisplay === 'string'
      ? (record.defaultDisplay as WeatherStore['defaultDisplay'])
      : 'my-location'

  if (
    resolvedDefaultDisplay !== 'my-location' &&
    !cities.some((city) => city.id === resolvedDefaultDisplay)
  ) {
    resolvedDefaultDisplay = 'my-location'
  }

  const validActiveCityId =
    activeCityId && cities.some((city) => city.id === activeCityId)
      ? activeCityId
      : validMyLocationId ?? cities[0]?.id

  return {
    myLocationCityId: validMyLocationId,
    defaultDisplay: resolvedDefaultDisplay,
    cities,
    activeCityId: validActiveCityId,
  }
}

function loadStore(): WeatherStore {
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

function saveStore(store: WeatherStore): boolean {
  const ok = writeLocalStorageItem(STORAGE_KEY, JSON.stringify(store))
  if (ok && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('instant-os:weather-store-changed'))
  }
  return ok
}

export function readWeatherStore(): WeatherStore {
  return loadStore()
}

export function writeWeatherStore(store: WeatherStore): boolean {
  return saveStore(store)
}

export function createCityId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fff-]/gi, '')
}

export function toNotificationWeather(detail: WeatherDetail): NotificationWeather {
  return {
    city: detail.city,
    condition: detail.condition,
    temperatureC: detail.temperatureC,
    highC: detail.highC,
    lowC: detail.lowC,
    humidity: detail.humidity,
    wind: detail.wind,
    emoji: detail.emoji,
    summary: detail.summary,
  }
}

export function compactNotificationToDetail(weather: NotificationWeather): WeatherDetail {
  return {
    ...weather,
    feelsLikeC: weather.temperatureC,
    uvIndex: 4,
    airQuality: '良',
    visibilityKm: 10,
    hourly: [],
    daily: [],
  }
}

export function getCityById(store: WeatherStore, cityId: string | undefined) {
  if (!cityId) {
    return undefined
  }
  return store.cities.find((city) => city.id === cityId)
}

export function getActiveCity(store: WeatherStore) {
  return getCityById(store, store.activeCityId)
}

export function getMyLocationCity(store: WeatherStore) {
  return getCityById(store, store.myLocationCityId)
}

export function getWidgetDisplayCity(store: WeatherStore) {
  if (store.defaultDisplay === 'my-location') {
    return getMyLocationCity(store)
  }
  return getCityById(store, store.defaultDisplay) ?? getMyLocationCity(store)
}

export function getWidgetDisplayWeather(store: WeatherStore): NotificationWeather | undefined {
  const city = getWidgetDisplayCity(store)
  if (!city?.weather) {
    return undefined
  }
  return toNotificationWeather(city.weather)
}

export function syncWidgetWeatherFromStore(store: WeatherStore = readWeatherStore()): void {
  const weather = getWidgetDisplayWeather(store)
  if (!weather) {
    return
  }
  saveNotificationCenterWidgetsCache({ weather })
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('instant-os:weather-widget-changed'))
  }
}

export function upsertCityWeather(
  store: WeatherStore,
  input: {
    name: string
    region?: string
    weather: WeatherDetail
    asMyLocation?: boolean
  },
): WeatherStore {
  const id = createCityId(input.name)
  const existingIndex = store.cities.findIndex((city) => city.id === id)
  const entry = {
    id,
    name: input.name.trim(),
    region: input.region?.trim() || undefined,
    weather: input.weather,
  }

  const cities =
    existingIndex >= 0
      ? store.cities.map((city, index) => (index === existingIndex ? { ...city, ...entry } : city))
      : [...store.cities, entry]

  let myLocationCityId = store.myLocationCityId
  if (input.asMyLocation) {
    myLocationCityId = id
  }

  return {
    ...store,
    cities,
    myLocationCityId,
    activeCityId: id,
  }
}

export function ensureMyLocationFromNotification(weather: NotificationWeather): WeatherStore {
  const store = readWeatherStore()

  if (store.myLocationCityId) {
    return store
  }

  const id = createCityId(weather.city)
  const detail = compactNotificationToDetail(weather)
  const existing = getCityById(store, id)

  const next = upsertCityWeather(store, {
    name: weather.city,
    weather: existing?.weather?.hourly.length ? existing.weather : detail,
    asMyLocation: true,
  })
  writeWeatherStore(next)
  syncWidgetWeatherFromStore(next)
  return next
}

export function bootstrapWeatherStoreFromWidgetCache(
  weather: NotificationWeather | undefined,
): WeatherStore {
  let store = readWeatherStore()
  if (store.cities.length > 0) {
    if (!store.activeCityId && store.cities[0]) {
      store = { ...store, activeCityId: store.cities[0].id }
      writeWeatherStore(store)
    }
    return store
  }

  if (!weather) {
    return store
  }

  store = upsertCityWeather(store, {
    name: weather.city,
    weather: compactNotificationToDetail(weather),
    asMyLocation: true,
  })
  writeWeatherStore(store)
  syncWidgetWeatherFromStore(store)
  return store
}

export function setActiveCity(cityId: string): WeatherStore {
  const store = { ...readWeatherStore(), activeCityId: cityId }
  writeWeatherStore(store)
  return store
}

export function setDefaultDisplay(defaultDisplay: WeatherStore['defaultDisplay']): WeatherStore {
  const store = { ...readWeatherStore(), defaultDisplay }
  writeWeatherStore(store)
  syncWidgetWeatherFromStore(store)
  return store
}

export function updateCityWeather(cityId: string, weather: WeatherDetail): WeatherStore {
  const store = readWeatherStore()
  const cities = store.cities.map((city) =>
    city.id === cityId ? { ...city, weather, name: weather.city } : city,
  )
  const next = { ...store, cities }
  writeWeatherStore(next)

  const widgetCity = getWidgetDisplayCity(next)
  if (widgetCity?.id === cityId) {
    syncWidgetWeatherFromStore(next)
  }

  return next
}

export function removeCity(cityId: string): WeatherStore {
  const store = readWeatherStore()
  if (store.myLocationCityId === cityId) {
    return store
  }

  const cities = store.cities.filter((city) => city.id !== cityId)
  let defaultDisplay = store.defaultDisplay
  if (defaultDisplay === cityId) {
    defaultDisplay = 'my-location'
  }

  let activeCityId = store.activeCityId
  if (activeCityId === cityId) {
    activeCityId = store.myLocationCityId ?? cities[0]?.id
  }

  const next = { ...store, cities, defaultDisplay, activeCityId }
  writeWeatherStore(next)
  syncWidgetWeatherFromStore(next)
  return next
}
