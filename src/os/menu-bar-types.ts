export type MenuItemAction = {
  type: 'action'
  label: string
  onClick: () => void
  disabled?: boolean
  shortcut?: string
}

export type MenuItemSeparator = {
  type: 'separator'
}

export type MenuItem = MenuItemAction | MenuItemSeparator

export type MenuDefinition = {
  label: string
  items: MenuItem[]
}
