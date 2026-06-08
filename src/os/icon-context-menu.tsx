import { useEffect, useRef } from 'preact/hooks'
import './icon-context-menu.css'

export type IconContextMenuItem =
  | { type: 'action'; label: string; disabled?: boolean; destructive?: boolean; onClick: () => void }
  | { type: 'separator' }

type IconContextMenuProps = {
  x: number
  y: number
  items: IconContextMenuItem[]
  onClose: () => void
}

export function IconContextMenu({ x, y, items, onClose }: IconContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
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
      onClose()
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
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
    const maxX = window.innerWidth - menuRect.width - 8
    const maxY = window.innerHeight - menuRect.height - 8

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
      })}
    </div>
  )
}
