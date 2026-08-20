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
  pageLoading?: boolean
  evalInPage: (code: string) => Promise<unknown>
  replHistory: string[]
  onReplHistoryChange: (history: string[]) => void
  onAppendEntries: (entries: ChromoConsoleDisplayEntry[]) => void
  onClear?: () => void
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
  const formatted = formatChromoEvalValue(value)
  const isUndefined =
    value === undefined ||
    (value !== null &&
      typeof value === 'object' &&
      (value as { __vc?: string }).__vc === 'undefined')

  if (!isExpandableValue(value)) {
    return (
      <span
        class={[
          'chromo-console__value',
          isUndefined ? 'chromo-console__value--undefined' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {formatted}
      </span>
    )
  }

  const isMultiline = formatted.includes('\n')

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
        <pre class="chromo-console__object">{formatted}</pre>
      ) : (
        <span class="chromo-console__object-preview">
          {isMultiline ? `${formatted.split('\n')[0]}…` : formatted}
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
    const value = entry.value === undefined ? { __vc: 'undefined' } : entry.value
    return (
      <div class="chromo-console__body chromo-console__body--result">
        <ConsoleArgValue value={value} />
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
  pageLoading = false,
  evalInPage,
  replHistory,
  onReplHistoryChange,
  onAppendEntries,
  onClear,
}: ChromoConsolePanelProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [levelFilter, setLevelFilter] = useState<ChromoConsoleLevelFilter>('all')
  const [inputValue, setInputValue] = useState('')
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [running, setRunning] = useState(false)
  const restoreFocusAfterRunRef = useRef(false)

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      // REPL 输入/结果始终可见（对齐 Chrome：级别过滤器只作用于页面 console.*）
      if (entry.kind === 'input' || entry.kind === 'result') {
        return true
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
    restoreFocusAfterRunRef.current = true
    setRunning(true)
    // 清空后立刻保持焦点（不要在执行期间 disabled，否则浏览器会抢走焦点）
    queueMicrotask(() => {
      inputRef.current?.focus()
    })

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
    }
  }, [
    evalInPage,
    inputValue,
    onAppendEntries,
    onReplHistoryChange,
    replHistory,
    running,
  ])

  useEffect(() => {
    if (running || !restoreFocusAfterRunRef.current) {
      return
    }
    restoreFocusAfterRunRef.current = false
    const input = inputRef.current
    if (!input || input.disabled) {
      return
    }
    input.focus()
  }, [running, filteredEntries.length])

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

  const focusReplOnBlankClick = useCallback(
    (event: MouseEvent) => {
      if (!pageReady) {
        return
      }
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }
      // 过滤器 / 展开按钮等交互控件不抢焦点
      if (target.closest('button, a, input, textarea, select, [contenteditable="true"]')) {
        return
      }
      // 拖选文本时保持选择，不聚焦输入框
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed && selection.toString().length > 0) {
        return
      }
      inputRef.current?.focus()
    },
    [pageReady],
  )

  return (
    <div class="chromo-console" aria-label="控制台" onClick={focusReplOnBlankClick}>
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
        {onClear ? (
          <button
            type="button"
            class="chromo-console__clear"
            onClick={onClear}
            title="清空控制台"
            aria-label="清空控制台"
          >
            清空
          </button>
        ) : null}
      </div>

      <div class="chromo-console__list" ref={listRef}>
        {filteredEntries.length === 0 ? (
          <div class="chromo-console__empty">子页面 console 输出会显示在这里</div>
        ) : (
          filteredEntries.map((entry) => {
            const key =
              entry.kind === 'page'
                ? `page:${entry.entry.id}`
                : `${entry.kind}:${entry.id}`
            return <ConsoleEntryRow key={key} entry={entry} />
          })
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
          placeholder={
            !pageReady
              ? '网页尚未就绪'
              : pageLoading
                ? '页面仍在加载，部分脚本可能尚未执行'
                : '在此输入 JavaScript…'
          }
          disabled={!pageReady}
          aria-busy={running}
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
