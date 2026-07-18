import { useEffect, useRef } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import './menu-bar-popover.css'

type MenuBarPopoverProps = {
  align?: 'left' | 'right' | 'center'
  label: string
  flushBottom?: boolean
  children: ComponentChildren
}

export function MenuBarPopover({
  align = 'left',
  label,
  flushBottom = false,
  children,
}: MenuBarPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = popoverRef.current
    if (!el) return

    const adjustPosition = () => {
      el.style.marginLeft = '0px'

      let rect = el.getBoundingClientRect()
      const padding = 8
      let marginLeft = 0

      if (rect.right > window.innerWidth) {
        marginLeft -= (rect.right - window.innerWidth + padding)
      }

      if (marginLeft !== 0) {
        el.style.marginLeft = `${marginLeft}px`
        rect = el.getBoundingClientRect()
      }

      if (rect.left < padding) {
        marginLeft += (padding - rect.left)
        el.style.marginLeft = `${marginLeft}px`
      }
    }

    adjustPosition()
    window.addEventListener('resize', adjustPosition)
    return () => window.removeEventListener('resize', adjustPosition)
  }, [align])

  const alignClass =
    align === 'right'
      ? ' menu-bar__popover--right'
      : align === 'center'
        ? ' menu-bar__popover--center'
        : ''
  const flushClass = flushBottom ? ' menu-bar__popover--flush-bottom' : ''

  return (
    <div
      ref={popoverRef}
      class={`menu-bar__popover${alignClass}${flushClass}`}
      role="dialog"
      aria-label={label}
    >
      {children}
    </div>
  )
}
