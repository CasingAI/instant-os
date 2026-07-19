import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

export type VscodeQuickPickItem = {
  id: string
  label: string
  /** 额外参与搜索的关键词 */
  keywords?: readonly string[]
  description?: string
}

export type VscodeQuickPickProps = {
  open: boolean
  title?: string
  placeholder?: string
  items: readonly VscodeQuickPickItem[]
  activeId?: string
  onSelect: (item: VscodeQuickPickItem) => void
  onClose: () => void
}

function itemMatches(item: VscodeQuickPickItem, query: string): boolean {
  if (!query) return true
  const haystack = [item.label, item.description, ...(item.keywords ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(query)
}

export function VscodeQuickPick({
  open,
  title = '快速选择',
  placeholder = '输入以筛选…',
  items,
  activeId,
  onSelect,
  onClose,
}: VscodeQuickPickProps) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return items.filter((item) => itemMatches(item, normalized))
  }, [items, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    const activeIndex = Math.max(
      0,
      items.findIndex((item) => item.id === activeId),
    )
    setHighlight(activeIndex >= 0 ? activeIndex : 0)
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeId, items, open])

  useEffect(() => {
    setHighlight((current) => {
      if (filtered.length === 0) return 0
      return Math.min(current, filtered.length - 1)
    })
  }, [filtered.length])

  useEffect(() => {
    if (!open) return
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-quick-pick-index="${highlight}"]`,
    )
    node?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open])

  if (!open) return undefined

  const selectIndex = (index: number) => {
    const item = filtered[index]
    if (!item) return
    onSelect(item)
  }

  return (
    <div class="vscode-quick-pick" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" class="vscode-quick-pick__backdrop" aria-label="关闭" onClick={onClose} />
      <div class="vscode-quick-pick__panel">
        <div class="vscode-quick-pick__title">{title}</div>
        <input
          ref={inputRef}
          class="vscode-quick-pick__input"
          type="search"
          placeholder={placeholder}
          value={query}
          aria-autocomplete="list"
          aria-controls="vscode-quick-pick-list"
          onInput={(event) => {
            setQuery((event.target as HTMLInputElement).value)
            setHighlight(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              onClose()
              return
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              if (filtered.length === 0) return
              setHighlight((current) => (current + 1) % filtered.length)
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              if (filtered.length === 0) return
              setHighlight((current) => (current - 1 + filtered.length) % filtered.length)
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              selectIndex(highlight)
            }
          }}
        />
        <div
          id="vscode-quick-pick-list"
          class="vscode-quick-pick__list"
          role="listbox"
          ref={listRef}
        >
          {filtered.length === 0 ? (
            <div class="vscode-quick-pick__empty">无匹配结果</div>
          ) : (
            filtered.map((item, index) => {
              const selected = item.id === activeId
              const highlighted = index === highlight
              return (
                <button
                  key={`${item.id}:${item.label}`}
                  type="button"
                  role="option"
                  data-quick-pick-index={index}
                  aria-selected={selected}
                  class={`vscode-quick-pick__item${highlighted ? ' vscode-quick-pick__item--highlight' : ''}${selected ? ' vscode-quick-pick__item--active' : ''}`}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => onSelect(item)}
                >
                  <span class="vscode-quick-pick__item-label">{item.label}</span>
                  {item.description ? (
                    <span class="vscode-quick-pick__item-desc">{item.description}</span>
                  ) : undefined}
                </button>
              )
            })
          )}
        </div>
        <div class="vscode-quick-pick__hint">↑↓ 选择 · Enter 确认 · Esc 关闭</div>
      </div>
    </div>
  )
}
