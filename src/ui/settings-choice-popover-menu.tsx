import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { RefObject } from 'preact'
import { createPortal } from 'preact/compat'
import { computeFloatingPanelPosition } from './compute-floating-panel-position.ts'
import { getFloatingOverlayRoot } from './floating-overlay-root.ts'
import type { SettingsChoiceOption } from './settings-choice-option-list.tsx'
import './settings-choice-popover-menu.css'

type SettingsChoicePopoverMenuProps = {
  open: boolean
  anchorRef: RefObject<HTMLElement>
  options: readonly SettingsChoiceOption[]
  value: string
  label: string
  onChange: (value: string) => void
  dark?: boolean
}

export function SettingsChoicePopoverMenu({
  open,
  anchorRef,
  options,
  value,
  label,
  onChange,
  dark,
}: SettingsChoicePopoverMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) {
      return
    }

    const panel = panelRef.current
    const anchorRect = anchor.getBoundingClientRect()
    const measured = panel?.getBoundingClientRect()
    const panelWidth = measured && measured.width > 0 ? measured.width : 120
    const panelHeight =
      measured && measured.height > 0 ? measured.height : Math.max(32, options.length * 32)

    setPosition(
      computeFloatingPanelPosition(anchorRect, panelWidth, panelHeight, 'right'),
    )
  }, [anchorRef, options.length])

  useLayoutEffect(() => {
    if (!open) {
      return
    }

    updatePosition()

    const frame = window.requestAnimationFrame(() => {
      updatePosition()
    })

    window.addEventListener('resize', updatePosition)
    document.addEventListener('scroll', updatePosition, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, updatePosition])

  if (!open) {
    return undefined
  }

  return createPortal(
    <div
      ref={panelRef}
      class={`settings-choice-popover${dark ? ' settings-choice-popover--dark' : ''}`}
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
      role="listbox"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          class="settings-choice-popover__item"
          role="option"
          aria-selected={value === option.id}
          onClick={() => onChange(option.id)}
        >
          <span class="settings-choice-popover__label">{option.label}</span>
          {value === option.id && (
            <span class="settings-choice-popover__check" aria-hidden="true">
              ✓
            </span>
          )}
        </button>
      ))}
    </div>,
    getFloatingOverlayRoot(),
  )
}
