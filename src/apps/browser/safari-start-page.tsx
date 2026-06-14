import { useMemo, useState } from 'preact/hooks'
import { SearchIcon } from '../../icons/app-icons.tsx'
import {
  bookmarkAccentColor,
  bookmarkDisplayGlyph,
  loadBrowserBookmarks,
} from './browser-bookmarks.ts'
import { CompassMark } from './compass-mark.tsx'
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
          {/* 拟物化金属罗盘 —— 与全局应用图标共用同一组件，保持品牌一致 */}
          <span class="safari-start__compass">
            <CompassMark />
          </span>
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
          <section class="safari-start__favorites" aria-label="书签">
            <h2 class="safari-start__section-title">书签</h2>
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
