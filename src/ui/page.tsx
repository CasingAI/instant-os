import type { ComponentChildren } from 'preact'
import './page.css'
import './theme.css'

export type PageProps = {
  /** 顶部 Header（PageHeader），可为空 */
  header?: ComponentChildren
  children: ComponentChildren
  class?: string
}

/**
 * 页面根：头部 + 可滚动正文。
 * .page__body 同时是静止态与转场态的滚动容器（层保活，scrollTop 自动保留）。
 */
export function Page({ header, children, class: className }: PageProps) {
  return (
    <div class={`page${className ? ` ${className}` : ''}`}>
      {header}
      <div class="page__body">{children}</div>
    </div>
  )
}