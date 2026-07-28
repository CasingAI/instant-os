import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ChromoNetworkEntry, ChromoNetworkBodyReadResult } from './chromo-bridge.ts'
import { NetworkDetailDrawer } from './chromo-network-detail.tsx'

type ChromoNetworkPanelProps = {
  entries: ChromoNetworkEntry[]
  selectedId?: string
  pageLoading?: boolean
  pageError?: string
  pageUrl?: string
  disableNetworkCache?: boolean
  readNetworkBody?: (entryId: string) => Promise<ChromoNetworkBodyReadResult>
  onSelect: (entry: ChromoNetworkEntry) => void
  onCloseDetail?: () => void
}

type NetworkSummary = {
  completedCount: number
  totalCount: number
  totalBytes: number
  pageStatus: string
  loadDurationMs: number | null
  hasPending: boolean
}

type NetworkSortColumn = 'name' | 'status' | 'waterfall' | 'duration' | 'size'
type NetworkSortDirection = 'asc' | 'desc'
type NetworkTypeFilter = 'all' | 'document' | 'script' | 'stylesheet' | 'xhr' | 'image' | 'font' | 'media' | 'websocket' | 'wasm' | 'other'

const TYPE_FILTERS: { id: NetworkTypeFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'document', label: 'Doc' },
  { id: 'script', label: 'JS' },
  { id: 'stylesheet', label: 'CSS' },
  { id: 'xhr', label: 'Fetch/XHR' },
  { id: 'image', label: 'Img' },
  { id: 'font', label: 'Font' },
  { id: 'media', label: 'Media' },
  { id: 'websocket', label: 'WS' },
  { id: 'wasm', label: 'Wasm' },
  { id: 'other', label: 'Other' },
]

const SORT_COLUMNS: { id: NetworkSortColumn; label: string }[] = [
  { id: 'name', label: '名称' },
  { id: 'status', label: '状态' },
  { id: 'waterfall', label: 'Waterfall' },
  { id: 'duration', label: '耗时' },
  { id: 'size', label: '大小' },
]

export function formatNetworkBytes(size: number): string {
  if (!size) {
    return '0 B'
  }
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function computeNetworkSummary(
  entries: ChromoNetworkEntry[],
  pageLoading?: boolean,
  pageError?: string,
): NetworkSummary {
  const totalCount = entries.length
  const completedCount = entries.filter((entry) => !entry.pending).length
  const totalBytes = entries.reduce((sum, entry) => sum + (entry.pending ? 0 : entry.size), 0)
  const hasPending = entries.some((entry) => entry.pending)
  const documentEntry = entries.find((entry) => normalizeNetworkType(entry.type) === 'document')

  let pageStatus = '-'
  if (pageError) {
    pageStatus = '失败'
  } else if (pageLoading || documentEntry?.pending) {
    pageStatus = '加载中'
  } else if (documentEntry) {
    pageStatus = documentEntry.failed ? '失败' : String(documentEntry.status || '-')
  } else if (hasPending) {
    pageStatus = '加载中'
  }

  let loadDurationMs: number | null = null
  if (entries.length > 0) {
    let minTs = Number.POSITIVE_INFINITY
    let maxEnd = 0
    for (const entry of entries) {
      minTs = Math.min(minTs, entry.ts)
      if (!entry.pending) {
        maxEnd = Math.max(maxEnd, entry.ts + entry.duration)
      }
    }
    if (minTs !== Number.POSITIVE_INFINITY && maxEnd > minTs) {
      loadDurationMs = maxEnd - minTs
    }
  }

  return {
    completedCount,
    totalCount,
    totalBytes,
    pageStatus,
    loadDurationMs,
    hasPending,
  }
}

export function networkEntryName(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.pathname === '/' ? parsed.host : parsed.pathname
  } catch {
    return url
  }
}

function normalizeNetworkType(type: string): string {
  return (type || 'other').toLowerCase()
}

function decodeNetworkBody(result: ChromoNetworkBodyReadResult): string {
  if (result.encoding === 'text') {
    return result.body
  }
  try {
    const binary = atob(result.body)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } catch {
    return '(binary body)'
  }
}

function formatResponsePreview(text: string, maxLen = 12000): string {
  if (text.length <= maxLen) {
    return text
  }
  return `${text.slice(0, maxLen)}\n\n… (truncated)`
}

function matchesNetworkTypeFilter(entry: ChromoNetworkEntry, filter: NetworkTypeFilter): boolean {
  if (filter === 'all') {
    return true
  }
  const type = normalizeNetworkType(entry.type)
  if (filter === 'xhr') {
    return type === 'xhr' || type === 'fetch'
  }
  if (filter === 'other') {
    return !TYPE_FILTERS.some((item) => item.id !== 'all' && item.id !== 'other' && matchesNetworkTypeFilter(entry, item.id))
  }
  return type === filter
}

function matchesNameFilter(entry: ChromoNetworkEntry, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return true
  }
  const name = networkEntryName(entry.url).toLowerCase()
  return name.includes(normalized) || entry.url.toLowerCase().includes(normalized)
}

function compareNetworkEntries(
  a: ChromoNetworkEntry,
  b: ChromoNetworkEntry,
  column: NetworkSortColumn,
  direction: NetworkSortDirection,
): number {
  let cmp = 0
  switch (column) {
    case 'name':
      cmp = networkEntryName(a.url).localeCompare(networkEntryName(b.url), undefined, { sensitivity: 'base' })
      break
    case 'status':
      cmp = (a.pending ? -1 : a.status || 0) - (b.pending ? -1 : b.status || 0)
      break
    case 'waterfall':
      cmp = a.ts - b.ts
      break
    case 'duration':
      cmp = a.duration - b.duration
      break
    case 'size':
      cmp = a.size - b.size
      break
  }
  return direction === 'asc' ? cmp : -cmp
}

function computeTimelineBounds(entries: ChromoNetworkEntry[]): { minTs: number; span: number } {
  if (entries.length === 0) {
    return { minTs: 0, span: 1 }
  }
  let minTs = Number.POSITIVE_INFINITY
  let maxEnd = 0
  for (const entry of entries) {
    minTs = Math.min(minTs, entry.ts)
    const end = entry.ts + (entry.pending ? Math.max(entry.duration, 40) : entry.duration)
    maxEnd = Math.max(maxEnd, end)
  }
  return { minTs, span: Math.max(maxEnd - minTs, 1) }
}

function NetworkWaterfallBar({
  entry,
  minTs,
  span,
}: {
  entry: ChromoNetworkEntry
  minTs: number
  span: number
}) {
  const left = ((entry.ts - minTs) / span) * 100
  const width = entry.pending
    ? Math.max(((Math.max(entry.duration, 40) / span) * 100), 1.5)
    : Math.max((entry.duration / span) * 100, 1.5)

  return (
    <div class="chromo-network__waterfall" aria-hidden="true">
      <span
        class={[
          'chromo-network__waterfall-bar',
          entry.failed ? 'chromo-network__waterfall-bar--failed' : '',
          entry.pending ? 'chromo-network__waterfall-bar--pending' : '',
          entry.bypass ? 'chromo-network__waterfall-bar--bypass' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ left: `${left}%`, width: `${width}%` }}
      />
    </div>
  )
}

function SortHeader({
  column,
  label,
  activeColumn,
  direction,
  onSort,
}: {
  column: NetworkSortColumn
  label: string
  activeColumn: NetworkSortColumn
  direction: NetworkSortDirection
  onSort: (column: NetworkSortColumn) => void
}) {
  const active = activeColumn === column
  return (
    <th class="chromo-network__th">
      <button
        type="button"
        class={['chromo-network__th-btn', active ? 'chromo-network__th-btn--active' : ''].filter(Boolean).join(' ')}
        onClick={() => onSort(column)}
      >
        <span>{label}</span>
        {active ? <span class="chromo-network__sort-indicator" aria-hidden="true">{direction === 'asc' ? '↑' : '↓'}</span> : null}
      </button>
    </th>
  )
}

export function ChromoNetworkPanel({
  entries,
  selectedId,
  pageLoading,
  pageError,
  pageUrl,
  disableNetworkCache,
  readNetworkBody,
  onSelect,
  onCloseDetail,
}: ChromoNetworkPanelProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const [nameFilter, setNameFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<NetworkTypeFilter>('all')
  const [sortColumn, setSortColumn] = useState<NetworkSortColumn>('waterfall')
  const [sortDirection, setSortDirection] = useState<NetworkSortDirection>('asc')
  const [bodyPreview, setBodyPreview] = useState('')
  const [bodyResult, setBodyResult] = useState<ChromoNetworkBodyReadResult | null>(null)
  const [bodyError, setBodyError] = useState('')
  const [bodyLoading, setBodyLoading] = useState(false)

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.id === selectedId) ?? null,
    [entries, selectedId],
  )

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => matchesNameFilter(entry, nameFilter) && matchesNetworkTypeFilter(entry, typeFilter))
  }, [entries, nameFilter, typeFilter])

  const sortedEntries = useMemo(() => {
    const next = [...filteredEntries]
    next.sort((a, b) => compareNetworkEntries(a, b, sortColumn, sortDirection))
    return next
  }, [filteredEntries, sortColumn, sortDirection])

  const timelineBounds = useMemo(() => computeTimelineBounds(entries), [entries])
  const summary = useMemo(
    () => computeNetworkSummary(entries, pageLoading, pageError),
    [entries, pageLoading, pageError],
  )
  const originTs = useMemo(() => {
    if (entries.length === 0) {
      return Date.now()
    }
    let min = Number.POSITIVE_INFINITY
    for (const entry of entries) {
      const queued = entry.timing?.queuedAt ?? entry.ts
      if (queued < min) {
        min = queued
      }
    }
    return min === Number.POSITIVE_INFINITY ? Date.now() : min
  }, [entries])

  const handleSort = useCallback(
    (column: NetworkSortColumn) => {
      if (sortColumn === column) {
        setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
        return
      }
      setSortColumn(column)
      setSortDirection(column === 'name' ? 'asc' : column === 'waterfall' ? 'asc' : 'desc')
    },
    [sortColumn],
  )

  const shouldAutoScroll =
    !nameFilter.trim() &&
    typeFilter === 'all' &&
    sortColumn === 'waterfall' &&
    sortDirection === 'asc'

  useEffect(() => {
    if (!shouldAutoScroll) {
      return
    }
    const list = listRef.current
    if (!list) {
      return
    }
    list.scrollTop = list.scrollHeight
  }, [entries.length, shouldAutoScroll])

  useEffect(() => {
    if (!selectedEntry || !readNetworkBody) {
      setBodyPreview('')
      setBodyResult(null)
      setBodyError('')
      setBodyLoading(false)
      return
    }
    if (!selectedEntry.hasBody) {
      setBodyPreview('')
      setBodyResult(null)
      setBodyError(selectedEntry.pending ? '请求进行中…' : '未缓存响应正文')
      setBodyLoading(false)
      return
    }

    let cancelled = false
    setBodyLoading(true)
    setBodyError('')
    setBodyPreview('')
    setBodyResult(null)

    readNetworkBody(selectedEntry.id)
      .then((result) => {
        if (cancelled) {
          return
        }
        setBodyResult(result)
        const text = decodeNetworkBody(result)
        const contentType = result.headers['content-type'] || result.headers['Content-Type'] || ''
        const body = formatResponsePreview(text)
        setBodyPreview(
          contentType.startsWith('image/') || contentType.startsWith('video/')
            ? `(binary: ${contentType}, ${formatNetworkBytes(body.length)} — preview skipped)`
            : body,
        )
        if (result.truncated) {
          setBodyError('响应正文在存储时被截断')
        }
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return
        }
        const message = err instanceof Error ? err.message : String(err)
        setBodyError(message)
      })
      .finally(() => {
        if (!cancelled) {
          setBodyLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [readNetworkBody, selectedEntry])

  return (
    <div
      class={[
        'chromo-network',
        selectedEntry ? 'chromo-network--drawer-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label="Network"
    >
      <div class="chromo-network__toolbar" role="toolbar" aria-label="Network 过滤">
        <input
          type="search"
          class="chromo-network__filter-name"
          value={nameFilter}
          placeholder="过滤名称或 URL"
          onInput={(event) => setNameFilter((event.currentTarget as HTMLInputElement).value)}
          aria-label="名称过滤"
        />
        <select
          class="chromo-network__filter-type"
          value={typeFilter}
          onChange={(event) => setTypeFilter((event.currentTarget as HTMLSelectElement).value as NetworkTypeFilter)}
          aria-label="类型过滤"
        >
          {TYPE_FILTERS.map((filter) => (
            <option key={filter.id} value={filter.id}>{filter.label}</option>
          ))}
        </select>
        <span class="chromo-network__count" aria-live="polite">
          {sortedEntries.length}/{entries.length}
        </span>
      </div>

      <div class="chromo-network__body">
        <div class="chromo-network__table-wrap" ref={listRef}>
        {sortedEntries.length === 0 ? (
          <div class="chromo-network__empty">
            {entries.length === 0 ? '子页面网络请求会显示在这里' : '没有匹配当前过滤条件的请求'}
          </div>
        ) : (
          <table class="chromo-network__table">
            <thead class="chromo-network__thead">
              <tr>
                {SORT_COLUMNS.map((column) => (
                  <SortHeader
                    key={column.id}
                    column={column.id}
                    label={column.label}
                    activeColumn={sortColumn}
                    direction={sortDirection}
                    onSort={handleSort}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map((entry) => (
                <tr
                  key={entry.id}
                  class={[
                    'chromo-network__row',
                    entry.failed ? 'chromo-network__row--failed' : '',
                    entry.bypass ? 'chromo-network__row--bypass' : '',
                    entry.pending ? 'chromo-network__row--pending' : '',
                    selectedId === entry.id ? 'chromo-network__row--selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => onSelect(entry)}
                >
                  <td class="chromo-network__cell chromo-network__cell--name">
                    <span class="chromo-network__method">{entry.method || 'GET'}</span>
                    <span class="chromo-network__name" title={entry.url}>{networkEntryName(entry.url)}</span>
                    {entry.bypass ? <span class="chromo-network__badge">bypass</span> : null}
                    {entry.fromCache ? <span class="chromo-network__badge">cache</span> : null}
                    {entry.pending ? <span class="chromo-network__badge">pending</span> : null}
                  </td>
                  <td class="chromo-network__cell chromo-network__cell--status">
                    <span class={['chromo-network__status', entry.failed ? 'chromo-network__status--failed' : ''].filter(Boolean).join(' ')}>
                      {entry.pending
                        ? '…'
                        : entry.failed && !entry.status
                          ? '(failed)'
                          : entry.status || '-'}
                    </span>
                  </td>
                  <td class="chromo-network__cell chromo-network__cell--waterfall">
                    <NetworkWaterfallBar entry={entry} minTs={timelineBounds.minTs} span={timelineBounds.span} />
                  </td>
                  <td class="chromo-network__cell chromo-network__cell--duration">
                    {entry.pending ? 'pending' : `${entry.duration} ms`}
                  </td>
                  <td class="chromo-network__cell chromo-network__cell--size">
                    {entry.pending ? '-' : formatNetworkBytes(entry.size)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        </div>

        {selectedEntry ? (
          <NetworkDetailDrawer
            entry={selectedEntry}
            bodyResult={bodyResult}
            bodyText={bodyPreview}
            bodyLoading={bodyLoading}
            bodyError={bodyError}
            originTs={originTs}
            pageUrl={pageUrl}
            disableNetworkCache={disableNetworkCache}
            entries={entries}
            onClose={() => onCloseDetail?.()}
          />
        ) : null}
      </div>

      <footer class="chromo-network__footer" aria-live="polite">
        <span class="chromo-network__footer-item">
          {summary.completedCount}/{summary.totalCount} 请求
        </span>
        <span class="chromo-network__footer-divider" aria-hidden="true">|</span>
        <span class="chromo-network__footer-item">{formatNetworkBytes(summary.totalBytes)}</span>
        <span class="chromo-network__footer-divider" aria-hidden="true">|</span>
        <span
          class={[
            'chromo-network__footer-item',
            summary.pageStatus === '失败' ? 'chromo-network__footer-item--failed' : '',
            summary.pageStatus === '加载中' ? 'chromo-network__footer-item--loading' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {summary.pageStatus}
        </span>
        <span class="chromo-network__footer-divider" aria-hidden="true">|</span>
        <span class="chromo-network__footer-item">
          {summary.loadDurationMs === null
            ? '-'
            : `${summary.loadDurationMs} ms${summary.hasPending ? '…' : ''}`}
        </span>
      </footer>
    </div>
  )
}
