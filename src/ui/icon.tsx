import type { JSX } from 'preact'
import 'material-symbols/outlined.css'
import 'material-symbols/rounded.css'
import 'material-symbols/sharp.css'
import './icon.css'

export type IconFamily = 'outlined' | 'rounded' | 'sharp'

export type IconProps = {
  /** Material Symbols ligature 名，如 "delete"；名字见 fonts.google.com/icons。内置自绘例外：activity-indicator（iOS 6 风格转圈，CSS 绘制，不占字体；size < 20px 自动换紧凑画法） */
  name: string
  /** 字体族（三套变量字体的轮廓风格），默认 rounded；自绘图标忽略 */
  family?: IconFamily
  /** FILL 轴：描边（false，默认）/ 填充（true）；自绘图标忽略 */
  fill?: boolean
  /** wght 轴 100–700，默认 400；自绘图标忽略 */
  weight?: number
  /** GRAD 轴 -25–200，默认 0；自绘图标忽略 */
  grade?: number
  /** font-size 像素值；缺省用字体族默认的 24px。自绘图标则作为盒子边长 */
  size?: number
  /** 语义化标签；缺省时图标 aria-hidden，仅供装饰 */
  label?: string
  class?: string
  style?: JSX.CSSProperties
}

const FAMILY_CLASS: Record<IconFamily, string> = {
  outlined: 'material-symbols-outlined',
  rounded: 'material-symbols-rounded',
  sharp: 'material-symbols-sharp',
}

const TICK_COUNT = 12
/** 紧凑变体（size < 20px）：12 根刻度按百分比缩到 14px 级别会细成发丝且彼此挤在一起，
 *  改 8 根（45° 一步）并按比例加粗加长；样式见 icon.css 的 --small 块 */
const SMALL_TICK_COUNT = 8
const SMALL_MAX_SIZE = 20

/** 自绘图标：iOS 6 风格转圈（UIActivityIndicatorView），颜色随 currentColor，size 即盒子边长；
 *  size < 20px 自动切紧凑画法（刻度 12→8 根、加粗加长），调用方不感知 */
function ActivityIndicatorIcon({ size, label, className, style }: {
  size?: number
  label?: string
  className?: string
  style?: JSX.CSSProperties
}) {
  const small = size != null && size < SMALL_MAX_SIZE
  const base = small ? 'icon-activity-indicator icon-activity-indicator--small' : 'icon-activity-indicator'
  return (
    <span
      class={className ? `${base} ${className}` : base}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      style={{ width: size != null ? `${size}px` : undefined, height: size != null ? `${size}px` : undefined, ...style }}
    >
      {Array.from({ length: small ? SMALL_TICK_COUNT : TICK_COUNT }, (_, i) => (
        <span key={i} class="icon-activity-indicator__tick" style={`--icon-ai-i:${i}`} />
      ))}
    </span>
  )
}

/** Material Symbols 图标：ligature 文本经 OpenType 连字渲染为图形，粗细/填充走可变字体轴 */
export function Icon({
  name,
  family = 'rounded',
  fill = false,
  weight = 400,
  grade = 0,
  size,
  label,
  class: className,
  style,
}: IconProps) {
  if (name === 'activity-indicator') {
    return <ActivityIndicatorIcon size={size} label={label} className={className} style={style} />
  }
  return (
    <span
      class={className ? `${FAMILY_CLASS[family]} ${className}` : FAMILY_CLASS[family]}
      aria-hidden={label ? undefined : 'true'}
      aria-label={label}
      role={label ? 'img' : undefined}
      style={{
        fontSize: size != null ? `${size}px` : undefined,
        fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}, 'GRAD' ${grade}, 'opsz' 24`,
        ...style,
      }}
    >
      {name}
    </span>
  )
}
