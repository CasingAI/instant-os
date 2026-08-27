import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { RefObject } from 'preact'
import { createPortal } from 'preact/compat'
import { computeFloatingPanelPosition } from './compute-floating-panel-position.ts'
import { getFloatingOverlayRoot } from './floating-overlay-root.ts'
import { IosButton } from './ios-button.tsx'
import './popover.css'

/** 与 useAppNarrowLayout / window-snap 的 NARROW_WORK_AREA_WIDTH 一致（滞回防抖） */
const POPOVER_NARROW_ENTER_WIDTH = 520
const POPOVER_NARROW_EXIT_WIDTH = 580
/** 箭头中心距气泡两边的最小距离，避免贴到圆角外 */
const POPOVER_ARROW_SAFE_INSET = 14

type PopoverProps = {
  open: boolean
  /** 锚点元素；气泡箭头指向它，宿主窗口宽度也以它所在的 .window-frame 为准 */
  anchorRef: RefObject<HTMLElement>
  onClose: () => void
  children: preact.ComponentChildren
  ariaLabel?: string
  /** 窄屏模态里关闭按钮文案，默认「好」 */
  dismissLabel?: string
}

/**
 * 通用锚定气泡：宽屏在锚点旁弹出（带指向箭头，靠近边缘自动翻转 / 夹紧），
 * 宿主窗口很窄时退化为居中模态对话框。portal 到浮层根节点。
 * 关闭：外部点按、Esc；窄屏模态另有关闭按钮与遮罩点按。
 */
export function Popover({
  open,
  anchorRef,
  onClose,
  children,
  ariaLabel,
  dismissLabel = '好',
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [placement, setPlacement] = useState<'below' | 'above'>('below')
  const [arrowX, setArrowX] = useState(0)
  const [narrow, setNarrow] = useState(false)

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) {
      return
    }
    const anchorRect = anchor.getBoundingClientRect()
    const measured = panelRef.current?.getBoundingClientRect()
    const panelWidth = measured && measured.width > 0 ? measured.width : 200
    const panelHeight = measured && measured.height > 0 ? measured.height : 40
    const next = computeFloatingPanelPosition(anchorRect, panelWidth, panelHeight, 'left')
    setPosition({ top: next.top, left: next.left })
    setPlacement(next.placement)
    const anchorCenterX = anchorRect.left + anchorRect.width / 2
    const maxArrowX = Math.max(POPOVER_ARROW_SAFE_INSET, panelWidth - POPOVER_ARROW_SAFE_INSET)
    setArrowX(Math.min(Math.max(anchorCenterX - next.left, POPOVER_ARROW_SAFE_INSET), maxArrowX))
  }, [anchorRef])

  // 宽窄判定：锚点所在窗口框架的宽度；不在任何窗口里（桌面级浮层）退化为视口宽度
  useEffect(() => {
    if (!open) {
      return
    }
    const anchor = anchorRef.current
    const frame = anchor?.closest('.window-frame')
    const host = frame instanceof HTMLElement ? frame : null
    const measure = () => {
      const width = host ? host.clientWidth : window.innerWidth
      setNarrow((prev) => width <= (prev ? POPOVER_NARROW_EXIT_WIDTH : POPOVER_NARROW_ENTER_WIDTH))
    }
    measure()
    if (!host) {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => observer.disconnect()
  }, [open, anchorRef])

  useLayoutEffect(() => {
    if (!open) {
      return
    }
    updatePosition()
    const frame = window.requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    document.addEventListener('scroll', updatePosition, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) {
      return
    }
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null
      if (panelRef.current?.contains(target) || modalRef.current?.contains(target)) {
        return
      }
      onClose()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open, onClose])

  if (!open) {
    return undefined
  }

  if (narrow) {
    return createPortal(
      <div class="popover-modal__backdrop" onClick={onClose}>
        <div
          ref={modalRef}
          class="popover-modal"
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          onClick={(event) => event.stopPropagation()}
        >
          <div class="popover-modal__body">{children}</div>
          <div class="popover-modal__actions">
            <IosButton tone="primary" size="compact" onClick={onClose}>
              {dismissLabel}
            </IosButton>
          </div>
        </div>
      </div>,
      getFloatingOverlayRoot(),
    )
  }

  return createPortal(
    <div
      ref={panelRef}
      class={`popover popover--${placement}`}
      role="dialog"
      aria-label={ariaLabel}
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
        '--popover-arrow-x': `${arrowX}px`,
      }}
    >
      {children}
    </div>,
    getFloatingOverlayRoot(),
  )
}
