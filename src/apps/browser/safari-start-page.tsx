import { useMemo, useState } from 'preact/hooks'
import { SearchIcon } from '../../icons/app-icons.tsx'
import {
  bookmarkAccentColor,
  bookmarkDisplayGlyph,
  loadBrowserBookmarks,
} from './browser-bookmarks.ts'
import { normalizeBrowserUrl } from './normalize-browser-url.ts'

type SafariStartPageProps = {
  bookmarksRevision: number
  onNavigate: (url: string) => void
}

export function SafariStartPage({ bookmarksRevision, onNavigate }: SafariStartPageProps) {
  const [query, setQuery] = useState('')
  const favorites = useMemo(() => loadBrowserBookmarks(), [bookmarksRevision])

  const greeting = useMemo(() => {
    const hour = new Date().getHours()
    if (hour < 12) {
      return '早上好'
    }
    if (hour < 18) {
      return '下午好'
    }
    return '晚上好'
  }, [])

  const submitSearch = (event: Event) => {
    event.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) {
      return
    }
    onNavigate(normalizeBrowserUrl(trimmed))
  }

  return (
    <div class="safari-start">
      <div class="safari-start__content">
        <div class="safari-start__brand" aria-hidden="true">
          <svg class="safari-start__compass" viewBox="0 0 80 80" width="64" height="64">
            <circle cx="40" cy="40" r="36" fill="none" stroke="currentColor" stroke-width="2" opacity="0.15" />
            <circle cx="40" cy="40" r="28" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25" />
            <text x="40" y="18" text-anchor="middle" fill="#ff3b30" font-size="11" font-weight="700">
              N
            </text>
            <path
              d="M40 22 L44 52 L40 46 L36 52 Z"
              fill="#ff3b30"
              opacity="0.9"
            />
            <path
              d="M40 46 L44 52 L36 52 Z"
              fill="#3a3a3c"
              opacity="0.55"
            />
            <circle cx="40" cy="40" r="3" fill="currentColor" opacity="0.35" />
          </svg>
        </div>

        <h1 class="safari-start__greeting">{greeting}</h1>
        <p class="safari-start__subtitle">输入网址或搜索关键词，开始浏览</p>

        <form class="safari-start__search" onSubmit={submitSearch}>
          <SearchIcon />
          <input
            type="text"
            class="safari-start__search-input"
            value={query}
            placeholder="搜索或输入网站名称"
            onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
            spellcheck={false}
            aria-label="搜索或输入网址"
          />
        </form>

        {favorites.length > 0 && (
          <section class="safari-start__favorites" aria-label="个人收藏">
            <h2 class="safari-start__section-title">个人收藏</h2>
            <div class="safari-start__grid">
              {favorites.map((item) => (
                <button
                  key={item.url}
                  type="button"
                  class="safari-start__tile"
                  onClick={() => onNavigate(item.url)}
                >
                  <span
                    class="safari-start__tile-icon"
                    style={{ background: item.color ?? bookmarkAccentColor(item.url) }}
                  >
                    {item.emoji ?? bookmarkDisplayGlyph(item.url, item.title)}
                  </span>
                  <span class="safari-start__tile-label">{item.title}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
