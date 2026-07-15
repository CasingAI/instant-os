import { useEffect, useRef } from 'preact/hooks'

const ITEM_HEIGHT = 36

type DateTimeWheelColumnProps = {
  values: readonly number[]
  value: number
  label: string
  formatValue?: (value: number) => string
  onChange: (value: number) => void
}

export function DateTimeWheelColumn({
  values,
  value,
  label,
  formatValue = String,
  onChange,
}: DateTimeWheelColumnProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const settlingRef = useRef(false)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    const index = Math.max(0, values.indexOf(value))
    const top = index * ITEM_HEIGHT
    if (Math.abs(viewport.scrollTop - top) > 1) {
      settlingRef.current = true
      viewport.scrollTop = top
      window.requestAnimationFrame(() => {
        settlingRef.current = false
      })
    }
  }, [value, values])

  const handleScroll = () => {
    if (settlingRef.current) {
      return
    }
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    const index = Math.round(viewport.scrollTop / ITEM_HEIGHT)
    const next = values[Math.max(0, Math.min(values.length - 1, index))]
    if (next !== undefined && next !== value) {
      onChange(next)
    }
  }

  const handleScrollEnd = () => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    const index = Math.round(viewport.scrollTop / ITEM_HEIGHT)
    const clamped = Math.max(0, Math.min(values.length - 1, index))
    settlingRef.current = true
    viewport.scrollTo({ top: clamped * ITEM_HEIGHT, behavior: 'smooth' })
    const next = values[clamped]
    if (next !== undefined && next !== value) {
      onChange(next)
    }
    window.setTimeout(() => {
      settlingRef.current = false
    }, 180)
  }

  return (
    <div class="date-time-wheel" role="listbox" aria-label={label} aria-valuenow={value}>
      <div class="date-time-wheel__band" aria-hidden="true" />
      <div
        ref={viewportRef}
        class="date-time-wheel__viewport"
        onScroll={handleScroll}
        onPointerUp={handleScrollEnd}
        onTouchEnd={handleScrollEnd}
      >
        <div class="date-time-wheel__spacer" aria-hidden="true" />
        {values.map((item) => (
          <button
            key={item}
            type="button"
            role="option"
            aria-selected={item === value}
            class={`date-time-wheel__item${item === value ? ' date-time-wheel__item--selected' : ''}`}
            onClick={() => onChange(item)}
          >
            {formatValue(item)}
          </button>
        ))}
        <div class="date-time-wheel__spacer" aria-hidden="true" />
      </div>
    </div>
  )
}
