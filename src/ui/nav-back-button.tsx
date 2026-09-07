import type { JSX } from 'preact'
import { BackIcon } from '../icons/app-icons.tsx'
import './nav-back.css'

type NavBackButtonProps = {
  label: string
  onClick: (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => void
  class?: string
  /** default ≈ 28px；mini ≈ 22px，供 Popover 等紧凑场景 */
  size?: 'default' | 'mini'
  iconSize?: number
  disabled?: boolean
  'aria-label'?: string
}

/**
 * @deprecated 已弃用，新代码不要再用；仅保留供现有调用方，后续随调用方迁移一并移除。
 */
export function NavBackButton({
  label,
  onClick,
  class: className,
  size = 'default',
  iconSize,
  disabled = false,
  'aria-label': ariaLabel,
}: NavBackButtonProps) {
  const resolvedIconSize = iconSize ?? (size === 'mini' ? 11 : 13)
  return (
    <button
      type="button"
      class={`nav-back${size === 'mini' ? ' nav-back--mini' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      <span class="nav-back__icon" aria-hidden="true">
        <BackIcon size={resolvedIconSize} />
      </span>
      <span class="nav-back__label">{label}</span>
    </button>
  )
}
