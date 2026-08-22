import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import './ios-range-slider.css'

type IosRangeSliderProps = {
  value: number
  min: number
  max: number
  step: number
  label?: string
  suffix?: string
  disabled?: boolean
  onChange: (value: number) => void
}

function clampStep(value: number, min: number, max: number, step: number): number {
  const rounded = Math.round(value / step) * step
  return Math.max(min, Math.min(max, rounded))
}

/** iOS 风格 Range Slider：左侧数字输入框可直接键入，右侧是水平拖块。 */
export function IosRangeSlider({
  value,
  min,
  max,
  step,
  label,
  suffix = '',
  disabled = false,
  onChange,
}: IosRangeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [inputValue, setInputValue] = useState(String(value))

  useEffect(() => {
    setInputValue(String(value))
  }, [value])

  const clampedValue = clampStep(value, min, max, step)
  const progress = max === min ? 0 : (clampedValue - min) / (max - min)

  const commit = useCallback(
    (raw: number) => {
      onChange(clampStep(raw, min, max, step))
    },
    [min, max, step, onChange],
  )

  const handleInput = useCallback(
    (event: Event) => {
      const text = (event.currentTarget as HTMLInputElement).value
      setInputValue(text)
      const parsed = Number(text)
      if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
        commit(parsed)
      }
    },
    [commit],
  )

  const handleBlur = useCallback(() => {
    commit(Number(inputValue) || min)
  }, [commit, inputValue, min])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        handleBlur()
        ;(event.currentTarget as HTMLInputElement).blur()
      }
    },
    [handleBlur],
  )

  const setClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track) return
      const rect = track.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const raw = min + ratio * (max - min)
      commit(raw)
    },
    [min, max, commit],
  )

  const handleMouseDown = useCallback(
    (event: MouseEvent) => {
      if (disabled) return
      event.preventDefault()
      setClientX(event.clientX)

      const handleMouseMove = (moveEvent: MouseEvent) => {
        setClientX(moveEvent.clientX)
      }
      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    },
    [disabled, setClientX],
  )

  return (
    <div
      class={`ios-range-slider${disabled ? ' ios-range-slider--disabled' : ''}`}
      aria-disabled={disabled}
    >
      {label ? <span class="ios-range-slider__label">{label}</span> : null}
      <div class="ios-range-slider__body">
        <input
          type="number"
          class="ios-range-slider__input"
          value={inputValue}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onInput={handleInput}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />
        {suffix ? <span class="ios-range-slider__suffix">{suffix}</span> : null}
        <div
          class="ios-range-slider__track"
          ref={trackRef}
          onMouseDown={handleMouseDown}
          role="slider"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={clampedValue}
        >
          <div
            class="ios-range-slider__fill"
            style={{ width: `${progress * 100}%` }}
          />
          <div
            class="ios-range-slider__thumb"
            style={{ left: `${progress * 100}%` }}
          />
        </div>
      </div>
    </div>
  )
}
