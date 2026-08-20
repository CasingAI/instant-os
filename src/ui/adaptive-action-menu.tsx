import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import { ActionMenuSheet } from './action-menu-sheet.tsx'
import { getFloatingOverlayRoot } from './floating-overlay-root.ts'
import { readAppliedDockReservePx } from '../dock/dock-css-vars.ts'
import { useOverlayPresence } from './use-overlay-presence.ts'
import './adaptive-action-menu.css'

export type AdaptiveActionMenuLeafItem =
  | { type: 'action'; label: string; disabled?: boolean; shortcut?: string; onClick: () => void }
  | { type: 'separator' }

export type AdaptiveActionMenuItem =
  | AdaptiveActionMenuLeafItem
  | { type: 'submenu'; label: string; items: AdaptiveActionMenuLeafItem[] }

export type AdaptiveActionMenuMount = 'contained' | 'portal'

type AdaptiveActionMenuProps = {
  open: boolean
  title: string
  items: AdaptiveActionMenuItem[]
  narrowLayout: boolean
  anchor?: { x: number; y: number }
  onClose: () => void
  mount?: AdaptiveActionMenuMount
  cancelLabel?: string
  /**
   * 右键菜单：等本次指针抬起后再允许点外部关闭。
   * 触摸板按住右键时，松开常会再合成一次 pointerdown/click，否则菜单会闪一下就没。
   */
  dismissAfterPointerUp?: boolean
}

function handleAction(item: Extract<AdaptiveActionMenuLeafItem, { type: 'action' }>, onClose: () => void) {
  if (item.disabled) {
    return
  }
  item.onClick()
  onClose()
}

function AdaptiveActionMenuSubmenu({
  item,
  onClose,
}: {
  item: Extract<AdaptiveActionMenuItem, { type: 'submenu' }>
  onClose: () => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [alignLeft, setAlignLeft] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }

    const row = rowRef.current
    const submenu = submenuRef.current
    if (!row || !submenu) {
      return
    }

    const rowRect = row.getBoundingClientRect()
    const submenuRect = submenu.getBoundingClientRect()
    const fitsRight = rowRect.right + submenuRect.width + 8 <= window.innerWidth
    setAlignLeft(!fitsRight)

    const defaultTop = -5
    let top = defaultTop
    const overflowBottom = rowRect.top + defaultTop + submenuRect.height - (window.innerHeight - 8)
    if (overflowBottom > 0) {
      top -= overflowBottom
    }
    const overflowTop = 8 - (rowRect.top + top)
    if (overflowTop > 0) {
      top += overflowTop
    }
    submenu.style.top = `${top}px`
  }, [open, item.items])

  return (
    <div
      ref={rowRef}
      class={`adaptive-action-menu__submenu-row${open ? ' adaptive-action-menu__submenu-row--open' : ''}`}
      role="none"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span class="adaptive-action-menu__submenu-label">{item.label}</span>
      <span class="adaptive-action-menu__submenu-chevron" aria-hidden="true">
        ›
      </span>
      {open && (
        <div
          ref={submenuRef}
          class={`adaptive-action-menu__dropdown adaptive-action-menu__submenu${alignLeft ? ' adaptive-action-menu__submenu--left' : ''}`}
          role="menu"
          aria-label={item.label}
        >
          {item.items.map((subItem, index) => {
            if (subItem.type === 'separator') {
              return (
                <div
                  key={`sep-${index}`}
                  class="adaptive-action-menu__dropdown-separator"
                  role="separator"
                />
              )
            }
            return (
              <button
                key={`${item.label}-${subItem.label}`}
                type="button"
                class="adaptive-action-menu__dropdown-item"
                role="menuitem"
                disabled={subItem.disabled}
                onClick={() => handleAction(subItem, onClose)}
              >
                {subItem.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AdaptiveActionMenuDropdown({
  items,
  anchor,
  mount,
  onClose,
  dismissAfterPointerUp = false,
}: {
  items: AdaptiveActionMenuItem[]
  anchor: { x: number; y: number }
  mount: AdaptiveActionMenuMount
  onClose: () => void
  dismissAfterPointerUp?: boolean
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let allowDismiss = !dismissAfterPointerUp
    let enableTimer = 0

    const enableDismiss = () => {
      allowDismiss = true
      window.clearTimeout(enableTimer)
    }

    const scheduleEnable = () => {
      window.clearTimeout(enableTimer)
      enableTimer = window.setTimeout(enableDismiss, 120)
    }

    if (dismissAfterPointerUp) {
      window.addEventListener('pointerup', scheduleEnable, true)
    } else {
      scheduleEnable()
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!allowDismiss) {
        return
      }
      if (event.button !== 0) {
        return
      }
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose()
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    const handleScroll = () => {
      if (!allowDismiss) {
        return
      }
      onClose()
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      window.clearTimeout(enableTimer)
      window.removeEventListener('pointerup', scheduleEnable, true)
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [dismissAfterPointerUp, onClose])

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) {
      return
    }

    const menuRect = menu.getBoundingClientRect()

    if (mount === 'portal') {
      const dockReserve = readAppliedDockReservePx()
      const maxX = window.innerWidth - menuRect.width - 4
      const maxY = window.innerHeight - dockReserve - menuRect.height - 4
      menu.style.left = `${Math.max(4, Math.min(anchor.x, maxX))}px`
      menu.style.top = `${Math.max(4, Math.min(anchor.y, maxY))}px`
      return
    }

    const offsetParent = menu.offsetParent as HTMLElement | undefined
    if (!offsetParent) {
      return
    }

    const parentRect = offsetParent.getBoundingClientRect()
    const localX = anchor.x - parentRect.left
    const localY = anchor.y - parentRect.top
    const maxX = parentRect.width - menuRect.width - 4
    const maxY = parentRect.height - menuRect.height - 4
    menu.style.left = `${Math.max(4, Math.min(localX, maxX))}px`
    menu.style.top = `${Math.max(4, Math.min(localY, maxY))}px`
  }, [anchor.x, anchor.y, items, mount])

  return (
    <div
      ref={menuRef}
      class={[
        'adaptive-action-menu__dropdown',
        mount === 'portal' ? 'adaptive-action-menu__dropdown--portal' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="menu"
      style={{ left: `${anchor.x}px`, top: `${anchor.y}px` }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => {
        if (item.type === 'separator') {
          return (
            <div
              key={`sep-${index}`}
              class="adaptive-action-menu__dropdown-separator"
              role="separator"
            />
          )
        }

        if (item.type === 'submenu') {
          return <AdaptiveActionMenuSubmenu key={`sub-${item.label}`} item={item} onClose={onClose} />
        }

        return (
          <button
            key={item.label}
            type="button"
            class="adaptive-action-menu__dropdown-item"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => handleAction(item, onClose)}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

function AdaptiveActionMenuModal({
  title,
  items,
  mount,
  cancelLabel,
  exiting,
  onClose,
}: {
  title: string
  items: AdaptiveActionMenuItem[]
  mount: AdaptiveActionMenuMount
  cancelLabel: string
  exiting: boolean
  onClose: () => void
}) {
  useEffect(() => {
    if (exiting) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [exiting, onClose])

  return (
    <ActionMenuSheet
      mount={mount}
      exiting={exiting}
      title={title}
      onBackdropClose={onClose}
      footer={
        <footer class="action-menu-sheet__footer">
          <button type="button" class="action-menu-sheet__cancel" onClick={onClose}>
            {cancelLabel}
          </button>
        </footer>
      }
    >
      <div class="action-menu-sheet__list" role="menu">
        {items.flatMap((item) => (item.type === 'submenu' ? item.items : [item])).map((item, index) => {
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
              onClick={() => handleAction(item, onClose)}
            >
              <span class="action-menu-sheet__item-label">{item.label}</span>
              {item.shortcut && (
                <span class="action-menu-sheet__item-shortcut">{item.shortcut}</span>
              )}
            </button>
          )
        })}
      </div>
    </ActionMenuSheet>
  )
}

export function AdaptiveActionMenu({
  open,
  title,
  items,
  narrowLayout,
  anchor,
  onClose,
  mount = 'contained',
  cancelLabel = '取消',
  dismissAfterPointerUp = false,
}: AdaptiveActionMenuProps) {
  const { mounted, exiting } = useOverlayPresence(open)
  const contentSnapshotRef = useRef<{ title: string; items: AdaptiveActionMenuItem[] }>({
    title,
    items,
  })

  if (open) {
    contentSnapshotRef.current = { title, items }
  }

  const displayTitle = contentSnapshotRef.current.title
  const displayItems = contentSnapshotRef.current.items

  if (narrowLayout) {
    if (!mounted) {
      return undefined
    }

    const content = (
      <AdaptiveActionMenuModal
        title={displayTitle}
        items={displayItems}
        mount={mount}
        cancelLabel={cancelLabel}
        exiting={exiting}
        onClose={onClose}
      />
    )

    if (mount === 'portal') {
      return createPortal(content, getFloatingOverlayRoot())
    }

    return content
  }

  if (!open) {
    return undefined
  }

  if (!anchor) {
    return undefined
  }

  const content = (
    <AdaptiveActionMenuDropdown
      items={items}
      anchor={anchor}
      mount={mount}
      onClose={onClose}
      dismissAfterPointerUp={dismissAfterPointerUp}
    />
  )

  if (mount === 'portal') {
    return createPortal(content, getFloatingOverlayRoot())
  }

  return content
}
