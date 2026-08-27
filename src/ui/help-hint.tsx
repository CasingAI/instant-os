import { useRef, useState } from 'preact/hooks'
import { Popover } from './popover.tsx'
import './help-hint.css'

type HelpHintProps = {
  /** 说明内容，展示在弹出气泡里 */
  text: string
  /** 无障碍标签；缺省用「说明」 */
  label?: string
}

/**
 * 系统风格帮助提示：圆形「？」按钮（SVG 矢量问号，任何字号都几何居中），
 * 点按经 Popover 弹出说明气泡（带指向箭头；宿主窗口很窄时变居中模态）。
 */
export function HelpHint({ text, label }: HelpHintProps) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button
        type="button"
        ref={buttonRef}
        class={`help-hint${open ? ' help-hint--open' : ''}`}
        aria-label={label ?? '说明'}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => !value)
        }}
      >
        <svg class="help-hint__icon" viewBox="0 0 14 14" aria-hidden="true">
          <path
            d="M4.8 4.6a2.2 2.2 0 1 1 3.9 1.4c-.9.75-1.7 1.3-1.7 2.4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
          />
          <circle cx="7" cy="10.7" r="0.95" fill="currentColor" />
        </svg>
      </button>
      <Popover
        open={open}
        anchorRef={buttonRef}
        onClose={() => setOpen(false)}
        ariaLabel={label ?? '说明'}
      >
        {text}
      </Popover>
    </>
  )
}
