import { useEffect, useRef, useState } from 'preact/hooks'
import { readAppliedDockReservePx } from '../dock/dock-css-vars.ts'
import './icon-context-menu.css'

export type IconContextMenuActionItem = {
  type: 'action'
  label: string
  disabled?: boolean
  destructive?: boolean
  onClick: () => void
}

export type IconContextMenuLeafItem = IconContextMenuActionItem | { type: 'separator' }

export type IconContextMenuItem =
  | IconContextMenuActionItem
  | { type: 'separator' }
  | { type: 'submenu'; label: string; items: IconContextMenuLeafItem[] }

type IconContextMenuProps = {
  x: number
  y: number
  items: IconContextMenuItem[]
  onClose: () => void
}

function IconContextMenuLeaf({
  item,
  index,
  onClose,
}: {
  item: IconContextMenuLeafItem
  index: number
  onClose: () => void
}) {
  if (item.type === 'separator') {
    return <div key={`sep-${index}`} class="os-icon-context-menu__separator" role="separator" />
  }

  return (
    <button
      key={item.label}
      type="button"
      class={`os-icon-context-menu__item${item.destructive ? ' os-icon-context-menu__item--destructive' : ''}`}
      role="menuitem"
      disabled={item.disabled}
      onClick={() => {
        if (item.disabled) {
          return
        }
        item.onClick()
        onClose()
      }}
    >
      {item.label}
    </button>
  )
}

function IconContextMenuSubmenu({
  item,
  onClose,
}: {
  item: Extract<IconContextMenuItem, { type: 'submenu' }>
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
      class={`os-icon-context-menu__submenu-row${open ? ' os-icon-context-menu__submenu-row--open' : ''}`}
      role="none"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span class="os-icon-context-menu__submenu-label">{item.label}</span>
      <span class="os-icon-context-menu__submenu-chevron" aria-hidden="true">
        ›
      </span>
      {open && (
        <div
          ref={submenuRef}
          class={`os-icon-context-menu os-icon-context-menu__submenu${alignLeft ? ' os-icon-context-menu__submenu--left' : ''}`}
          role="menu"
          aria-label={item.label}
        >
          {item.items.map((subItem, index) => (
            <IconContextMenuLeaf key={`${item.label}-${index}`} item={subItem} index={index} onClose={onClose} />
          ))}
        </div>
      )}
    </div>
  )
}

export function IconContextMenu({ x, y, items, onClose }: IconContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // 触摸板右键常在 contextmenu 之后仍投递同一次手势的 pointerdown/up；
    // 等本次指针抬起（或短暂超时）后再允许「点外部关闭」，避免菜单闪一下就消失。
    let dismissArmed = false
    let armTimer = 0

    const armDismiss = () => {
      if (dismissArmed) {
        return
      }
      dismissArmed = true
      window.removeEventListener('pointerup', armDismiss, true)
      window.clearTimeout(armTimer)
    }

    armTimer = window.setTimeout(armDismiss, 50)
    window.addEventListener('pointerup', armDismiss, true)

    const handlePointerDown = (event: PointerEvent) => {
      if (!dismissArmed) {
        return
      }
      // 只认主键；右键属于打开手势
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
      if (!dismissArmed) {
        return
      }
      onClose()
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      window.clearTimeout(armTimer)
      window.removeEventListener('pointerup', armDismiss, true)
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [onClose])

  useEffect(() => {
    const menu = menuRef.current
    if (!menu) {
      return
    }

    const menuRect = menu.getBoundingClientRect()
    const dockReserve = readAppliedDockReservePx()
    const maxX = window.innerWidth - menuRect.width - 8
    const maxY = window.innerHeight - dockReserve - menuRect.height - 8

    menu.style.left = `${Math.max(8, Math.min(x, maxX))}px`
    menu.style.top = `${Math.max(8, Math.min(y, maxY))}px`
  }, [x, y, items])

  return (
    <div
      ref={menuRef}
      class="os-icon-context-menu"
      role="menu"
      style={{ left: `${x}px`, top: `${y}px` }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => {
        if (item.type === 'separator') {
          return (
            <div key={`sep-${index}`} class="os-icon-context-menu__separator" role="separator" />
          )
        }

        if (item.type === 'submenu') {
          return <IconContextMenuSubmenu key={item.label} item={item} onClose={onClose} />
        }

        return <IconContextMenuLeaf key={item.label} item={item} index={index} onClose={onClose} />
      })}
    </div>
  )
}
