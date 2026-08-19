import type { MenuDefinition, MenuItem } from './menu-bar-types.ts'

export const APP_MENU_ITEM_IDS = {
  about: 'app.about',
  hide: 'app.hide',
  quit: 'app.quit',
} as const

export type AppMenuItemId = (typeof APP_MENU_ITEM_IDS)[keyof typeof APP_MENU_ITEM_IDS]

export type AppMenuTemplateActions = {
  onAbout: () => void
  onHide: () => void
  onQuit: () => void
}

type ReservedSlot = 'about' | 'hide' | 'quit'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function aboutLabel(appName: string): string {
  return `关于 ${appName}`
}

function hideLabel(appName: string): string {
  return `隐藏 ${appName}`
}

function quitLabel(appName: string): string {
  return `退出 ${appName}`
}

export function buildDefaultAppMenuItems(
  appName: string,
  actions: AppMenuTemplateActions,
): MenuItem[] {
  return [
    {
      type: 'action',
      id: APP_MENU_ITEM_IDS.about,
      label: aboutLabel(appName),
      onClick: actions.onAbout,
    },
    { type: 'separator' },
    {
      type: 'action',
      id: APP_MENU_ITEM_IDS.hide,
      label: hideLabel(appName),
      shortcut: '⌘H',
      onClick: actions.onHide,
    },
    { type: 'separator' },
    {
      type: 'action',
      id: APP_MENU_ITEM_IDS.quit,
      label: quitLabel(appName),
      shortcut: '⌘Q',
      onClick: actions.onQuit,
    },
  ]
}

function defaultItem(slot: ReservedSlot, appName: string, actions: AppMenuTemplateActions): MenuItem {
  if (slot === 'about') {
    return {
      type: 'action',
      id: APP_MENU_ITEM_IDS.about,
      label: aboutLabel(appName),
      onClick: actions.onAbout,
    }
  }
  if (slot === 'hide') {
    return {
      type: 'action',
      id: APP_MENU_ITEM_IDS.hide,
      label: hideLabel(appName),
      shortcut: '⌘H',
      onClick: actions.onHide,
    }
  }
  return {
    type: 'action',
    id: APP_MENU_ITEM_IDS.quit,
    label: quitLabel(appName),
    shortcut: '⌘Q',
    onClick: actions.onQuit,
  }
}

function identifySlot(item: MenuItem, appName: string): ReservedSlot | 'extra' | 'separator' {
  if (item.type === 'separator') {
    return 'separator'
  }
  if (item.type === 'submenu') {
    return 'extra'
  }
  if (item.id === APP_MENU_ITEM_IDS.about) {
    return 'about'
  }
  if (item.id === APP_MENU_ITEM_IDS.hide) {
    return 'hide'
  }
  if (item.id === APP_MENU_ITEM_IDS.quit) {
    return 'quit'
  }
  if (item.shortcut === '⌘H') {
    return 'hide'
  }
  if (item.shortcut === '⌘Q') {
    return 'quit'
  }

  const name = escapeRegExp(appName)
  if (new RegExp(`^关于\\s*${name}$`).test(item.label)) {
    return 'about'
  }
  if (new RegExp(`^隐藏\\s*${name}$`).test(item.label)) {
    return 'hide'
  }
  if (new RegExp(`^退出\\s*${name}$`).test(item.label)) {
    return 'quit'
  }
  return 'extra'
}

function firstMenuLooksLikeAppMenu(menu: MenuDefinition, appName: string): boolean {
  if (menu.label === appName) {
    return true
  }
  return menu.items.some((item) => {
    const slot = identifySlot(item, appName)
    return slot === 'about' || slot === 'hide' || slot === 'quit'
  })
}

export function collapseAppMenuSeparators(items: MenuItem[]): MenuItem[] {
  const out: MenuItem[] = []
  for (const item of items) {
    if (item.type === 'separator') {
      if (out.length === 0) {
        continue
      }
      if (out[out.length - 1]?.type === 'separator') {
        continue
      }
      out.push(item)
      continue
    }
    out.push(item)
  }
  while (out.length > 0 && out[out.length - 1]?.type === 'separator') {
    out.pop()
  }
  return out
}

function itemId(item: MenuItem): string | undefined {
  return item.type === 'action' ? item.id : undefined
}

export function mergeAppMenuItems(
  appItems: MenuItem[],
  appName: string,
  actions: AppMenuTemplateActions,
): MenuItem[] {
  const seen = new Set<ReservedSlot>()
  const result: MenuItem[] = []

  for (const item of appItems) {
    const slot = identifySlot(item, appName)
    if (slot === 'separator') {
      result.push({ type: 'separator' })
      continue
    }
    if (slot === 'extra') {
      result.push(item)
      continue
    }
    if (seen.has(slot)) {
      continue
    }
    seen.add(slot)
    result.push(defaultItem(slot, appName, actions))
  }

  if (seen.size === 0) {
    return collapseAppMenuSeparators([
      defaultItem('about', appName, actions),
      { type: 'separator' },
      ...result,
      { type: 'separator' },
      defaultItem('hide', appName, actions),
      { type: 'separator' },
      defaultItem('quit', appName, actions),
    ])
  }

  if (!seen.has('about')) {
    result.unshift({ type: 'separator' })
    result.unshift(defaultItem('about', appName, actions))
  }

  if (!seen.has('hide')) {
    const quitIndex = result.findIndex((item) => itemId(item) === APP_MENU_ITEM_IDS.quit)
    if (quitIndex >= 0) {
      result.splice(quitIndex, 0, defaultItem('hide', appName, actions), { type: 'separator' })
    } else {
      result.push({ type: 'separator' }, defaultItem('hide', appName, actions))
    }
  }

  if (!seen.has('quit')) {
    result.push({ type: 'separator' }, defaultItem('quit', appName, actions))
  }

  return collapseAppMenuSeparators(result)
}

export function applyAppMenuTemplate(
  menus: MenuDefinition[],
  appName: string,
  actions: AppMenuTemplateActions,
): MenuDefinition[] {
  const defaultMenu: MenuDefinition = {
    label: appName,
    items: buildDefaultAppMenuItems(appName, actions),
  }

  const first = menus[0]
  if (!first || !firstMenuLooksLikeAppMenu(first, appName)) {
    return [defaultMenu, ...menus]
  }

  return [
    {
      label: appName,
      items: mergeAppMenuItems(first.items, appName, actions),
    },
    ...menus.slice(1),
  ]
}
