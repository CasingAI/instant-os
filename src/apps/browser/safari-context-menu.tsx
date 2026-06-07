import { useEffect, useRef } from 'preact/hooks'

export type SafariContextMenuItem =
  | { type: 'action'; label: string; disabled?: boolean; onClick: () => void }
  | { type: 'separator' }

export type SafariContextMenuTarget =
  | { kind: 'link'; url: string }
  | { kind: 'image'; url: string }
  | { kind: 'page' }

type SafariContextMenuProps = {
  x: number
  y: number
  items: SafariContextMenuItem[]
  onClose: () => void
}

export function SafariContextMenu({ x, y, items, onClose }: SafariContextMenuProps) {
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

    const parent = menu.offsetParent as HTMLElement | undefined
    if (!parent) {
      return
    }

    const parentRect = parent.getBoundingClientRect()
    const menuRect = menu.getBoundingClientRect()
    const maxX = parentRect.width - menuRect.width - 4
    const maxY = parentRect.height - menuRect.height - 4

    menu.style.left = `${Math.max(4, Math.min(x, maxX))}px`
    menu.style.top = `${Math.max(4, Math.min(y, maxY))}px`
  }, [x, y, items])

  return (
    <div
      ref={menuRef}
      class="safari-context-menu"
      role="menu"
      style={{ left: `${x}px`, top: `${y}px` }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => {
        if (item.type === 'separator') {
          return <div key={`sep-${index}`} class="safari-context-menu__separator" role="separator" />
        }

        return (
          <button
            key={item.label}
            type="button"
            class="safari-context-menu__item"
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
