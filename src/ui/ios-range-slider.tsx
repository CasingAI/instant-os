import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import './ios-range-slider.css'

export type IosRangeSliderMark = {
  value: number
  label?: string
}

type IosRangeSliderProps = {
  value: number
  min: number
  max: number
  step: number
  label?: string
  suffix?: string
  disabled?: boolean
  marks?: IosRangeSliderMark[]
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
  marks,
  onChange,
}: IosRangeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [inputValue, setInputValue] = useState(String(value))
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    setInputValue(String(value))
  }, [value])

  // 拖动中把光标锁成 grabbing：window 级 mousemove 移出组件后 CSS 类就管不到了。
  useEffect(() => {
    if (!dragging) return
    document.body.style.cursor = 'grabbing'
    return () => {
      document.body.style.cursor = ''
    }
  }, [dragging])

  const clampedValue = clampStep(value, min, max, step)
  const progress = max === min ? 0 : (clampedValue - min) / (max - min)

  const normalizedMarks = useMemo(() => {
    const byValue = new Map<number, IosRangeSliderMark>()
    for (const mark of marks ?? []) {
      if (mark.value < min || mark.value > max) continue
      const snapped = clampStep(mark.value, min, max, step)
      const existing = byValue.get(snapped)
      byValue.set(snapped, {
        value: snapped,
        label: existing?.label ?? mark.label,
      })
    }
    return [...byValue.values()].sort((a, b) => a.value - b.value)
  }, [marks, min, max, step])

  const labeledMarks = useMemo(
    () => normalizedMarks.filter((mark) => mark.label),
    [normalizedMarks],
  )

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
        setDragging(false)
      }
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      setDragging(true)
    },
    [disabled, setClientX],
  )

  return (
    <div
      class={`ios-range-slider${disabled ? ' ios-range-slider--disabled' : ''}${
        dragging ? ' ios-range-slider--dragging' : ''
      }`}
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
        <div class="ios-range-slider__track-area" onMouseDown={handleMouseDown}>
          <div
            class="ios-range-slider__track"
            ref={trackRef}
            role="slider"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={clampedValue}
          >
            <div
              class="ios-range-slider__fill"
              style={{ width: `${progress * 100}%` }}
            />
            {normalizedMarks.map((mark) => (
              <div
                key={mark.value}
                class={`ios-range-slider__tick${
                  clampedValue >= mark.value ? ' ios-range-slider__tick--active' : ''
                }`}
                style={{
                  // 圆头半径 4px，圆心在 100% - 4px：极限档位的点要和圆头同心。
                  left: `clamp(4px, ${
                    max === min ? 0 : ((mark.value - min) / (max - min)) * 100
                  }%, calc(100% - 4px))`,
                }}
              />
            ))}
            <div
              class="ios-range-slider__thumb"
              style={{ left: `clamp(4px, ${progress * 100}%, calc(100% - 4px))` }}
            />
            {dragging && !disabled ? (
              <>
                <div
                  class="ios-range-slider__tooltip"
                  style={
                    // 气泡中心钳在 [18px, 100%-18px]：中段正好居中于拇指，极限档最多被
                    // 压回 14px，气泡外缘最多探出轨道端点 12px（轨道区自身留白），不会被面板裁掉。
                    { left: `clamp(18px, ${progress * 100}%, calc(100% - 18px))` }
                  }
                >
                  {clampedValue}
                  {suffix}
                </div>
                <div
                  class="ios-range-slider__tooltip-arrow"
                  style={{ left: `clamp(4px, ${progress * 100}%, calc(100% - 4px))` }}
                />
              </>
            ) : null}
          </div>
          {labeledMarks.length > 0 ? (
            <div class="ios-range-slider__marks">
              {labeledMarks.map((mark) => (
                <span
                  key={mark.value}
                  class="ios-range-slider__mark-label"
                  style={{
                    // 和刻度点同一圆心：极限标签对齐圆头圆心，而不是端点。
                    left: `clamp(4px, ${
                      max === min ? 0 : ((mark.value - min) / (max - min)) * 100
                    }%, calc(100% - 4px))`,
                  }}
                >
                  {mark.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
