import type { MenuDefinition, MenuItem, MenuItemLeaf } from './menu-bar-types.ts'

function bindLeaf(
  getLive: () => MenuItemLeaf | undefined,
  item: MenuItemLeaf,
): MenuItemLeaf {
  if (item.type === 'separator') {
    return item
  }
  return {
    ...item,
    onClick: () => {
      const live = getLive()
      if (!live || live.type !== 'action' || live.disabled) {
        return
      }
      live.onClick()
    },
  }
}

function bindItem(getLive: () => MenuItem | undefined, item: MenuItem): MenuItem {
  if (item.type === 'submenu') {
    return {
      ...item,
      items: item.items.map((child, childIndex) =>
        bindLeaf(() => {
          const liveItem = getLive()
          if (!liveItem || liveItem.type !== 'submenu') {
            return undefined
          }
          return liveItem.items[childIndex]
        }, child),
      ),
    }
  }
  return bindLeaf(() => {
    const liveItem = getLive()
    return liveItem && liveItem.type !== 'submenu' ? liveItem : undefined
  }, item)
}

export function bindMenusToLive(
  getLiveMenus: () => MenuDefinition[] | undefined,
  menus: MenuDefinition[],
): MenuDefinition[] {
  return menus.map((menu, menuIndex) => ({
    ...menu,
    items: menu.items.map((item, itemIndex) =>
      bindItem(() => getLiveMenus()?.[menuIndex]?.items[itemIndex], item),
    ),
  }))
}
