import { createContext, cloneElement, isValidElement } from 'preact'
import type { ComponentChildren, JSX, VNode } from 'preact'
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks'
import { createPortal } from 'preact/compat'
import {
  computeFloatingPanelPosition,
  FLOATING_PANEL_VIEWPORT_PADDING,
} from './compute-floating-panel-position.ts'
import { getFloatingOverlayRoot } from './floating-overlay-root.ts'
import { Nav, type NavProps } from './nav.tsx'
import { useOverlayPresence } from './use-overlay-presence.ts'
import './pop-nav.css'

/** 面板固定尺寸；模块常量，不可调 */
const POP_NAV_WIDTH = 320
const POP_NAV_HEIGHT = 280
/** 与 Popover 一致的窄屏滞回（宿主窗口宽） */
const POP_NAV_NARROW_ENTER_WIDTH = 520
const POP_NAV_NARROW_EXIT_WIDTH = 580
/** 退出动画时长，与 pop-nav.css 各形态入场动画时长一致 */
const POP_NAV_EXIT_WIDE_MS = 120
const POP_NAV_EXIT_MODAL_MS = 150
/** 箭头中心距面板两边的最小距离，避免贴到圆角外 */
const POP_NAV_ARROW_SAFE_INSET = 14

type PopNavOwnProps = {
  open: boolean
  /** 关闭通知（外部点按 / Esc）；面板仅隐藏不销毁，Nav 状态保留 */
  onClose: () => void
  /** PopNavTrigger 点按时的开窗请求；不传则触发器点按只负责关窗 */
  onOpen?: () => void
  /** 逃生口：直接指定锚点元素（锚点不是 PopNavTrigger 包着的东西时用）；锚点须包含触发器元素，理由见 PopNavTrigger 注释 */
  anchorRef?: { current: HTMLElement | null }
  ariaLabel?: string
  children?: ComponentChildren
}

export type PopNavProps = PopNavOwnProps & NavProps

type PopNavTriggerApi = {
  /** 主锚点登记：cloneElement 注入孩子、由 ref 回调报到（元素或组件实例原样收下，解析见 anchorElementOf） */
  registerAnchor: (el: unknown) => void
  /** 兜底壳登记：孩子接不了 ref 时由透明壳回报 */
  registerShell: (el: HTMLElement | null) => void
  /** 主锚点是否已登记（Trigger 用来判断要不要退回兜底壳） */
  hasPrimaryAnchor: () => boolean
  /** 触发器点按：开→关、关→开 */
  activate: () => void
}

const PopNavTriggerContext = createContext<PopNavTriggerApi | null>(null)

/**
 * ref 回报值还原成真实元素：原生孩子的 ref 由 preact 以 DOM 节点回调；
 * 组件孩子（如 Button）的 ref 被框架以「组件实例」回调——createElement 会把
 * ref 从 props 里抽走挂到节点槽位上，props 根本到不了组件内部，而组件实例的
 * base 就是框架维护的「该组件渲染出的根 DOM」。两者之外一律当没锚点。
 */
function anchorElementOf(reported: unknown): Element | null {
  if (reported instanceof Element) {
    return reported
  }
  const base = (reported as { base?: unknown } | null)?.base
  return base instanceof Element ? base : null
}

/** 锚点有效方块：透明壳（display:contents）自身没有盒子，改量壳内第一个真实元素 */
function anchorRectOf(el: Element | null): DOMRect | null {
  if (!el) {
    return null
  }
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) {
    const inner = el.firstElementChild
    if (inner) {
      return inner.getBoundingClientRect()
    }
  }
  return rect
}

/**
 * 强制 Nav 的大弹出窗：固定尺寸（320×280，不可调），内容只能是 Nav 页面
 * （controller + 渲染属性原样透传给内部 <Nav>）。有锚点时贴锚点弹出、箭头指向
 * 它（宿主窗口内钳制，不越界盖别的窗口）；无锚点时在视口内居中（无锚点便无从
 * 定位宿主窗口）。宿主窗口很窄（宽 ≤520）时退化为居中模态。关闭 = 外部点按 /
 * Esc；面板仅隐藏不销毁——Nav 停在第几页下次开还在第几页。
 */
export function PopNav({
  open,
  onClose,
  onOpen,
  anchorRef,
  ariaLabel,
  children,
  ...navProps
}: PopNavProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const primaryAnchorRef = useRef<unknown>(null)
  const shellAnchorRef = useRef<HTMLElement | null>(null)
  const [anchorVersion, setAnchorVersion] = useState(0)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [size, setSize] = useState({ width: POP_NAV_WIDTH, height: POP_NAV_HEIGHT })
  const [placement, setPlacement] = useState<'below' | 'above'>('below')
  const [arrowX, setArrowX] = useState(0)
  const [centered, setCentered] = useState(false)
  const [narrow, setNarrow] = useState(false)
  const [everOpened, setEverOpened] = useState(false)
  const { exiting } = useOverlayPresence(
    open,
    narrow ? POP_NAV_EXIT_MODAL_MS : POP_NAV_EXIT_WIDE_MS,
  )
  useLayoutEffect(() => {
    if (open) {
      setEverOpened(true)
    }
  }, [open])
  const hidden = !open && !exiting

  const resolveAnchorEl = useCallback((): Element | null => {
    if (anchorRef) {
      return anchorRef.current
    }
    return anchorElementOf(primaryAnchorRef.current) ?? shellAnchorRef.current
  }, [anchorRef])

  // 登记回调恒定：配合作稳定化的 ref 回调，避免每次开关窗都触发
  // 「旧 ref(null) → 新 ref(el)」的重挂舞步，锚点中途一拍为空会被
  // scroll 触发的定位误判成无锚点、面板跳去视口居中
  const registerAnchor = useCallback((el: unknown) => {
    if (primaryAnchorRef.current === el) {
      return
    }
    primaryAnchorRef.current = el
    setAnchorVersion((version) => version + 1)
  }, [])
  const registerShell = useCallback((el: HTMLElement | null) => {
    if (shellAnchorRef.current === el) {
      return
    }
    shellAnchorRef.current = el
    setAnchorVersion((version) => version + 1)
  }, [])

  const updatePosition = useCallback(() => {
    if (narrow) {
      return
    }
    const panel = panelRef.current
    if (!panel) {
      return
    }
    const pad = FLOATING_PANEL_VIEWPORT_PADDING
    const anchorEl = resolveAnchorEl()
    const frame = anchorEl?.closest('.window-frame')
    const host = frame instanceof HTMLElement ? frame : null
    const hostRect = host?.getBoundingClientRect() ?? null
    // 尺寸固定，只在超出宿主内容区时收缩（不设可调 props）；max 兜底防极窄宿主算出负数
    const width = Math.max(
      1,
      Math.min(POP_NAV_WIDTH, (hostRect ? hostRect.width : window.innerWidth) - pad * 2),
    )
    const height = Math.max(
      1,
      Math.min(POP_NAV_HEIGHT, (hostRect ? hostRect.height : window.innerHeight) - pad * 2),
    )
    setSize((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height },
    )
    const anchorRect = anchorRectOf(anchorEl)
    let top: number
    let left: number
    if (!anchorRect) {
      // 无锚点：视口内居中（拿不到锚点便无从定位宿主窗口）
      const base = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
      left = base.left + (base.width - width) / 2
      top = base.top + (base.height - height) / 2
      setCentered(true)
      setPlacement('below')
    } else {
      const next = computeFloatingPanelPosition(anchorRect, width, height, 'left')
      const anchorCenterX = anchorRect.left + anchorRect.width / 2
      const minLeft = hostRect ? hostRect.left + pad : pad
      const maxLeft = hostRect ? hostRect.right - width - pad : window.innerWidth - width - pad
      // 小锚点中心距面板左缘不足箭头安全内距时整体左移，箭头才能正指锚点中心
      left = Math.min(
        Math.max(Math.min(next.left, anchorCenterX - POP_NAV_ARROW_SAFE_INSET), minLeft),
        Math.max(minLeft, maxLeft),
      )
      top = next.top
      if (hostRect) {
        // 钳回宿主窗口内容区内，不越界盖别的窗口
        top = Math.min(
          Math.max(top, hostRect.top + pad),
          Math.max(hostRect.top + pad, hostRect.bottom - height - pad),
        )
      }
      setCentered(false)
      setPlacement(next.placement)
      const maxArrowX = Math.max(POP_NAV_ARROW_SAFE_INSET, width - POP_NAV_ARROW_SAFE_INSET)
      setArrowX(Math.min(Math.max(anchorCenterX - left, POP_NAV_ARROW_SAFE_INSET), maxArrowX))
    }
    setPosition({ top, left })
  }, [narrow, resolveAnchorEl])

  // 宽窄判定：锚点所在窗口框架的宽度；不在任何窗口里（桌面级浮层）退化为视口宽度
  useEffect(() => {
    if (!open) {
      return
    }
    const frame = resolveAnchorEl()?.closest('.window-frame')
    const host = frame instanceof HTMLElement ? frame : null
    const measure = () => {
      const width = host ? host.clientWidth : window.innerWidth
      setNarrow((prev) =>
        width <= (prev ? POP_NAV_NARROW_EXIT_WIDTH : POP_NAV_NARROW_ENTER_WIDTH),
      )
    }
    measure()
    if (!host) {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => observer.disconnect()
  }, [open, resolveAnchorEl, anchorVersion])

  useLayoutEffect(() => {
    if (!open || narrow) {
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
  }, [open, narrow, updatePosition, anchorVersion])

  useEffect(() => {
    if (!open) {
      return
    }
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null
      if (panelRef.current?.contains(target) || modalRef.current?.contains(target)) {
        return
      }
      // 触发器自身的点按不放给外点关闭——交给 activate 完整切换，
      // 否则 pointerdown 先关、click 又开，触发器就关不掉弹窗了
      if (target && resolveAnchorEl()?.contains(target)) {
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
  }, [open, onClose, resolveAnchorEl])

  // triggerApi 恒定（open/onClose/onOpen 经 ref 镜像取最新值）：PopNavTrigger
  // 注入的 ref 回调随之稳定，不因每次开关窗换身份而反复解绑/重绑锚点
  const ownPropsRef = useRef({ open, onClose, onOpen })
  ownPropsRef.current = { open, onClose, onOpen }
  const triggerApi = useMemo<PopNavTriggerApi>(
    () => ({
      registerAnchor,
      registerShell,
      hasPrimaryAnchor: () => primaryAnchorRef.current != null,
      activate: () => {
        const { open: isOpen, onClose: close, onOpen: openFn } = ownPropsRef.current
        if (isOpen) {
          close()
        } else {
          openFn?.()
        }
      },
    }),
    [registerAnchor, registerShell],
  )

  const content = <Nav {...navProps} />

  // 首次打开才挂载 portal；此后常驻（退场动画播完仅挂隐藏类）——hide 不 destroy
  if (!everOpened) {
    return (
      <PopNavTriggerContext.Provider value={triggerApi}>{children}</PopNavTriggerContext.Provider>
    )
  }

  if (narrow) {
    return (
      <PopNavTriggerContext.Provider value={triggerApi}>
        {children}
        {createPortal(
          <div
            class={`pop-nav-modal__backdrop${exiting ? ' pop-nav-modal__backdrop--exiting' : ''}${
              hidden ? ' pop-nav-modal__backdrop--hidden' : ''
            }`}
            onClick={onClose}
          >
            <div
              ref={modalRef}
              class={`pop-nav-modal${exiting ? ' pop-nav-modal--exiting' : ''}`}
              role="dialog"
              aria-modal="true"
              aria-label={ariaLabel}
              onClick={(event) => event.stopPropagation()}
            >
              <div class="pop-nav__content">{content}</div>
            </div>
          </div>,
          getFloatingOverlayRoot(),
        )}
      </PopNavTriggerContext.Provider>
    )
  }

  return (
    <PopNavTriggerContext.Provider value={triggerApi}>
      {children}
      {createPortal(
        <div
          ref={panelRef}
          class={`pop-nav pop-nav--${placement}${centered ? ' pop-nav--center' : ''}${
            exiting ? ' pop-nav--exiting' : ''
          }${hidden ? ' pop-nav--hidden' : ''}`}
          role="dialog"
          aria-label={ariaLabel}
          style={{
            top: `${position.top}px`,
            left: `${position.left}px`,
            width: `${size.width}px`,
            height: `${size.height}px`,
            '--pop-nav-arrow-x': `${arrowX}px`,
          }}
        >
          <div class="pop-nav__content">{content}</div>
        </div>,
        getFloatingOverlayRoot(),
      )}
    </PopNavTriggerContext.Provider>
  )
}

/**
 * PopNav 的触发器：不多渲染任何元素——cloneElement 给唯一孩子注入 ref（挂载/
 * 更换/卸载时向 PopNav 报到）与 onClick（点按开关弹窗）。原生元素孩子 ref 回报
 * DOM 节点；组件孩子（如 Button）ref 回报组件实例，PopNav 解析实例 base 取根
 * DOM（见 anchorElementOf），两者都零包装。非单元素孩子（字符串/数组）直接走
 * 透明壳。
 * 注意：用了 anchorRef 逃生口时，触发器元素须位于锚点内部——外点关闭守卫
 * 只放过锚点内的点按，触发器在锚点外会被「外点关闭」抢先、又被点按重开。
 */
export function PopNavTrigger({ children }: { children: ComponentChildren }) {
  const api = useContext(PopNavTriggerContext)
  const child = isValidElement(children) ? (children as VNode<Record<string, unknown>>) : null
  const [useShell, setUseShell] = useState(!child)
  const anchorRefCb = useCallback(
    (el: HTMLElement | null) => api?.registerAnchor(el),
    [api],
  )
  const shellRefCb = useCallback((el: HTMLElement | null) => api?.registerShell(el), [api])
  useEffect(() => {
    if (api && child && !api.hasPrimaryAnchor()) {
      setUseShell(true)
    }
  }, [api, child])
  if (!api) {
    throw new Error('PopNavTrigger 必须用在 <PopNav> 内部')
  }
  if (child && !useShell) {
    return cloneElement(child, {
      ref: anchorRefCb,
      onClick: (event: JSX.TargetedMouseEvent<HTMLElement>) => {
        const original = child.props.onClick as
          | ((e: JSX.TargetedMouseEvent<HTMLElement>) => void)
          | undefined
        original?.(event)
        if (!event.defaultPrevented) {
          api.activate()
        }
      },
    })
  }
  return (
    <span class="pop-nav-trigger" ref={shellRefCb} onClick={(event) => {
      if (!event.defaultPrevented) {
        api.activate()
      }
    }}>
      {children}
    </span>
  )
}
