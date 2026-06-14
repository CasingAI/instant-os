import { useMemo } from 'preact/hooks'
import { CloseIcon } from '../../icons/app-icons.tsx'
import '../../ui/overlay-presence.css'
import { useOverlayPresence } from '../../ui/use-overlay-presence.ts'
import {
  clearBrowserHistory,
  loadBrowserHistory,
  removeBrowserHistoryVisit,
  type HistoryVisitRecord,
} from './browser-history.ts'
import { displayUrl, hostnameFromUrl } from './normalize-browser-url.ts'

type SafariHistoryPanelProps = {
  open: boolean
  revision: number
  onClose: () => void
  onNavigate: (url: string) => void
  onHistoryChange?: () => void
}

type HistoryGroup = {
  label: string
  entries: HistoryVisitRecord[]
}

function groupHistoryByDate(visits: HistoryVisitRecord[]): HistoryGroup[] {
  const groups = new Map<string, HistoryVisitRecord[]>()
  const today = startOfDay(Date.now())
  const yesterday = today - 86_400_000

  for (const visit of visits) {
    const dayStart = startOfDay(visit.visitedAt)
    let label: string

    if (dayStart === today) {
      label = '今天'
    } else if (dayStart === yesterday) {
      label = '昨天'
    } else {
      label = new Date(visit.visitedAt).toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    }

    const bucket = groups.get(label) ?? []
    bucket.push(visit)
    groups.set(label, bucket)
  }

  return [...groups.entries()].map(([label, entries]) => ({ label, entries }))
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function formatVisitTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function siteInitial(url: string): string {
  const host = hostnameFromUrl(url)
  return host.charAt(0).toUpperCase() || '?'
}

export function SafariHistoryPanel({
  open,
  revision,
  onClose,
  onNavigate,
  onHistoryChange,
}: SafariHistoryPanelProps) {
  const { mounted, exiting } = useOverlayPresence(open)
  const visits = useMemo(() => (mounted ? loadBrowserHistory() : []), [mounted, revision])
  const groups = useMemo(() => groupHistoryByDate(visits), [visits])

  if (!mounted) {
    return undefined
  }

  const bump = () => onHistoryChange?.()

  const handleClearAll = () => {
    clearBrowserHistory()
    bump()
    onClose()
  }

  const handleRemove = (url: string) => {
    removeBrowserHistoryVisit(url)
    bump()
  }

  const handleSelect = (url: string) => {
    onNavigate(url)
    onClose()
  }

  return (
    <div
      class={[
        'safari-history-backdrop',
        'overlay-presence__backdrop',
        exiting ? 'overlay-presence__backdrop--exiting' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="presentation"
      onClick={onClose}
    >
      <aside
        class={[
          'safari-history',
          'overlay-presence__sheet',
          exiting ? 'overlay-presence__sheet--exiting' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label="浏览历史"
        onClick={(event) => event.stopPropagation()}
      >
        <header class="safari-history__header">
          <div>
            <h2 class="safari-history__title">历史记录</h2>
            <p class="safari-history__subtitle">{visits.length} 个页面</p>
          </div>
          <button type="button" class="safari-history__close" onClick={onClose} aria-label="关闭">
            <CloseIcon />
          </button>
        </header>

        {visits.length === 0 ? (
          <div class="safari-history__empty">
            <p>暂无浏览历史</p>
            <span>访问过的网页会显示在这里</span>
          </div>
        ) : (
          <div class="safari-history__body">
            {groups.map((group) => (
              <section key={group.label} class="safari-history__group">
                <h3 class="safari-history__group-label">{group.label}</h3>
                <ul class="safari-history__list">
                  {group.entries.map((entry) => (
                    <li key={`${entry.url}-${entry.visitedAt}`} class="safari-history__item">
                      <span class="safari-history__favicon" aria-hidden="true">
                        {siteInitial(entry.url)}
                      </span>
                      <button
                        type="button"
                        class="safari-history__link"
                        onClick={() => handleSelect(entry.url)}
                      >
                        <span class="safari-history__item-title">{entry.title}</span>
                        <span class="safari-history__item-url">{displayUrl(entry.url)}</span>
                      </button>
                      <span class="safari-history__item-time">{formatVisitTime(entry.visitedAt)}</span>
                      <button
                        type="button"
                        class="safari-history__item-remove"
                        aria-label={`删除 ${entry.title}`}
                        onClick={() => handleRemove(entry.url)}
                      >
                        <CloseIcon />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {visits.length > 0 && (
          <footer class="safari-history__footer">
            <button type="button" class="safari-history__clear" onClick={handleClearAll}>
              清空历史记录
            </button>
          </footer>
        )}
      </aside>
    </div>
  )
}
