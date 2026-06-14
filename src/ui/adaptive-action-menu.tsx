import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import { ActionMenuSheet } from './action-menu-sheet.tsx'
import { getFloatingOverlayRoot } from './floating-overlay-root.ts'
import { useOverlayPresence } from './use-overlay-presence.ts'
import './adaptive-action-menu.css'

export type AdaptiveActionMenuItem =
  | { type: 'action'; label: string; disabled?: boolean; shortcut?: string; onClick: () => void }
  | { type: 'separator' }

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
}

function handleAction(item: Extract<AdaptiveActionMenuItem, { type: 'action' }>, onClose: () => void) {
  if (item.disabled) {
    return
  }
  item.onClick()
  onClose()
}

function AdaptiveActionMenuDropdown({
  items,
  anchor,
  mount,
  onClose,
}: {
  items: AdaptiveActionMenuItem[]
  anchor: { x: number; y: number }
  mount: AdaptiveActionMenuMount
  onClose: () => void
}) {
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

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) {
      return
    }

    const menuRect = menu.getBoundingClientRect()

    if (mount === 'portal') {
      const maxX = window.innerWidth - menuRect.width - 4
      const maxY = window.innerHeight - menuRect.height - 4
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
        {items.map((item, index) => {
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
    <AdaptiveActionMenuDropdown items={items} anchor={anchor} mount={mount} onClose={onClose} />
  )

  if (mount === 'portal') {
    return createPortal(content, getFloatingOverlayRoot())
  }

  return content
}
