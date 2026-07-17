import { useEffect, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import { ForwardIcon } from '../icons/app-icons.tsx'
import { ActionMenuSheet } from '../ui/action-menu-sheet.tsx'
import { getFloatingOverlayRoot } from '../ui/floating-overlay-root.ts'
import { useOverlayPresence } from '../ui/use-overlay-presence.ts'
import type { MenuDefinition, MenuItemLeaf } from './menu-bar-types.ts'

type MenuOverflowModalProps = {
  open: boolean
  menus: MenuDefinition[]
  onClose: () => void
}

type OverflowView =
  | { kind: 'menus' }
  | { kind: 'menu'; menu: MenuDefinition }
  | { kind: 'submenu'; parentMenu: MenuDefinition; item: Extract<MenuDefinition['items'][number], { type: 'submenu' }> }

export function MenuOverflowModal({ open, menus, onClose }: MenuOverflowModalProps) {
  const [view, setView] = useState<OverflowView>({ kind: 'menus' })
  const { mounted, exiting } = useOverlayPresence(open)

  useEffect(() => {
    if (!mounted) {
      setView({ kind: 'menus' })
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
      if (view.kind !== 'menus') {
        if (view.kind === 'submenu') {
          setView({ kind: 'menu', menu: view.parentMenu })
          return
        }
        setView({ kind: 'menus' })
        return
      }
      onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [exiting, menus, mounted, onClose, view])

  const handleAction = (item: MenuItemLeaf) => {
    if (item.type !== 'action' || item.disabled) {
      return
    }
    item.onClick()
    onClose()
  }

  const sheetTitle =
    view.kind === 'menus'
      ? '被隐藏的菜单'
      : view.kind === 'menu'
        ? view.menu.label
        : view.item.label

  const handleBack = () => {
    if (view.kind === 'submenu') {
      setView({ kind: 'menu', menu: view.parentMenu })
      return
    }
    if (view.kind === 'menu') {
      setView({ kind: 'menus' })
      return
    }
    onClose()
  }

  if (!mounted) {
    return undefined
  }

  return createPortal(
    <ActionMenuSheet
      mount="portal"
      exiting={exiting}
      title={sheetTitle}
      ariaLabel={sheetTitle}
      onBackdropClose={onClose}
      headerStart={
        <button
          type="button"
          class="action-menu-sheet__back"
          onClick={handleBack}
        >
          返回
        </button>
      }
    >
      <div class="action-menu-sheet__list" role="menu">
        {view.kind === 'submenu'
          ? view.item.items.map((item, index) => {
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
                  {item.shortcut ? (
                    <span class="action-menu-sheet__item-shortcut">{item.shortcut}</span>
                  ) : undefined}
                </button>
              )
            })
          : view.kind === 'menu'
            ? view.menu.items.map((item, index) => {
                if (item.type === 'separator') {
                  return (
                    <div key={`sep-${index}`} class="action-menu-sheet__separator" role="separator" />
                  )
                }

                if (item.type === 'submenu') {
                  return (
                    <button
                      key={item.label}
                      type="button"
                      class="action-menu-sheet__item action-menu-sheet__item--nav"
                      role="menuitem"
                      onClick={() => setView({ kind: 'submenu', parentMenu: view.menu, item })}
                    >
                      <span class="action-menu-sheet__item-label">{item.label}</span>
                      <span class="action-menu-sheet__item-chevron" aria-hidden="true">
                        <ForwardIcon size={13} />
                      </span>
                    </button>
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
                    {item.shortcut ? (
                      <span class="action-menu-sheet__item-shortcut">{item.shortcut}</span>
                    ) : undefined}
                  </button>
                )
              })
            : menus.map((menu) => (
                <button
                  key={menu.label}
                  type="button"
                  class="action-menu-sheet__item action-menu-sheet__item--nav"
                  role="menuitem"
                  onClick={() => setView({ kind: 'menu', menu })}
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
