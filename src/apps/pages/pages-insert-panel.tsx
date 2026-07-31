import type { BlockInsertSection } from './pages-block-insert.ts'

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
  onSelect: (item: InsertPanelItem) => void
  onHoverIndex?: (index: number) => void
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
  onSelect,
  onHoverIndex,
}: InsertPanelProps) {
  if (items.length === 0) return null

  const useDense =
    layout === 'dense' && items.some((item) => item.section === 'basic' || item.section === 'common')

  if (!useDense) {
    return (
      <div class="pages-insert" style={style} role="listbox" aria-label={ariaLabel}>
        <div class="pages-insert__list">
          {items.map((item, index) => (
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
        </div>
      </div>
    )
  }

  const basic = items.filter((item) => item.section === 'basic')
  const common = items.filter((item) => item.section === 'common')

  return (
    <div class="pages-insert" style={style} role="listbox" aria-label={ariaLabel}>
      {basic.length > 0 ? (
        <div class="pages-insert__section">
          <div class="pages-insert__section-label">基础</div>
          <div class="pages-insert__grid">
            {basic.map((item) => {
              const index = itemIndex(items, item.id)
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
              const index = itemIndex(items, item.id)
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
    </div>
  )
}
