import { useEffect, useRef } from 'preact/hooks'

type ChromoPageFindBarProps = {
  query: string
  count: number
  index: number
  busy?: boolean
  error?: string
  focusEpoch?: number
  onQueryChange: (query: string) => void
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}

export function ChromoPageFindBar({
  query,
  count,
  index,
  busy = false,
  error,
  focusEpoch = 0,
  onQueryChange,
  onNext,
  onPrev,
  onClose,
}: ChromoPageFindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const input = inputRef.current
    if (!input) {
      return
    }
    input.focus()
    input.select()
  }, [focusEpoch])

  const status = error
    ? error
    : !query
      ? ''
      : count === 0
        ? '无匹配'
        : `${index + 1} / ${count}`

  return (
    <div class="chromo-findbar" role="search">
      <input
        ref={inputRef}
        class="chromo-findbar__input"
        type="search"
        value={query}
        placeholder="查找"
        aria-label="在网页中查找"
        onInput={(event) => onQueryChange((event.currentTarget as HTMLInputElement).value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            if (event.shiftKey) onPrev()
            else onNext()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
      />
      <span class="chromo-findbar__status" aria-live="polite">
        {busy ? '查找中…' : status}
      </span>
      <button type="button" class="chromo-findbar__btn" onClick={onPrev} aria-label="上一个" disabled={count === 0}>
        ↑
      </button>
      <button type="button" class="chromo-findbar__btn" onClick={onNext} aria-label="下一个" disabled={count === 0}>
        ↓
      </button>
      <button type="button" class="chromo-findbar__btn chromo-findbar__btn--close" onClick={onClose} aria-label="关闭查找">
        ×
      </button>
    </div>
  )
}
