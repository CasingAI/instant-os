import type { ComponentChildren } from 'preact'
import { createContext } from 'preact'
import { useCallback, useContext, useState } from 'preact/hooks'
import { IconContextMenu, type IconContextMenuItem } from './icon-context-menu.tsx'

type IconContextMenuState = {
  x: number
  y: number
  items: IconContextMenuItem[]
}

type IconContextMenuContextValue = {
  showIconContextMenu: (event: MouseEvent, items: IconContextMenuItem[]) => void
}

const IconContextMenuContext = createContext<IconContextMenuContextValue | undefined>(undefined)

export function IconContextMenuProvider({ children }: { children: ComponentChildren }) {
  const [menu, setMenu] = useState<IconContextMenuState | undefined>(undefined)

  const showIconContextMenu = useCallback((event: MouseEvent, items: IconContextMenuItem[]) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY, items })
  }, [])

  const closeMenu = useCallback(() => {
    setMenu(undefined)
  }, [])

  return (
    <IconContextMenuContext.Provider value={{ showIconContextMenu }}>
      {children}
      {menu && (
        <IconContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />
      )}
    </IconContextMenuContext.Provider>
  )
}

export function useIconContextMenu() {
  const context = useContext(IconContextMenuContext)
  if (!context) {
    throw new Error('useIconContextMenu must be used within IconContextMenuProvider')
  }
  return context
}
