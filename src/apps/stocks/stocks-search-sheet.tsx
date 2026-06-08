import { useEffect, useState } from 'preact/hooks'
import { generateStockSearchSuggestions } from './stocks-agent.ts'
import type { StockSearchSuggestion } from './stocks-types.ts'

export type StocksSearchSheetProps = {
  open: boolean
  query: string
  addingSymbol: string | undefined
  onClose: () => void
  onSelect: (suggestion: StockSearchSuggestion) => void
}

export function StocksSearchSheet({
  open,
  query,
  addingSymbol,
  onClose,
  onSelect,
}: StocksSearchSheetProps) {
  const [suggestions, setSuggestions] = useState<StockSearchSuggestion[]>([])
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

    void generateStockSearchSuggestions(query)
      .then((results) => {
        if (cancelled) {
          return
        }
        setSuggestions(results)
        if (results.length === 0) {
          setError('没有找到相关股票，试试其他关键词')
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
    <div class="stocks-app__sheet-overlay" onClick={onClose}>
      <div
        class="stocks-app__sheet"
        role="dialog"
        aria-label="搜索股票"
        onClick={(event) => event.stopPropagation()}
      >
        <div class="stocks-app__sheet-header">
          <h2 class="stocks-app__sheet-title">搜索股票</h2>
          <button type="button" class="stocks-app__sheet-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>
        <p class="stocks-app__sheet-query">
          关键词：<strong>{query}</strong>
        </p>

        {loading && (
          <div class="stocks-app__sheet-loading" role="status" aria-live="polite">
            <div class="stocks-app__loading-spinner" aria-hidden="true" />
            <p>正在加载</p>
          </div>
        )}

        {!loading && error && <p class="stocks-app__sheet-error">{error}</p>}

        {!loading && suggestions.length > 0 && (
          <ul class="stocks-app__sheet-list">
            {suggestions.map((item) => {
              const busy = addingSymbol === item.symbol
              return (
                <li key={item.symbol}>
                  <button
                    type="button"
                    class="stocks-app__sheet-item"
                    disabled={addingSymbol !== undefined}
                    onClick={() => onSelect(item)}
                  >
                    <span class="stocks-app__sheet-item-main">
                      <span class="stocks-app__sheet-item-symbol">{item.symbol}</span>
                      <span class="stocks-app__sheet-item-name">{item.name}</span>
                    </span>
                    <span class="stocks-app__sheet-item-sub">
                      {busy ? '正在添加…' : `${item.exchange} · ${item.subtitle}`}
                    </span>
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
