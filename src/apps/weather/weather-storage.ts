import { createRegistryStore } from '../../os/registry-store.ts'
import type { NotificationWeather } from '../../os/notification-center-widget-types.ts'
import { saveNotificationCenterWidgetsCache } from '../../os/notification-center-widgets-storage.ts'
import type { WeatherCityEntry, WeatherDetail, WeatherStore } from './weather-types.ts'

const registryStore = createRegistryStore<WeatherStore>({
  appId: 'weather',
  defaultValue: emptyStore,
  legacyKey: 'store',
  fields: [
    {
      key: 'myLocationCityId',
      read: (store) => store.myLocationCityId,
      write: (value, draft) => ({ ...draft, myLocationCityId: value }),
      serialize: (value) => value ?? '',
      deserialize: (raw) => (raw ? raw : undefined),
    },
    {
      key: 'defaultDisplay',
      read: (store) => store.defaultDisplay,
      write: (value, draft) => ({ ...draft, defaultDisplay: value }),
      serialize: (value) => value,
      deserialize: (raw) => (raw ? raw : 'my-location'),
    },
    {
      key: 'cities',
      read: (store) => store.cities,
      write: (value, draft) => ({ ...draft, cities: value }),
      serialize: (value) => JSON.stringify(value),
      deserialize: (raw) => {
        if (!raw) {
          return []
        }
        try {
          return normalizeCityEntries(JSON.parse(raw) as unknown)
        } catch {
          return []
        }
      },
    },
    {
      key: 'activeCityId',
      read: (store) => store.activeCityId,
      write: (value, draft) => ({ ...draft, activeCityId: value }),
      serialize: (value) => value ?? '',
      deserialize: (raw) => (raw ? raw : undefined),
    },
  ],
  finalize: normalizeCrossFieldInvariants,
  changedEventName: 'instant-os:weather-store-changed',
})

function normalizeCrossFieldInvariants(store: WeatherStore): WeatherStore {
  const validMyLocationId =
    store.myLocationCityId && store.cities.some((city) => city.id === store.myLocationCityId)
      ? store.myLocationCityId
      : undefined

  let resolvedDefaultDisplay: WeatherStore['defaultDisplay'] = store.defaultDisplay
  if (
    resolvedDefaultDisplay !== 'my-location' &&
    resolvedDefaultDisplay &&
    !store.cities.some((city) => city.id === resolvedDefaultDisplay)
  ) {
    resolvedDefaultDisplay = 'my-location'
  }

  const validActiveCityId =
    store.activeCityId && store.cities.some((city) => city.id === store.activeCityId)
      ? store.activeCityId
      : validMyLocationId ?? store.cities[0]?.id

  return {
    myLocationCityId: validMyLocationId,
    defaultDisplay: resolvedDefaultDisplay,
    cities: store.cities,
    activeCityId: validActiveCityId,
  }
}

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

function normalizeCityEntries(raw: unknown): WeatherCityEntry[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw
    .map((item): WeatherCityEntry | undefined => {
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
    .filter((item): item is WeatherCityEntry => item !== undefined)
}

export function subscribeWeatherStore(listener: () => void): () => void {
  return registryStore.subscribe(listener)
}

export async function readWeatherStore(): Promise<WeatherStore> {
  return registryStore.read()
}

export async function writeWeatherStore(store: WeatherStore): Promise<void> {
  await registryStore.write(store)
}

/** 内存缓存同步兜底读（未 hydrate 返回 undefined）；常规路径用 readWeatherStore */
export function readWeatherStoreSync(): WeatherStore | undefined {
  return registryStore.readSync()
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

export function syncWidgetWeatherFromStore(store: WeatherStore): void {
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

export async function ensureMyLocationFromNotification(
  weather: NotificationWeather,
): Promise<WeatherStore> {
  const store = await readWeatherStore()

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
  await writeWeatherStore(next)
  syncWidgetWeatherFromStore(next)
  return next
}

export async function bootstrapWeatherStoreFromWidgetCache(
  weather: NotificationWeather | undefined,
): Promise<WeatherStore> {
  let store = await readWeatherStore()
  if (store.cities.length > 0) {
    if (!store.activeCityId && store.cities[0]) {
      store = { ...store, activeCityId: store.cities[0].id }
      await writeWeatherStore(store)
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
  await writeWeatherStore(store)
  syncWidgetWeatherFromStore(store)
  return store
}

export async function setActiveCity(cityId: string): Promise<WeatherStore> {
  const store = { ...(await readWeatherStore()), activeCityId: cityId }
  await writeWeatherStore(store)
  return store
}

export async function setDefaultDisplay(
  defaultDisplay: WeatherStore['defaultDisplay'],
): Promise<WeatherStore> {
  const store = { ...(await readWeatherStore()), defaultDisplay }
  await writeWeatherStore(store)
  syncWidgetWeatherFromStore(store)
  return store
}

export async function updateCityWeather(cityId: string, weather: WeatherDetail): Promise<WeatherStore> {
  const store = await readWeatherStore()
  const cities = store.cities.map((city) =>
    city.id === cityId ? { ...city, weather, name: weather.city } : city,
  )
  const next = { ...store, cities }
  await writeWeatherStore(next)

  const widgetCity = getWidgetDisplayCity(next)
  if (widgetCity?.id === cityId) {
    syncWidgetWeatherFromStore(next)
  }

  return next
}

export async function removeCity(cityId: string): Promise<WeatherStore> {
  const store = await readWeatherStore()
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
  await writeWeatherStore(next)
  syncWidgetWeatherFromStore(next)
  return next
}
