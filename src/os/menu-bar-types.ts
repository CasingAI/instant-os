export type MenuItemAction = {
  type: 'action'
  /** 系统保留项 id，例如 `app.about` / `app.hide` / `app.quit`。 */
  id?: string
  label: string
  onClick: () => void
  disabled?: boolean
  shortcut?: string
}

export type MenuItemSeparator = {
  type: 'separator'
}

export type MenuItemLeaf = MenuItemAction | MenuItemSeparator

export type MenuItemSubmenu = {
  type: 'submenu'
  label: string
  items: MenuItemSubItem[]
}

/** 子菜单内的条目：叶子动作，或再嵌套一层子菜单。 */
export type MenuItemSubItem = MenuItemLeaf | MenuItemSubmenu

export type MenuItem = MenuItemLeaf | MenuItemSubmenu

export type MenuDefinition = {
  label: string
  items: MenuItem[]
}
