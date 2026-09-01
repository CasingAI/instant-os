import type { JSX } from 'preact'
import { BackIcon } from '../icons/app-icons.tsx'
import './page-back-button.css'

export type PageBackButtonProps = {
  label: string
  onClick: (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => void
  class?: string
  iconSize?: number
  disabled?: boolean
  'aria-label'?: string
}

/** 页面栈返回按钮：← + 文案，样式与系统 Header 返回一致 */
export function PageBackButton({
  label,
  onClick,
  class: className,
  iconSize = 13,
  disabled = false,
  'aria-label': ariaLabel,
}: PageBackButtonProps) {
  return (
    <button
      type="button"
      class={`page-back-button${className ? ` ${className}` : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      <span class="page-back-button__icon" aria-hidden="true">
        <BackIcon size={iconSize} />
      </span>
      <span class="page-back-button__label">{label}</span>
    </button>
  )
}