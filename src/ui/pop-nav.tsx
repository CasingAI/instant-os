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
import { FLOATING_PANEL_VIEWPORT_PADDING } from './compute-floating-panel-position.ts'
import { getFloatingOverlayRoot } from './floating-overlay-root.ts'
import { Nav, type NavProps } from './nav.tsx'
import { DarkMode } from './theme.tsx'
import { useOverlayPresence } from './use-overlay-presence.ts'
import './pop-nav.css'

/** 面板默认尺寸；可用 width / height 覆盖 */
const POP_NAV_WIDTH = 320
const POP_NAV_HEIGHT = 280
/** 气球几何：圆角半径、尖高、尖半宽（含进整盒），拼路径与 Nav 安全区共用 */
const POP_NAV_R = 10
const POP_NAV_ARROW_H = 9
const POP_NAV_ARROW_HALF = 7
/** 退出动画时长，与 pop-nav.css 入场动画时长一致 */
const POP_NAV_EXIT_WIDE_MS = 120
/** 尖心距面板两边的最小距离：圆角 + 半宽，尖底边不吃进角弧 */
const POP_NAV_ARROW_SAFE_INSET = POP_NAV_R + POP_NAV_ARROW_HALF
/** 尖尖咬进锚点的深度：2px（below 从底边往上咬，above 镜像） */
const POP_NAV_TIP_OVERLAP = 2

/**
 * 气球外形路径：圆角矩形加一侧尖，坐标系与面板同盒（左上 0,0）。旁路 SVG 的
 * 填充描边与内容层的裁剪共用这一条路径——外形几何只维护此处。
 */
function balloonPath(
  width: number,
  height: number,
  arrowX: number,
  placement: 'below' | 'above',
): string {
  const r = POP_NAV_R
  const h = POP_NAV_ARROW_H
  const half = POP_NAV_ARROW_HALF
  const n = (v: number) => `${Math.round(v * 100) / 100}`
  // 圆角四分之一弧：路径恒顺时针走，sweep 恒 1
  const corner = (x: number, y: number) => `A ${r} ${r} 0 0 1 ${n(x)} ${n(y)}`
  if (placement === 'below') {
    // 尖在上边：尖底把上边分成两段，从尖底左端起顺时针绕一圈
    return [
      `M ${n(r)} ${h}`,
      `L ${n(arrowX - half)} ${h}`,
      `L ${n(arrowX)} 0`,
      `L ${n(arrowX + half)} ${h}`,
      `L ${n(width - r)} ${h}`,
      corner(width, h + r),
      `L ${n(width)} ${n(height - r)}`,
      corner(width - r, height),
      `L ${n(r)} ${n(height)}`,
      corner(0, height - r),
      `L 0 ${h + r}`,
      corner(r, h),
      'Z',
    ].join(' ')
  }
  // 尖在下边：从左上角起顺时针绕一圈
  return [
    `M ${n(r)} 0`,
    `L ${n(width - r)} 0`,
    corner(width, r),
    `L ${n(width)} ${n(height - h - r)}`,
    corner(width - r, height - h),
    `L ${n(arrowX + half)} ${n(height - h)}`,
    `L ${n(arrowX)} ${n(height)}`,
    `L ${n(arrowX - half)} ${n(height - h)}`,
    `L ${n(r)} ${n(height - h)}`,
    corner(0, height - h - r),
    `L 0 ${n(r)}`,
    corner(r, 0),
    'Z',
  ].join(' ')
}

type PopNavOwnProps = {
  /**
   * 受控开合。⚠️ 配套动作别忘：触发器孩子是 <Button> 时传 pressed={open}——
   * 弹层开着时触发钮保持按压观感、关窗即释（详见 PopNavTrigger 注释）。
   */
  open: boolean
  /** 关闭通知（外部点按 / Esc）；面板仅隐藏不销毁，Nav 状态保留 */
  onClose: () => void
  /** PopNavTrigger 点按时的开窗请求；不传则触发器点按只负责关窗 */
  onOpen?: () => void
  /** 逃生口：直接指定锚点元素（锚点不是 PopNavTrigger 包着的东西时用）；锚点须包含触发器元素，理由见 PopNavTrigger 注释 */
  anchorRef?: { current: HTMLElement | null }
  /** 面板宽（矩形本体，px）。默认 320；仅当屏幕本身放不下才收窄——宿主窗口不是硬边界 */
  width?: number
  /** 面板高（矩形本体，不含尖，px）。默认 280；仅当屏幕本身放不下才收短——宿主窗口不是硬边界 */
  height?: number
  ariaLabel?: string
  children?: ComponentChildren
}

export type PopNavProps = PopNavOwnProps & NavProps

/**
 * Header + Select：PopNav 与 <Nav.Page> 的 actions 槽（标题栏操作区）组合后，
 * 非常适合充当标题栏上的 Select / 下拉选择器——触发器用系统 <Button pressed>，
 * 弹层里放一页 <Nav.Page> + List 选项列表，点选写回并收起。
 * 样板见 demos/pop-nav/basic.tsx 的「标题栏选择器」变体。
 */

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
 * 强制 Nav 的大弹出窗：尺寸可传（width / height，默认 320×280），内容只能是
 * Nav 页面（controller + 渲染属性原样透传给内部 <Nav>）。有锚点时贴锚点弹出、
 * 尖端指向它（尖咬进锚点 2px，上下两形态同深度）：下面完整
 * 装得下就放下面，装不下而上面装得下就放上面；上下都
 * 装不下才按屏幕钳制挑更宽敞的一侧。水平整层跟着锚点，会伸出宿主窗口也
 * 不往里推，只有快飞出屏幕才收。无锚点时在视口内居中。关闭 = 外部点按 /
 * Esc；面板仅隐藏不销毁——Nav 停在第几页下次开还在第几页。
 *
 * 推荐用法（Header + Select）：把整棵 PopNav（PopNavTrigger 包系统 Button
 * 作触发器）放进 <Nav.Page> 的 actions 槽，弹层里放 List 做选项列表——
 * PopNav 与标题栏组合后非常适合充当 Select / 下拉选择器：按钮显示当前值、
 * 点开弹层、点选某项写回并收起。见 demos/pop-nav/basic.tsx 的组合示例。
 */
export function PopNav({
  open,
  onClose,
  onOpen,
  anchorRef,
  width,
  height,
  ariaLabel,
  children,
  ...navProps
}: PopNavProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const primaryAnchorRef = useRef<unknown>(null)
  const shellAnchorRef = useRef<HTMLElement | null>(null)
  const [anchorVersion, setAnchorVersion] = useState(0)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [size, setSize] = useState({ width: POP_NAV_WIDTH, height: POP_NAV_HEIGHT })
  const [placement, setPlacement] = useState<'below' | 'above'>('below')
  const [arrowX, setArrowX] = useState(0)
  const [centered, setCentered] = useState(false)
  const [everOpened, setEverOpened] = useState(false)
  // mounted：presence 自己的挂载判定——关窗当拍退场标记尚未立上也算挂着，
  // 面板不会被打成隐藏，等退场动画播完才真正隐藏（避免消失又冒出播退出）
  const { mounted, exiting } = useOverlayPresence(open, POP_NAV_EXIT_WIDE_MS)
  useLayoutEffect(() => {
    if (open) {
      setEverOpened(true)
    }
  }, [open])
  const hidden = !mounted

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

  // 面板矩形本体尺寸：跟调用方走，缺省 320×280
  const reqWidth = width ?? POP_NAV_WIDTH
  const reqHeight = height ?? POP_NAV_HEIGHT

  const updatePosition = useCallback(() => {
    const panel = panelRef.current
    if (!panel) {
      return
    }
    const pad = FLOATING_PANEL_VIEWPORT_PADDING
    const anchorEl = resolveAnchorEl()
    const anchorRect = anchorRectOf(anchorEl)
    const hasArrow = Boolean(anchorRect)
    const arrowH = hasArrow ? POP_NAV_ARROW_H : 0
    const vw = window.innerWidth
    const vh = window.innerHeight
    // 只在屏幕本身放不下时收到视口内——宿主窗口不是硬边界，不为它挤扁面板；
    // 有尖时整盒再加一截尖高
    const width = Math.max(1, Math.min(reqWidth, vw - pad * 2))
    const rectH = Math.max(1, Math.min(reqHeight, vh - pad * 2 - arrowH))
    const height = rectH + arrowH
    setSize((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height },
    )

    let top: number
    let left: number
    if (!anchorRect) {
      // 无锚点：视口内居中（拿不到锚点便无从定位宿主窗口）
      left = (vw - width) / 2
      top = (vh - height) / 2
      setCentered(true)
      setPlacement('below')
    } else {
      const anchorCenterX = anchorRect.left + anchorRect.width / 2
      // 垂直：按上下「未钳候选」判断哪一侧完整装得下（尖端咬进锚点 2px，
      // below 从底边往上咬、above 镜像）。优先下面；下面装不下且上面装得
      // 下就放上面（上面的桌面空间可用，不为「留在宿主窗口里」硬往下塞）；
      // 两侧都装不下才退化为屏幕钳制，挑钳完离锚点更近（更宽敞）的一侧。
      const clampTop = (t: number) => Math.min(Math.max(t, pad), Math.max(pad, vh - height - pad))
      const belowTipY = anchorRect.bottom - POP_NAV_TIP_OVERLAP
      const aboveTipY = anchorRect.top + POP_NAV_TIP_OVERLAP
      const belowTop = clampTop(belowTipY)
      const aboveTop = clampTop(aboveTipY - height)
      const belowFits = belowTop === belowTipY
      const aboveFits = aboveTop === aboveTipY - height
      let preferBelow = belowFits || !aboveFits
      const belowDrift = Math.abs(belowTop - belowTipY)
      const aboveDrift = Math.abs(aboveTop + height - aboveTipY)
      if (!belowFits && !aboveFits) {
        preferBelow = belowDrift <= aboveDrift
      }
      top = preferBelow ? belowTop : aboveTop
      setPlacement(preferBelow ? 'below' : 'above')
      // 水平：整层跟着锚点走（尖对准锚点中心）。会伸出宿主窗口也不往里推
      // ——一推尖就对不上；只有快飞出屏幕才收。
      left = anchorCenterX - width / 2
      if (left < pad) {
        left = pad
      }
      if (left > vw - width - pad) {
        left = Math.max(pad, vw - width - pad)
      }
      // 收进屏幕后尖仍须落在安全内距内；放不下（锚点贴屏幕角）时按钳制
      // 实际位移挑离锚点更近的一侧，别让尖空指。
      const minArrowLeft = Math.max(pad, anchorCenterX - (width - POP_NAV_ARROW_SAFE_INSET))
      const maxArrowLeft = Math.min(vw - width - pad, anchorCenterX - POP_NAV_ARROW_SAFE_INSET)
      if (minArrowLeft <= maxArrowLeft) {
        left = Math.min(Math.max(left, minArrowLeft), maxArrowLeft)
      } else if (preferBelow && aboveDrift < belowDrift) {
        top = aboveTop
        setPlacement('above')
      } else if (!preferBelow && belowDrift < aboveDrift) {
        top = belowTop
        setPlacement('below')
      }
      setCentered(false)
      const maxArrowX = Math.max(POP_NAV_ARROW_SAFE_INSET, width - POP_NAV_ARROW_SAFE_INSET)
      setArrowX(Math.min(Math.max(anchorCenterX - left, POP_NAV_ARROW_SAFE_INSET), maxArrowX))
    }
    setPosition({ top, left })
  }, [resolveAnchorEl, reqWidth, reqHeight])

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
    // everOpened：面板首次真正挂载的那一拍重跑一次——上一轮 effect 跑在
    // 挂载渲染之前（panelRef 还空），同步补量才不会先画在 (0,0) 再跳
  }, [open, everOpened, updatePosition, anchorVersion])

  useEffect(() => {
    if (!open) {
      return
    }
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null
      if (panelRef.current?.contains(target)) {
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

  const navSafeArea = !centered
    ? placement === 'below'
      ? { top: POP_NAV_ARROW_H }
      : { bottom: POP_NAV_ARROW_H }
    : 0
  const content = <Nav {...navProps} safeArea={navSafeArea} />
  // 有尖形态的气球路径：旁路 SVG 描边与内容层裁剪同吃这一条
  const balloon = centered ? null : balloonPath(size.width, size.height, arrowX, placement)

  // 首次打开才挂载 portal；此后常驻（退场动画播完仅挂隐藏类）——hide 不 destroy
  if (!everOpened) {
    return (
      <PopNavTriggerContext.Provider value={triggerApi}>{children}</PopNavTriggerContext.Provider>
    )
  }

  return (
    <PopNavTriggerContext.Provider value={triggerApi}>
      {children}
      {createPortal(
        // 内部固定暗色（暂不提供对外配置）：同窄屏模态，DarkMode 壳包住
        // 面板整体，面板 chrome 与内部 Nav 页面吃同一套暗色 token。
        <DarkMode>
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
            {balloon && (
              // 旁路层：两道同路径描边替代四向投影——投影复制会把锐角抹平，
              // SVG 描边沿路径 miter 相交，尖保持锐。先半透明圈宽 4，再深色
              // 边宽 2 + 壳色填充；描边居中、内半被填充盖住，各露 1px。
              <svg
                class="pop-nav__cast"
                aria-hidden="true"
                viewBox={`0 0 ${size.width} ${size.height}`}
              >
                <path class="pop-nav__cast-ring" d={balloon} />
                <path class="pop-nav__cast-body" d={balloon} />
              </svg>
            )}
            <div
              class="pop-nav__content"
              style={balloon ? { clipPath: `path('${balloon}')` } : undefined}
            >
              {content}
            </div>
          </div>
        </DarkMode>,
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
 * 提醒：孩子是 <Button> 时记得传 pressed={open}——弹层开着时触发钮保持按压
 * 观感、关窗即释。开合真源在调用方（triggerApi 恒定、不随开合触发重渲染），
 * 这里不做自动注入；漏了这步不会报错，只会少一块观感。
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
