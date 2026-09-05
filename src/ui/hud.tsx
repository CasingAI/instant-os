import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren, RefObject } from 'preact'
import { createPortal } from 'preact/compat'
import { WindowModalOverlayContext } from '../window/window-modal.tsx'
import { Icon } from './icon.tsx'
import { useOverlayPresence } from './use-overlay-presence.ts'
import './hud.css'

export type HudMode = 'spinner' | 'text' | 'success' | 'error' | 'progress'

export type HudShowOptions = {
  /** 内容形态；默认 spinner 转圈 */
  mode?: HudMode
  /** 主文案 */
  text?: string
  /** 第二行浅灰小字 */
  detail?: string
  /** progress 模式的百分比 0-100，自动 clamp */
  percent?: number
  /** 是否暗化背景；默认 true */
  dimBackground?: boolean
  /** 最短显示毫秒：提前 hide 也补满时长再播退出，防「已保存」一闪而过 */
  minVisibleMs?: number
  /** 只盖指定容器（容器需非 static 定位）；缺省盖 view 所在窗口的内容区（同 WindowModal 浮层根，标题栏在外） */
  containerRef?: RefObject<HTMLElement>
  /** 无障碍标签；缺省用 text */
  ariaLabel?: string
}

type HudProps = HudShowOptions & { open: boolean }

/** 退出动画时长，与 hud.css 各入场动画时长对应 */
const HUD_EXIT_MS = 160

function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.max(0, Math.min(100, value))
}

/**
 * 内部构件（不导出）：useHud 的 view 就是它。
 * 位置在挂载时一次定死：containerRef 盖容器 > 所在窗口的浮层根（WindowModalOverlayContext，
 * 与 WindowModal 同源，只盖内容区、标题栏在外）；都拿不到就不渲染——不存在全屏形态，运行期没有任何位置猜测。
 */
function Hud({
  open,
  mode = 'spinner',
  text,
  detail,
  percent,
  dimBackground = true,
  minVisibleMs = 0,
  containerRef,
  ariaLabel,
}: HudProps) {
  const overlayRoot = useContext(WindowModalOverlayContext)
  // 隐形锚点：真实节点，渲染进谁的窗口就属于谁的窗口
  const anchorRef = useRef<HTMLSpanElement>(null)
  const holdTimerRef = useRef<number | undefined>(undefined)
  const shownAtRef = useRef(0)
  const [heldOpen, setHeldOpen] = useState(false)
  const { mounted, exiting } = useOverlayPresence(heldOpen, HUD_EXIT_MS)
  const [mount, setMount] = useState<HTMLElement | null>(null)

  // minVisibleMs：open 提前关闭时先补满已显示时长，再走退出动画
  useEffect(() => {
    if (open) {
      if (holdTimerRef.current !== undefined) {
        window.clearTimeout(holdTimerRef.current)
        holdTimerRef.current = undefined
      }
      shownAtRef.current = performance.now()
      setHeldOpen(true)
      return
    }
    const remainMs = minVisibleMs - (performance.now() - shownAtRef.current)
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = undefined
      setHeldOpen(false)
    }, Math.max(0, remainMs))
    return () => {
      if (holdTimerRef.current !== undefined) {
        window.clearTimeout(holdTimerRef.current)
        holdTimerRef.current = undefined
      }
    }
  }, [open, minVisibleMs])

  useLayoutEffect(() => {
    if (!heldOpen) {
      return
    }
    const explicit = containerRef?.current
    if (explicit) {
      setMount(explicit)
      return
    }
    if (overlayRoot) {
      setMount(overlayRoot)
      return
    }
    // 没有浮层根可盖：宁可不出也不越界，绝不退到全屏
    setMount(null)
    console.warn(
      '[hud] 未找到所在窗口的浮层根，HUD 未显示；请把 useHud 的 view 放进窗口内的组件树（WindowModalProvider 内），或用 containerRef 指定容器',
    )
  }, [heldOpen, containerRef, overlayRoot])

  if (!mounted || !mount) {
    return <span ref={anchorRef} style={{ display: 'none' }} aria-hidden="true" />
  }

  const clamped = clampPercent(percent ?? 0)
  const alert = mode === 'success' || mode === 'error'

  return (
    <>
      <span ref={anchorRef} style={{ display: 'none' }} aria-hidden="true" />
      {createPortal(
        <div
          class={`hud${dimBackground ? '' : ' hud--clear'}${exiting ? ' hud--exiting' : ''}`}
          role={alert ? 'alert' : 'status'}
          aria-live={alert ? 'assertive' : 'polite'}
          aria-label={ariaLabel ?? text}
        >
          <div class="hud__box">
            {mode === 'spinner' && (
              <div class="hud__icon-slot">
                <Icon name="activity-indicator" size={56} class="hud__spinner" />
              </div>
            )}
            {mode === 'success' && (
              <div class="hud__icon-slot">
                <Icon name="check" size={60} class="hud__glyph" />
              </div>
            )}
            {mode === 'error' && (
              <div class="hud__icon-slot">
                <Icon name="close" size={60} class="hud__glyph" />
              </div>
            )}
            {mode === 'progress' && (
              <>
                <div
                  class="hud__bar"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(clamped)}
                >
                  <div class="hud__bar-fill" style={{ width: `${clamped}%` }} />
                </div>
                <div class="hud__percent">{Math.round(clamped)}%</div>
              </>
            )}
            {text && <div class="hud__text">{text}</div>}
            {detail && <div class="hud__detail">{detail}</div>}
          </div>
        </div>,
        mount,
      )}
    </>
  )
}

export type HudHandle = {
  /** 弹出（已显示则替换内容，不闪断）；传字符串等价 { text } */
  show: (options?: string | HudShowOptions) => void
  /** 收起（补满 minVisibleMs 后播退出动画再卸载） */
  hide: () => void
  /** HUD 渲染位：放进组件树任意位置，位置就此定死在所在窗口 */
  view: ComponentChildren
}

/**
 * 命令式 HUD：view 放在哪个窗口，show 就永远弹在哪个窗口，
 * 与弹的那一刻哪个窗口在前台无关。多处 useHud 互不干扰，随宿主组件树生死。
 */
export function useHud(): HudHandle {
  const [visible, setVisible] = useState(false)
  const [options, setOptions] = useState<HudShowOptions>({})

  const show = useCallback((next?: string | HudShowOptions) => {
    setOptions(typeof next === 'string' ? { text: next } : next ?? {})
    setVisible(true)
  }, [])
  const hide = useCallback(() => setVisible(false), [])

  const view = <Hud open={visible} {...options} />
  return { show, hide, view }
}
