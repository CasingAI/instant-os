import type { JSX } from 'preact'
import 'material-symbols/outlined.css'
import 'material-symbols/rounded.css'
import 'material-symbols/sharp.css'

export type IconFamily = 'outlined' | 'rounded' | 'sharp'

export type IconProps = {
  /** Material Symbols ligature 名，如 "delete"；名字见 fonts.google.com/icons */
  name: string
  /** 字体族（三套变量字体的轮廓风格），默认 rounded */
  family?: IconFamily
  /** FILL 轴：描边（false，默认）/ 填充（true） */
  fill?: boolean
  /** wght 轴 100–700，默认 400 */
  weight?: number
  /** GRAD 轴 -25–200，默认 0 */
  grade?: number
  /** font-size 像素值；缺省用字体族默认的 24px */
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
