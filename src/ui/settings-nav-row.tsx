import type { Ref } from 'preact'
import { ForwardIcon } from '../icons/app-icons.tsx'

type SettingsNavRowProps = {
  label: string
  value: string
  onClick: () => void
  disabled?: boolean
  rowRef?: Ref<HTMLButtonElement>
}

export function SettingsNavRow({ label, value, onClick, disabled, rowRef }: SettingsNavRowProps) {
  return (
    <button
      ref={rowRef}
      type="button"
      class="settings__row settings__row--button settings__row--nav"
      disabled={disabled}
      onClick={onClick}
    >
      <span class="settings__row-name">{label}</span>
      <span class="settings__row-size">{value}</span>
      <span class="settings__disclosure" aria-hidden="true">
        <ForwardIcon size={13} />
      </span>
    </button>
  )
}
