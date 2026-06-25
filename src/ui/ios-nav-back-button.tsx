import type { JSX } from 'preact'
import { BackIcon } from '../icons/app-icons.tsx'

type IosNavBackButtonProps = {
  label: string
  onClick: (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => void
  class?: string
  iconSize?: number
  disabled?: boolean
  'aria-label'?: string
}

export function IosNavBackButton({
  label,
  onClick,
  class: className,
  iconSize = 13,
  disabled = false,
  'aria-label': ariaLabel,
}: IosNavBackButtonProps) {
  return (
    <button
      type="button"
      class={`ios-nav-back${className ? ` ${className}` : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      <span class="ios-nav-back__icon" aria-hidden="true">
        <BackIcon size={iconSize} />
      </span>
      {label}
    </button>
  )
}
