import type { SpeechReadAloudControls } from '../ai/use-speech-read-aloud.ts'
import './speech-read-aloud-bar.css'

type SpeechReadAloudBarProps = {
  controls: SpeechReadAloudControls
  /** 视觉变体：贴合宿主 App */
  variant?: 'news' | 'books'
}

/** 朗读面板展开时显示的全宽控制横幅 */
export function SpeechReadAloudBar({
  controls,
  variant = 'news',
}: SpeechReadAloudBarProps) {
  const {
    panelOpen,
    isActive,
    label,
    phaseLabel,
    error,
    stop,
    resume,
    close,
  } = controls

  if (!panelOpen) {
    return undefined
  }

  return (
    <div
      class={[
        'speech-read-aloud-bar',
        `speech-read-aloud-bar--${variant}`,
        isActive ? 'speech-read-aloud-bar--active' : '',
        error ? 'speech-read-aloud-bar--error' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="region"
      aria-label="语音朗读"
    >
      <div class="speech-read-aloud-bar__inner">
        <div class="speech-read-aloud-bar__controls">
          <button
            type="button"
            class="speech-read-aloud-bar__btn speech-read-aloud-bar__btn--primary"
            onClick={() => {
              if (isActive) {
                stop()
              } else {
                resume()
              }
            }}
          >
            {label}
          </button>
        </div>

        <div class="speech-read-aloud-bar__trailing">
          <div class="speech-read-aloud-bar__status">
            {phaseLabel ? (
              <span class="speech-read-aloud-bar__phase speech-read-aloud-bar__phase--solo">
                {phaseLabel}
              </span>
            ) : error ? (
              <span class="speech-read-aloud-bar__phase speech-read-aloud-bar__phase--error speech-read-aloud-bar__phase--solo">
                {error}
              </span>
            ) : undefined}
          </div>
          <button
            type="button"
            class="speech-read-aloud-bar__close"
            aria-label="关闭朗读"
            title="关闭"
            onClick={close}
          >
            ×
          </button>
        </div>
      </div>
    </div>
  )
}
