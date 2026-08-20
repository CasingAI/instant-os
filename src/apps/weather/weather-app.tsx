import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import { loadNotificationCenterWidgetsCache } from '../../os/notification-center-widgets-storage.ts'
import { useOs } from '../../os/os-context.tsx'
import { generateWeatherDetail } from './weather-agent.ts'
import { WeatherCitySearchSheet } from './weather-city-search-sheet.tsx'
import {
  bootstrapWeatherStoreFromWidgetCache,
  getActiveCity,
  readWeatherStore,
  removeCity,
  setActiveCity,
  setDefaultDisplay,
  subscribeWeatherStore,
  updateCityWeather,
  upsertCityWeather,
  writeWeatherStore,
} from './weather-storage.ts'
import type { WeatherCitySuggestion, WeatherDetail, WeatherStore } from './weather-types.ts'
import './weather.css'

type WeatherDetailPanelProps = {
  weather: WeatherDetail
  isMyLocation: boolean
  isWidgetDefault: boolean
  onSetWidgetDefault: () => void
}

function WeatherDetailPanel({
  weather,
  isMyLocation,
  isWidgetDefault,
  onSetWidgetDefault,
}: WeatherDetailPanelProps) {
  return (
    <>
      <div class="weather-app__hero">
        <span class="weather-app__hero-emoji" aria-hidden="true">
          {weather.emoji}
        </span>
        <div class="weather-app__hero-main">
          <div class="weather-app__hero-labels">
            {isMyLocation && <span class="weather-app__badge">我的位置</span>}
            {isWidgetDefault && <span class="weather-app__badge weather-app__badge--widget">默认地区</span>}
          </div>
          <h2 class="weather-app__hero-city">{weather.city}</h2>
          <p class="weather-app__hero-temp">{weather.temperatureC}°</p>
          <p class="weather-app__hero-condition">
            {weather.condition} · 体感 {weather.feelsLikeC}°
          </p>
        </div>
        {!isWidgetDefault && (
          <button
            type="button"
            class="weather-app__widget-pin"
            aria-label="设为通知中心显示"
            title="设为通知中心显示"
            onClick={onSetWidgetDefault}
          >
            <svg
              class="weather-app__widget-pin-icon"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <rect
                x="4"
                y="4"
                width="16"
                height="16"
                rx="3.5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.75"
              />
              <path
                d="M8 9.5h8M8 12.5h5.5M12 16.5V21M9.5 19h5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        )}
      </div>

      <p class="weather-app__summary">{weather.summary}</p>
      <div class="weather-app__stats">
        <div class="weather-app__stat">
          <span class="weather-app__stat-label">最高 / 最低</span>
          <span class="weather-app__stat-value">
            {weather.highC}° / {weather.lowC}°
          </span>
        </div>
        <div class="weather-app__stat">
          <span class="weather-app__stat-label">湿度</span>
          <span class="weather-app__stat-value">{weather.humidity}%</span>
        </div>
        <div class="weather-app__stat">
          <span class="weather-app__stat-label">风力</span>
          <span class="weather-app__stat-value">{weather.wind}</span>
        </div>
        <div class="weather-app__stat">
          <span class="weather-app__stat-label">紫外线</span>
          <span class="weather-app__stat-value">{weather.uvIndex}</span>
        </div>
        <div class="weather-app__stat">
          <span class="weather-app__stat-label">空气质量</span>
          <span class="weather-app__stat-value">{weather.airQuality}</span>
        </div>
        <div class="weather-app__stat">
          <span class="weather-app__stat-label">能见度</span>
          <span class="weather-app__stat-value">{weather.visibilityKm} km</span>
        </div>
      </div>
      {weather.hourly.length > 0 && (
        <>
          <p class="weather-app__section-title">逐小时</p>
          <div class="weather-app__hourly">
            {weather.hourly.map((item) => (
              <div key={item.time} class="weather-app__hourly-item">
                <span class="weather-app__hourly-time">{item.time}</span>
                <span class="weather-app__hourly-emoji" aria-hidden="true">
                  {item.emoji}
                </span>
                <span class="weather-app__hourly-temp">{item.tempC}°</span>
              </div>
            ))}
          </div>
        </>
      )}
      {weather.daily.length > 0 && (
        <>
          <p class="weather-app__section-title">未来几天</p>
          <div class="weather-app__daily">
            {weather.daily.map((item) => (
              <div key={item.day} class="weather-app__daily-row">
                <span class="weather-app__daily-day">{item.day}</span>
                <span aria-hidden="true">{item.emoji}</span>
                <span class="weather-app__daily-condition">{item.condition}</span>
                <span class="weather-app__daily-temp">{item.highC}°</span>
                <span class="weather-app__daily-temp weather-app__daily-temp--low">{item.lowC}°</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function isWidgetDefaultCity(store: WeatherStore, cityId: string | undefined): boolean {
  if (!cityId) {
    return false
  }
  if (store.defaultDisplay === 'my-location') {
    return store.myLocationCityId === cityId
  }
  return store.defaultDisplay === cityId
}

export function WeatherApp() {
  const { setAppWindowTitle } = useOs()

  const widgetCache = useMemo(() => loadNotificationCenterWidgetsCache(), [])
  const [store, setStore] = useState<WeatherStore | undefined>(undefined)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchSheetOpen, setSearchSheetOpen] = useState(false)
  const [searchSheetQuery, setSearchSheetQuery] = useState('')
  const [loadingCityId, setLoadingCityId] = useState<string | undefined>(undefined)
  const [addingCityName, setAddingCityName] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  const activeCity = useMemo(() => (store ? getActiveCity(store) : undefined), [store])

  useEffect(() => {
    setAppWindowTitle('weather', '天气')
  }, [setAppWindowTitle])

  useEffect(() => {
    let alive = true
    const load = () => {
      bootstrapWeatherStoreFromWidgetCache(widgetCache.weather).then((next) => {
        if (alive) {
          setStore(next)
        }
      })
    }
    load()
    const unsubscribe = subscribeWeatherStore(load)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [widgetCache.weather])

  const fetchCityDetail = useCallback(async (cityId: string, cityName: string) => {
    setLoadingCityId(cityId)
    setError(undefined)
    try {
      const detail = await generateWeatherDetail(cityName)
      const next = await updateCityWeather(cityId, detail)
      setStore(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : '天气生成失败')
    } finally {
      setLoadingCityId(undefined)
    }
  }, [])

  useEffect(() => {
    if (!activeCity || loadingCityId) {
      return
    }
    if (!activeCity.weather || activeCity.weather.hourly.length === 0) {
      void fetchCityDetail(activeCity.id, activeCity.name)
    }
  }, [activeCity, loadingCityId, fetchCityDetail])

  const openSearchSheet = useCallback(() => {
    const query = searchQuery.trim()
    if (!query) {
      return
    }
    setSearchSheetQuery(query)
    setSearchSheetOpen(true)
  }, [searchQuery])

  const handleSelectSuggestion = useCallback(async (suggestion: WeatherCitySuggestion) => {
    setAddingCityName(suggestion.name)
    setError(undefined)
    try {
      const detail = await generateWeatherDetail(suggestion.name)
      let next = upsertCityWeather(await readWeatherStore(), {
        name: suggestion.name,
        region: suggestion.region,
        weather: detail,
      })
      await writeWeatherStore(next)
      setStore(next)
      setSearchSheetOpen(false)
      setSearchQuery('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加城市失败')
    } finally {
      setAddingCityName(undefined)
    }
  }, [])

  const handleSelectCity = useCallback(async (cityId: string) => {
    const next = await setActiveCity(cityId)
    setStore(next)
  }, [])

  const handleSetWidgetDefault = useCallback(async () => {
    if (!activeCity || !store) {
      return
    }
    const next =
      activeCity.id === store.myLocationCityId
        ? await setDefaultDisplay('my-location')
        : await setDefaultDisplay(activeCity.id)
    setStore(next)
  }, [activeCity, store?.myLocationCityId])

  const handleRefresh = useCallback(async () => {
    if (!activeCity) {
      return
    }
    await fetchCityDetail(activeCity.id, activeCity.name)
  }, [activeCity, fetchCityDetail])

  const handleRemoveCity = useCallback(async (cityId: string) => {
    const next = await removeCity(cityId)
    setStore(next)
  }, [])

  useAppMenuBar('weather', [])

  const activeWeather = activeCity?.weather
  const loadingActive = activeCity !== undefined && loadingCityId === activeCity.id

  return (
    <div class="weather-app">
      <div class="weather-app__toolbar">
        <span class="weather-app__brand">天气</span>
        <label class="weather-app__search">
          <input
            type="search"
            value={searchQuery}
            placeholder="搜索城市…"
            aria-label="搜索城市"
            onInput={(event) => setSearchQuery((event.currentTarget as HTMLInputElement).value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                openSearchSheet()
              }
            }}
          />
          <button
            type="button"
            class="weather-app__search-btn"
            disabled={!searchQuery.trim()}
            onClick={openSearchSheet}
          >
            搜索
          </button>
        </label>
        <button
          type="button"
          class="weather-app__refresh"
          aria-label="刷新"
          disabled={loadingActive || !activeCity}
          onClick={() => void handleRefresh()}
        >
          ↻
        </button>
      </div>

      {store && store.cities.length > 0 && (
        <div class="weather-app__city-bar" role="tablist" aria-label="城市列表">
          {store.cities.map((city) => {
            const selected = city.id === store.activeCityId
            const isMyLocation = city.id === store.myLocationCityId
            const temp = city.weather?.temperatureC
            return (
              <div key={city.id} class={`weather-app__city-chip-wrap${selected ? ' weather-app__city-chip-wrap--active' : ''}`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  class={`weather-app__city-chip${selected ? ' weather-app__city-chip--active' : ''}`}
                  onClick={() => handleSelectCity(city.id)}
                >
                  <span class="weather-app__city-chip-emoji" aria-hidden="true">
                    {city.weather?.emoji ?? '🌤'}
                  </span>
                  <span class="weather-app__city-chip-copy">
                    <span class="weather-app__city-chip-name">{city.name}</span>
                    <span class="weather-app__city-chip-meta">
                      {isMyLocation ? '我的位置' : city.region ?? '已添加'}
                      {temp !== undefined ? ` · ${temp}°` : ''}
                    </span>
                  </span>
                </button>
                {!isMyLocation && (
                  <button
                    type="button"
                    class="weather-app__city-remove"
                    aria-label={`移除 ${city.name}`}
                    onClick={() => handleRemoveCity(city.id)}
                  >
                    ×
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div class="weather-app__body">
        {store === undefined && !loadingActive && (
          <div class="weather-app__loading" role="status" aria-live="polite">
            <div class="weather-app__loading-spinner" aria-hidden="true" />
            <p>正在加载</p>
          </div>
        )}
        {loadingActive && !activeWeather && (
          <div class="weather-app__loading" role="status" aria-live="polite">
            <div class="weather-app__loading-spinner" aria-hidden="true" />
            <p>正在加载</p>
          </div>
        )}
        {error && <p class="weather-app__error">{error}</p>}
        {!activeCity && !loadingActive && (
          <p class="weather-app__hint">搜索并添加城市，或在通知中心生成「我的位置」天气。</p>
        )}
        {activeWeather && store && (
          <WeatherDetailPanel
            weather={activeWeather}
            isMyLocation={activeCity?.id === store.myLocationCityId}
            isWidgetDefault={isWidgetDefaultCity(store, activeCity?.id)}
            onSetWidgetDefault={handleSetWidgetDefault}
          />
        )}
      </div>

      <WeatherCitySearchSheet
        open={searchSheetOpen}
        query={searchSheetQuery}
        addingCityId={addingCityName}
        onClose={() => setSearchSheetOpen(false)}
        onSelect={(suggestion) => void handleSelectSuggestion(suggestion)}
      />
    </div>
  )
}
