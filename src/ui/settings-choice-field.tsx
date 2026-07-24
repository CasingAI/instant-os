import { useEffect, useRef, useState } from 'preact/hooks'
import type { SettingsChoiceOption } from './settings-choice-option-list.tsx'
import { SettingsChoicePopoverMenu } from './settings-choice-popover-menu.tsx'
import { SettingsNavRow } from './settings-nav-row.tsx'
import './settings-choice-field.css'

type SettingsChoiceFieldProps = {
  label: string
  value: string
  displayValue?: string
  options: readonly SettingsChoiceOption[]
  onChange: (value: string) => void
  wideLayout: boolean
  onNavigate?: () => void
  presentation?: 'list' | 'form'
  fieldClass?: string
  labelClass?: string
  disabled?: boolean
  dark?: boolean
}

export function SettingsChoiceField({
  label,
  value,
  displayValue,
  options,
  onChange,
  wideLayout,
  onNavigate,
  presentation = 'list',
  fieldClass = 'settings__field',
  labelClass = 'settings__field-label',
  disabled,
  dark,
}: SettingsChoiceFieldProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const resolvedDisplay = displayValue ?? options.find((option) => option.id === value)?.label ?? value

  useEffect(() => {
    if (!wideLayout) {
      setOpen(false)
    }
  }, [wideLayout])

  useEffect(() => {
    if (!open) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const trigger = triggerRef.current
      const target = event.target as Node
      if (trigger?.contains(target)) {
        return
      }
      const overlay = document.getElementById('instant-os-floating-overlays')
      if (overlay?.contains(target)) {
        return
      }
      setOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const handleSelect = (next: string) => {
    onChange(next)
    setOpen(false)
  }

  const popoverMenu = (
    <SettingsChoicePopoverMenu
      open={open}
      anchorRef={triggerRef}
      options={options}
      value={value}
      label={label}
      dark={dark}
      onChange={handleSelect}
    />
  )

  if (!wideLayout) {
    return (
      <SettingsNavRow
        label={label}
        value={resolvedDisplay}
        disabled={disabled}
        onClick={() => onNavigate?.()}
      />
    )
  }

  if (presentation === 'form') {
    return (
      <div class={fieldClass}>
        <span class={labelClass}>{label}</span>
        <div class="settings-choice-field">
          <button
            ref={triggerRef}
            type="button"
            class={`settings-choice-field__trigger${open ? ' settings-choice-field__trigger--open' : ''}${dark ? ' settings-choice-field__trigger--dark' : ''}`}
            aria-haspopup="listbox"
            aria-expanded={open}
            disabled={disabled}
            onClick={() => setOpen((current) => !current)}
          >
            <span class="settings-choice-field__trigger-label">{resolvedDisplay}</span>
          </button>
          {popoverMenu}
        </div>
      </div>
    )
  }

  return (
    <div class="settings-choice-field settings-choice-field--row">
      <SettingsNavRow
        rowRef={triggerRef}
        label={label}
        value={resolvedDisplay}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      />
      {popoverMenu}
    </div>
  )
}
