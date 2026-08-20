import { useMemo } from 'preact/hooks'
import { hostnameFromUrl } from '../browser/normalize-browser-url.ts'
import {
  chromoBookmarkGlyph,
  loadChromoBookmarks,
  type ChromoBookmark,
} from './chromo-bookmarks.ts'
import type { ChromoBookmarkContextRequest } from './chromo-bookmarks-bar.tsx'

type ChromoBookmarksPageProps = {
  revision: number
  onNavigate: (url: string) => void
  onDelete: (url: string) => void
  onContextMenu: (request: ChromoBookmarkContextRequest) => void
}

function bookmarkLabel(item: ChromoBookmark): string {
  return item.title.trim() || hostnameFromUrl(item.url) || item.url
}

export function ChromoBookmarksPage({
  revision,
  onNavigate,
  onDelete,
  onContextMenu,
}: ChromoBookmarksPageProps) {
  const bookmarks = useMemo(() => loadChromoBookmarks(), [revision])

  return (
    <div class="chromo-internal" role="document" aria-labelledby="chromo-bookmarks-title">
      <header class="chromo-internal__header">
        <h1 id="chromo-bookmarks-title" class="chromo-internal__title">
          书签
        </h1>
        <p class="chromo-internal__subtitle">{bookmarks.length} 个书签</p>
      </header>
      {bookmarks.length === 0 ? (
        <div class="chromo-internal__empty">还没有书签。点地址栏星标即可添加。</div>
      ) : (
        <ul class="chromo-bookmarks-page__list">
          {bookmarks.map((item) => (
            <li key={item.url} class="chromo-bookmarks-page__item">
              <button
                type="button"
                class="chromo-bookmarks-page__link"
                onClick={() => onNavigate(item.url)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  onContextMenu({ x: event.clientX, y: event.clientY, bookmark: item })
                }}
              >
                <span class="chromo-bookmarks__glyph" aria-hidden="true">
                  {chromoBookmarkGlyph(item)}
                </span>
                <span class="chromo-bookmarks-page__text">
                  <span class="chromo-bookmarks-page__label">{bookmarkLabel(item)}</span>
                  <span class="chromo-bookmarks-page__url">{hostnameFromUrl(item.url) || item.url}</span>
                </span>
              </button>
              <button
                type="button"
                class="chromo-bookmarks-page__delete"
                aria-label={`删除 ${bookmarkLabel(item)}`}
                onClick={() => onDelete(item.url)}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
