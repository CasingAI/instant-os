import { useEffect, useRef } from 'preact/hooks'

export type PagesFindBarProps = {
  query: string
  replacement: string
  caseSensitive: boolean
  showReplace: boolean
  matchCount: number
  currentIndex: number
  onQueryChange: (query: string) => void
  onReplacementChange: (value: string) => void
  onCaseSensitiveChange: (value: boolean) => void
  onShowReplaceChange: (value: boolean) => void
  onFindNext: () => void
  onFindPrev: () => void
  onReplace: () => void
  onReplaceAll: () => void
  onClose: () => void
}

export function PagesFindBar({
  query,
  replacement,
  caseSensitive,
  showReplace,
  matchCount,
  currentIndex,
  onQueryChange,
  onReplacementChange,
  onCaseSensitiveChange,
  onShowReplaceChange,
  onFindNext,
  onFindPrev,
  onReplace,
  onReplaceAll,
  onClose,
}: PagesFindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const status =
    !query.trim()
      ? ''
      : matchCount === 0
        ? '无结果'
        : `${Math.min(currentIndex + 1, matchCount)} / ${matchCount}`

  return (
    <div class="pages-find-bar" role="search" aria-label="查找替换">
      <div class="pages-find-bar__row">
        <input
          ref={inputRef}
          class="pages-find-bar__input"
          type="search"
          value={query}
          placeholder="查找"
          aria-label="查找"
          onInput={(event) => onQueryChange((event.target as HTMLInputElement).value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              if (event.shiftKey) onFindPrev()
              else onFindNext()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            }
          }}
        />
        <span class="pages-find-bar__status" aria-live="polite">
          {status}
        </span>
        <button
          type="button"
          class={`pages-find-bar__btn${caseSensitive ? ' pages-find-bar__btn--active' : ''}`}
          title="区分大小写"
          aria-pressed={caseSensitive ? 'true' : 'false'}
          onClick={() => onCaseSensitiveChange(!caseSensitive)}
        >
          Aa
        </button>
        <button type="button" class="pages-find-bar__btn" title="上一处" onClick={onFindPrev}>
          ↑
        </button>
        <button type="button" class="pages-find-bar__btn" title="下一处" onClick={onFindNext}>
          ↓
        </button>
        <button
          type="button"
          class={`pages-find-bar__btn${showReplace ? ' pages-find-bar__btn--active' : ''}`}
          title="替换"
          aria-pressed={showReplace ? 'true' : 'false'}
          onClick={() => onShowReplaceChange(!showReplace)}
        >
          替换
        </button>
        <button type="button" class="pages-find-bar__btn" title="关闭" onClick={onClose}>
          ✕
        </button>
      </div>
      {showReplace ? (
        <div class="pages-find-bar__row">
          <input
            class="pages-find-bar__input"
            type="text"
            value={replacement}
            placeholder="替换为"
            aria-label="替换为"
            onInput={(event) => onReplacementChange((event.target as HTMLInputElement).value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onReplace()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                onClose()
              }
            }}
          />
          <button type="button" class="pages-find-bar__btn pages-find-bar__btn--text" onClick={onReplace}>
            替换
          </button>
          <button
            type="button"
            class="pages-find-bar__btn pages-find-bar__btn--text"
            onClick={onReplaceAll}
          >
            全部
          </button>
        </div>
      ) : null}
    </div>
  )
}
