export type InsertPanelItem = {
  id: string
  title: string
  description: string
}

export type InsertPanelProps = {
  items: InsertPanelItem[]
  selectedIndex: number
  style?: Record<string, string | number>
  ariaLabel?: string
  onSelect: (item: InsertPanelItem) => void
  onHoverIndex?: (index: number) => void
}

/** 斜杠 / 加号 / 右键插入共用的块列表面板 */
export function PagesInsertPanel({
  items,
  selectedIndex,
  style,
  ariaLabel = '插入块',
  onSelect,
  onHoverIndex,
}: InsertPanelProps) {
  if (items.length === 0) return null

  return (
    <div class="pages-slash" style={style} role="listbox" aria-label={ariaLabel}>
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={index === selectedIndex ? 'true' : 'false'}
          class={`pages-slash__item${index === selectedIndex ? ' pages-slash__item--active' : ''}`}
          onMouseEnter={() => onHoverIndex?.(index)}
          onMouseDown={(event) => {
            event.preventDefault()
            onSelect(item)
          }}
        >
          <span class="pages-slash__title">{item.title}</span>
          <span class="pages-slash__desc">{item.description}</span>
        </button>
      ))}
    </div>
  )
}
