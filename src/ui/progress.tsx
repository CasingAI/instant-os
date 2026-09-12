import './progress.css'

export type ProgressStatus = 'normal' | 'active' | 'success' | 'error'

export type ProgressProps = {
  /** 0-100 的百分比；< 0 或 > 100 会被 clamp。不确定态时只作无障碍回退，不画宽度 */
  percent?: number
  /** 总量未知：整条轨道走条纹，不表示百分比 */
  indeterminate?: boolean
  /** 状态：active 在已填部分上叠条纹；success 绿；error 红 */
  status?: ProgressStatus
  /** 控制条高度；small 适合列表行与菜单栏卡片 */
  size?: 'small' | 'default'
  /** 是否显示右侧百分比（不确定态且未传 info 时强制不显示） */
  showInfo?: boolean
  /** 追加自定义类名 */
  className?: string
  /** 覆盖右侧文案（如 "12 / 340"） */
  info?: string
  /** 无障碍 label */
  ariaLabel?: string
}

function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.max(0, Math.min(100, value))
}

export function Progress({
  percent = 0,
  indeterminate = false,
  status = 'normal',
  size = 'default',
  showInfo = true,
  className,
  info,
  ariaLabel,
}: ProgressProps) {
  const clamped = clampPercent(percent)
  const displayInfo = indeterminate ? info : (info ?? `${Math.round(clamped)}%`)
  const revealInfo = showInfo && displayInfo !== undefined
  const statusClass =
    status === 'success'
      ? ' progress--success'
      : status === 'error'
        ? ' progress--error'
        : status === 'active'
          ? ' progress--active'
          : ''
  const sizeClass = size === 'small' ? ' progress--small' : ''
  const extraClass = className ? ` ${className}` : ''
  const indeterminateClass = indeterminate ? ' progress--indeterminate' : ''

  return (
    <div
      class={`progress${statusClass}${sizeClass}${indeterminateClass}${extraClass}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
      aria-label={ariaLabel}
    >
      <div class="progress__track">
        <div
          class="progress__bar"
          style={indeterminate ? undefined : { width: `${clamped}%` }}
        />
      </div>
      {revealInfo && <span class="progress__info">{displayInfo}</span>}
    </div>
  )
}
