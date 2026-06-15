import { useEffect, useRef, useState } from 'preact/hooks'
import { useOpenAiReady } from '../../ai/use-openai-ready.ts'
import { SearchIcon } from '../../icons/app-icons.tsx'
import { searchStoreCatalogStreaming } from './books-agent.ts'
import { BooksCover, listingToCoverProps } from './books-cover.tsx'
import type { BookListing } from './books-types.ts'

type BooksStoreSearchProps = {
  librarySlugs: ReadonlySet<string>
  onOpenListing: (slug: string, results: BookListing[]) => void
}

export function BooksStoreSearch({ librarySlugs, onOpenListing }: BooksStoreSearchProps) {
  const apiReady = useOpenAiReady()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [results, setResults] = useState<BookListing[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const runSearch = async () => {
    const trimmed = query.trim()
    if (!trimmed || !apiReady || loading) return

    setActiveQuery(trimmed)
    setLoading(true)
    setError(undefined)
    setResults([])

    try {
      await searchStoreCatalogStreaming(trimmed, (listing) => {
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
        ? '正在搜索'
        : '没有找到相关书籍，试试其他关键词'
      : '输入关键词来搜索'

  return (
    <div class="books-store-search">
      <div class="books-store-search__bar">
        <span class="books-store-search__icon" aria-hidden="true">
          <SearchIcon />
        </span>
        <input
          ref={inputRef}
          type="text"
          class="books-store-search__input"
          placeholder="搜索书名、作者、题材、设定…"
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
          spellcheck={false}
          aria-label="搜索书籍"
        />
        <button
          type="button"
          class="books-store-search__submit"
          disabled={!query.trim() || !apiReady || loading}
          onClick={() => void runSearch()}
        >
          搜索
        </button>
      </div>

      {error && <div class="books-store-search__notice">{error}</div>}

      {activeQuery && (
        <p class="books-store-search__heading">
          {loading ? `正在搜索「${activeQuery}」…` : `「${activeQuery}」· ${results.length} 个结果`}
        </p>
      )}

      <div class="books-store-search__results">
        {loading && results.length === 0 ? (
          <div class="books-store__loading">
            <div class="books-store__spinner" />
            <p>正在搜索「{activeQuery}」…</p>
          </div>
        ) : results.length === 0 ? (
          <div class="books-store-search__empty">
            <p>{emptyMessage}</p>
          </div>
        ) : (
          <div class="books-store__grid">
            {results.map((listing) => (
              <button
                key={listing.slug}
                type="button"
                class="books-store__card"
                onClick={() => onOpenListing(listing.slug, results)}
              >
                <BooksCover {...listingToCoverProps(listing)} size="small" />
                <div class="books-store__card-body">
                  <span class="books-store__badge">{listing.category}</span>
                  <span class="books-store__card-title">{listing.title}</span>
                  <span class="books-store__card-author">{listing.author}</span>
                  <span class="books-store__card-synopsis">{listing.synopsis}</span>
                  {librarySlugs.has(listing.slug) && (
                    <span class="books-store__badge">已在书架</span>
                  )}
                </div>
              </button>
            ))}
            {loading && <div class="books-store-search__more">正在下载更多…</div>}
          </div>
        )}
      </div>
    </div>
  )
}
