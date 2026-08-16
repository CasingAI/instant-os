import type { ComponentType, JSX } from 'preact'
import type { AppIconDecorationConfig } from '../os/types.ts'
import './app-icon-decoration.css'

type IconProps = { size?: number }

/** 小于该尺寸时隐藏装饰，避免文字糊掉（菜单栏、文件列表等极小尺寸图标） */
const MIN_DECORATION_SIZE = 32

export function withAppIconDecoration(
  Icon: ComponentType<IconProps>,
  decoration: AppIconDecorationConfig,
): ComponentType<IconProps> {
  return function AppIconWithDecoration({ size = 64 }: IconProps) {
    if (size < MIN_DECORATION_SIZE) {
      return <Icon size={size} />
    }

    const style: JSX.CSSProperties = { '--d': `${size}px` }

    if (decoration.ribbon?.color) {
      style['--app-icon-ribbon-color'] = decoration.ribbon.color
    }
    if (decoration.sleeve?.color) {
      style['--app-icon-sleeve-color'] = decoration.sleeve.color
    }

    return (
      <span class="app-icon-decoration" style={style}>
        <Icon size={size} />
        {decoration.ribbon && (
          <span class="app-icon-ribbon" aria-hidden="true">
            <span class="app-icon-ribbon__band">{decoration.ribbon.label}</span>
          </span>
        )}
        {decoration.sleeve && (
          <span class="app-icon-sleeve" aria-hidden="true">
            {decoration.sleeve.label}
          </span>
        )}
      </span>
    )
  }
}
