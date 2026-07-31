import type { JSX } from 'preact'
import { BackIcon } from '../icons/app-icons.tsx'
import './ios-nav-back.css'

type IosNavBackButtonProps = {
  label: string
  onClick: (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => void
  class?: string
  /** default ≈ 28px；mini ≈ 22px，供 Popover 等紧凑场景 */
  size?: 'default' | 'mini'
  iconSize?: number
  disabled?: boolean
  'aria-label'?: string
}

export function IosNavBackButton({
  label,
  onClick,
  class: className,
  size = 'default',
  iconSize,
  disabled = false,
  'aria-label': ariaLabel,
}: IosNavBackButtonProps) {
  const resolvedIconSize = iconSize ?? (size === 'mini' ? 11 : 13)
  return (
    <button
      type="button"
      class={`ios-nav-back${size === 'mini' ? ' ios-nav-back--mini' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      <span class="ios-nav-back__icon" aria-hidden="true">
        <BackIcon size={resolvedIconSize} />
      </span>
      <span class="ios-nav-back__label">{label}</span>
    </button>
  )
}
