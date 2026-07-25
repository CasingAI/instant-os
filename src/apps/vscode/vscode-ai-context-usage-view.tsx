import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  formatCompactTokenCount,
  formatTokenCount,
} from '../browser/format-token-count.ts'
import type { VscodeAiContextUsage } from './vscode-ai-context-usage.ts'

export type VscodeAiContextUsageViewProps = {
  usage: VscodeAiContextUsage | undefined
  disabled?: boolean
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  if (value > 100) return 100
  return value
}

export function VscodeAiContextUsageView({
  usage,
  disabled,
}: VscodeAiContextUsageViewProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current
      if (!root) return
      if (event.target instanceof Node && root.contains(event.target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const percent = useMemo(() => {
    if (!usage || usage.contextWindow <= 0) return 0
    return clampPercent((usage.totalTokens / usage.contextWindow) * 100)
  }, [usage])

  const ringStyle = useMemo(() => {
    const deg = (percent / 100) * 360
    const track = 'rgba(127, 127, 127, 0.28)'
    const fill =
      percent >= 90 ? '#e35d6a' : percent >= 70 ? '#e0a04a' : 'var(--help-accent, #2f87e2)'
    return {
      background: `conic-gradient(${fill} ${deg}deg, ${track} ${deg}deg)`,
    }
  }, [percent])

  if (!usage) {
    return (
      <div class="vscode-ai__context-usage vscode-ai__context-usage--empty" aria-hidden="true">
        <span class="vscode-ai__context-usage-ring" />
      </div>
    )
  }

  const prefix = usage.estimated ? '约 ' : ''
  const totalLabel = `${prefix}${formatCompactTokenCount(usage.totalTokens)}`
  const windowLabel = formatCompactTokenCount(usage.contextWindow)
  const percentLabel = `${Math.round(percent)}%`

  return (
    <div
      class={`vscode-ai__context-usage${open ? ' vscode-ai__context-usage--open' : ''}`}
      ref={rootRef}
    >
      <button
        type="button"
        class="vscode-ai__context-usage-trigger"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`上下文占用 ${percentLabel}，${totalLabel} / ${windowLabel} Token`}
        title={`上下文占用 ${percentLabel} · ${totalLabel} / ${windowLabel}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span class="vscode-ai__context-usage-ring" style={ringStyle}>
          <span class="vscode-ai__context-usage-ring-hole" />
        </span>
      </button>

      {open ? (
        <div class="vscode-ai__context-usage-popover" role="dialog" aria-label="上下文占用">
          <div class="vscode-ai__context-usage-popover-head">
            <span class="vscode-ai__context-usage-popover-title">上下文占用</span>
            <button
              type="button"
              class="vscode-ai__context-usage-popover-close"
              aria-label="关闭"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          <div class="vscode-ai__context-usage-popover-summary">
            <span>已使用 {percentLabel}</span>
            <span>
              {prefix}
              {formatCompactTokenCount(usage.totalTokens)} / {windowLabel} Token
            </span>
          </div>
          <div class="vscode-ai__context-usage-bar" aria-hidden="true">
            {usage.breakdown.map((item) => {
              const width =
                usage.totalTokens > 0
                  ? Math.max(1.5, (item.tokens / usage.totalTokens) * 100)
                  : 0
              return (
                <span
                  key={item.id}
                  class="vscode-ai__context-usage-bar-seg"
                  style={{
                    width: `${width}%`,
                    background: item.color,
                  }}
                  title={`${item.label}: ${formatTokenCount(item.tokens)}`}
                />
              )
            })}
          </div>
          <ul class="vscode-ai__context-usage-list">
            {usage.breakdown.map((item) => (
              <li key={item.id} class="vscode-ai__context-usage-row">
                <span
                  class="vscode-ai__context-usage-swatch"
                  style={{ background: item.color }}
                />
                <span class="vscode-ai__context-usage-row-label">{item.label}</span>
                <span class="vscode-ai__context-usage-row-tokens">
                  {usage.estimated ? '约 ' : ''}
                  {formatCompactTokenCount(item.tokens)}
                </span>
              </li>
            ))}
          </ul>
          {usage.estimated ? (
            <div class="vscode-ai__context-usage-note">估算值；请求后会按接口返回校准</div>
          ) : undefined}
        </div>
      ) : undefined}
    </div>
  )
}
