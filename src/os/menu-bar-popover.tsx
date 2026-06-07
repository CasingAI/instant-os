import type { ComponentChildren } from 'preact'
import './menu-bar-popover.css'

type MenuBarPopoverProps = {
  align?: 'left' | 'right' | 'center'
  label: string
  children: ComponentChildren
}

export function MenuBarPopover({ align = 'left', label, children }: MenuBarPopoverProps) {
  const alignClass =
    align === 'right'
      ? ' menu-bar__popover--right'
      : align === 'center'
        ? ' menu-bar__popover--center'
        : ''

  return (
    <div
      class={`menu-bar__popover${alignClass}`}
      role="dialog"
      aria-label={label}
    >
      {children}
    </div>
  )
}
