import type { ComponentChildren } from 'preact'
import './theme.css'

/**
 * 主题强制作用域壳：包住谁，谁里面的系统页面组件（Page / PageHeader /
 * PageStack 转场 / Nav，均消费同一套 --page-* token）整体按指定主题
 * 渲染，包外不受影响——应用无须再往自己的根节点手工塞 data-theme
 * （见 vscode-settings-panel 的旧用法）。
 *
 * disabled = 强制亮色，不是「跟随外层」：亮色有对称作用域
 * （theme.css 的 [data-theme='light']，值抄自各组件 :root 定义与消费方
 * fallback——--page-bg 没有 :root 定义，是从 fallback 抄的），暗色祖先
 * 里照样抠出亮色块。缺省强制暗色。
 *
 * display:contents 让壳不生成盒子：不占布局、不打乱调用方的 flex/grid
 * 子项关系，只向子树贡献一个属性；变量走 DOM 树继承（display:contents
 * 不影响继承），按「最近的定义祖先」压过更远的定义。无任何 JS 运行时。
 */
export function DarkMode({
  children,
  disabled,
}: {
  children: ComponentChildren
  disabled?: boolean
}) {
  return (
    <div
      data-theme={disabled ? 'light' : 'dark'}
      style={{ display: 'contents' }}
    >
      {children}
    </div>
  )
}
