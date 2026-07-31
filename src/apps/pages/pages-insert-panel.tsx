import { useEffect, useRef, useState } from 'preact/hooks'
import type { BlockInsertSection } from './pages-block-insert.ts'
import { filterBlockInsertItems, type BlockInsertItem } from './pages-block-insert.ts'

export type InsertPanelItem = {
  id: string
  title: string
  description: string
  icon?: string
  section?: BlockInsertSection
}

export type InsertPanelProps = {
  items: InsertPanelItem[]
  selectedIndex: number
  style?: Record<string, string | number>
  ariaLabel?: string
  /** 完整目录用分组网格；过滤结果用紧凑列表 */
  layout?: 'dense' | 'flat'
  enableSearch?: boolean
  onSelect: (item: InsertPanelItem) => void
  onHoverIndex?: (index: number) => void
  onFilteredItemsChange?: (items: InsertPanelItem[]) => void
}

function itemIndex(items: InsertPanelItem[], id: string): number {
  return items.findIndex((item) => item.id === id)
}

/** 斜杠 / 加号 / 右键插入共用的高密度块面板（飞书式） */
export function PagesInsertPanel({
  items,
  selectedIndex,
  style,
  ariaLabel = '插入块',
  layout = 'dense',
  enableSearch = false,
  onSelect,
  onHoverIndex,
  onFilteredItemsChange,
}: InsertPanelProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (enableSearch) {
      inputRef.current?.focus()
    }
  }, [enableSearch])

  const filtered: InsertPanelItem[] =
    enableSearch && query.trim()
      ? filterBlockInsertItems(query).map((item: BlockInsertItem) => ({
          id: item.id,
          title: item.title,
          description: item.description,
          icon: item.icon,
          section: item.section,
        }))
      : items

  useEffect(() => {
    onFilteredItemsChange?.(filtered)
  }, [filtered, onFilteredItemsChange])

  if (items.length === 0 && !enableSearch) return null

  const useDense =
    layout === 'dense' &&
    !query.trim() &&
    filtered.some((item) => item.section === 'basic' || item.section === 'common')

  const body = !useDense ? (
    <div class="pages-insert__list">
      {filtered.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="option"
          title={item.description}
          aria-selected={index === selectedIndex ? 'true' : 'false'}
          class={`pages-insert__row${index === selectedIndex ? ' pages-insert__row--active' : ''}`}
          onMouseEnter={() => onHoverIndex?.(index)}
          onMouseDown={(event) => {
            event.preventDefault()
            onSelect(item)
          }}
        >
          <span class="pages-insert__row-icon">{item.icon ?? '·'}</span>
          <span class="pages-insert__row-title">{item.title}</span>
        </button>
      ))}
      {filtered.length === 0 ? <div class="pages-insert__empty">无匹配项</div> : null}
    </div>
  ) : (
    <>
      {(() => {
        const basic = filtered.filter((item) => item.section === 'basic')
        const common = filtered.filter((item) => item.section === 'common')
        return (
          <>
            {basic.length > 0 ? (
              <div class="pages-insert__section">
                <div class="pages-insert__section-label">基础</div>
                <div class="pages-insert__grid">
                  {basic.map((item) => {
                    const index = itemIndex(filtered, item.id)
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        title={`${item.title} · ${item.description}`}
                        aria-label={item.title}
                        aria-selected={index === selectedIndex ? 'true' : 'false'}
                        class={`pages-insert__cell${index === selectedIndex ? ' pages-insert__cell--active' : ''}`}
                        onMouseEnter={() => onHoverIndex?.(index)}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          onSelect(item)
                        }}
                      >
                        {item.icon ?? '·'}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}
            {common.length > 0 ? (
              <div class="pages-insert__section">
                <div class="pages-insert__section-label">常用</div>
                <div class="pages-insert__list">
                  {common.map((item) => {
                    const index = itemIndex(filtered, item.id)
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        title={item.description}
                        aria-selected={index === selectedIndex ? 'true' : 'false'}
                        class={`pages-insert__row${index === selectedIndex ? ' pages-insert__row--active' : ''}`}
                        onMouseEnter={() => onHoverIndex?.(index)}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          onSelect(item)
                        }}
                      >
                        <span class="pages-insert__row-icon">{item.icon ?? '·'}</span>
                        <span class="pages-insert__row-title">{item.title}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </>
        )
      })()}
    </>
  )

  return (
    <div class="pages-insert" style={style} role="listbox" aria-label={ariaLabel}>
      {enableSearch ? (
        <input
          ref={inputRef}
          class="pages-insert__search"
          type="search"
          placeholder="搜索块…"
          value={query}
          onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
          onKeyDown={(event) => event.stopPropagation()}
        />
      ) : null}
      {body}
    </div>
  )
}
