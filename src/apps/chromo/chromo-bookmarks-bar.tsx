import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { hostnameFromUrl } from '../browser/normalize-browser-url.ts'
import {
  chromoBookmarkGlyph,
  loadChromoBookmarks,
  type ChromoBookmark,
} from './chromo-bookmarks.ts'

export type ChromoBookmarkContextRequest = {
  x: number
  y: number
  bookmark: ChromoBookmark
}

type ChromoBookmarksBarProps = {
  revision: number
  overflowOpen: boolean
  onToggleOverflow: () => void
  onNavigate: (url: string) => void
  onContextMenu: (request: ChromoBookmarkContextRequest) => void
}

function bookmarkLabel(item: ChromoBookmark): string {
  return item.title.trim() || hostnameFromUrl(item.url) || item.url
}

export function ChromoBookmarksBar({
  revision,
  overflowOpen,
  onToggleOverflow,
  onNavigate,
  onContextMenu,
}: ChromoBookmarksBarProps) {
  const bookmarks = useMemo(() => loadChromoBookmarks(), [revision])
  const scrollRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(bookmarks.length)

  useLayoutEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) {
      return
    }

    const measure = () => {
      const items = Array.from(scroll.querySelectorAll<HTMLElement>('[data-bm-index]'))
      if (items.length === 0) {
        setVisibleCount(bookmarks.length)
        return
      }

      const available = scroll.clientWidth
      const gap = 2
      const overflowBtnSpace = 32
      const widths = items.map((item) => item.offsetWidth)
      const totalWidth = widths.reduce((sum, width, index) => sum + width + (index > 0 ? gap : 0), 0)

      if (totalWidth <= available) {
        setVisibleCount(items.length)
        return
      }

      let fit = items.length
      let visibleWidth = totalWidth
      while (fit > 0 && visibleWidth + overflowBtnSpace > available) {
        fit -= 1
        visibleWidth -= widths[fit] + (fit > 0 ? gap : 0)
      }
      setVisibleCount(Math.max(0, fit))
    }

    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure)
      observer.observe(scroll)
      return () => observer.disconnect()
    }

    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [bookmarks.length, revision])

  useLayoutEffect(() => {
    if (!overflowOpen) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('.chromo-bookmarks__overflow')) {
        return
      }
      onToggleOverflow()
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [onToggleOverflow, overflowOpen])

  const handleContextMenu = useCallback(
    (event: MouseEvent, bookmark: ChromoBookmark) => {
      event.preventDefault()
      event.stopPropagation()
      onContextMenu({ x: event.clientX, y: event.clientY, bookmark })
    },
    [onContextMenu],
  )

  const overflowing = bookmarks.slice(visibleCount)
  const hasOverflow = overflowing.length > 0

  return (
    <div class="chromo-bookmarks" role="navigation" aria-label="书签栏">
      <div class="chromo-bookmarks__scroll" ref={scrollRef}>
        {bookmarks.map((item, index) => {
          const hidden = hasOverflow && index >= visibleCount
          return (
            <button
              key={item.url}
              type="button"
              data-bm-index={index}
              class={['chromo-bookmarks__item', hidden ? 'chromo-bookmarks__item--overflowing' : '']
                .filter(Boolean)
                .join(' ')}
              title={bookmarkLabel(item)}
              aria-hidden={hidden}
              tabIndex={hidden ? -1 : 0}
              onClick={() => onNavigate(item.url)}
              onContextMenu={(event) => handleContextMenu(event, item)}
            >
              <span class="chromo-bookmarks__glyph" aria-hidden="true">
                {chromoBookmarkGlyph(item)}
              </span>
              <span class="chromo-bookmarks__label">{bookmarkLabel(item)}</span>
            </button>
          )
        })}
      </div>
      {hasOverflow ? (
        <div class="chromo-bookmarks__overflow">
          <button
            type="button"
            class={[
              'chromo-bookmarks__overflow-btn',
              overflowOpen ? 'chromo-bookmarks__overflow-btn--active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-label="更多书签"
            aria-expanded={overflowOpen}
            onClick={onToggleOverflow}
          >
            »
          </button>
          {overflowOpen ? (
            <div class="chromo-bookmarks__overflow-menu" role="menu">
              {overflowing.map((item) => (
                <button
                  key={item.url}
                  type="button"
                  class="chromo-bookmarks__overflow-item"
                  role="menuitem"
                  onClick={() => onNavigate(item.url)}
                  onContextMenu={(event) => handleContextMenu(event, item)}
                >
                  <span class="chromo-bookmarks__glyph" aria-hidden="true">
                    {chromoBookmarkGlyph(item)}
                  </span>
                  {bookmarkLabel(item)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
