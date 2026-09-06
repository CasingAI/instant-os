import type { ComponentChildren } from 'preact'
import './theme.css'

/**
 * 暗色主题作用域（Provider 壳）：包住谁，谁里面的系统页面组件（Page /
 * PageHeader / PageStack 转场 / Nav，均消费同一套 --page-* token）整体
 * 按暗色渲染，包外不受影响——应用无须再往自己的根节点手工塞
 * data-theme='dark'（见 vscode-settings-panel 的旧用法）。
 *
 * display:contents 让壳不生成盒子：不占布局、不打乱调用方的 flex/grid
 * 子项关系，只向子树贡献一个属性；暗色变量走 DOM 树继承（display:contents
 * 不影响继承），按「最近的定义祖先」天然压过 :root 的亮色默认值。无任何
 * JS 运行时。没有对称的亮色作用域——亮色即 :root 默认值，所以暗里嵌不出
 * 亮色块。
 */
export function DarkMode({ children }: { children: ComponentChildren }) {
  return (
    <div data-theme="dark" style={{ display: 'contents' }}>
      {children}
    </div>
  )
}
