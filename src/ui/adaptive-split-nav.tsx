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
import './adaptive-split-nav.css'

/**
 * 自适应分栏导航：布局原语（类 Ant Design 抽屉/分栏）。
 * Header（返回键 / 操作区，PageHeader 套件）与全部正文内容由应用自行渲染，
 * 本组件不强加任何外壳样式——应用想写什么就写什么。
 *
 * 形态：
 * - 未开启 `split`：任何宽度都渲染为子页栈（普通页面栈布局）；
 * - 开启 `split`：宽屏左右分栏（列表 + 派生帧栈详情），窄屏自动回子页栈。
 *
 * 单一真源是应用的领域状态：子页与帧都从它派生，本组件不持有任何业务
 * 导航历史。子页栈（PageStack，壳无关）由组件接管——应用经
 * useAdaptiveSplitNav 拿到 navigate/setPageSilent 驱动，形态切回子页栈时
 * 组件会按 narrowPageForState 静默重置栈；分栏右栏帧栈纯视觉叠放（无
 * 历史，返回即改状态）：push 新帧从右滑入、pop 旧帧保帧滑出
 * frameAnimationMs 后才移除、重置/跨级跳变立即整体替换。
 */

export type AdaptiveFrameSpec = {
  /** 帧稳定性键：结构变化（push/pop/重置）按 id 序列判定 */
  id: string
  content: ComponentChildren
}

export type AdaptiveSplitNavController = {
  /** 当前是否渲染为子页栈形态（split 未开启时恒为 true） */
  narrowLayout: boolean
  /** 完成首次宽度测量（仅 split 开启时有意义） */
  layoutReady: boolean
  /** 子页栈当前页；分栏形态下是最后一次导航的残留值，勿据此渲染 */
  page: string
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
}

export function useAdaptiveSplitNav(options: {
  /** 由领域状态推导当前应处的子页 id（分栏切回子页栈时调用） */
  narrowPageForState: () => string
  /** 开启响应式分栏：宽屏左右两栏、窄屏子页栈；缺省 = 永远子页栈 */
  split?: boolean
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
    // 形态切换等窗口尺寸动画/拖拽落定后再提交，避免中途整体换形态；
    // 左右半屏吸附视为窄形态（不受宽度滞回死区影响）
    settleMs: 120,
    snapForcesNarrow: true,
  })
  // 渲染形态：未开启 split 时恒为子页栈
  const narrowLayout = !options.split || measuredNarrow

  // options 里的函数每次渲染都是新闭包，经 ref 取最新值供 effect 使用
  const forStateRef = useRef(options.narrowPageForState)
  forStateRef.current = options.narrowPageForState
  const onSwitchRef = useRef(options.onLayoutChange)
  onSwitchRef.current = options.onLayoutChange

  const [initialPage] = useState(options.narrowPageForState)

  const { setPage: setPageSilent, ...stack } = usePageStack<string>(initialPage)

  // 形态切换编排：分栏→子页栈时按领域状态静默重置页面栈（不播动画）；
  // 子页栈→分栏时右栏帧栈由领域状态派生，无需恢复任何栈状态
  const prevFormRef = useRef<boolean | undefined>(undefined)
  useLayoutEffect(() => {
    if (!layoutReady) return
    const previous = prevFormRef.current
    prevFormRef.current = narrowLayout
    if (previous === undefined || previous === narrowLayout) return
    if (narrowLayout) {
      setPageSilent(forStateRef.current())
    }
    onSwitchRef.current?.(narrowLayout)
  }, [layoutReady, narrowLayout, setPageSilent])

  return useMemo(
    () => ({
      narrowLayout,
      layoutReady,
      page: stack.page,
      hostRef,
      navigate: (page, direction, onSettled) => {
        if (!narrowLayout) {
          onSettled?.()
          return
        }
        stack.navigate(page, direction, onSettled)
      },
      setPageSilent,
      stackView: {
        stack: stack.stack,
        transition: stack.transition,
        handleMotionEnd: stack.handleMotionEnd,
      },
    }),
    [
      hostRef,
      narrowLayout,
      layoutReady,
      stack.page,
      stack.navigate,
      setPageSilent,
      stack.stack,
      stack.transition,
      stack.handleMotionEnd,
    ],
  )
}

export type AdaptiveSplitNavProps = {
  controller: AdaptiveSplitNavController
  /** 子页栈：渲染某个页，内容与外壳完全由应用定义 */
  renderNarrowPage: (page: string) => ComponentChildren
  /** 分栏左栏内容，应用全权定义 */
  renderList: () => ComponentChildren
  /**
   * 分栏右栏帧序列，从与子页同一份领域状态派生；顺序 = 叠放次序（末位最上）。
   * 每次渲染都会调用，活帧内容始终取最新（空数组表示详情区无内容）。
   */
  renderWideFrames: () => AdaptiveFrameSpec[]
  /** 帧栈全量重置键：变化时立即整体替换帧（不播动画），如选中条目身份切换 */
  framesResetKey?: string
  /** 附加条（应用自定内容）：分栏时在右栏底部、子页栈时在栈下方 */
  footer?: ComponentChildren
  /** 分栏帧序列为空时的占位，应用全权定义；缺省渲染中性空白 */
  renderDetailEmpty?: () => ComponentChildren
  /** 左栏最小宽（px），默认 240 */
  listMinWidth?: number
  /** 左栏占分栏总宽比例（0~1），默认 0.38 */
  listRatio?: number
  /** 分栏帧动画时长（ms），默认 380 */
  frameAnimationMs?: number
  class?: string
}

const DEFAULT_LIST_MIN = 240
const DEFAULT_LIST_RATIO = 0.38
const DEFAULT_FRAME_MS = 380

export function AdaptiveSplitNav(props: AdaptiveSplitNavProps) {
  const {
    controller,
    renderNarrowPage,
    renderList,
    renderWideFrames,
    framesResetKey = '',
    footer,
    renderDetailEmpty,
    listMinWidth = DEFAULT_LIST_MIN,
    listRatio = DEFAULT_LIST_RATIO,
    frameAnimationMs = DEFAULT_FRAME_MS,
    class: className,
  } = props
  const { narrowLayout, hostRef } = controller

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

  // 切回子页栈：帧栈是纯视觉层，随形态一起清场（下次进分栏按状态重建）
  useLayoutEffect(() => {
    if (!narrowLayout) return
    setExiting([])
    prevLiveLenRef.current = 0
    setWideIndex(0)
  }, [narrowLayout])

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
  // 让它从右侧滑入（挂载与动画分两帧，否则首帧就是终点、没有动画）
  useEffect(() => {
    if (narrowLayout) return
    if (liveFramesRef.current.length > prevLiveLenRef.current) {
      prevLiveLenRef.current = liveFramesRef.current.length
      setWideIndex(liveFramesRef.current.length - 1)
    }
  }, [liveSig, narrowLayout])

  useLayoutEffect(() => {
    lastViewRef.current = [...liveFramesRef.current, ...exitingRef.current]
  })

  // 渲染视图 = 活帧（最新内容）+ 与活帧不重号的退场帧（定格内容）
  const liveIds = new Set(liveFrames.map((frame) => frame.id))
  const view =
    exiting.length > 0
      ? [...liveFrames, ...exiting.filter((frame) => !liveIds.has(frame.id))]
      : liveFrames
  const active = Math.min(wideIndex, Math.max(0, view.length - 1))

  const styleVars = {
    '--asn-list-min': `${listMinWidth}px`,
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
    return (
      <div class="adaptive-split-nav__frames">
        {view.map((frame, index) => (
          <div
            key={frame.id}
            class={`adaptive-split-nav__frame${index === active ? ' is-active' : ''}`}
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
      ref={hostRef}
      class={`adaptive-split-nav ${narrowLayout ? 'adaptive-split-nav--stack' : 'adaptive-split-nav--split'}${className ? ` ${className}` : ''}`}
      style={styleVars}
    >
      {narrowLayout ? (
        <div
          key="stack"
          class="adaptive-split-nav__form adaptive-split-nav__form--from-left"
        >
          <PageStack
            stack={controller.stackView.stack}
            page={controller.page}
            transition={controller.stackView.transition}
            onMotionEnd={controller.stackView.handleMotionEnd}
            renderPage={renderNarrowPage}
          />
          {footer ? <div class="adaptive-split-nav__footer">{footer}</div> : undefined}
        </div>
      ) : (
        <div
          key="split"
          class="adaptive-split-nav__form adaptive-split-nav__form--from-right"
        >
          <div class="adaptive-split-nav__split">
            <div class="adaptive-split-nav__list-pane">{renderList()}</div>
            <div class="adaptive-split-nav__detail-pane">
              {renderFramesStack()}
              {footer ? <div class="adaptive-split-nav__footer">{footer}</div> : undefined}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
