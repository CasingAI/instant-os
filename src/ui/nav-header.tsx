import type { ComponentChildren } from 'preact'
import { BackIcon } from '../icons/app-icons.tsx'
import { ButtonDefaultReliefProvider } from './button.tsx'
import './nav-header.css'

export type NavHeaderProps = {
  /** 居中标题；缺省时标题元素留空（Header 仍占位居中） */
  title?: string
  /** 返回按钮文案（无 onBack 时不渲染返回按钮） */
  backLabel?: string
  onBack?: () => void
  /** 右侧操作区（PageActionButton 等）；缺省时渲染隐形占位保持标题居中 */
  actions?: ComponentChildren
  class?: string
}

/*
 * Nav 专用私有 Header：只由 nav.tsx（Nav.Page / Nav.Header）使用，勿在
 * Nav 之外引用。样式亮暗自带（nav-header.css 的私有 token），不对外提供
 * 换皮变量；Nav 之外需要页头时用共享的 PageHeader。返回键照 Button
 * relief="sunken" 配方做凹：灰边框 → 一圈对内阴影 → 底色，按下压暗加深。
 */

/** 返回键：← + 文案，sunken 凹款（本文件私有，不导出） */
function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" class="nav-header__back" onClick={onClick}>
      <span class="nav-header__back-icon" aria-hidden="true">
        <BackIcon size={13} />
      </span>
      <span class="nav-header__back-label">{label}</span>
    </button>
  )
}

/**
 * 三槽 Header：左返回（可缺省）/ 中标题（可缺省）/ 右操作（可缺省）。
 * grid 1fr/auto/1fr，标题居中并有省略号；操作按钮可挤压（flex-shrink）而不是溢出滚动。
 */
export function NavHeader({
  title,
  backLabel,
  onBack,
  actions,
  class: className,
}: NavHeaderProps) {
  const classes = [
    'nav-header',
    title ? undefined : 'nav-header--no-title',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <ButtonDefaultReliefProvider relief="sunken">
      <div class={classes}>
        <div class="nav-header__bar">
          {onBack ? (
            <BackButton label={backLabel ?? '返回'} onClick={onBack} />
          ) : (
            <span class="nav-header__back-spacer" aria-hidden="true" />
          )}
          {title ? <h1 class="nav-header__title">{title}</h1> : undefined}
          {actions ? (
            <div class="nav-header__trailing">{actions}</div>
          ) : (
            <span class="nav-header__trailing nav-header__trailing--empty" aria-hidden="true" />
          )}
        </div>
      </div>
    </ButtonDefaultReliefProvider>
  )
}
