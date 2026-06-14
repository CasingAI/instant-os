import type { ComponentChildren, RefObject } from 'preact'
import { createContext } from 'preact'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { IconContextMenu, type IconContextMenuItem } from './icon-context-menu.tsx'

type IconContextMenuState = {
  x: number
  y: number
  items: IconContextMenuItem[]
}

type IconContextMenuHostHandle = {
  show: (event: MouseEvent, items: IconContextMenuItem[]) => void
}

type IconContextMenuContextValue = {
  showIconContextMenu: (event: MouseEvent, items: IconContextMenuItem[]) => void
}

const IconContextMenuContext = createContext<IconContextMenuContextValue | undefined>(undefined)

type IconContextMenuHostProps = {
  hostRef: RefObject<IconContextMenuHostHandle | undefined>
}

function IconContextMenuHost({ hostRef }: IconContextMenuHostProps) {
  const [menu, setMenu] = useState<IconContextMenuState | undefined>(undefined)

  const closeMenu = useCallback(() => {
    setMenu(undefined)
  }, [])

  useEffect(() => {
    hostRef.current = {
      show: (event, items) => {
        event.preventDefault()
        event.stopPropagation()
        setMenu({ x: event.clientX, y: event.clientY, items })
      },
    }
    return () => {
      hostRef.current = undefined
    }
  }, [hostRef])

  if (!menu) {
    return undefined
  }

  return (
    <IconContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />
  )
}

export function IconContextMenuProvider({ children }: { children: ComponentChildren }) {
  const hostRef = useRef<IconContextMenuHostHandle | undefined>(undefined)

  const showIconContextMenu = useCallback((event: MouseEvent, items: IconContextMenuItem[]) => {
    hostRef.current?.show(event, items)
  }, [])

  const contextValue = useMemo(
    () => ({ showIconContextMenu }),
    [showIconContextMenu],
  )

  return (
    <IconContextMenuContext.Provider value={contextValue}>
      {children}
      <IconContextMenuHost hostRef={hostRef} />
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
