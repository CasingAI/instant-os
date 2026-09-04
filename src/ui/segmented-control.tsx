import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import './segmented-control.css'

export type SegmentedControlItem<T extends string = string> = {
  id: T
  label: string
  /** 未选中时显示脏状态小橙点 */
  dirty?: boolean
  /** 段标签旁的数量角标；空字符串 / 0 / undefined 不显示 */
  badge?: string | number
}

export type SegmentedControlProps<T extends string = string> = {
  value: T
  items: readonly SegmentedControlItem<T>[]
  onChange: (id: T) => void
  ariaLabel: string
  className?: string
}

/** 凹槽条分段切换器；只管切换 UI，不管内容区。
 * 默认契约：分段以自身文字为最小宽度，均分只分配富余空间，父级压不动；
 * 被钉进比文字窄的定宽格子（固定网格列等）时由调用方追加 className
 * `segmented-control--clamp`：整条不越界，分段退回省略号截断 */
export function SegmentedControl<T extends string>({
  value,
  items,
  onChange,
  ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  const [motionReady, setMotionReady] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null)
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.id === value),
  )

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMotionReady(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  // 分段有了文字下限后不再严格均分，滑块几何只能实测活动段
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const measure = () => {
      const active = root.querySelector<HTMLButtonElement>(
        '[aria-selected="true"]',
      )
      if (!active) return
      // offsetLeft 相对根的边框外缘，thumb 的 left 基准在边框内，扣掉边框宽
      const x = active.offsetLeft - root.clientLeft
      const w = active.offsetWidth
      setThumb((prev) =>
        prev && prev.x === x && prev.w === w ? prev : { x, w },
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
  }, [value, items])

  const rootClass = [
    'segmented-control',
    motionReady ? 'segmented-control--ready' : undefined,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={rootRef}
      class={rootClass}
      role="tablist"
      aria-label={ariaLabel}
      style={{
        '--segmented-count': String(Math.max(items.length, 1)),
        '--segmented-index': String(activeIndex),
        ...(thumb
          ? {
              '--segmented-thumb-x': `${thumb.x}px`,
              '--segmented-thumb-w': `${thumb.w}px`,
            }
          : {}),
      }}
    >
      <span class="segmented-control__thumb" aria-hidden="true" />
      {items.map((item) => {
        const active = value === item.id
        const itemClass = [
          'segmented-control__item',
          active ? 'segmented-control__item--active' : undefined,
          item.dirty ? 'segmented-control__item--dirty' : undefined,
        ]
          .filter(Boolean)
          .join(' ')

        const showBadge =
          item.badge !== undefined && item.badge !== '' && item.badge !== 0

        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            class={itemClass}
            onClick={() => onChange(item.id)}
          >
            {item.label}
            {showBadge ? (
              <span class="segmented-control__badge">{item.badge}</span>
            ) : undefined}
          </button>
        )
      })}
    </div>
  )
}
