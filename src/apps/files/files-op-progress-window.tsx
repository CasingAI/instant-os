/**
 * Finder 式文件操作进度迷你窗（对齐 macOS 拷贝窗口）：
 * - 非模态：无遮罩、不拦截下层交互，portal 到 body 级浮层可拖出 App 窗口
 * - 可拖动：标题栏拖动（松手记住位置，本次会话内沿用）
 * - 可折叠：标题栏圆钮收起为带进度圆环的小圆柄，点圆柄展开
 * - 取消：state.onCancel 提供时在标题栏右侧显示 ✕
 * 替换原模态 FilesOpProgressDialog。
 */
import { createPortal } from 'preact/compat'
import { useEffect, useRef, useState } from 'preact/hooks'
import { getFloatingOverlayRoot } from '../../ui/floating-overlay-root.ts'
import { clampFloatingPosition } from '../../window/window-snap.ts'
import {
  defaultFilesOpWindowPosition,
  FILES_OP_WINDOW_COLLAPSED_SIZE,
  FILES_OP_WINDOW_WIDTH,
  FILES_OP_WINDOW_HEIGHT,
  type FilesOpWindowPosition,
} from './files-op-window-position.ts'
import type { FilesOpProgressUiState } from './files-run-with-op-progress.ts'
import { useOpWindowDrag } from './use-op-window-drag.ts'
import './files-op-progress-window.css'

/** 本次会话内记住上次拖动位置；未拖过时回落默认位置 */
let rememberedPosition: FilesOpWindowPosition | undefined

function clampToViewport(pos: FilesOpWindowPosition, width: number, height: number): FilesOpWindowPosition {
  return clampFloatingPosition(pos.x, pos.y, width, height)
}

/** 圆环进度 SVG；stroke 用主题色变量（与圆柄、进度条同源） */
function ProgressRing({ fraction, size = FILES_OP_WINDOW_COLLAPSED_SIZE }: { fraction: number; size?: number }) {
  const clamped = Math.min(1, Math.max(0, fraction))
  const stroke = Math.max(3, Math.round(size * 0.1))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="rgba(0,0,0,0.14)"
        stroke-width={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--op-window-accent, #8a6a38)"
        stroke-width={stroke}
        stroke-linecap="round"
        stroke-dasharray={`${clamped * c} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        class="files-op-window__ring-fill"
      />
    </svg>
  )
}

function CollapseGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6" />
    </svg>
  )
}

export type FilesOpProgressWindowProps = {
  state: FilesOpProgressUiState | undefined
  themeColor?: string
}

export function FilesOpProgressWindow({ state, themeColor }: FilesOpProgressWindowProps) {
  const [pos, setPos] = useState<FilesOpWindowPosition>(() => {
    const size = { width: FILES_OP_WINDOW_WIDTH, height: FILES_OP_WINDOW_HEIGHT }
    const base = rememberedPosition ?? defaultFilesOpWindowPosition(
      { width: window.innerWidth, height: window.innerHeight },
      size,
    )
    return clampToViewport(base, size.width, size.height)
  })
  const [collapsed, setCollapsed] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const posRef = useRef(pos)
  const wasOpenRef = useRef(false)

  posRef.current = pos

  useEffect(() => {
    if (state && !wasOpenRef.current) {
      // 新操作开始时回到完整面板形态；位置沿用上次拖动落点
      setCollapsed(false)
    }
    wasOpenRef.current = state !== undefined
  }, [state])

  useEffect(() => {
    const onResize = () => {
      const width = collapsed ? FILES_OP_WINDOW_COLLAPSED_SIZE : FILES_OP_WINDOW_WIDTH
      const height = collapsed ? FILES_OP_WINDOW_COLLAPSED_SIZE : FILES_OP_WINDOW_HEIGHT
      setPos((prev) => clampToViewport(prev, width, height))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [collapsed])

  const { startDrag, movedRef, dragging } = useOpWindowDrag({
    panelRef,
    getPosition: () => posRef.current,
    onPositionChange: (next) => {
      setPos(next)
      rememberedPosition = next
    },
  })

  if (!state) return null

  const fraction = Math.min(1, Math.max(0, state.fraction ?? 0))
  const percent = Math.round(fraction * 100)
  const panelStyle = themeColor
    ? ({ '--op-window-accent': themeColor } as Record<string, string>)
    : undefined

  const root = collapsed ? (
    <div
      ref={panelRef}
      class={`files-op-window files-op-window--collapsed${dragging ? ' files-op-window--dragging' : ''}`}
      style={{ left: pos.x, top: pos.y, ...panelStyle }}
      onPointerDown={startDrag}
      onClick={() => {
        if (movedRef.current) return
        setCollapsed(false)
      }}
      role="button"
      aria-label="展开进度窗口"
      title={state.title}
    >
      <ProgressRing fraction={fraction} />
    </div>
  ) : (
    <div
      ref={panelRef}
      class={`files-op-window${dragging ? ' files-op-window--dragging' : ''}`}
      style={{ left: pos.x, top: pos.y, ...panelStyle }}
      role="dialog"
      aria-modal="false"
      aria-label={state.title}
    >
      <header class="files-op-window__titlebar" onPointerDown={startDrag}>
        <button
          type="button"
          class="files-op-window__iconbutton"
          title="收起为圆柄"
          aria-label="收起为圆柄"
          onClick={() => setCollapsed(true)}
        >
          <CollapseGlyph />
        </button>
        <span class="files-op-window__title">{state.title}</span>
        {state.onCancel ? (
          <button
            type="button"
            class="files-op-window__iconbutton files-op-window__cancel"
            title={state.cancelPending ? '正在取消…' : '取消'}
            aria-label="取消"
            disabled={state.cancelPending}
            onClick={() => state.onCancel?.()}
          >
            ✕
          </button>
        ) : (
          <span class="files-op-window__titlebar-placeholder" aria-hidden="true" />
        )}
      </header>
      <div class="files-op-window__body">
        {state.detailLabel ? <div class="files-op-window__detail">{state.detailLabel}</div> : null}
        <div
          class="files-op-window__track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label={state.title}
        >
          <span class="files-op-window__fill" style={{ width: `${percent}%` }} />
        </div>
        <div class="files-op-window__remaining">{state.remainingLabel}</div>
      </div>
    </div>
  )

  return createPortal(root, getFloatingOverlayRoot())
}