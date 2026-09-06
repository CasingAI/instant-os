import type { ComponentChildren } from 'preact'
import './page.css'
import './theme.css'

export type PageProps = {
  /** 顶部 Header（PageHeader），可为空 */
  header?: ComponentChildren
  children: ComponentChildren
  class?: string
  /** 页根携带主题作用域：主题壳无法包住页元素时（Nav.Page 的外壳由
   * Nav 强制），把 data-theme 直接钉在 .page 根上，标题栏与正文整页
   * 随作用域取色，页面内外的布局结构不受影响 */
  dataTheme?: 'dark' | 'light'
}

/**
 * 页面根：头部 + 可滚动正文。
 * .page__body 同时是静止态与转场态的滚动容器（层保活，scrollTop 自动保留）。
 */
export function Page({ header, children, class: className, dataTheme }: PageProps) {
  return (
    <div class={`page${className ? ` ${className}` : ''}`} data-theme={dataTheme}>
      {header}
      {/* 内容面板默认亮（= 恒定套一层 DarkMode disabled 的作用域）：深蓝壳
          设计下暗色页的内容区是浅色内凹面板，这里钉死亮色作用域让面板内的
          全部内容跟面板走。调用方要暗色内容，在自己的内容外再包一层
          <DarkMode> 即可——自定义属性按最近定义祖先继承，一包就翻。 */}
      <div class="page__body" data-theme="light">
        {children}
      </div>
    </div>
  )
}