import type { ComponentChildren } from 'preact'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks'
import {
  APP_NARROW_LAYOUT_EXIT_WIDTH,
  APP_NARROW_LAYOUT_MAX_WIDTH,
  useAppNarrowLayout,
} from './use-app-narrow-layout.ts'
import { PageStack, usePageStack, type PageStackTransition } from './page-stack.tsx'
import { hitsNavFrameIndex, wideNavFrameIndices } from './adaptive-split-nav-model.ts'
import './adaptive-split-nav.css'
import './adaptive-split-nav-flat.css'
import './theme.css'

/**
 * 自适应分栏导航：布局原语（类 Ant Design 抽屉/分栏）。
 * Header（返回键 / 操作区，PageHeader 套件）与全部正文内容由应用自行渲染，
 * 本组件不强加任何外壳样式——应用想写什么就写什么。
 *
 * 形态：
 * - 未开启 `split`：任何宽度都渲染为子页栈（普通页面栈布局）；
 * - 开启 `split`：宽屏左右分栏（列表 + 派生帧栈详情），窄屏自动回子页栈。
 *
 * 宽窄形变 = 刚性面板滑轨：右栏帧容器作为面板与左栏内容同曲线联动，四种
 * 方向连续交接（窄子页滑退成右栏、列表刚性面板自左缘滑入 / 右栏自右缘
 * 滑入 / 面板扩张盖满交棒子页栈 / 面板滑出右缘），前后画面共享同一份内容
 * 与几何，无硬切。
 *
 * 单一真源是应用的领域状态：子页与帧都从它派生，本组件不持有任何业务
 * 导航历史。子页栈（PageStack，壳无关）由组件接管——应用经
 * useAdaptiveSplitNav 拿到 navigate/setPageSilent 驱动，形态切回子页栈时
 * 组件会按 narrowPageForState 静默重置栈；分栏右栏帧栈纯视觉叠放（无
 * 历史，返回即改状态）：push 新帧从右滑入、pop 旧帧保帧滑出
 * frameAnimationMs 后才移除、重置/跨级跳变立即整体替换；进退的转场窗口
 * 里容器套用页面栈同款拆盒（标题栏交叉淡移、正文整页滑），静止时仍是
 * 各自完整的一帧。
 */

export type AdaptiveFrameSpec = {
  /** 帧稳定性键：结构变化（push/pop/重置）按 id 序列判定 */
  id: string
  content: ComponentChildren
}

/** 形态翻转计划：翻转那一帧渲染期写入，供组件编排面板形变与页面交接 */
export type AdaptiveSplitNavSwitchPlan = {
  /** true = 窄 → 宽 */
  toWide: boolean
  /** 翻转前的栈顶页（窄屏满屏显示的那页） */
  fromPage: string
  /** 切回窄屏将显示的页（narrowPageForState() 的结果） */
  narrowTarget: string
}

/**
 * 形变分型（见组件注释）。应用可用来对齐两种形态不同的 chrome：
 * 例如首帧在窄屏有返回、分栏没有——A 淡出、C 淡入，B/D 不必动。
 */
export type AdaptiveSplitNavMorphKind = 'A' | 'B' | 'C' | 'D'

function morphKindFromPlan(
  plan: AdaptiveSplitNavSwitchPlan,
  listPage: string,
): AdaptiveSplitNavMorphKind {
  if (plan.toWide) return plan.fromPage === listPage ? 'B' : 'A'
  return plan.narrowTarget === listPage ? 'D' : 'C'
}

export type AdaptiveSplitNavController = {
  /** 当前是否渲染为子页栈形态（split 未开启时恒为 true） */
  narrowLayout: boolean
  /** 完成首次宽度测量（仅 split 开启时有意义） */
  layoutReady: boolean
  /**
   * 子页栈当前页。分栏形态下可能是最后一次导航的残留值——分栏左栏的
   * 显示内容由组件钉死为 listPage，残留值只在栈里保活、不会上屏。
   */
  page: string
  /** 分栏左栏显示的根列表页 id；未配置时分栏左栏退回显示 page */
  listPage: string
  /** 挂到应用根容器上的宽度测量 ref（组件内部使用） */
  hostRef: (node: HTMLElement | null) => void
  /**
   * 驱动子页栈。分栏形态下没有页面栈：push 无效果（右栏帧由领域状态
   * 派生），pop 视为纯状态提交——onSettled 立即执行。因此
   * 「navigate(目标页, 'pop', 提交状态)」的写法在两种形态下都正确。
   */
  navigate: (page: string, direction: 'push' | 'pop', onSettled?: () => void) => void
  /** 不播动画地重置子页栈（状态收敛时用） */
  setPageSilent: (page: string) => void
  /** 子页栈的转场管道（组件内部渲染 PageStack 用，应用勿动） */
  stackView: {
    stack: string[]
    transition: PageStackTransition<string> | undefined
    handleMotionEnd: (event: AnimationEvent) => void
  }
  /** 形态翻转计划（组件内部编排形变用，应用勿动）：翻转渲染期写入、下次翻转覆盖 */
  switchPlanRef: { current: AdaptiveSplitNavSwitchPlan | undefined }
  /**
   * 形变进行中（含翻转当帧）。应用用来对齐两种形态不同的 chrome：
   * 例如首帧在窄屏有返回、分栏没有——形变期先按起始形态画，随滑轨淡入淡出。
   * 翻转当帧即为 true，收尾或跳过后再渲染一次落到终点形态。
   */
  morphing: boolean
  /** 当前形变分型；未在形变时为 undefined */
  morphKind: AdaptiveSplitNavMorphKind | undefined
  /** 形变收尾/跳过时清掉 morphing（组件内部用，应用勿动） */
  morphingSetRef: {
    current: (next: boolean, kind?: AdaptiveSplitNavMorphKind) => void
  }
}

export function useAdaptiveSplitNav(options: {
  /** 由领域状态推导当前应处的子页 id（分栏切回子页栈时调用） */
  narrowPageForState: () => string
  /** 开启响应式分栏：宽屏左右两栏、窄屏子页栈；缺省 = 永远子页栈 */
  split?: boolean
  /** 分栏形态下左栏显示的页 id（应用的根列表页）；切宽时静默浮出，栈保活 */
  listPage?: string
  /** split 开启时：进入分栏形态的宽度上限（含），默认 520（对齐吸附窗宽） */
  narrowEnterWidth?: number
  /** split 开启时：退出分栏形态的下限（不含），默认 580（与进入阈值滞回防抖） */
  narrowExitWidth?: number
  /** 形态切换回调（首次测量不触发；仅 split 开启时会触发） */
  onLayoutChange?: (narrow: boolean) => void
}): AdaptiveSplitNavController {
  const enterWidth = options.narrowEnterWidth ?? APP_NARROW_LAYOUT_MAX_WIDTH
  const exitWidth = options.narrowExitWidth ?? APP_NARROW_LAYOUT_EXIT_WIDTH
  const { hostRef, narrowLayout: measuredNarrow, layoutReady } = useAppNarrowLayout({
    enterWidth,
    exitWidth,
    // 左右半屏吸附视为窄形态（不受宽度滞回死区影响）
    snapForcesNarrow: true,
    // 拖拽调宽中不提交翻转（hook 里 hold），松手/一步跳变等宽度停变后提交，
    // 才播完整滑轨形变——拖拽中提交会让滑轨没有可演的起止点。
    settleMs: SPLIT_FLIP_SETTLE_MS,
  })
  // 渲染形态：未开启 split 时恒为子页栈
  const narrowLayout = !options.split || measuredNarrow

  // options 里的函数每次渲染都是新闭包，经 ref 取最新值供 effect 使用
  const forStateRef = useRef(options.narrowPageForState)
  forStateRef.current = options.narrowPageForState
  const listPageRef = useRef(options.listPage)
  listPageRef.current = options.listPage
  const onSwitchRef = useRef(options.onLayoutChange)
  onSwitchRef.current = options.onLayoutChange

  const [initialPage] = useState(options.narrowPageForState)

  const { showPage, ...stack } = usePageStack<string>(initialPage)
  const listPage = options.listPage ?? ''

  // 形态翻转计划：必须在渲染期侦测并写入——AdaptiveSplitNav 是子组件，其
  // layout effect 先于本 hook 的执行，等 effect 再算就晚了。fromPage 取
  // 本轮渲染的栈顶（翻转提交前满屏显示的那页）。
  const prevFormRef = useRef<boolean | undefined>(undefined)
  const switchPlanRef = useRef<AdaptiveSplitNavSwitchPlan | undefined>(undefined)
  const [morphing, setMorphing] = useState(false)
  const [morphKind, setMorphKind] = useState<AdaptiveSplitNavMorphKind | undefined>(
    undefined,
  )
  const [morphEpoch, setMorphEpoch] = useState(0)
  const morphingSetRef = useRef<
    (next: boolean, kind?: AdaptiveSplitNavMorphKind) => void
  >(() => {})
  morphingSetRef.current = (next, kind) => {
    setMorphing(next)
    if (next) {
      if (kind) setMorphKind(kind)
    } else {
      setMorphKind(undefined)
      setMorphEpoch((epoch) => epoch + 1)
    }
  }
  const flipping =
    layoutReady && prevFormRef.current !== undefined && prevFormRef.current !== narrowLayout
  if (flipping) {
    switchPlanRef.current = {
      toWide: !narrowLayout,
      fromPage: stack.stack[stack.stack.length - 1] ?? stack.page,
      narrowTarget: forStateRef.current(),
    }
  }
  // 翻转当帧就要标形成变：子组件 layout effect 还没跑，首帧 paint 已经用
  // 分栏帧画标题栏。reduced-motion 不播滑轨，也不保起始 chrome。
  const morphingNow = morphing || (flipping && !prefersReducedMotion())
  const morphKindNow =
    morphKind ??
    (flipping && switchPlanRef.current
      ? morphKindFromPlan(switchPlanRef.current, listPage)
      : undefined)

  // 形态切换编排：切宽 = 左栏静默浮出根列表页；切窄 = 当前领域位置对应页
  // 浮到栈顶。两方向都不截断栈——已挂载层（含滚动位置）全程保活，
  // 宽窄形变期间没有任何重挂载。首次测量即处于分栏形态时同样浮出根列表。
  useLayoutEffect(() => {
    if (!layoutReady) return
    const previous = prevFormRef.current
    prevFormRef.current = narrowLayout
    if (previous === undefined) {
      if (!narrowLayout && listPageRef.current) showPage(listPageRef.current)
      return
    }
    if (previous === narrowLayout) return
    if (narrowLayout) {
      showPage(switchPlanRef.current?.narrowTarget ?? forStateRef.current())
    } else if (listPageRef.current) {
      showPage(listPageRef.current)
    }
    onSwitchRef.current?.(narrowLayout)
  }, [layoutReady, narrowLayout, showPage])

  return useMemo(
    () => ({
      narrowLayout,
      layoutReady,
      page: stack.page,
      listPage,
      hostRef,
      navigate: (page, direction, onSettled) => {
        if (!narrowLayout) {
          onSettled?.()
          return
        }
        stack.navigate(page, direction, onSettled)
      },
      setPageSilent: stack.setPage,
      stackView: {
        stack: stack.stack,
        transition: stack.transition,
        handleMotionEnd: stack.handleMotionEnd,
      },
      switchPlanRef,
      morphing: morphingNow,
      morphKind: morphKindNow,
      morphingSetRef,
    }),
    [
      hostRef,
      narrowLayout,
      layoutReady,
      stack.page,
      listPage,
      stack.navigate,
      stack.setPage,
      showPage,
      stack.stack,
      stack.transition,
      stack.handleMotionEnd,
      switchPlanRef,
      morphingNow,
      morphKindNow,
      morphingSetRef,
      morphEpoch,
    ],
  )
}

/** flat 引擎渲染页面时收到的 chrome 上下文（应用据此决定返回键等形态差异） */
export type AdaptiveSplitNavPageContext = {
  narrowLayout: boolean
  morphing: boolean
  morphKind?: AdaptiveSplitNavMorphKind
}

type AdaptiveSplitNavSharedProps = {
  controller: AdaptiveSplitNavController
  /** 帧栈全量重置键：变化时立即整体替换帧（不播动画），如选中条目身份切换 */
  framesResetKey?: string
  /** 附加条（应用自定内容）：分栏时在右栏底部、子页栈时在栈下方 */
  footer?: ComponentChildren
  /** 分栏帧序列为空时的占位，应用全权定义；缺省渲染中性空白 */
  renderDetailEmpty?: () => ComponentChildren
  /** 左栏占分栏总宽比例（0~1），默认 0.38 */
  listRatio?: number
  /** 分栏帧动画时长（ms），默认 380 */
  frameAnimationMs?: number
  class?: string
}

export type ClassicAdaptiveSplitNavProps = AdaptiveSplitNavSharedProps & {
  /** 双份渲染引擎（缺省）：窄屏子页与分栏帧各渲染一份，形变靠交接对齐 */
  engine?: 'classic'
  /** 子页栈：渲染某个页，内容与外壳完全由应用定义（左栏根列表页也由此渲染） */
  renderNarrowPage: (page: string) => ComponentChildren
  /**
   * 分栏右栏帧序列，从与子页同一份领域状态派生；顺序 = 叠放次序（末位最上）。
   * 每次渲染都会调用，活帧内容始终取最新（空数组表示详情区无内容）。
   */
  renderWideFrames: () => AdaptiveFrameSpec[]
}

export type FlatAdaptiveSplitNavProps = AdaptiveSplitNavSharedProps & {
  /** 平铺单实例引擎：每页一个常驻 host，形态切换零重挂载、零交接、无双份 */
  engine: 'flat'
  /**
   * 按页 id 渲染页面实体（页 = 身份：pop 离场帧靠 id 稳定内容，无需快照）。
   * chrome 差异（返回键有无等）由 ctx 决定，一份内容服务两种形态。
   */
  renderPage: (page: string, ctx: AdaptiveSplitNavPageContext) => ComponentChildren
  /** 分栏右栏帧序（页 id，末位最上）；与窄屏子页同一套 id 空间 */
  frames: string[]
}

export type AdaptiveSplitNavProps =
  | ClassicAdaptiveSplitNavProps
  | FlatAdaptiveSplitNavProps

const DEFAULT_LIST_RATIO = 0.38
const DEFAULT_FRAME_MS = 380
/** 形态翻转等宽度停变后再提交，避免拖拽中途反复起滑轨 */
const SPLIT_FLIP_SETTLE_MS = 150

/** 形变滑轨曲线：与左栏 width 过渡（css）严格同曲线，缝隙恒等式才成立 */
const MORPH_EASING = 'cubic-bezier(0.22, 0.61, 0.36, 1)'

/**
 * 形变分型：
 * - A 窄(子页)→宽：面板从满屏宽收缩到右栏宽（右缘钉住），子页原位退成
 *   右栏，根列表钉在最终宽度作为刚性面板自左缘滑入（列表右缘与面板左缘
 *   同式联动，任意中间帧严丝合缝）；
 * - B 窄(根列表)→宽：面板以最终宽度从窗口右缘外整体滑入；
 * - C 宽(子页)→窄：面板从右栏宽扩张盖满，落定后交棒给同内容子页栈；
 * - D 宽(根列表)→窄：面板整体滑出右缘。
 * A/C 期间面板会向左越出详情栏盒子，必须放开该栏 overflow / contain，
 * 否则悬出被剪掉，视觉塌成「列表瞬现 + 内容从右挤入」。
 */
type MorphKind = AdaptiveSplitNavMorphKind

/** 一次进行中的形态形变：持有全部需要在收尾时清理/还原的资源 */
type MorphGesture = {
  kind: MorphKind
  toNarrow: boolean
  detailW: number
  duration: number
  sheet: HTMLElement | undefined
  detailPane: HTMLElement | undefined
  anim: Animation | undefined
  /** A 型：左栏列表刚性滑入的轨道，收尾时还原内联样式 */
  listTrack: HTMLElement | undefined
  trackAnim: Animation | undefined
  timer: number
  observer: ResizeObserver
  done: boolean
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function playMorphAnim(
  target: HTMLElement,
  keyframes: Keyframe[],
  duration: number,
) {
  const anim = target.animate(keyframes, {
    duration,
    easing: MORPH_EASING,
    fill: 'both',
  })
  // 提前 cancel（装甲/被新形变接替）会让 finished 拒绝，属预期内
  anim.finished.catch(() => {})
  return anim
}

/** 按引擎分发：classic（缺省，双份渲染 + 交接）与 flat（平铺单实例） */
export function AdaptiveSplitNav(props: AdaptiveSplitNavProps) {
  if (props.engine === 'flat') {
    return <FlatSplitNavView {...props} />
  }
  return <ClassicSplitNavView {...props} />
}

function ClassicSplitNavView(props: ClassicAdaptiveSplitNavProps) {
  const {
    controller,
    renderNarrowPage,
    renderWideFrames,
    framesResetKey = '',
    footer,
    renderDetailEmpty,
    listRatio = DEFAULT_LIST_RATIO,
    frameAnimationMs = DEFAULT_FRAME_MS,
    class: className,
  } = props
  const { narrowLayout, layoutReady, hostRef } = controller
  // 形变编排要直接操作的骨架节点：根（量宽/装甲 RO）、帧容器（面板本体）、
  // 详情栏（形变期抬 z 用）
  const rootRef = useRef<HTMLDivElement | null>(null)
  const framesRef = useRef<HTMLDivElement | null>(null)
  const detailPaneRef = useRef<HTMLDivElement | null>(null)
  const listTrackRef = useRef<HTMLDivElement | null>(null)
  // 分栏左栏显示不变量：分栏形态固定渲染根列表页（listPage），栈顶残留页
  // 只在栈里保活、不上屏；未配置 listPage 时退回显示栈顶页（原行为）。
  // 例外：宽→窄形变（C/D）期间继续渲染 listPage——左栏是滑轨要盖过去的
  // 画面，翻转当帧就换栈顶页会让左栏硬切出子页、顶上闪出一颗分栏没有的
  // 返回键；窄屏终态页等形变收尾、面板盖满交棒时才换上。
  const morphToNarrow =
    controller.morphing &&
    (controller.morphKind === 'C' || controller.morphKind === 'D')
  const displayPage = !controller.listPage
    ? controller.page
    : narrowLayout && !morphToNarrow
      ? controller.page
      : controller.listPage

  // 活帧：ref 供 effect 读取最新值；渲染期直接使用（内容永不过期）
  const liveFrames = renderWideFrames()
  const liveFramesRef = useRef(liveFrames)
  liveFramesRef.current = liveFrames
  // 结构签名：只有 id 序列变化才进入时序分支（同结构的内容刷新不触发动画）
  const liveSig = liveFrames.map((frame) => frame.id).join('\0')

  /** pop 离场的帧：保帧播完滑出动画后才移除，内容定格在退场开始那一刻 */
  const [exiting, setExiting] = useState<AdaptiveFrameSpec[]>([])
  const exitingRef = useRef(exiting)
  exitingRef.current = exiting
  const [wideIndex, setWideIndex] = useState(0)
  const prevLiveLenRef = useRef(0)
  const resetKeyRef = useRef(framesResetKey)
  // 上一帧视图（活帧 + 退场帧），供下一次 pop 捕获离场帧；
  // 由本文件最后一个 layout effect 更新（时序 effect 读到的是上一帧视图）
  const lastViewRef = useRef<AdaptiveFrameSpec[]>([])

  // 帧转场窗口：右栏进/退子页的那一段时间（时长 = 帧动画时长）。窗口期
  // 容器改用页面栈同款拆盒（标题栏交叉淡移、正文整页滑、持续底色画在伪
  // 元素上）——旧实现整帧连标题栏一起滑，底色跟着走会露出白底，返回键
  // 也会在白板上叠出两颗。形变（滑轨 A~D）期间不开窗口，那是另一套编排。
  const [frameNav, setFrameNav] = useState<'push' | 'pop' | undefined>(undefined)
  const frameNavTimerRef = useRef(0)
  const openFrameNav = (direction: 'push' | 'pop') => {
    window.clearTimeout(frameNavTimerRef.current)
    setFrameNav(direction)
    frameNavTimerRef.current = window.setTimeout(() => {
      setFrameNav(undefined)
    }, frameAnimationMs)
  }
  const closeFrameNav = () => {
    window.clearTimeout(frameNavTimerRef.current)
    setFrameNav(undefined)
  }

  // 结构时序：重置键变化 / 跨级跳变（|Δ|>1）→ 立即整体替换；
  // pop（帧数变少）→ active 先回退让旧帧滑出，动画结束后才从 DOM 移除；
  // push（帧数变多）→ 这里不动，由下方收尾 effect 抬 active 完成滑入
  useLayoutEffect(() => {
    if (narrowLayout) return
    const resetChanged = resetKeyRef.current !== framesResetKey
    resetKeyRef.current = framesResetKey
    const nextLen = liveFramesRef.current.length
    const prevLen = prevLiveLenRef.current
    if (resetChanged || Math.abs(nextLen - prevLen) > 1) {
      prevLiveLenRef.current = nextLen
      setExiting([])
      setWideIndex(Math.max(0, nextLen - 1))
      return
    }
    if (nextLen < prevLen) {
      const popped = lastViewRef.current.slice(nextLen)
      prevLiveLenRef.current = nextLen
      setExiting(popped)
      setWideIndex(Math.max(0, nextLen - 1))
      if (!morphRef.current) openFrameNav('pop')
      const timer = window.setTimeout(() => {
        setExiting([])
      }, frameAnimationMs)
      return () => window.clearTimeout(timer)
    }
    if (nextLen > prevLen) return
    if (exitingRef.current.length > 0) {
      // 弹栈动画进行中又推回同级：丢弃退场帧，顶帧立即生效（滑入）
      setExiting([])
      setWideIndex(Math.max(0, nextLen - 1))
    }
  }, [liveSig, narrowLayout, framesResetKey, frameAnimationMs])

  // push 收尾：新帧已挂载在 translateX(100%) 之外，paint 后再抬 active，
  // 让它从右侧滑入（挂载与动画分两帧，否则首帧就是终点、没有动画）。
  // 形变期不走这条：顶帧由滑轨对齐，再抬会让子页自己从右边滑进来。
  useEffect(() => {
    if (narrowLayout) return
    if (morphRef.current) {
      prevLiveLenRef.current = liveFramesRef.current.length
      return
    }
    if (liveFramesRef.current.length > prevLiveLenRef.current) {
      const hadTop = prevLiveLenRef.current > 0
      prevLiveLenRef.current = liveFramesRef.current.length
      setWideIndex(liveFramesRef.current.length - 1)
      // 首帧（书架位自动展开）没有退让的底层帧，不拆盒直接就位
      if (hadTop) openFrameNav('push')
    }
  }, [liveSig, narrowLayout])

  useLayoutEffect(() => {
    lastViewRef.current = [...liveFramesRef.current, ...exitingRef.current]
  })

  // ── 宽窄形变：刚性面板滑轨 ──
  // 右栏帧容器作为「面板」参与滑轨，A 型时左栏列表作为刚性面板自左缘滑入，
  // 两者同曲线联动（时长取同源的 --asn-frame-ms）。翻转统一在宽度停变
  // （松手/一步跳变）后提交，到这里必有稳定的起止点；仅 reduced-motion 与
  // 「提交撞上拖拽态」的竞态装甲退化为即时切换。
  // 形变中途宿主再变尺寸则立即落定清理（RO 装甲，忽略首次回调）。
  const morphRef = useRef<MorphGesture | undefined>(undefined)
  const pendingSlideRef = useRef(false)
  const prevMorphFormRef = useRef<boolean | undefined>(undefined)
  const finishMorphRef = useRef<() => void>(() => {})

  const clearWideFramesView = () => {
    setExiting([])
    prevLiveLenRef.current = 0
    setWideIndex(0)
    closeFrameNav()
  }

  const finishMorph = () => {
    const gesture = morphRef.current
    if (!gesture || gesture.done) return
    gesture.done = true
    window.clearTimeout(gesture.timer)
    gesture.observer.disconnect()
    // cancel 让面板回到常态样式（与移除内联同帧、同一次 paint，无中间态）
    gesture.anim?.cancel()
    const sheet = gesture.sheet
    if (sheet) {
      sheet.style.position = ''
      sheet.style.top = ''
      sheet.style.bottom = ''
      sheet.style.right = ''
      sheet.style.left = ''
      sheet.style.width = ''
    }
    const track = gesture.listTrack
    if (track) {
      // 同理：fill 保持的终态 translateX(0) 即常态，cancel + 去掉内联宽度
      // 回到流内（左栏 width 过渡与滑轨同拍，此刻已停稳在终宽，无跳变）
      gesture.trackAnim?.cancel()
      track.style.width = ''
      track.style.transform = ''
    }
    if (gesture.detailPane) {
      gesture.detailPane.style.zIndex = ''
      gesture.detailPane.style.overflow = ''
      gesture.detailPane.style.contain = ''
    }
    rootRef.current?.classList.remove('adaptive-split-nav--morphing')
    morphRef.current = undefined
    pendingSlideRef.current = false
    controller.morphingSetRef.current(false)
    if (gesture.toNarrow) {
      clearWideFramesView()
    } else if (liveFramesRef.current.length > 0) {
      // 形变期间用户又前进了一层（push 收尾给滑轨让路）：顶帧滞留右缘待入，
      // 收尾在这里补抬 active 让它滑入；常态下 active 已在顶，赋同值无动画
      prevLiveLenRef.current = liveFramesRef.current.length
      setWideIndex(liveFramesRef.current.length - 1)
    }
  }
  finishMorphRef.current = finishMorph

  // 形变启动。必须先于下方清场 effect 声明：清场要等形变收尾才执行。
  useLayoutEffect(() => {
    if (!layoutReady) return
    const previous = prevMorphFormRef.current
    prevMorphFormRef.current = narrowLayout
    if (previous === undefined || previous === narrowLayout) return

    const root = rootRef.current
    // 装甲：拖拽中（--resizing）hook 已 hold 翻转、不该有提交到这里，但
    // 松手后 settle 计时窗口内又开拖的竞态仍可能把提交撞进拖拽态——此时
    // 不播滑轨（起止点在流变，硬播也会被 RO 装甲掐掉），退化为即时切换。
    // reduced-motion 同样退化为即时切换。翻转当帧已经把 morphing 标亮，
    // 不播滑轨就要立刻清掉，否则应用会按起始 chrome 一直画到下一次翻转。
    const dragging = !!root?.closest('.window-frame--resizing')
    if (!root || dragging || prefersReducedMotion()) {
      // 上一次滑轨还挂着（装甲未及收尾）先落定清场，再按新形态就位
      finishMorphRef.current()
      if (!narrowLayout) {
        // 宽向即时切：对齐栈顶帧，否则头一帧先画出底层帧
        const len = liveFramesRef.current.length
        if (len > 0) {
          prevLiveLenRef.current = len
          setWideIndex(len - 1)
        }
      }
      controller.morphingSetRef.current(false)
      return
    }

    const plan = controller.switchPlanRef.current
    if (!plan) {
      controller.morphingSetRef.current(false)
      return
    }
    const stageW = root.clientWidth
    if (stageW <= 0) {
      controller.morphingSetRef.current(false)
      return
    }
    // 面板终宽 D：与 CSS 同式（width: ratio%），缝隙恒等式的两端才能对上
    const ratioPct = Math.round(listRatio * 10000) / 100
    const detailW = stageW - (stageW * ratioPct) / 100
    const hasFrames = liveFramesRef.current.length > 0

    let kind: MorphKind
    if (plan.toWide) {
      kind = plan.fromPage === controller.listPage ? 'B' : 'A'
    } else {
      kind = plan.narrowTarget === controller.listPage ? 'D' : 'C'
    }
    if (kind === 'A' && !hasFrames) kind = 'B'
    if (kind === 'C' && !hasFrames) kind = 'D'

    // 快速连续翻转：上一次形变先落定清场，再起新滑轨
    finishMorphRef.current()
    // 若帧转场窗口还开着（滑轨与进退子页撞上），先关掉：滑轨要独占面板
    closeFrameNav()

    // 面板对齐栈顶帧：窄屏期间 wideIndex 被清成 0，不抬会先渲染底层帧
    if (hasFrames && kind !== 'D') {
      prevLiveLenRef.current = liveFramesRef.current.length
      setWideIndex(liveFramesRef.current.length - 1)
    }

    const sheet = framesRef.current ?? undefined
    const detailPane = detailPaneRef.current ?? undefined
    // observe() 会立刻回一次当前尺寸；若当成「中途改宽」会在首帧 paint 前
    // 把刚起的滑轨掐死，A 型塌成「列表硬切 + 子页从右挤入」（B 型碰巧长得像对的）。
    const originW = root.clientWidth
    const observer = new ResizeObserver(() => {
      if (root.clientWidth === originW) return
      finishMorphRef.current()
    })
    observer.observe(root)
    root.classList.add('adaptive-split-nav--morphing')
    const gesture: MorphGesture = {
      kind,
      toNarrow: !plan.toWide,
      detailW,
      duration: frameAnimationMs,
      sheet,
      detailPane,
      anim: undefined,
      listTrack: undefined,
      trackAnim: undefined,
      timer: 0,
      observer,
      done: false,
    }
    morphRef.current = gesture
    // 翻转当帧靠 flipping 让 morphing 为 true；parent 的 form effect 随后
    // 会把 flipping 关掉。这里把状态和分型钉住，直到收尾，应用才能按起始
    // 形态画 chrome（如 A 型书页返回键随滑轨淡出）。
    controller.morphingSetRef.current(true, kind)
    const armTimer = () => {
      window.clearTimeout(gesture.timer)
      gesture.timer = window.setTimeout(
        () => finishMorphRef.current(),
        gesture.duration + 30,
      )
    }
    armTimer()

    if ((kind === 'A' || kind === 'C') && detailPane) {
      // 面板要盖住/露出左栏（静置时左栏 z=2 在上），形变期抬到最上；
      // A/C 的面板会大幅向左越出详情栏盒子（面板左缘从 0 滑到 L，而详情栏
      // 左缘从 W 滑到 L），不放开详情栏的 overflow 裁剪，滑轨就会被剪成
      // 「列表瞬现 + 内容从右挤入」——恰是 B/D 不存在此悬出（只悬出窗口外）
      detailPane.style.zIndex = '3'
      detailPane.style.overflow = 'visible'
      detailPane.style.contain = 'none'
    }

    if (!sheet) {
      // 帧未就绪（B 型：书架位切宽时应用常晚一帧自动展开首帧）：武装，
      // 等帧挂载的 paint 前补播滑入；届时已超时收尾则自然作废。
      // A 型帧容器缺失不补播（列表轨道在下方、同样不会启动），由计时器
      // 收尾，退化为即时切换而非错误动画。
      if (kind === 'B') pendingSlideRef.current = true
      return
    }

    sheet.style.position = 'absolute'
    sheet.style.top = '0'
    sheet.style.bottom = '0'
    sheet.style.right = '0'
    sheet.style.left = 'auto'

    let keyframes: Keyframe[]
    if (kind === 'A') {
      sheet.style.width = `${stageW}px`
      keyframes = [{ width: `${stageW}px` }, { width: `${detailW}px` }]
      // 列表刚性面板自左缘滑入：内容钉在最终宽度排版（此刻面板盖满全窗，
      // 满宽→终宽的改排不可见），translateX(-L→0) 的右缘 = -L(1-e)+L =
      // L·e(t) 恰与面板左缘同式，缝隙恒等式成立；同时免掉 width 过渡的
      // 逐帧重排挤压
      const track = listTrackRef.current
      if (track) {
        const listW = stageW - detailW
        track.style.width = `${listW}px`
        gesture.listTrack = track
        gesture.trackAnim = playMorphAnim(
          track,
          [
            { transform: `translateX(${-listW}px)` },
            { transform: 'translateX(0px)' },
          ],
          gesture.duration,
        )
      }
    } else if (kind === 'C') {
      sheet.style.width = `${detailW}px`
      keyframes = [{ width: `${detailW}px` }, { width: `${stageW}px` }]
    } else if (kind === 'B') {
      sheet.style.width = `${detailW}px`
      keyframes = [
        { transform: `translateX(${detailW}px)` },
        { transform: 'translateX(0px)' },
      ]
    } else {
      sheet.style.width = `${detailW}px`
      keyframes = [
        { transform: 'translateX(0px)' },
        { transform: `translateX(${detailW}px)` },
      ]
    }
    gesture.anim = playMorphAnim(sheet, keyframes, gesture.duration)
  }, [
    layoutReady,
    narrowLayout,
    listRatio,
    frameAnimationMs,
    controller.switchPlanRef,
    controller.listPage,
  ])

  // B 型补播：武装后帧才挂载（应用自动展开），在挂载渲染的 paint 前起滑
  useLayoutEffect(() => {
    const gesture = morphRef.current
    if (!gesture || gesture.kind !== 'B' || !pendingSlideRef.current) return
    const sheet = framesRef.current
    if (!sheet) return
    pendingSlideRef.current = false
    sheet.style.position = 'absolute'
    sheet.style.top = '0'
    sheet.style.bottom = '0'
    sheet.style.right = '0'
    sheet.style.left = 'auto'
    sheet.style.width = `${gesture.detailW}px`
    gesture.sheet = sheet
    gesture.anim = playMorphAnim(
      sheet,
      [
        { transform: `translateX(${gesture.detailW}px)` },
        { transform: 'translateX(0px)' },
      ],
      gesture.duration,
    )
    window.clearTimeout(gesture.timer)
    gesture.timer = window.setTimeout(
      () => finishMorphRef.current(),
      gesture.duration + 30,
    )
  }, [liveSig])

  // 切回子页栈：帧栈是纯视觉层，随形态一起清场（下次进分栏按状态重建）。
  // 形变进行中让路——等 morph 收尾再清，面板才能把画面交棒给子页栈。
  useLayoutEffect(() => {
    if (!narrowLayout) return
    if (morphRef.current) return
    clearWideFramesView()
  }, [narrowLayout])

  // 卸载时形变未收尾：取消动画并还原样式；顺带清掉帧转场窗口计时器
  useEffect(
    () => () => {
      finishMorphRef.current()
      window.clearTimeout(frameNavTimerRef.current)
    },
    [],
  )

  // 渲染视图 = 活帧（最新内容）+ 与活帧不重号的退场帧（定格内容）
  const liveIds = new Set(liveFrames.map((frame) => frame.id))
  const view =
    exiting.length > 0
      ? [...liveFrames, ...exiting.filter((frame) => !liveIds.has(frame.id))]
      : liveFrames
  const active = Math.min(wideIndex, Math.max(0, view.length - 1))

  const styleVars = {
    '--asn-list-ratio': `${Math.round(listRatio * 10000) / 100}%`,
    '--asn-frame-ms': `${frameAnimationMs}ms`,
  } as Record<string, string>

  const renderFramesStack = () => {
    if (view.length === 0) {
      return (
        <div class="adaptive-split-nav__detail-empty">
          {renderDetailEmpty ? renderDetailEmpty() : undefined}
        </div>
      )
    }
    // 窗口期参与拆盒的两帧：push = 旧顶退守（under）+ 新顶滑入（over）；
    // pop = 新顶回位（under）+ 退场帧滑出（over）。其余帧窗口内不渲染。
    const navUnder = frameNav === 'push' ? active - 1 : frameNav === 'pop' ? active : -1
    const navOver = frameNav === 'push' ? active : frameNav === 'pop' ? active + 1 : -1
    return (
      <div
        ref={framesRef}
        class={`adaptive-split-nav__frames${
          frameNav ? ` adaptive-split-nav__frames--${frameNav}` : ''
        }`}
      >
        {view.map((frame, index) => (
          <div
            key={frame.id}
            class={[
              'adaptive-split-nav__frame',
              index === active ? 'is-active' : '',
              index === navUnder ? 'is-under' : '',
              index === navOver ? 'is-over' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              transform:
                index === active
                  ? 'translateX(0)'
                  : index < active
                    ? 'translateX(-30%)'
                    : 'translateX(100%)',
              zIndex: index,
            }}
          >
            {frame.content}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      ref={(node) => {
        rootRef.current = node
        hostRef(node)
      }}
      class={`adaptive-split-nav${className ? ` ${className}` : ''}`}
      style={styleVars}
    >
      <div class="adaptive-split-nav__stage" data-form={narrowLayout ? 'stack' : 'split'}>
        <div class="adaptive-split-nav__list-pane">
          <div ref={listTrackRef} class="adaptive-split-nav__list-track">
            <PageStack
              stack={controller.stackView.stack}
              page={displayPage}
              transition={controller.stackView.transition}
              onMotionEnd={controller.stackView.handleMotionEnd}
              renderPage={renderNarrowPage}
            />
          </div>
          {narrowLayout && footer ? (
            <div class="adaptive-split-nav__footer">{footer}</div>
          ) : undefined}
        </div>
        <div
          ref={detailPaneRef}
          class="adaptive-split-nav__detail-pane"
          aria-hidden={narrowLayout || undefined}
        >
          {renderFramesStack()}
          {!narrowLayout && footer ? (
            <div class="adaptive-split-nav__footer">{footer}</div>
          ) : undefined}
        </div>
      </div>
    </div>
  )
}

// ── flat 引擎：平铺单实例渲染 ──
// 每页一个常驻 host（stage 的绝对定位子节点），data-pos 表达角色——窄/宽
// 只是同一骨架下 host 盒子的两种角色状态。详情 host 恒钉右栏矩形，叠放
// 位移（露边/待入）写在盒内 slider 层上，host 只负责裁切；进退动画作用
// 在 host 内的 header/正文（host 盒本身不动）；宽窄形变是另一套编排，由
// tsx 用 WAAPI 直接动 host 盒子的几何（编排与缝隙数学照 classic 移植）。
// 页面内容从不换手：没有副本、没有交接，形态切换零重挂载，跨形态滚动
// 位置天然保留。

type FlatHostPos = 'current' | 'under' | 'parked' | 'list' | 'detail'

/** 一次进行中的形态形变：持有全部需要在收尾时清理/还原的资源 */
type FlatMorphGesture = {
  kind: MorphKind
  toNarrow: boolean
  detailW: number
  duration: number
  anims: Animation[]
  /** 动过内联 left/width 的 host，收尾时统一还原（transform 归渲染管） */
  styled: HTMLElement[]
  timer: number
  observer: ResizeObserver
  done: boolean
}

function FlatSplitNavView(props: FlatAdaptiveSplitNavProps) {
  const {
    controller,
    renderPage,
    frames,
    framesResetKey = '',
    footer,
    renderDetailEmpty,
    listRatio = DEFAULT_LIST_RATIO,
    frameAnimationMs = DEFAULT_FRAME_MS,
    class: className,
  } = props
  const { narrowLayout, layoutReady, hostRef } = controller
  const rootRef = useRef<HTMLDivElement | null>(null)
  // 形变编排直接操作 host 盒子：id → 元素
  const hostElsRef = useRef(new Map<string, HTMLDivElement>())

  const framesRef = useRef(frames)
  framesRef.current = frames
  // 结构签名：只有帧 id 序列变化才进入时序分支（同结构的内容刷新不触发动画）
  const liveSig = frames.join('\0')

  /** pop 离场的帧 id：保帧播完滑出动画后才卸载（内容随 id 天然稳定） */
  const [exitingIds, setExitingIds] = useState<string[]>([])
  const exitingRef = useRef(exitingIds)
  exitingRef.current = exitingIds
  const [wideIndex, setWideIndex] = useState(0)
  const prevLiveLenRef = useRef(0)
  const resetKeyRef = useRef(framesResetKey)
  const lastViewIdsRef = useRef<string[]>([])

  // 帧转场窗口：右栏进/退子页的那一段时间（时长 = 帧动画时长）。窗口期
  // 两台 host 的 header 交叉淡移、正文整页滑（page-stack 同款 keyframes）。
  // 形变（滑轨 A~D）期间不开窗口，那是另一套编排。
  const [frameNav, setFrameNav] = useState<'push' | 'pop' | undefined>(undefined)
  const frameNavRef = useRef(frameNav)
  frameNavRef.current = frameNav
  const frameNavTimerRef = useRef(0)
  const openFrameNav = (direction: 'push' | 'pop') => {
    window.clearTimeout(frameNavTimerRef.current)
    setFrameNav(direction)
    // 计时器只是兜底（reduced-motion 下动画为 none、animationend 永不来），
    // 正常收口在根 onAnimationEnd：计时器发起于 effect、动画在下一渲染帧
    // 才起跑，按帧长定的 deadline 必然早于动画终点——关窗帧上动画还差
    // 尾段 1~2px 没走完，fill 撤除会把 body 从缓动尾段硬拽到位，接缝处
    // 闪出底下的画面。放宽余量让它只可能晚到；晚到关窗幂等（终态＝自然态）。
    frameNavTimerRef.current = window.setTimeout(() => {
      setFrameNav(undefined)
    }, frameAnimationMs + 60)
  }
  const closeFrameNav = () => {
    window.clearTimeout(frameNavTimerRef.current)
    setFrameNav(undefined)
  }

  // 结构时序：重置键变化 / 跨级跳变（|Δ|>1）→ 立即整体替换；pop（帧数变少）
  // → active 先回退让旧帧滑出，动画结束后才卸载；push → 收尾 effect 抬 active
  useLayoutEffect(() => {
    if (narrowLayout) return
    const resetChanged = resetKeyRef.current !== framesResetKey
    resetKeyRef.current = framesResetKey
    const nextLen = framesRef.current.length
    const prevLen = prevLiveLenRef.current
    if (resetChanged || Math.abs(nextLen - prevLen) > 1) {
      prevLiveLenRef.current = nextLen
      // 整体替换可能撞上未关的帧窗口（书→架自动展开撞上 pop 收尾等）：
      // 滞留的窗口方向会按新 active 误标 is-under/over，拆盒动画重放到
      // 替换后的帧上，顺手关窗。
      setExitingIds([])
      closeFrameNav()
      setWideIndex(Math.max(0, nextLen - 1))
      return
    }
    if (nextLen < prevLen) {
      const popped = lastViewIdsRef.current.slice(nextLen)
      prevLiveLenRef.current = nextLen
      setExitingIds(popped)
      setWideIndex(Math.max(0, nextLen - 1))
      if (!morphRef.current) openFrameNav('pop')
      // 退场帧正常路径与关窗同拍卸载（根 onAnimationEnd，见彼处注释）；
      // 此计时器只兜底 reduced-motion / 动画被内容打断的场景——届时
      // transition 一并被 reduced-motion 关闭，slider 瞬移 100% 后摘除
      // 不可见。
      const timer = window.setTimeout(() => {
        setExitingIds([])
      }, frameAnimationMs + 60)
      return () => window.clearTimeout(timer)
    }
    if (nextLen > prevLen) return
    if (exitingRef.current.length > 0) {
      // 弹栈动画进行中又推回同级：丢弃退场帧，顶帧立即生效（滑入）
      setExitingIds([])
      setWideIndex(Math.max(0, nextLen - 1))
    }
  }, [liveSig, narrowLayout, framesResetKey, frameAnimationMs])

  // push 收尾：新 host 挂载在 translateX(100%) 之外，paint 后再抬 active
  // 让它从右侧滑入（挂载与动画分两帧，否则首帧就是终点、没有动画）。
  // 形变期不走这条：顶帧由滑轨对齐，再抬会让子页自己从右边滑进来。
  useEffect(() => {
    if (narrowLayout) return
    if (morphRef.current) {
      prevLiveLenRef.current = framesRef.current.length
      return
    }
    if (framesRef.current.length > prevLiveLenRef.current) {
      const hadTop = prevLiveLenRef.current > 0
      prevLiveLenRef.current = framesRef.current.length
      setWideIndex(framesRef.current.length - 1)
      // 首帧（书架位自动展开）没有退让的底层帧，直接就位不开窗口
      if (hadTop) openFrameNav('push')
    }
  }, [liveSig, narrowLayout])

  useLayoutEffect(() => {
    lastViewIdsRef.current = [...framesRef.current, ...exitingRef.current]
  })

  // ── 宽窄形变：host 盒子滑轨 ──
  // 翻转统一在宽度停变（松手/一步跳变）后提交，到这里必有稳定的起止点；
  // 仅 reduced-motion 与「提交撞上拖拽态」的竞态装甲退化为即时切换。
  // 形变中途宿主再变尺寸则立即落定清理（RO 装甲，忽略首次回调）。
  const morphRef = useRef<FlatMorphGesture | undefined>(undefined)
  const pendingSlideRef = useRef(false)
  const prevMorphFormRef = useRef<boolean | undefined>(undefined)
  const finishMorphRef = useRef<() => void>(() => {})

  const clearWideFramesView = () => {
    setExitingIds([])
    prevLiveLenRef.current = 0
    setWideIndex(0)
    closeFrameNav()
  }

  const finishMorph = () => {
    const gesture = morphRef.current
    if (!gesture || gesture.done) return
    gesture.done = true
    window.clearTimeout(gesture.timer)
    gesture.observer.disconnect()
    // cancel 让 host 回到常态样式（与移除内联同帧、同一次 paint，无中间态）
    for (const anim of gesture.anims) anim.cancel()
    for (const el of gesture.styled) {
      el.style.left = ''
      el.style.width = ''
    }
    const root = rootRef.current
    if (root) {
      root.classList.remove('adaptive-split-nav--morphing')
      delete root.dataset.morphKind
    }
    morphRef.current = undefined
    pendingSlideRef.current = false
    controller.morphingSetRef.current(false)
    if (gesture.toNarrow) {
      clearWideFramesView()
    } else if (framesRef.current.length > 0) {
      // 形变期间又前进了一层（push 收尾给滑轨让路）：顶帧滞留右缘待入，
      // 收尾在这里补抬 active 让它滑入；常态下 active 已在顶，赋同值无动画
      prevLiveLenRef.current = framesRef.current.length
      setWideIndex(framesRef.current.length - 1)
    }
  }
  finishMorphRef.current = finishMorph

  // 形变启动。必须先于下方清场 effect 声明：清场要等形变收尾才执行。
  useLayoutEffect(() => {
    if (!layoutReady) return
    const previous = prevMorphFormRef.current
    prevMorphFormRef.current = narrowLayout
    if (previous === undefined || previous === narrowLayout) return

    const root = rootRef.current
    // 装甲：拖拽中（--resizing）hook 已 hold 翻转、不该有提交到这里，但
    // 松手后 settle 计时窗口内又开拖的竞态仍可能把提交撞进拖拽态——此时
    // 不播滑轨，退化为即时切换。reduced-motion 同样退化。翻转当帧已经把
    // morphing 标亮，不播滑轨就要立刻清掉，否则应用会按起始 chrome 一直画。
    const dragging = !!root?.closest('.window-frame--resizing')
    if (!root || dragging || prefersReducedMotion()) {
      finishMorphRef.current()
      if (!narrowLayout) {
        // 宽向即时切：对齐栈顶帧，否则头一帧先画出底层帧
        const len = framesRef.current.length
        if (len > 0) {
          prevLiveLenRef.current = len
          setWideIndex(len - 1)
        }
      }
      controller.morphingSetRef.current(false)
      return
    }

    const plan = controller.switchPlanRef.current
    if (!plan) {
      controller.morphingSetRef.current(false)
      return
    }
    const stageW = root.clientWidth
    if (stageW <= 0) {
      controller.morphingSetRef.current(false)
      return
    }
    // 面板终宽 D：与 CSS 同式（width: ratio%），缝隙恒等式的两端才能对上
    const ratioPct = Math.round(listRatio * 10000) / 100
    const detailW = stageW - (stageW * ratioPct) / 100
    const listW = stageW - detailW
    const frameIds = framesRef.current
    const hasFrames = frameIds.length > 0

    let kind: MorphKind
    if (plan.toWide) {
      kind = plan.fromPage === controller.listPage ? 'B' : 'A'
    } else {
      kind = plan.narrowTarget === controller.listPage ? 'D' : 'C'
    }
    if (kind === 'A' && !hasFrames) kind = 'B'
    if (kind === 'C' && !hasFrames) kind = 'D'

    // 快速连续翻转：上一次形变先落定清场，再起新滑轨
    finishMorphRef.current()
    // 若帧转场窗口还开着（滑轨与进退子页撞上），先关掉：滑轨要独占面板
    closeFrameNav()

    // 面板对齐栈顶帧：窄屏期间 wideIndex 被清成 0，不抬会先渲染底层帧
    if (hasFrames && kind !== 'D') {
      prevLiveLenRef.current = frameIds.length
      setWideIndex(frameIds.length - 1)
    }

    // observe() 会立刻回一次当前尺寸；若当成「中途改宽」会在首帧 paint 前
    // 把刚起的滑轨掐死（classic 同款：忽略首次回调）
    const originW = root.clientWidth
    const observer = new ResizeObserver(() => {
      if (root.clientWidth === originW) return
      finishMorphRef.current()
    })
    observer.observe(root)
    root.classList.add('adaptive-split-nav--morphing')
    root.dataset.morphKind = kind
    const gesture: FlatMorphGesture = {
      kind,
      toNarrow: !plan.toWide,
      detailW,
      duration: frameAnimationMs,
      anims: [],
      styled: [],
      timer: 0,
      observer,
      done: false,
    }
    morphRef.current = gesture
    // 翻转当帧靠 flipping 让 morphing 为 true；这里把状态和分型钉住直到
    // 收尾，应用才能按起始形态画 chrome（如 A 型书页返回键随滑轨淡出）。
    controller.morphingSetRef.current(true, kind)
    const armTimer = () => {
      window.clearTimeout(gesture.timer)
      gesture.timer = window.setTimeout(
        () => finishMorphRef.current(),
        gesture.duration + 30,
      )
    }
    armTimer()

    const detailHosts = frameIds
      .map((id) => hostElsRef.current.get(id))
      .filter((el): el is HTMLDivElement => !!el)

    if (detailHosts.length === 0) {
      // 帧未就绪（B 型：书架位切宽时应用常晚一帧自动展开首帧）：武装，
      // 等帧挂载的 paint 前补播滑入；届时已超时收尾则自然作废。
      // A 型缺帧不补播，由计时器收尾，退化为即时切换而非错误动画。
      if (kind === 'B') pendingSlideRef.current = true
      return
    }

    if (kind === 'A') {
      // 窄子页原位退成右栏：host 盒从满窗收缩到右栏宽（右缘钉住），列表
      // 钉在最终宽度作为刚性面板自左缘滑入——两者同曲线联动，任意中间帧
      // 严丝合缝；列表免掉 width 过渡的逐帧重排挤压（classic 同款）
      for (const el of detailHosts) {
        el.style.left = '0px'
        el.style.width = `${stageW}px`
        gesture.styled.push(el)
        gesture.anims.push(
          playMorphAnim(
            el,
            [
              { left: '0px', width: `${stageW}px` },
              { left: `${listW}px`, width: `${detailW}px` },
            ],
            gesture.duration,
          ),
        )
      }
      const listEl = hostElsRef.current.get(controller.listPage)
      if (listEl) {
        listEl.style.width = `${listW}px`
        gesture.styled.push(listEl)
        gesture.anims.push(
          playMorphAnim(
            listEl,
            [
              { transform: `translateX(${-listW}px)` },
              { transform: 'translateX(0px)' },
            ],
            gesture.duration,
          ),
        )
      }
      return
    }
    if (kind === 'C') {
      // 面板（同一 host）从右栏宽扩张盖满，落定即窄屏当前页——没有交棒
      for (const el of detailHosts) {
        el.style.left = `${listW}px`
        el.style.width = `${detailW}px`
        gesture.styled.push(el)
        gesture.anims.push(
          playMorphAnim(
            el,
            [
              { left: `${listW}px`, width: `${detailW}px` },
              { left: '0px', width: `${stageW}px` },
            ],
            gesture.duration,
          ),
        )
      }
      return
    }
    for (const el of detailHosts) {
      el.style.width = `${detailW}px`
      gesture.styled.push(el)
      gesture.anims.push(
        playMorphAnim(
          el,
          kind === 'B'
            ? [
                { transform: `translateX(${detailW}px)` },
                { transform: 'translateX(0px)' },
              ]
            : [
                { transform: 'translateX(0px)' },
                { transform: `translateX(${detailW}px)` },
              ],
          gesture.duration,
        ),
      )
    }
  }, [
    layoutReady,
    narrowLayout,
    listRatio,
    frameAnimationMs,
    controller.switchPlanRef,
    controller.listPage,
  ])

  // B 型补播：武装后帧才挂载（应用自动展开），在挂载渲染的 paint 前起滑
  useLayoutEffect(() => {
    const gesture = morphRef.current
    if (!gesture || gesture.kind !== 'B' || !pendingSlideRef.current) return
    const els = framesRef.current
      .map((id) => hostElsRef.current.get(id))
      .filter((el): el is HTMLDivElement => !!el)
    if (els.length === 0) return
    pendingSlideRef.current = false
    for (const el of els) {
      el.style.width = `${gesture.detailW}px`
      gesture.styled.push(el)
      gesture.anims.push(
        playMorphAnim(
          el,
          [
            { transform: `translateX(${gesture.detailW}px)` },
            { transform: 'translateX(0px)' },
          ],
          gesture.duration,
        ),
      )
    }
    window.clearTimeout(gesture.timer)
    gesture.timer = window.setTimeout(
      () => finishMorphRef.current(),
      gesture.duration + 30,
    )
  }, [liveSig])

  // 切回子页栈：帧视图随形态一起清场（下次进分栏按状态重建）。
  // 形变进行中让路——等 morph 收尾再清。
  useLayoutEffect(() => {
    if (!narrowLayout) return
    if (morphRef.current) return
    clearWideFramesView()
  }, [narrowLayout])

  // 卸载时形变未收尾：取消动画并还原样式；顺带清掉帧转场窗口计时器
  useEffect(
    () => () => {
      finishMorphRef.current()
      window.clearTimeout(frameNavTimerRef.current)
    },
    [],
  )

  // ── 渲染 ──
  const stack = controller.stackView.stack
  const transition = controller.stackView.transition
  const morphing = controller.morphing
  const frameIdSet = new Set(frames)
  const exitingSet = new Set(exitingIds)
  // 渲染视图 = 帧（最新内容）+ 与帧不重号的退场帧（id 稳定，内容不快照）
  const viewIds = [...frames, ...exitingIds.filter((id) => !frameIdSet.has(id))]
  const active = Math.min(wideIndex, Math.max(0, viewIds.length - 1))
  const hostIds: string[] = []
  for (const id of stack) if (!hostIds.includes(id)) hostIds.push(id)
  for (const id of viewIds) if (!hostIds.includes(id)) hostIds.push(id)

  const underId =
    transition !== undefined
      ? transition.direction === 'push'
        ? transition.from
        : transition.to
      : undefined
  const overId =
    transition !== undefined
      ? transition.direction === 'push'
        ? transition.to
        : transition.from
      : undefined
  // -1 表示「这一侧没有帧」；host 不在帧序列里时 indexOf 也是 -1。匹配
  // 走 hitsNavFrameIndex（要求 fi >= 0），否则从列表点进首个子页
  // （active=0、push）时左栏会被误标成 under，拆盒后变成并排卡片。
  const { navUnder, navOver } = wideNavFrameIndices(frameNav, active)

  // host 角色。形变期（窄形态）按起始（分栏）几何画：帧保持 detail、列表
  // 保持 list，等收尾才整体换成窄屏角色——面板盖满的瞬间无缝换装。
  const roleOf = (id: string): FlatHostPos => {
    if (narrowLayout) {
      if (morphing) {
        if (id === controller.listPage) return 'list'
        if (frameIdSet.has(id)) return 'detail'
        if (stack.includes(id)) return 'under'
        return 'parked'
      }
      if (id === controller.page) return 'current'
      if (stack.includes(id)) return 'under'
      return 'parked'
    }
    if (id === controller.listPage) return 'list'
    return frameIdSet.has(id) ? 'detail' : 'parked'
  }

  const pageCtx: AdaptiveSplitNavPageContext = {
    narrowLayout,
    morphing,
    morphKind: controller.morphKind,
  }
  const styleVars = {
    '--asn-list-ratio': `${Math.round(listRatio * 10000) / 100}%`,
    '--asn-frame-ms': `${frameAnimationMs}ms`,
  } as Record<string, string>

  return (
    <div
      ref={(node) => {
        rootRef.current = node
        hostRef(node)
      }}
      class={`adaptive-split-nav adaptive-split-nav--flat${className ? ` ${className}` : ''}`}
      style={styleVars}
      data-stack-transition={transition ? transition.direction : undefined}
      data-frame-nav={frameNav}
      onAnimationEnd={(event) => {
        // 宽屏帧窗口由动画自身收口（与 PageStack 的 motion-end 契约同构）：
        // 四个 body 滑动动画同拍起跑、同拍到终点，任一到位即关窗，fill 终态
        // 与关窗后的自然态逐像素一致；计时器只兜底（reduced-motion 下动画为
        // none、animationend 永不来）。pop 的退场帧必须与关窗同一拍卸载：
        // 关窗即失参与态，slider 的 transform 过渡会从原位重新滑向 100%、
        // 整页回显一瞬才被兜底计时器摘除（闪现）；此刻退场页停在 fill 终点
        // （body 100% 离屏、header 栏 opacity 0），同拍卸载不可见。其余动画
        // 名（应用内容里的动画会冒泡上来）不收口、也不交给子页栈状态机。
        if (frameNavRef.current) {
          const name = event.animationName
          if (
            name === 'page-body-under-push' ||
            name === 'page-body-over-push' ||
            name === 'page-body-under-pop' ||
            name === 'page-body-over-pop'
          ) {
            setExitingIds([])
            closeFrameNav()
          }
          return
        }
        controller.stackView.handleMotionEnd(event)
      }}
    >
      <div class="adaptive-split-nav__stage" data-form={narrowLayout ? 'stack' : 'split'}>
        {hostIds.map((id) => {
          const exiting = !frameIdSet.has(id) && exitingSet.has(id)
          const pos: FlatHostPos = exiting ? 'detail' : roleOf(id)
          const fi = viewIds.indexOf(id)
          const isUnder =
            (transition !== undefined && id === underId) ||
            (frameNav !== undefined && hitsNavFrameIndex(fi, navUnder))
          const isOver =
            (transition !== undefined && id === overId) ||
            (frameNav !== undefined && hitsNavFrameIndex(fi, navOver))
          const cls = [
            'adaptive-split-nav__host',
            isUnder ? 'is-under' : '',
            isOver ? 'is-over' : '',
          ]
            .filter(Boolean)
            .join(' ')
          // detail 叠放位移写在 slider 上（host 盒恒钉右栏、只负责裁切）：
          // active 就位、底层 -30% 露边、待入 100%。转场窗口的参与帧不写
          // ——窗口规则把 slider 打平进 host 内网格，内联会压过 CSS；形变
          // 期 WAAPI 动 host 的 left/width，与 slider 无冲突。只有 active
          // 接交互。slider 对所有角色常驻：角色切换只改属性，内容零重挂。
          const hostStyle: { zIndex?: string } = {}
          const slideStyle: { transform?: string; pointerEvents?: string } = {}
          if (pos === 'detail') {
            if (!isUnder && !isOver) {
              slideStyle.transform =
                fi === active
                  ? 'translateX(0)'
                  : fi < active
                    ? 'translateX(-30%)'
                    : 'translateX(100%)'
              slideStyle.pointerEvents = fi === active ? 'auto' : 'none'
            }
            hostStyle.zIndex = `${10 + Math.max(fi, 0)}`
          }
          return (
            <div
              key={id}
              ref={(node: HTMLDivElement | null) => {
                if (node) hostElsRef.current.set(id, node)
                else hostElsRef.current.delete(id)
              }}
              class={cls}
              data-pos={pos}
              style={hostStyle}
              aria-hidden={
                narrowLayout && (pos === 'detail' || pos === 'parked')
                  ? true
                  : undefined
              }
            >
              <div class="adaptive-split-nav__host-slider" style={slideStyle}>
                {renderPage(id, pageCtx)}
              </div>
            </div>
          )
        })}
        {!narrowLayout && viewIds.length === 0 ? (
          <div class="adaptive-split-nav__flat-empty">
            {renderDetailEmpty ? renderDetailEmpty() : undefined}
          </div>
        ) : undefined}
        {footer ? <div class="adaptive-split-nav__flat-footer">{footer}</div> : undefined}
      </div>
    </div>
  )
}
