import { useCallback, useEffect, useRef } from 'preact/hooks'
import type { ChromoConsoleEntry } from './chromo-bridge.ts'

type ChromoConsolePanelProps = {
  entries: ChromoConsoleEntry[]
  onClear: () => void
}

function formatConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') {
        return arg
      }
      try {
        return JSON.stringify(arg)
      } catch {
        return String(arg)
      }
    })
    .join(' ')
}

function formatConsoleTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString()
  } catch {
    return ''
  }
}

export function ChromoConsolePanel({ entries, onClear }: ChromoConsolePanelProps) {
  const listRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    const list = listRef.current
    if (!list) {
      return
    }
    list.scrollTop = list.scrollHeight
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [entries.length, scrollToBottom])

  return (
    <aside class="chromo-console" aria-label="页面 Console">
      <header class="chromo-console__header">
        <div class="chromo-console__title">Console</div>
        <button type="button" class="chromo-console__clear" onClick={onClear}>
          清空
        </button>
      </header>
      <div class="chromo-console__list" ref={listRef}>
        {entries.length === 0 ? (
          <div class="chromo-console__empty">子页面 console 输出会显示在这里</div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              class={[
                'chromo-console__entry',
                `chromo-console__entry--${entry.level || 'log'}`,
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div class="chromo-console__meta">
                {entry.level} · {formatConsoleTime(entry.ts)}
              </div>
              <div class="chromo-console__body">{formatConsoleArgs(entry.args)}</div>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
