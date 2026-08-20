import type { ComponentChildren } from 'preact'
import { IosNavBackButton } from './ios-nav-back-button.tsx'
import './popover-nav-header.css'

export type PopoverNavHeaderProps = {
  title: string
  /** 有值时显示 mini 返回按钮 */
  backLabel?: string
  onBack?: () => void
  trailing?: ComponentChildren
  dark?: boolean
  class?: string
}

export function PopoverNavHeader({
  title,
  backLabel,
  onBack,
  trailing,
  dark,
  class: className,
}: PopoverNavHeaderProps) {
  const showBack = Boolean(backLabel && onBack)
  return (
    <div
      class={`popover-nav-header${dark ? ' popover-nav-header--dark' : ''}${className ? ` ${className}` : ''}`}
    >
      <div class="popover-nav-header__leading">
        {showBack ? (
          <IosNavBackButton size="mini" label={backLabel!} onClick={() => onBack?.()} />
        ) : (
          <span class="popover-nav-header__spacer" aria-hidden="true" />
        )}
      </div>
      <h1 class="popover-nav-header__title">{title}</h1>
      <div class="popover-nav-header__trailing">
        {trailing ?? <span class="popover-nav-header__spacer" aria-hidden="true" />}
      </div>
    </div>
  )
}
