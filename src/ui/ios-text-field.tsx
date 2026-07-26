import type { JSX } from 'preact'
import './ios-text-field.css'

export type IosTextFieldProps = Omit<JSX.IntrinsicElements['input'], 'class'> & {
  class?: string
}

/** iOS 6 内凹文本输入框 */
export function IosTextField({ class: className, type = 'text', ...rest }: IosTextFieldProps) {
  return <input type={type} class={['ios-text-field', className].filter(Boolean).join(' ')} {...rest} />
}
