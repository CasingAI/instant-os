import { createPortal } from 'preact/compat'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  formatCompactTokenCount,
  formatTokenCount,
} from '../browser/format-token-count.ts'
import type { VscodeAiContextUsage } from './vscode-ai-context-usage.ts'

export type VscodeAiContextUsageViewProps = {
  usage: VscodeAiContextUsage | undefined
  disabled?: boolean
  dark?: boolean
}

const POPOVER_WIDTH = 280
const POPOVER_GAP = 8
const VIEWPORT_PADDING = 8
const POPOVER_FALLBACK_HEIGHT = 220

function clampPercent(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  if (value > 100) return 100
  return value
}

function positionPopover(
  trigger: DOMRect,
  panelWidth: number,
  panelHeight: number,
): { top: number; left: number } {
  const maxLeft = window.innerWidth - panelWidth - VIEWPORT_PADDING
  let left = trigger.right - panelWidth
  left = Math.min(Math.max(left, VIEWPORT_PADDING), Math.max(VIEWPORT_PADDING, maxLeft))

  const aboveTop = trigger.top - panelHeight - POPOVER_GAP
  const belowTop = trigger.bottom + POPOVER_GAP
  const maxTop = window.innerHeight - panelHeight - VIEWPORT_PADDING

  // 优先上方（底部输入区）；上方不够则翻到下方（气泡编辑靠近顶部时）
  let top: number
  if (aboveTop >= VIEWPORT_PADDING) {
    top = aboveTop
  } else if (belowTop + panelHeight <= window.innerHeight - VIEWPORT_PADDING) {
    top = belowTop
  } else {
    top = Math.max(VIEWPORT_PADDING, Math.min(belowTop, maxTop))
  }

  return { top, left }
}

export function VscodeAiContextUsageView({
  usage,
  disabled,
  dark,
}: VscodeAiContextUsageViewProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const measured = popoverRef.current?.getBoundingClientRect()
    const width =
      measured && measured.width > 0
        ? measured.width
        : Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_PADDING * 2)
    const height =
      measured && measured.height > 0 ? measured.height : POPOVER_FALLBACK_HEIGHT
    setPosition(positionPopover(trigger.getBoundingClientRect(), width, height))
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    const frame = window.requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    document.addEventListener('scroll', updatePosition, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, updatePosition, usage])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
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

  const popover =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={popoverRef}
            class={`vscode-ai__context-usage-popover${
              dark ? ' vscode-ai__context-usage-popover--dark' : ''
            }`}
            role="dialog"
            aria-label="上下文占用"
            style={{ top: `${position.top}px`, left: `${position.left}px` }}
          >
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
          </div>,
          document.body,
        )
      : undefined

  return (
    <div
      class={`vscode-ai__context-usage${open ? ' vscode-ai__context-usage--open' : ''}`}
      ref={rootRef}
    >
      <button
        ref={triggerRef}
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
      {popover}
    </div>
  )
}
