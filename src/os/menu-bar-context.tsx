import type { ComponentChildren } from 'preact'
import { createContext } from 'preact'
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { bindMenusToLive } from './menu-bar-live-handlers.ts'
import type { AppId } from './types.ts'
import type { MenuDefinition, MenuItem, MenuItemLeaf } from './menu-bar-types.ts'

type MenuBarContextValue = {
  menusByApp: Record<string, MenuDefinition[]>
  registerAppMenus: (appId: AppId, menus: MenuDefinition[]) => void
  unregisterAppMenus: (appId: AppId) => void
}

const MenuBarContext = createContext<MenuBarContextValue | undefined>(undefined)

function leafItemSignature(item: MenuItemLeaf): string | [string, boolean, string, string] {
  if (item.type === 'separator') {
    return '|'
  }
  return [item.label, item.disabled ?? false, item.shortcut ?? '', item.id ?? '']
}

function menuItemSignature(
  item: MenuItem,
): string | [string, boolean, string, string] | [string, 'submenu', unknown[]] {
  if (item.type === 'submenu') {
    return [item.label, 'submenu', item.items.map(leafItemSignature)]
  }
  return leafItemSignature(item)
}

function menuSignature(menus: MenuDefinition[]): string {
  return JSON.stringify(
    menus.map((menu) => ({
      label: menu.label,
      items: menu.items.map(menuItemSignature),
    })),
  )
}

export function MenuBarProvider({ children }: { children: ComponentChildren }) {
  const [menusByApp, setMenusByApp] = useState<Record<string, MenuDefinition[]>>({})
  const liveMenusRef = useRef<Record<string, MenuDefinition[]>>({})

  const registerAppMenus = useCallback((appId: AppId, menus: MenuDefinition[]) => {
    liveMenusRef.current = { ...liveMenusRef.current, [appId]: menus }
    const signature = menuSignature(menus)
    setMenusByApp((current) => {
      if (current[appId] && menuSignature(current[appId]) === signature) {
        return current
      }
      return {
        ...current,
        [appId]: bindMenusToLive(() => liveMenusRef.current[appId], menus),
      }
    })
  }, [])

  const unregisterAppMenus = useCallback((appId: AppId) => {
    const nextLive = { ...liveMenusRef.current }
    delete nextLive[appId]
    liveMenusRef.current = nextLive
    setMenusByApp((current) => {
      if (!(appId in current)) {
        return current
      }
      const next = { ...current }
      delete next[appId]
      return next
    })
  }, [])

  const value = useMemo(
    () => ({ menusByApp, registerAppMenus, unregisterAppMenus }),
    [menusByApp, registerAppMenus, unregisterAppMenus],
  )

  return <MenuBarContext.Provider value={value}>{children}</MenuBarContext.Provider>
}

export function useMenuBar() {
  const context = useContext(MenuBarContext)
  if (!context) {
    throw new Error('useMenuBar must be used within MenuBarProvider')
  }
  return context
}

export function useAppMenuBar(appId: AppId, menus: MenuDefinition[], enabled = true) {
  const { registerAppMenus, unregisterAppMenus } = useMenuBar()

  useLayoutEffect(() => {
    if (!enabled) {
      unregisterAppMenus(appId)
      return
    }
    registerAppMenus(appId, menus)
  }, [appId, enabled, menus, registerAppMenus, unregisterAppMenus])

  useEffect(() => {
    return () => unregisterAppMenus(appId)
  }, [appId, unregisterAppMenus])
}
