import { useEffect, useState } from 'preact/hooks'
import { generateCitySearchSuggestions } from './weather-agent.ts'
import type { WeatherCitySuggestion } from './weather-types.ts'

export type WeatherCitySearchSheetProps = {
  open: boolean
  query: string
  addingCityId: string | undefined
  onClose: () => void
  onSelect: (suggestion: WeatherCitySuggestion) => void
}

export function WeatherCitySearchSheet({
  open,
  query,
  addingCityId,
  onClose,
  onSelect,
}: WeatherCitySearchSheetProps) {
  const [suggestions, setSuggestions] = useState<WeatherCitySuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!open || !query.trim()) {
      setSuggestions([])
      setError(undefined)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(undefined)
    setSuggestions([])

    void generateCitySearchSuggestions(query)
      .then((results) => {
        if (cancelled) {
          return
        }
        setSuggestions(results)
        if (results.length === 0) {
          setError('没有找到相关城市，试试其他关键词')
        }
      })
      .catch((err) => {
        if (cancelled) {
          return
        }
        setError(err instanceof Error ? err.message : '搜索失败')
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [open, query])

  if (!open) {
    return undefined
  }

  return (
    <div class="weather-app__sheet-overlay" onClick={onClose}>
      <div
        class="weather-app__sheet"
        role="dialog"
        aria-label="搜索城市"
        onClick={(event) => event.stopPropagation()}
      >
        <div class="weather-app__sheet-header">
          <h2 class="weather-app__sheet-title">搜索城市</h2>
          <button type="button" class="weather-app__sheet-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>
        <p class="weather-app__sheet-query">
          关键词：<strong>{query}</strong>
        </p>

        {loading && (
          <div class="weather-app__sheet-loading" role="status" aria-live="polite">
            <div class="weather-app__loading-spinner" aria-hidden="true" />
            <p>正在加载</p>
          </div>
        )}

        {!loading && error && <p class="weather-app__sheet-error">{error}</p>}

        {!loading && suggestions.length > 0 && (
          <ul class="weather-app__sheet-list">
            {suggestions.map((item) => {
              const busy = addingCityId === item.name
              return (
                <li key={item.name}>
                  <button
                    type="button"
                    class="weather-app__sheet-item"
                    disabled={addingCityId !== undefined}
                    onClick={() => onSelect(item)}
                  >
                    <span class="weather-app__sheet-item-main">
                      <span class="weather-app__sheet-item-name">{item.name}</span>
                      <span class="weather-app__sheet-item-region">{item.region}</span>
                    </span>
                    <span class="weather-app__sheet-item-sub">{busy ? '正在添加…' : item.subtitle}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
