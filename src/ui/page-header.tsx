import type { ComponentChildren } from 'preact'
import { PageBackButton } from './page-back-button.tsx'
import './page-header.css'

export type PageHeaderProps = {
  /** 居中标题；缺省时标题元素留空（Header 仍占位居中） */
  title?: string
  /** 返回按钮文案（无 onBack 时不渲染返回按钮） */
  backLabel?: string
  onBack?: () => void
  /** 右侧操作区（PageActionButton 等）；缺省时渲染隐形占位保持标题居中 */
  actions?: ComponentChildren
  class?: string
}

/**
 * 三槽 Header：左返回（可缺省）/ 中标题（可缺省）/ 右操作（可缺省）。
 * grid 1fr/2fr/1fr，标题居中并有省略号；操作按钮可挤压（flex-shrink）而不是溢出滚动。
 */
export function PageHeader({
  title,
  backLabel,
  onBack,
  actions,
  class: className,
}: PageHeaderProps) {
  const classes = [
    'page-header',
    title ? undefined : 'page-header--no-title',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div class={classes}>
      <div class="page-header__bar">
        {onBack ? (
          <PageBackButton label={backLabel ?? '返回'} onClick={onBack} />
        ) : (
          <span class="page-header__back-spacer" aria-hidden="true" />
        )}
        {title ? <h1 class="page-header__title">{title}</h1> : undefined}
        {actions ? (
          <div class="page-header__trailing">{actions}</div>
        ) : (
          <span class="page-header__trailing page-header__trailing--empty" aria-hidden="true" />
        )}
      </div>
    </div>
  )
}