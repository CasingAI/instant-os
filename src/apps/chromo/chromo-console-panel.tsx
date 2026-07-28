import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { formatChromoEvalValue } from './chromo-eval-format.ts'
import type {
  ChromoConsoleDisplayEntry,
  ChromoConsoleLevelFilter,
} from './chromo-console-types.ts'
import {
  displayEntryLevel,
  matchesConsoleLevelFilter,
} from './chromo-console-types.ts'

type ChromoConsolePanelProps = {
  entries: ChromoConsoleDisplayEntry[]
  pageReady: boolean
  evalInPage: (code: string) => Promise<unknown>
  replHistory: string[]
  onReplHistoryChange: (history: string[]) => void
  onAppendEntries: (entries: ChromoConsoleDisplayEntry[]) => void
}

const LEVEL_FILTERS: { id: ChromoConsoleLevelFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'error', label: '错误' },
  { id: 'warn', label: '警告' },
  { id: 'info', label: '信息' },
  { id: 'verbose', label: '详细' },
]

function formatConsoleTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString()
  } catch {
    return ''
  }
}

function isExpandableValue(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !('__vc' in (value as object))
}

function ConsoleArgValue({ value }: { value: unknown }) {
  const [expanded, setExpanded] = useState(false)

  if (!isExpandableValue(value)) {
    return <span class="chromo-console__value">{formatChromoEvalValue(value)}</span>
  }

  const preview = formatChromoEvalValue(value)
  const isMultiline = preview.includes('\n')

  return (
    <span class="chromo-console__value chromo-console__value--object">
      <button
        type="button"
        class="chromo-console__expand"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
      >
        {expanded ? '▼' : '▶'}
      </button>
      {expanded ? (
        <pre class="chromo-console__object">{preview}</pre>
      ) : (
        <span class="chromo-console__object-preview">
          {isMultiline ? `${preview.split('\n')[0]}…` : preview}
        </span>
      )}
    </span>
  )
}

function ConsoleEntryBody({ entry }: { entry: ChromoConsoleDisplayEntry }) {
  if (entry.kind === 'input') {
    return (
      <div class="chromo-console__body chromo-console__body--input">
        <span class="chromo-console__prompt">&gt;</span> {entry.code}
      </div>
    )
  }

  if (entry.kind === 'result') {
    if (entry.error) {
      return <div class="chromo-console__body chromo-console__body--error">{entry.error}</div>
    }
    return (
      <div class="chromo-console__body chromo-console__body--result">
        <ConsoleArgValue value={entry.value} />
      </div>
    )
  }

  if (entry.entry.args.length <= 1) {
    return (
      <div class="chromo-console__body">
        <ConsoleArgValue value={entry.entry.args[0]} />
      </div>
    )
  }

  return (
    <div class="chromo-console__body">
      {entry.entry.args.map((arg, index) => (
        <span key={index} class="chromo-console__arg">
          <ConsoleArgValue value={arg} />
          {index < entry.entry.args.length - 1 ? ' ' : null}
        </span>
      ))}
    </div>
  )
}

function ConsoleEntryRow({ entry }: { entry: ChromoConsoleDisplayEntry }) {
  const level = displayEntryLevel(entry)

  const meta =
    entry.kind === 'page'
      ? `${entry.entry.level || 'log'} · ${formatConsoleTime(entry.entry.ts)}`
      : ''

  return (
    <div
      class={[
        'chromo-console__entry',
        `chromo-console__entry--${level || 'log'}`,
        entry.kind === 'input' ? 'chromo-console__entry--repl-input' : '',
        entry.kind === 'result' ? 'chromo-console__entry--repl-result' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {entry.kind === 'page' ? (
        <div class="chromo-console__meta">{meta}</div>
      ) : null}
      <ConsoleEntryBody entry={entry} />
    </div>
  )
}

export function ChromoConsolePanel({
  entries,
  pageReady,
  evalInPage,
  replHistory,
  onReplHistoryChange,
  onAppendEntries,
}: ChromoConsolePanelProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [levelFilter, setLevelFilter] = useState<ChromoConsoleLevelFilter>('all')
  const [inputValue, setInputValue] = useState('')
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [running, setRunning] = useState(false)

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (entry.kind === 'input') {
        return levelFilter === 'all'
      }
      if (entry.kind === 'result') {
        if (levelFilter === 'all') {
          return true
        }
        if (levelFilter === 'error') {
          return Boolean(entry.error)
        }
        if (levelFilter === 'verbose') {
          return !entry.error
        }
        return false
      }
      return matchesConsoleLevelFilter(entry.entry.level, levelFilter)
    })
  }, [entries, levelFilter])

  const scrollToBottom = useCallback(() => {
    const list = listRef.current
    if (!list) {
      return
    }
    list.scrollTop = list.scrollHeight
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [filteredEntries.length, scrollToBottom])

  const runRepl = useCallback(async () => {
    const code = inputValue.trim()
    if (!code || running) {
      return
    }

    const ts = Date.now()
    const inputId = `repl-input-${ts}`
    const resultId = `repl-result-${ts}`

    onAppendEntries([
      { kind: 'input', id: inputId, code, ts },
    ])

    const nextHistory = [...replHistory.filter((item) => item !== code), code]
    onReplHistoryChange(nextHistory)
    setHistoryIndex(-1)
    setInputValue('')
    setRunning(true)

    try {
      const value = await evalInPage(code)
      onAppendEntries([
        {
          kind: 'result',
          id: resultId,
          code,
          value,
          ts: Date.now(),
        },
      ])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      onAppendEntries([
        {
          kind: 'result',
          id: resultId,
          code,
          error: message,
          ts: Date.now(),
        },
      ])
    } finally {
      setRunning(false)
      inputRef.current?.focus()
    }
  }, [
    evalInPage,
    inputValue,
    onAppendEntries,
    onReplHistoryChange,
    replHistory,
    running,
  ])

  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        void runRepl()
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        if (!replHistory.length) {
          return
        }
        const nextIndex =
          historyIndex < 0 ? replHistory.length - 1 : Math.max(0, historyIndex - 1)
        setHistoryIndex(nextIndex)
        setInputValue(replHistory[nextIndex] ?? '')
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        if (historyIndex < 0) {
          return
        }
        const nextIndex = historyIndex + 1
        if (nextIndex >= replHistory.length) {
          setHistoryIndex(-1)
          setInputValue('')
          return
        }
        setHistoryIndex(nextIndex)
        setInputValue(replHistory[nextIndex] ?? '')
      }
    },
    [historyIndex, replHistory, runRepl],
  )

  return (
    <div class="chromo-console" aria-label="控制台">
      <div class="chromo-console__filters" role="toolbar" aria-label="控制台过滤">
        {LEVEL_FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            class={[
              'chromo-console__filter',
              levelFilter === filter.id ? 'chromo-console__filter--active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => setLevelFilter(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div class="chromo-console__list" ref={listRef}>
        {filteredEntries.length === 0 ? (
          <div class="chromo-console__empty">子页面 console 输出会显示在这里</div>
        ) : (
          filteredEntries.map((entry) => <ConsoleEntryRow key={
            entry.kind === 'page' ? entry.entry.id : entry.id
          } entry={entry} />)
        )}
      </div>

      <div class="chromo-console__repl">
        <span class="chromo-console__prompt" aria-hidden="true">
          &gt;
        </span>
        <textarea
          ref={inputRef}
          class="chromo-console__repl-input"
          value={inputValue}
          rows={1}
          placeholder={pageReady ? '在此输入 JavaScript…' : '网页尚未就绪'}
          disabled={!pageReady || running}
          onInput={(event) => {
            setInputValue((event.currentTarget as HTMLTextAreaElement).value)
            if (historyIndex >= 0) {
              setHistoryIndex(-1)
            }
          }}
          onKeyDown={handleInputKeyDown}
          spellcheck={false}
          aria-label="控制台输入"
        />
      </div>
    </div>
  )
}
