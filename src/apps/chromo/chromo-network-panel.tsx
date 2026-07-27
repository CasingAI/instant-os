import { useEffect, useRef } from 'preact/hooks'
import type { ChromoNetworkEntry } from './chromo-bridge.ts'

type ChromoNetworkPanelProps = {
  entries: ChromoNetworkEntry[]
  selectedId?: string
  onSelect: (entry: ChromoNetworkEntry) => void
}

export function formatNetworkBytes(size: number): string {
  if (!size) {
    return '0 B'
  }
  if (size < 1024) {
    return `${size} B`
  }
  return `${(size / 1024).toFixed(1)} KB`
}

export function networkEntryName(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.pathname === '/' ? parsed.host : parsed.pathname
  } catch {
    return url
  }
}

export function ChromoNetworkPanel({ entries, selectedId, onSelect }: ChromoNetworkPanelProps) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const list = listRef.current
    if (!list) {
      return
    }
    list.scrollTop = list.scrollHeight
  }, [entries.length])

  return (
    <div class="chromo-network" aria-label="Network">
      <div class="chromo-network__list" ref={listRef}>
        {entries.length === 0 ? (
          <div class="chromo-network__empty">子页面网络请求会显示在这里</div>
        ) : (
          entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              class={[
                'chromo-network__entry',
                entry.failed ? 'chromo-network__entry--failed' : '',
                entry.bypass ? 'chromo-network__entry--bypass' : '',
                entry.pending ? 'chromo-network__entry--pending' : '',
                selectedId === entry.id ? 'chromo-network__entry--selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelect(entry)}
            >
              <div class="chromo-network__meta">
                <span class="chromo-network__method">{entry.method || 'GET'}</span>
                <span class="chromo-network__status">
                  {entry.pending ? '…' : entry.status || '-'}
                </span>
                <span class="chromo-network__type">{entry.type || 'other'}</span>
                <span class="chromo-network__size">
                  {entry.pending ? '-' : formatNetworkBytes(entry.size)}
                </span>
                <span class="chromo-network__time">
                  {entry.pending ? 'pending' : `${entry.duration}ms`}
                </span>
                {entry.bypass ? <span class="chromo-network__badge">bypass</span> : null}
                {entry.pending ? <span class="chromo-network__badge">pending</span> : null}
              </div>
              <div class="chromo-network__name">{networkEntryName(entry.url)}</div>
            </button>
          ))
        )}
      </div>
      <div class="chromo-network__detail" aria-live="polite">
        {selectedId
          ? entries.find((entry) => entry.id === selectedId)?.url ?? '点击行查看完整 URL'
          : '点击行查看完整 URL'}
      </div>
    </div>
  )
}
