import { SafariStartPage } from './safari-start-page.tsx'
import { SafariStreamBackdrop } from './safari-stream-backdrop.tsx'
import { SafariPageFrame } from './safari-page-frame.tsx'
import type { SafariFrameContextMenuRequest } from './attach-safari-frame-navigation.ts'
import { isStartPageUrl, pageTitleFromUrl } from './normalize-browser-url.ts'

type SafariTabPaneProps = {
  active: boolean
  tabId: string
  url: string
  title: string
  historyIndex: number
  html: string
  loading: boolean
  streaming: boolean
  rawText: string
  reasoningText: string
  error: string | undefined
  bookmarksRevision: number
  onStartPageNavigate: (url: string) => void
  onPageNavigate: (url: string) => void
  onReload: () => void
  onFocusWindow?: () => void
  onContextMenu?: (request: SafariFrameContextMenuRequest) => void
}

export function SafariTabPane({
  active,
  tabId,
  url,
  title,
  historyIndex,
  html,
  loading,
  streaming,
  rawText,
  reasoningText,
  error,
  bookmarksRevision,
  onStartPageNavigate,
  onPageNavigate,
  onReload,
  onFocusWindow,
  onContextMenu,
}: SafariTabPaneProps) {
  const onStartPage = isStartPageUrl(url)
  const showProgress = loading || streaming
  const showStreamBackdrop = showProgress && Boolean(rawText || reasoningText)

  return (
    <div
      class={`safari__tab-pane ${active ? 'safari__tab-pane--active' : ''}`}
      aria-hidden={!active}
    >
      {onStartPage ? (
        <SafariStartPage bookmarksRevision={bookmarksRevision} onNavigate={onStartPageNavigate} />
      ) : error ? (
        <div class="safari__error">
          <div class="safari__error-icon" aria-hidden="true">
            !
          </div>
          <h1>无法打开此页面</h1>
          <p>{error}</p>
          <p class="safari__error-url">{url}</p>
          <button type="button" class="safari__error-retry" onClick={onReload}>
            重新加载
          </button>
        </div>
      ) : (
        <div class="safari__content-stack">
          <SafariStreamBackdrop
            reasoningText={showStreamBackdrop ? reasoningText : ''}
            contentText={showStreamBackdrop ? rawText : ''}
          />
          {loading && !rawText && !reasoningText && (
            <div class="safari__loading-overlay">
              <div class="safari__loading-spinner" />
              <p>正在连接 {pageTitleFromUrl(url)}</p>
            </div>
          )}
          <SafariPageFrame
            frameKey={`${tabId}:${historyIndex}`}
            pageUrl={url}
            html={html}
            streaming={showStreamBackdrop}
            title={title}
            onNavigate={onPageNavigate}
            onFocus={onFocusWindow}
            onContextMenu={onContextMenu}
          />
        </div>
      )}
    </div>
  )
}
