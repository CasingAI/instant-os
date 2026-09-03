import { useMemo } from 'preact/hooks'
import { osNowMs } from '../../os/os-clock.ts'
import { Button } from '../../ui/button.tsx'
import { displayUrl, hostnameFromUrl } from '../browser/normalize-browser-url.ts'
import {
  clearChromoHistory,
  loadChromoHistory,
  removeChromoHistoryVisit,
  type ChromoHistoryVisit,
} from './chromo-history.ts'

type ChromoHistoryPageProps = {
  revision: number
  onNavigate: (url: string) => void
  onHistoryChange?: () => void
}

type HistoryGroup = {
  label: string
  entries: ChromoHistoryVisit[]
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function groupHistoryByDate(visits: ChromoHistoryVisit[]): HistoryGroup[] {
  const groups = new Map<string, ChromoHistoryVisit[]>()
  const today = startOfDay(osNowMs())
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

export function ChromoHistoryPage({
  revision,
  onNavigate,
  onHistoryChange,
}: ChromoHistoryPageProps) {
  const visits = useMemo(() => loadChromoHistory(), [revision])
  const groups = useMemo(() => groupHistoryByDate(visits), [visits])

  const bump = () => onHistoryChange?.()

  const handleClearAll = () => {
    clearChromoHistory()
    bump()
  }

  const handleRemove = (url: string) => {
    removeChromoHistoryVisit(url)
    bump()
  }

  return (
    <div class="chromo-internal" role="document" aria-labelledby="chromo-history-title">
      <header class="chromo-internal__header">
        <h1 id="chromo-history-title" class="chromo-internal__title">
          历史记录
        </h1>
        <p class="chromo-internal__subtitle">{visits.length} 个页面</p>
      </header>

      {visits.length === 0 ? (
        <div class="chromo-internal__empty">访问过的网页会显示在这里</div>
      ) : (
        <div class="chromo-internal__body">
          {groups.map((group) => (
            <section key={group.label} class="chromo-history-page__group">
              <h2 class="chromo-history-page__group-label">{group.label}</h2>
              <ul class="chromo-history-page__list">
                {group.entries.map((entry) => (
                  <li key={`${entry.url}-${entry.visitedAt}`} class="chromo-history-page__item">
                    <span class="chromo-history-page__glyph" aria-hidden="true">
                      {siteInitial(entry.url)}
                    </span>
                    <button
                      type="button"
                      class="chromo-history-page__link"
                      onClick={() => onNavigate(entry.url)}
                    >
                      <span class="chromo-history-page__label">{entry.title}</span>
                      <span class="chromo-history-page__url">{displayUrl(entry.url)}</span>
                    </button>
                    <span class="chromo-history-page__time">{formatVisitTime(entry.visitedAt)}</span>
                    <button
                      type="button"
                      class="chromo-history-page__delete"
                      aria-label={`删除 ${entry.title}`}
                      onClick={() => handleRemove(entry.url)}
                    >
                      删除
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {visits.length > 0 ? (
        <footer class="chromo-internal__footer">
          <Button size="compact" onClick={handleClearAll}>
            清空历史记录
          </Button>
        </footer>
      ) : null}
    </div>
  )
}
