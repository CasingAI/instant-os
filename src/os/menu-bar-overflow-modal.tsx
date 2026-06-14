import { useEffect, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import { ForwardIcon } from '../icons/app-icons.tsx'
import { ActionMenuSheet } from '../ui/action-menu-sheet.tsx'
import { getFloatingOverlayRoot } from '../ui/floating-overlay-root.ts'
import { useOverlayPresence } from '../ui/use-overlay-presence.ts'
import type { MenuDefinition, MenuItem } from './menu-bar-types.ts'

type MenuOverflowModalProps = {
  open: boolean
  menus: MenuDefinition[]
  onClose: () => void
}

export function MenuOverflowModal({ open, menus, onClose }: MenuOverflowModalProps) {
  const [selectedMenu, setSelectedMenu] = useState<MenuDefinition | undefined>(undefined)
  const { mounted, exiting } = useOverlayPresence(open)

  useEffect(() => {
    if (!mounted) {
      setSelectedMenu(undefined)
    }
  }, [mounted])

  useEffect(() => {
    if (!mounted || exiting) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      if (selectedMenu) {
        setSelectedMenu(undefined)
        return
      }
      onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [exiting, mounted, onClose, selectedMenu])

  const handleAction = (item: MenuItem) => {
    if (item.type !== 'action' || item.disabled) {
      return
    }
    item.onClick()
    onClose()
  }

  if (!mounted) {
    return undefined
  }

  return createPortal(
    <ActionMenuSheet
      mount="portal"
      exiting={exiting}
      title={selectedMenu ? selectedMenu.label : '被隐藏的菜单'}
      ariaLabel={selectedMenu ? selectedMenu.label : '被隐藏的菜单'}
      onBackdropClose={onClose}
      headerStart={
        <button
          type="button"
          class="action-menu-sheet__back"
          onClick={selectedMenu ? () => setSelectedMenu(undefined) : onClose}
        >
          返回
        </button>
      }
    >
      <div class="action-menu-sheet__list" role="menu">
        {selectedMenu
          ? selectedMenu.items.map((item, index) => {
              if (item.type === 'separator') {
                return (
                  <div key={`sep-${index}`} class="action-menu-sheet__separator" role="separator" />
                )
              }

              return (
                <button
                  key={item.label}
                  type="button"
                  class="action-menu-sheet__item"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => handleAction(item)}
                >
                  <span class="action-menu-sheet__item-label">{item.label}</span>
                  {item.shortcut && (
                    <span class="action-menu-sheet__item-shortcut">{item.shortcut}</span>
                  )}
                </button>
              )
            })
          : menus.map((menu) => (
              <button
                key={menu.label}
                type="button"
                class="action-menu-sheet__item action-menu-sheet__item--nav"
                role="menuitem"
                onClick={() => setSelectedMenu(menu)}
              >
                <span class="action-menu-sheet__item-label">{menu.label}</span>
                <span class="action-menu-sheet__item-chevron" aria-hidden="true">
                  <ForwardIcon size={13} />
                </span>
              </button>
            ))}
      </div>
    </ActionMenuSheet>,
    getFloatingOverlayRoot(),
  )
}
