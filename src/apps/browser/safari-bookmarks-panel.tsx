import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { CloseIcon } from '../../icons/app-icons.tsx'
import '../../ui/overlay-presence.css'
import { useOverlayPresence } from '../../ui/use-overlay-presence.ts'
import {
  bookmarkAccentColor,
  bookmarkDisplayGlyph,
  loadBrowserBookmarks,
  type BrowserBookmark,
} from './browser-bookmarks.ts'
import { hostnameFromUrl } from './normalize-browser-url.ts'
import { beginSafariDrag, endSafariDrag, getActiveSafariDrag } from './safari-drag-bridge.ts'
import { setSafariBookmarkDragImage } from './safari-drag-ghost.ts'
import {
  SAFARI_BOOKMARK_MIME,
  SAFARI_URL_MIME,
  readExternalUrl,
  acceptsUrlDrop,
} from './safari-bookmarks-bar.tsx'
import type { SafariBookmarkContextRequest } from './safari-bookmarks-bar.tsx'

type SafariBookmarksPanelProps = {
  open: boolean
  revision: number
  contextMenuOpen: boolean
  onClose: () => void
  onDismissContextMenu: () => void
  onNavigate: (url: string) => void
  onContextMenu: (request: SafariBookmarkContextRequest) => void
  onReorder: (fromUrl: string, toIndex: number) => void
  onAddBookmark: (url: string, index: number, title?: string) => void
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

export function SafariBookmarksPanel({
  open,
  revision,
  contextMenuOpen,
  onClose,
  onDismissContextMenu,
  onNavigate,
  onContextMenu,
  onReorder,
  onAddBookmark,
}: SafariBookmarksPanelProps) {
  const { mounted, exiting } = useOverlayPresence(open)
  const bookmarks = useMemo(() => (mounted ? loadBrowserBookmarks() : []), [mounted, revision])
  const [dropTarget, setDropTarget] = useState<{ index: number; side: 'before' | 'after' } | null>(
    null,
  )
  const [draggingUrl, setDraggingUrl] = useState<string | undefined>(undefined)
  const isInsideDragRef = useRef(false)

  const finishDrag = useCallback(() => {
    isInsideDragRef.current = false
    setDraggingUrl(undefined)
    setDropTarget(null)
    endSafariDrag()
  }, [])

  useEffect(() => {
    if (!open) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  const computeInsertion = useCallback(
    (event: DragEvent, el: HTMLElement, index: number) => {
      const rect = el.getBoundingClientRect()
      const midY = rect.top + rect.height / 2
      const side = event.clientY < midY ? 'before' : 'after'
      return side === 'before'
        ? { index, side: 'before' as const }
        : { index: index + 1, side: 'after' as const }
    },
    [],
  )

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

  const resolveDropEffect = useCallback((): 'copy' | 'move' => {
    const active = getActiveSafariDrag()
    if (isInsideDragRef.current || active?.kind === 'bookmark') {
      return 'move'
    }
    return 'copy'
  }, [])

  const applyDrop = useCallback(
    (event: DragEvent, index: number) => {
      const pending = getActiveSafariDrag()
      const bookmarkMime = event.dataTransfer?.getData(SAFARI_BOOKMARK_MIME)
      if (bookmarkMime) {
        onReorder(bookmarkMime, index)
        return
      }

      const externalUrl = readExternalUrl(event)
      if (externalUrl) {
        onAddBookmark(externalUrl, index, pending?.kind === 'url' ? pending.title : undefined)
        return
      }

      if (pending?.kind === 'bookmark') {
        onReorder(pending.url, index)
        return
      }

      if (pending?.kind === 'url') {
        onAddBookmark(pending.url, index, pending.title)
      }
    },
    [onAddBookmark, onReorder],
  )

  const handleItemDragOver = useCallback(
    (event: DragEvent, el: HTMLElement, index: number) => {
      if (!acceptsUrlDrop(event, isInsideDragRef.current)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = resolveDropEffect()
      }
      setDropTarget(computeInsertion(event, el, index))
    },
    [computeInsertion, resolveDropEffect],
  )

  const handleItemDrop = useCallback(
    (event: DragEvent, index: number) => {
      const insertion = computeInsertion(event, event.currentTarget as HTMLElement, index)
      event.preventDefault()
      event.stopPropagation()
      applyDrop(event, insertion.index)
      finishDrag()
    },
    [applyDrop, computeInsertion, finishDrag],
  )

  if (!mounted) {
    return undefined
  }

  const handleSelect = (url: string) => {
    onNavigate(url)
    onClose()
  }

  const handleBackdropClick = () => {
    if (contextMenuOpen) {
      onDismissContextMenu()
      return
    }
    onClose()
  }

  const handleContextMenu = (request: SafariBookmarkContextRequest) => {
    onContextMenu(request)
  }

  return (
    <div
      class={[
        'safari-bookmarks-panel-backdrop',
        'overlay-presence__backdrop',
        exiting ? 'overlay-presence__backdrop--exiting' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="presentation"
      onClick={handleBackdropClick}
    >
      <aside
        class={[
          'safari-bookmarks-panel',
          'overlay-presence__sheet',
          exiting ? 'overlay-presence__sheet--exiting' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label="全部书签"
        onClick={(event) => event.stopPropagation()}
      >
        <header class="safari-bookmarks-panel__header">
          <div>
            <h2 class="safari-bookmarks-panel__title">全部书签</h2>
            <p class="safari-bookmarks-panel__subtitle">{bookmarks.length} 个书签</p>
          </div>
          <button type="button" class="safari-bookmarks-panel__close" onClick={onClose} aria-label="关闭">
            <CloseIcon />
          </button>
        </header>

        {bookmarks.length === 0 ? (
          <div class="safari-bookmarks-panel__empty">
            <p>暂无书签</p>
            <span>将地址栏拖到书签栏，或点击收藏按钮添加</span>
          </div>
        ) : (
          <div class="safari-bookmarks-panel__body">
            <ul class="safari-bookmarks-panel__list">
              {bookmarks.map((item, index) => (
                <li
                  key={item.url}
                  class={[
                    'safari-bookmarks-panel__item',
                    draggingUrl === item.url ? 'safari-bookmarks-panel__item--dragging' : '',
                    dropTarget && dropTarget.index === index && dropTarget.side === 'before'
                      ? 'safari-bookmarks-panel__item--drop-before'
                      : '',
                    dropTarget && dropTarget.index === index + 1 && dropTarget.side === 'after'
                      ? 'safari-bookmarks-panel__item--drop-after'
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  draggable
                  onDragStart={(event) => handleItemDragStart(event, item)}
                  onDragEnd={handleItemDragEnd}
                  onDragOver={(event) =>
                    handleItemDragOver(event, event.currentTarget as HTMLElement, index)
                  }
                  onDrop={(event) => handleItemDrop(event, index)}
                >
                  <button
                    type="button"
                    class="safari-bookmarks-panel__link"
                    onClick={() => handleSelect(item.url)}
                  >
                    <span
                      class="safari-bookmarks-panel__icon"
                      style={{ background: bookmarkColor(item) }}
                      aria-hidden="true"
                    >
                      {bookmarkGlyph(item)}
                    </span>
                    <span class="safari-bookmarks-panel__text">
                      <span class="safari-bookmarks-panel__label">{bookmarkLabel(item)}</span>
                      <span class="safari-bookmarks-panel__url">{hostnameFromUrl(item.url)}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    class="safari-bookmarks-panel__context"
                    aria-label={`${bookmarkLabel(item)} 的更多操作`}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      handleContextMenu({
                        x: event.clientX,
                        y: event.clientY,
                        bookmark: item,
                      })
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      handleContextMenu({
                        x: event.clientX,
                        y: event.clientY,
                        bookmark: item,
                      })
                    }}
                  >
                    ···
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

      </aside>
    </div>
  )
}
