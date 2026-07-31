import { ForwardIcon } from '../icons/app-icons.tsx'
import './popover-nav-row.css'

export type PopoverNavRowProps = {
  label: string
  value: string
  onClick: () => void
  disabled?: boolean
  dark?: boolean
  class?: string
}

export function PopoverNavRow({
  label,
  value,
  onClick,
  disabled,
  dark,
  class: className,
}: PopoverNavRowProps) {
  return (
    <button
      type="button"
      class={`popover-nav-row${dark ? ' popover-nav-row--dark' : ''}${className ? ` ${className}` : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span class="popover-nav-row__label">{label}</span>
      <span class="popover-nav-row__value">{value}</span>
      <span class="popover-nav-row__chevron" aria-hidden="true">
        <ForwardIcon size={11} />
      </span>
    </button>
  )
}
