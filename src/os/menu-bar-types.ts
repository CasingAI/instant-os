export type MenuItemAction = {
  type: 'action'
  label: string
  onClick: () => void
  disabled?: boolean
  shortcut?: string
  /** 勾选标记（如「文件 → 无损压缩（FLAC）」），渲染为菜单项前的小勾 */
  checked?: boolean
}

export type MenuItemSeparator = {
  type: 'separator'
}

export type MenuItemLeaf = MenuItemAction | MenuItemSeparator

export type MenuItemSubmenu = {
  type: 'submenu'
  label: string
  items: MenuItemLeaf[]
}

export type MenuItem = MenuItemLeaf | MenuItemSubmenu

export type MenuDefinition = {
  label: string
  items: MenuItem[]
}
