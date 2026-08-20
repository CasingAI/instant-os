import { useMemo } from 'preact/hooks'
import { hostnameFromUrl } from '../browser/normalize-browser-url.ts'
import { chromoBookmarkGlyph, loadChromoBookmarks } from './chromo-bookmarks.ts'
import { loadChromoHistory } from './chromo-history.ts'

const MAX_BOOKMARK_TILES = 8
const MAX_RECENT_TILES = 8

type ChromoNewTabPageProps = {
  bookmarksRevision: number
  historyRevision: number
  onNavigate: (url: string) => void
}

function tileLabel(title: string, url: string): string {
  return title.trim() || hostnameFromUrl(url) || url
}

function tileGlyph(title: string, url: string): string {
  const label = tileLabel(title, url)
  return (label.charAt(0) || '?').toUpperCase()
}

export function ChromoNewTabPage({
  bookmarksRevision,
  historyRevision,
  onNavigate,
}: ChromoNewTabPageProps) {
  const bookmarks = useMemo(
    () => loadChromoBookmarks().slice(0, MAX_BOOKMARK_TILES),
    [bookmarksRevision],
  )
  const recent = useMemo(() => {
    const bookmarked = new Set(loadChromoBookmarks().map((item) => item.url))
    return loadChromoHistory()
      .filter((item) => !bookmarked.has(item.url))
      .slice(0, MAX_RECENT_TILES)
  }, [bookmarksRevision, historyRevision])

  return (
    <div class="chromo-ntp" role="document" aria-label="新标签页">
      <div class="chromo-ntp__content">
        {bookmarks.length > 0 ? (
          <section class="chromo-ntp__section" aria-label="快捷方式">
            <h2 class="chromo-ntp__heading">快捷方式</h2>
            <div class="chromo-ntp__grid">
              {bookmarks.map((item) => (
                <ShortcutTile
                  key={item.url}
                  title={item.title}
                  url={item.url}
                  glyph={chromoBookmarkGlyph(item)}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </section>
        ) : null}

        {recent.length > 0 ? (
          <section class="chromo-ntp__section" aria-label="最近访问">
            <h2 class="chromo-ntp__heading">最近访问</h2>
            <div class="chromo-ntp__grid">
              {recent.map((item) => (
                <ShortcutTile
                  key={item.url}
                  title={item.title}
                  url={item.url}
                  glyph={tileGlyph(item.title, item.url)}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </section>
        ) : null}

        {bookmarks.length === 0 && recent.length === 0 ? (
          <div class="chromo-ntp__empty">
            <p class="chromo-ntp__empty-title">新标签页</p>
            <p class="chromo-ntp__empty-copy">在地址栏输入网址，或把常用网站加为书签</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ShortcutTile({
  title,
  url,
  glyph,
  onNavigate,
}: {
  title: string
  url: string
  glyph: string
  onNavigate: (url: string) => void
}) {
  const label = tileLabel(title, url)
  return (
    <button type="button" class="chromo-ntp__tile" onClick={() => onNavigate(url)} title={url}>
      <span class="chromo-ntp__glyph" aria-hidden="true">
        {glyph}
      </span>
      <span class="chromo-ntp__label">{label}</span>
    </button>
  )
}
