import type { ComponentChildren, JSX } from 'preact'
import { useSpeechDictation } from '../ai/use-speech-dictation.ts'
import './input.css'

export type InputProps = Omit<JSX.IntrinsicElements['input'], 'class'> & {
  class?: string
  /**
   * 长按空格语音听写。
   * undefined = 跟随开发者选项「语音实验室」；false = 强制关闭。
   */
  voiceDictation?: boolean
}

export type TextAreaProps = Omit<JSX.IntrinsicElements['textarea'], 'class'> & {
  class?: string
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
    return 'input-wrap--recording'
  }
  if (phase === 'recognizing') {
    return 'input-wrap--recognizing'
  }
  return ''
}

function DictationWrap({
  phase,
  children,
}: {
  phase: string
  children: ComponentChildren
}) {
  return (
    <span class={['input-wrap', wrapPhaseClass(phase)].filter(Boolean).join(' ')}>
      {children}
      <span class="input__wave" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
      <span class="input__spinner" aria-hidden="true" />
    </span>
  )
}

/** 内凹文本输入框 */
function InputImpl({
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
}: InputProps) {
  const dictation = useSpeechDictation({
    voiceDictation,
    type,
    disabled: disabled as boolean | undefined,
    readOnly: readOnly as boolean | undefined,
  })

  const inputClass = [
    'input',
    dictation.isDictating ? 'input--dictating' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <DictationWrap phase={dictation.phase}>
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
    </DictationWrap>
  )
}

/** 内凹多行文本域 */
function TextAreaImpl({
  class: className,
  voiceDictation,
  disabled,
  readOnly,
  onKeyDown,
  onKeyUp,
  onBlur,
  onCompositionStart,
  onCompositionEnd,
  ...rest
}: TextAreaProps) {
  const dictation = useSpeechDictation({
    voiceDictation,
    as: 'textarea',
    disabled: disabled as boolean | undefined,
    readOnly: readOnly as boolean | undefined,
  })

  const textareaClass = [
    'input',
    'input--textarea',
    dictation.isDictating ? 'input--dictating' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <DictationWrap phase={dictation.phase}>
      <textarea
        class={textareaClass}
        disabled={disabled}
        readOnly={readOnly}
        {...rest}
        onKeyDown={chainHandler(dictation.onKeyDown, onKeyDown)}
        onKeyUp={chainHandler(dictation.onKeyUp, onKeyUp)}
        onBlur={chainHandler(dictation.onBlur, onBlur)}
        onCompositionStart={chainHandler(dictation.onCompositionStart, onCompositionStart)}
        onCompositionEnd={chainHandler(dictation.onCompositionEnd, onCompositionEnd)}
      />
    </DictationWrap>
  )
}

export const Input = Object.assign(InputImpl, { TextArea: TextAreaImpl })
