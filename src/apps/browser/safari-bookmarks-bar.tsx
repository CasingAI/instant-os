import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  bookmarkAccentColor,
  bookmarkDisplayGlyph,
  loadBrowserBookmarks,
  type BrowserBookmark,
} from './browser-bookmarks.ts'
import { hostnameFromUrl } from './normalize-browser-url.ts'
import { beginSafariDrag, endSafariDrag, getActiveSafariDrag, isSafariDragActive } from './safari-drag-bridge.ts'
import { setSafariBookmarkDragImage } from './safari-drag-ghost.ts'

export type SafariBookmarkContextRequest = {
  x: number
  y: number
  bookmark: BrowserBookmark
}

type SafariBookmarksBarProps = {
  revision: number
  overflowOpen: boolean
  onToggleOverflow: () => void
  onNavigate: (url: string) => void
  onContextMenu: (request: SafariBookmarkContextRequest) => void
  /** 把地址栏拖入的 URL 作为新书签插入到 index；index 越界则追加到末尾。 */
  onAddBookmark: (url: string, index: number, title?: string) => void
  /** 内部排序：把 fromUrl 的书签移动到（移除后数组的）toIndex。 */
  onReorder: (fromUrl: string, toIndex: number) => void
}

/** 拖拽时写入 dataTransfer 的自定义 MIME，用于区分「地址栏 URL」与「书签内部排序」。 */
export const SAFARI_URL_MIME = 'application/x-safari-url'
export const SAFARI_BOOKMARK_MIME = 'application/x-safari-bookmark'

function hasDropTypes(event: DragEvent): boolean {
  const types = event.dataTransfer?.types
  if (!types) {
    return false
  }

  const list = typeof types.includes === 'function' ? types : Array.from(types)
  return (
    list.includes(SAFARI_URL_MIME) ||
    list.includes(SAFARI_BOOKMARK_MIME) ||
    list.includes('text/uri-list') ||
    list.includes('text/plain')
  )
}

export function acceptsUrlDrop(event: DragEvent, isInsideDrag: boolean): boolean {
  return isInsideDrag || isSafariDragActive() || hasDropTypes(event)
}

export function readExternalUrl(event: DragEvent): string | undefined {
  const fromMime = event.dataTransfer?.getData(SAFARI_URL_MIME)
  if (fromMime) {
    return fromMime
  }

  const fromUriList = event.dataTransfer?.getData('text/uri-list')
  if (fromUriList) {
    return fromUriList.split('\n').find((line) => line.trim() && !line.startsWith('#'))?.trim()
  }

  const fromPlain = event.dataTransfer?.getData('text/plain')
  return fromPlain?.trim() || undefined
}

function resolveDropEffect(isInsideDrag: boolean): 'copy' | 'move' {
  const active = getActiveSafariDrag()
  if (isInsideDrag || active?.kind === 'bookmark') {
    return 'move'
  }
  return 'copy'
}

function resolveDroppedPayload(event: DragEvent): { kind: 'url' | 'bookmark'; url: string; title?: string } | undefined {
  const pending = getActiveSafariDrag()

  const bookmarkMime = event.dataTransfer?.getData(SAFARI_BOOKMARK_MIME)
  if (bookmarkMime) {
    return { kind: 'bookmark', url: bookmarkMime }
  }

  const externalUrl = readExternalUrl(event)
  if (externalUrl) {
    return {
      kind: 'url',
      url: externalUrl,
      title: pending?.kind === 'url' ? pending.title : undefined,
    }
  }

  return pending
}

function applyDrop(
  event: DragEvent,
  index: number,
  onAddBookmark: SafariBookmarksBarProps['onAddBookmark'],
  onReorder: SafariBookmarksBarProps['onReorder'],
): void {
  const payload = resolveDroppedPayload(event)
  if (!payload) {
    return
  }

  if (payload.kind === 'bookmark') {
    onReorder(payload.url, index)
    return
  }

  onAddBookmark(payload.url, index, payload.title)
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
  overflowOpen,
  onToggleOverflow,
  onNavigate,
  onContextMenu,
  onAddBookmark,
  onReorder,
}: SafariBookmarksBarProps) {
  const bookmarks = useMemo(() => loadBrowserBookmarks(), [revision])

  const scrollRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState<number>(bookmarks.length)

  const [dropTarget, setDropTarget] = useState<{ index: number; side: 'before' | 'after' } | null>(
    null,
  )
  const [draggingUrl, setDraggingUrl] = useState<string | undefined>(undefined)
  const isInsideDragRef = useRef(false)

  const resolveInsertionByPointer = useCallback(
    (clientX: number): { index: number; side: 'before' | 'after' } => {
      const scroll = scrollRef.current
      if (!scroll) {
        return { index: bookmarks.length, side: 'after' }
      }

      const items = Array.from(
        scroll.querySelectorAll<HTMLElement>(
          '.safari-bookmarks__item:not(.safari-bookmarks__item--overflowing)',
        ),
      )

      for (let index = 0; index < items.length; index += 1) {
        const rect = items[index].getBoundingClientRect()
        const midX = rect.left + rect.width / 2
        if (clientX < midX) {
          return { index, side: 'before' }
        }
      }

      return { index: bookmarks.length, side: 'after' }
    },
    [bookmarks.length],
  )

  // 测量：计算书签栏能放下的书签数（为溢出按钮预留空间）
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
      const gap = 4
      const overflowBtnSpace = 34

      let totalWidth = 0
      const widths: number[] = []
      for (let i = 0; i < items.length; i += 1) {
        const w = items[i].offsetWidth
        widths.push(w)
        totalWidth += w + (i > 0 ? gap : 0)
      }

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
      const ro = new ResizeObserver(measure)
      ro.observe(scroll)
      return () => ro.disconnect()
    }

    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [bookmarks.length])

  const finishDrag = useCallback(() => {
    isInsideDragRef.current = false
    setDraggingUrl(undefined)
    setDropTarget(null)
    endSafariDrag()
  }, [])

  const handleItemDragStart = useCallback((event: DragEvent, item: BrowserBookmark) => {
    isInsideDragRef.current = true
    setDraggingUrl(item.url)
    beginSafariDrag({ kind: 'bookmark', url: item.url, title: bookmarkLabel(item) })
    event.dataTransfer?.setData(SAFARI_BOOKMARK_MIME, item.url)
    event.dataTransfer?.setData(SAFARI_URL_MIME, item.url)
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copyMove'
    }
    setSafariBookmarkDragImage(event, {
      glyph: bookmarkGlyph(item),
      label: bookmarkLabel(item),
      color: bookmarkColor(item),
    })
  }, [])

  const handleItemDragEnd = useCallback(() => {
    finishDrag()
  }, [finishDrag])

  const computeInsertion = useCallback((event: DragEvent, el: HTMLElement, index: number) => {
    const rect = el.getBoundingClientRect()
    const midX = rect.left + rect.width / 2
    const side = event.clientX < midX ? 'before' : 'after'
    return side === 'before' ? { index, side: 'before' as const } : { index: index + 1, side: 'after' as const }
  }, [])

  const handleItemDragOver = useCallback(
    (event: DragEvent, el: HTMLElement, index: number) => {
      if (!acceptsUrlDrop(event, isInsideDragRef.current)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = resolveDropEffect(isInsideDragRef.current)
      }
      setDropTarget(computeInsertion(event, el, index))
    },
    [computeInsertion],
  )

  const handleItemDrop = useCallback(
    (event: DragEvent, el: HTMLElement, index: number) => {
      const insertion = computeInsertion(event, el, index)
      event.preventDefault()
      event.stopPropagation()
      applyDrop(event, insertion.index, onAddBookmark, onReorder)
      finishDrag()
    },
    [computeInsertion, finishDrag, onAddBookmark, onReorder],
  )

  const handleContainerDragOver = useCallback(
    (event: DragEvent) => {
      if (!acceptsUrlDrop(event, isInsideDragRef.current)) {
        return
      }
      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = resolveDropEffect(isInsideDragRef.current)
      }
      setDropTarget(resolveInsertionByPointer(event.clientX))
    },
    [resolveInsertionByPointer],
  )

  const handleContainerDrop = useCallback(
    (event: DragEvent) => {
      if (event.defaultPrevented) {
        return
      }
      event.preventDefault()
      const insertion = resolveInsertionByPointer(event.clientX)
      applyDrop(event, insertion.index, onAddBookmark, onReorder)
      finishDrag()
    },
    [finishDrag, onAddBookmark, onReorder, resolveInsertionByPointer],
  )

  const handleContainerDragLeave = useCallback((event: DragEvent) => {
    const next = event.relatedTarget as Node | null
    if (next && event.currentTarget instanceof HTMLElement && event.currentTarget.contains(next)) {
      return
    }
    setDropTarget(null)
  }, [])

  const hasOverflow = visibleCount < bookmarks.length
  const isDropActive = dropTarget !== null

  if (bookmarks.length === 0) {
    return (
      <nav
        class={['safari-bookmarks', 'safari-bookmarks--empty', isDropActive ? 'safari-bookmarks--drop-active' : '']
          .filter(Boolean)
          .join(' ')}
        aria-label="书签栏"
        onDragOver={handleContainerDragOver}
        onDrop={handleContainerDrop}
        onDragLeave={handleContainerDragLeave}
      >
        <div class="safari-bookmarks__empty-hint">将地址栏拖到此处以添加书签</div>
      </nav>
    )
  }

  return (
    <nav
      class={['safari-bookmarks', isDropActive ? 'safari-bookmarks--drop-active' : ''].filter(Boolean).join(' ')}
      aria-label="书签栏"
      onDragOver={handleContainerDragOver}
      onDrop={handleContainerDrop}
      onDragLeave={handleContainerDragLeave}
    >
      <div class="safari-bookmarks__scroll" ref={scrollRef}>
        {bookmarks.map((item, index) => {
          const overflowing = index >= visibleCount
          return (
            <div
              key={item.url}
              role="button"
              class={[
                'safari-bookmarks__item',
                overflowing ? 'safari-bookmarks__item--overflowing' : '',
                draggingUrl === item.url ? 'safari-bookmarks__item--dragging' : '',
                dropTarget && dropTarget.index === index && dropTarget.side === 'before'
                  ? 'safari-bookmarks__item--drop-before'
                  : '',
                dropTarget && dropTarget.index === index + 1 && dropTarget.side === 'after'
                  ? 'safari-bookmarks__item--drop-after'
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-bm-index={index}
              aria-hidden={hasOverflow && overflowing}
              tabIndex={hasOverflow && overflowing ? -1 : 0}
              draggable={!overflowing}
              title={bookmarkLabel(item)}
              onDragStart={(event) => handleItemDragStart(event, item)}
              onDragEnd={handleItemDragEnd}
              onDragOver={(event) => handleItemDragOver(event, event.currentTarget as HTMLElement, index)}
              onDrop={(event) => handleItemDrop(event, event.currentTarget as HTMLElement, index)}
              onClick={() => onNavigate(item.url)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onNavigate(item.url)
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                onContextMenu({ x: event.clientX, y: event.clientY, bookmark: item })
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
            </div>
          )
        })}
      </div>

      {hasOverflow && (
        <button
          type="button"
          class={[
            'safari-bookmarks__overflow-btn',
            overflowOpen ? 'safari-bookmarks__overflow-btn--active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-label="显示全部书签"
          aria-expanded={overflowOpen}
          onClick={onToggleOverflow}
        >
          <svg viewBox="0 0 16 4" width="16" height="4" aria-hidden="true">
            <circle cx="2" cy="2" r="1.6" fill="currentColor" />
            <circle cx="8" cy="2" r="1.6" fill="currentColor" />
            <circle cx="14" cy="2" r="1.6" fill="currentColor" />
          </svg>
        </button>
      )}
    </nav>
  )
}
