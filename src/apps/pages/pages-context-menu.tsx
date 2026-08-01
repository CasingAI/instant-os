export type ContextMenuItem =
  | { type: 'action'; id: string; label: string; shortcut?: string; danger?: boolean }
  | { type: 'separator'; id: string }

export type PagesContextMenuProps = {
  items: ContextMenuItem[]
  style?: Record<string, string | number>
  onAction: (id: string) => void
}

export function PagesContextMenu({ items, style, onAction }: PagesContextMenuProps) {
  return (
    <div class="pages-context-menu" style={style} role="menu" aria-label="块操作">
      {items.map((item) => {
        if (item.type === 'separator') {
          return <div key={item.id} class="pages-context-menu__sep" role="separator" />
        }
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            class={`pages-context-menu__item${item.danger ? ' pages-context-menu__item--danger' : ''}`}
            onMouseDown={(event) => {
              event.preventDefault()
              onAction(item.id)
            }}
          >
            <span>{item.label}</span>
            {item.shortcut ? (
              <span class="pages-context-menu__shortcut">{item.shortcut}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

export function buildContextMenuItems(opts: {
  inTable: boolean
  hasHeaderRow?: boolean
  canMergeCells?: boolean
  canSplitCell?: boolean
  onLink: boolean
  onImage?: boolean
}): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    { type: 'action', id: 'copy', label: '复制', shortcut: '⌘C' },
    { type: 'action', id: 'cut', label: '剪切', shortcut: '⌘X' },
    { type: 'action', id: 'paste', label: '粘贴', shortcut: '⌘V' },
    { type: 'separator', id: 'sep-edit' },
    { type: 'action', id: 'insert-above', label: opts.inTable ? '上方插入块' : '上方插入' },
    { type: 'action', id: 'insert-below', label: opts.inTable ? '下方插入块' : '下方插入' },
    { type: 'action', id: 'delete-block', label: '删除块', danger: true },
  ]

  if (opts.onLink) {
    items.push(
      { type: 'separator', id: 'sep-link' },
      { type: 'action', id: 'edit-link', label: '编辑链接' },
      { type: 'action', id: 'unset-link', label: '取消链接' },
    )
  }

  if (opts.onImage) {
    items.push(
      { type: 'separator', id: 'sep-image' },
      { type: 'action', id: 'replace-image', label: '替换图片' },
    )
  }

  if (opts.inTable) {
    items.push(
      { type: 'separator', id: 'sep-table' },
      { type: 'action', id: 'open-sheet', label: '在表格视图中编辑' },
      {
        type: 'action',
        id: 'toggle-header-row',
        label: opts.hasHeaderRow ? '取消表头行' : '设为表头行',
      },
    )
    if (opts.canMergeCells) {
      items.push({ type: 'action', id: 'merge-cells', label: '合并单元格' })
    }
    if (opts.canSplitCell) {
      items.push({ type: 'action', id: 'split-cell', label: '拆分单元格' })
    }
    items.push(
      { type: 'action', id: 'add-row-before', label: '向上插入行' },
      { type: 'action', id: 'add-row-after', label: '向下插入行' },
      { type: 'action', id: 'add-col-before', label: '向左插入列' },
      { type: 'action', id: 'add-col-after', label: '向右插入列' },
      { type: 'action', id: 'delete-row', label: '删除行', danger: true },
      { type: 'action', id: 'delete-col', label: '删除列', danger: true },
    )
  }

  return items
}
