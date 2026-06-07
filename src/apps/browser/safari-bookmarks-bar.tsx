import { useMemo } from 'preact/hooks'
import {
  bookmarkAccentColor,
  bookmarkDisplayGlyph,
  loadBrowserBookmarks,
  type BrowserBookmark,
} from './browser-bookmarks.ts'
import { hostnameFromUrl } from './normalize-browser-url.ts'

export type SafariBookmarkContextRequest = {
  x: number
  y: number
  bookmark: BrowserBookmark
}

type SafariBookmarksBarProps = {
  revision: number
  onNavigate: (url: string) => void
  onContextMenu: (request: SafariBookmarkContextRequest) => void
}

function bookmarkLabel(item: BrowserBookmark): string {
  return item.title || hostnameFromUrl(item.url)
}

function bookmarkGlyph(item: BrowserBookmark): string {
  return item.emoji ?? bookmarkDisplayGlyph(item.url, item.title)
}

function bookmarkColor(item: BrowserBookmark): string {
  return item.color ?? bookmarkAccentColor(item.url)
}

export function SafariBookmarksBar({
  revision,
  onNavigate,
  onContextMenu,
}: SafariBookmarksBarProps) {
  const bookmarks = useMemo(() => loadBrowserBookmarks(), [revision])

  if (bookmarks.length === 0) {
    return undefined
  }

  return (
    <nav class="safari-bookmarks" aria-label="收藏栏">
      <div class="safari-bookmarks__scroll">
        {bookmarks.map((item) => (
          <button
            key={item.url}
            type="button"
            class="safari-bookmarks__item"
            title={bookmarkLabel(item)}
            onClick={() => onNavigate(item.url)}
            onContextMenu={(event) => {
              event.preventDefault()
              onContextMenu({
                x: event.clientX,
                y: event.clientY,
                bookmark: item,
              })
            }}
          >
            <span
              class="safari-bookmarks__icon"
              style={{ background: bookmarkColor(item) }}
              aria-hidden="true"
            >
              {bookmarkGlyph(item)}
            </span>
            <span class="safari-bookmarks__label">{bookmarkLabel(item)}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
