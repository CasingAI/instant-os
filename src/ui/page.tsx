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
  /** 页壳内凹边框（默认关）：正文左/右/底露出壳底色成 U 形粗边框、面板
   * 上缘内凹嵌进壳里，且正文钉亮色作用域；关闭时正文整页平铺、随外层
   * 作用域取色。Nav 的 pageInset 经 Context 统一下发，也可单独使用 */
  inset?: boolean
}

/**
 * 页面根：头部 + 可滚动正文。
 * .page__body 同时是静止态与转场态的滚动容器（层保活，scrollTop 自动保留）。
 */
export function Page({ header, children, class: className, dataTheme, inset }: PageProps) {
  return (
    <div class={`page${inset ? ' page--inset' : ''}${className ? ` ${className}` : ''}`} data-theme={dataTheme}>
      {header}
      {/* 壳包住滚动容器：内阴影等画在壳伪元素上的效果浮在滚动内容
          之上（画在 .page__body 自身会被铺满内容盖住、随滚动滚走）。
          壳接管 body 的弹性布局职责，亮色下无任何视觉。 */}
      <div class="page__body-shell">
        {/* 内容面板默认亮（= 套一层 DarkMode disabled 的作用域）：内凹边框
            开启时内容区是浅色内凹面板，这里钉亮色作用域让面板内的全部内容
            跟面板走；关闭时不钉，正文整页随外层作用域取色。内凹页里调用方
            要暗色内容，在自己的内容外再包一层 <DarkMode> 即可——自定义属性
            按最近定义祖先继承，一包就翻。 */}
        <div class="page__body" data-theme={inset ? 'light' : undefined}>
          {children}
        </div>
      </div>
    </div>
  )
}