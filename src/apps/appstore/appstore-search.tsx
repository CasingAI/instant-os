import { BackIcon } from '../../icons/app-icons.tsx'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useOpenAiReady } from '../../ai/use-openai-ready.ts'
import { searchStoreListingsStreaming } from './store-agent.ts'
import type { GeneratedAppRecord, PendingInstall, StoreListing } from './types.ts'
import { ListingGrid } from './listing-grid.tsx'

type MarketplaceSearchProps = {
  installedApps: GeneratedAppRecord[]
  getPendingBySlug: (slug: string) => PendingInstall | undefined
  hasPendingUpdate: (slug: string) => boolean
  onBack: () => void
  onInstall: (listing: StoreListing) => Promise<void>
  onSelect: (slug: string, listings: StoreListing[]) => void
}

export function MarketplaceSearch({
  installedApps,
  getPendingBySlug,
  hasPendingUpdate,
  onBack,
  onInstall,
  onSelect,
}: MarketplaceSearchProps) {
  const apiReady = useOpenAiReady()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [results, setResults] = useState<StoreListing[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const runSearch = async () => {
    const trimmed = query.trim()
    if (!trimmed || !apiReady) return

    setActiveQuery(trimmed)
    setLoading(true)
    setError(undefined)
    setResults([])

    try {
      await searchStoreListingsStreaming(trimmed, (listing) => {
        setResults((current) => [...current, listing])
      })
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : '搜索失败')
    } finally {
      setLoading(false)
    }
  }

  const emptyMessage = !apiReady
    ? '请在系统设置 → 账户中配置 API Key'
    : activeQuery
      ? loading
        ? 'AI 正在想象搜索结果…'
        : '没有找到相关应用，试试其他关键词'
      : '输入关键词，AI 将为你现场生成搜索结果'

  return (
    <div class="appstore-search">
      <header class="appstore-search__nav">
        <button type="button" class="appstore-search__back" onClick={onBack}>
          <span class="appstore-search__back-icon" aria-hidden="true">
            <BackIcon size={13} />
          </span>
          应用集市
        </button>
      </header>

      <div class="appstore-search__bar">
        <span class="appstore-search__icon" aria-hidden="true">⌕</span>
        <input
          ref={inputRef}
          type="search"
          class="appstore-search__input"
          placeholder="游戏、工具、效率…"
          value={query}
          onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void runSearch()
            }
          }}
          disabled={!apiReady || loading}
          enterkeyhint="search"
        />
        {query && (
          <button
            type="button"
            class="appstore-search__clear"
            onClick={() => {
              setQuery('')
              setActiveQuery('')
              setResults([])
              setError(undefined)
              inputRef.current?.focus()
            }}
            aria-label="清除"
          >
            ×
          </button>
        )}
      </div>

      {error && (
        <div class="appstore__notice appstore__notice--error appstore-search__notice">{error}</div>
      )}

      {activeQuery && (
        <p class="appstore-search__heading">
          {loading ? `正在搜索「${activeQuery}」…` : `「${activeQuery}」· ${results.length} 个结果`}
        </p>
      )}

      <main class="appstore-search__results">
        <ListingGrid
          listings={results}
          installedApps={installedApps}
          loading={loading}
          getPendingBySlug={getPendingBySlug}
          hasPendingUpdate={hasPendingUpdate}
          onInstall={onInstall}
          onSelect={(slug) => onSelect(slug, results)}
          apiReady={apiReady}
          emptyMessage={emptyMessage}
          entering
        />
      </main>
    </div>
  )
}
