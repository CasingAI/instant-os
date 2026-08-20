import type { ComponentType, JSX } from 'preact'
import type { AppIconDecorationConfig } from '../os/types.ts'
import './app-icon-decoration.css'

type IconProps = { size?: number }

/** 小于该尺寸时隐藏装饰，避免文字糊掉（菜单栏、文件列表等极小尺寸图标） */
const MIN_DECORATION_SIZE = 32

/** 与 AppIconTile 的圆角公式保持一致 */
function appIconRadius(size: number): number {
  return Math.round(size * 0.22)
}

/** viewBox 100：色带中心落在对角线上，外沿贴在圆角弦内侧 */
const RIBBON_CX = 81
const RIBBON_CY = 19
const RIBBON_LENGTH = 78
const RIBBON_THICKNESS = 20
const RIBBON_FONT = 11

export function withAppIconDecoration(
  Icon: ComponentType<IconProps>,
  decoration: AppIconDecorationConfig,
): ComponentType<IconProps> {
  return function AppIconWithDecoration({ size = 64 }: IconProps) {
    if (size < MIN_DECORATION_SIZE) {
      return <Icon size={size} />
    }

    const style: JSX.CSSProperties = {
      '--d': `${size}px`,
      '--r': `${appIconRadius(size)}px`,
    }

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
          <span class="app-icon-decoration__overlay">
            <svg class="app-icon-ribbon" viewBox="0 0 100 100" aria-hidden="true">
              <g transform={`translate(${RIBBON_CX} ${RIBBON_CY}) rotate(45)`}>
                <rect
                  class="app-icon-ribbon__band"
                  x={-RIBBON_LENGTH / 2}
                  y={-RIBBON_THICKNESS / 2}
                  width={RIBBON_LENGTH}
                  height={RIBBON_THICKNESS}
                />
                <text
                  class="app-icon-ribbon__label"
                  text-anchor="middle"
                  dominant-baseline="middle"
                  dy="0.08em"
                  font-size={RIBBON_FONT}
                >
                  {decoration.ribbon.label}
                </text>
              </g>
            </svg>
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
