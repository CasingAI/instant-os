import type { JSX } from 'preact'
import { useSpeechDictation } from '../ai/use-speech-dictation.ts'
import './ios-text-field.css'

export type IosTextFieldProps = Omit<JSX.IntrinsicElements['input'], 'class'> & {
  class?: string
  /**
   * 长按空格语音听写。
   * undefined = 跟随开发者选项「语音实验室」；false = 强制关闭。
   */
  voiceDictation?: boolean
}

function chainHandler<E>(
  first: ((event: E) => void) | undefined,
  second: ((event: E) => void) | undefined,
): ((event: E) => void) | undefined {
  if (!first && !second) return undefined
  return (event: E) => {
    first?.(event)
    second?.(event)
  }
}

function wrapPhaseClass(phase: string): string {
  if (phase === 'arming' || phase === 'recording') {
    return 'ios-text-field-wrap--recording'
  }
  if (phase === 'recognizing') {
    return 'ios-text-field-wrap--recognizing'
  }
  return ''
}

/** iOS 6 内凹文本输入框 */
export function IosTextField({
  class: className,
  type = 'text',
  voiceDictation,
  disabled,
  readOnly,
  onKeyDown,
  onKeyUp,
  onBlur,
  onCompositionStart,
  onCompositionEnd,
  ...rest
}: IosTextFieldProps) {
  const dictation = useSpeechDictation({
    voiceDictation,
    type,
    disabled: disabled as boolean | undefined,
    readOnly: readOnly as boolean | undefined,
  })

  const wrapClass = ['ios-text-field-wrap', wrapPhaseClass(dictation.phase)]
    .filter(Boolean)
    .join(' ')

  const inputClass = [
    'ios-text-field',
    dictation.isDictating ? 'ios-text-field--dictating' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <span class={wrapClass}>
      <input
        type={type}
        class={inputClass}
        disabled={disabled}
        readOnly={readOnly}
        {...rest}
        onKeyDown={chainHandler(dictation.onKeyDown, onKeyDown)}
        onKeyUp={chainHandler(dictation.onKeyUp, onKeyUp)}
        onBlur={chainHandler(dictation.onBlur, onBlur)}
        onCompositionStart={chainHandler(dictation.onCompositionStart, onCompositionStart)}
        onCompositionEnd={chainHandler(dictation.onCompositionEnd, onCompositionEnd)}
      />
      <span class="ios-text-field__wave" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
      <span class="ios-text-field__spinner" aria-hidden="true" />
    </span>
  )
}
