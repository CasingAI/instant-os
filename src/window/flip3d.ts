import type { WindowState } from '../os/types.ts'
import type { WindowBounds } from './window-metrics.ts'

/** 从 3D 叠层收回普通布局的动画时长（毫秒） */
export const FLIP3D_RESTORE_MS = 520

/** 进入叠层：从桌面位收到扇面 */
export const FLIP3D_ENTER_MS = 520

/** 绕圈那一扇真窗飞出/飞入 */
export const FLIP3D_FLIGHT_OUT_MS = 160

/** 连按时最多保留几个队尾替身，避免 DOM 堆起来拖死主线程 */
export const FLIP3D_MAX_GHOSTS = 4

/** 退出叠层落地后，桌面阴影淡入（3D 变换下 box-shadow 几乎不绘） */
export const FLIP3D_SHADOW_IN_MS = 420

export type Flip3dEnterResult = 'entered' | 'already-active' | 'empty'

/** 被掀走的真窗自己播这段位姿；队列已经换成新 rank。 */
export type Flip3dFlight = {
  id: string
  windowId: string
  direction: 1 | -1
  fromTransform: string
  toTransform: string
  fromOpacity: number
  toOpacity: number
  zIndex: number
}

/** 反向切时留在队尾的替身：真窗已经去飞入，队尾还要播退出。 */
export type Flip3dGhost = {
  id: string
  windowId: string
  direction: 1 | -1
  title: string
  bounds: WindowBounds
  chromeKind?: WindowState['chromeKind']
}

export type Flip3dVisual = {
  rank: number
  skipTransition: boolean
  /** 正向飞完落到队尾：先停在更后一层再淡入 */
  fromBack: boolean
  opacity: number
}

/** 与显示桌面 peek 相同的可见窗：未关闭、未最小化。 */
export function isFlip3dEligibleWindow(window: WindowState): boolean {
  return !window.closing && !window.minimized
}

/** 按 zIndex 从高到低；队头为最前窗。 */
export function listFlip3dWindowIds(windows: readonly WindowState[]): string[] {
  return windows
    .filter(isFlip3dEligibleWindow)
    .slice()
    .sort((left, right) => right.zIndex - left.zIndex)
    .map((window) => window.id)
}

/** `+1` 把队头移到队尾（后一层到最前）；`-1` 把队尾移到队头。 */
export function cycleFlip3dOrder(order: readonly string[], delta: 1 | -1): string[] {
  if (order.length <= 1) {
    return [...order]
  }
  if (delta === 1) {
    return [...order.slice(1), order[0]!]
  }
  return [order[order.length - 1]!, ...order.slice(0, -1)]
}

/** 正向掀走队头，反向掀走队尾。 */
export function peeledFlip3dWindowId(
  order: readonly string[],
  delta: 1 | -1,
): string | undefined {
  if (order.length <= 1) {
    return undefined
  }
  return delta === 1 ? order[0] : order[order.length - 1]
}

export function createFlip3dGhost(
  window: WindowState,
  direction: 1 | -1,
  id: string,
): Flip3dGhost {
  return {
    id,
    windowId: window.id,
    direction,
    title: window.title,
    bounds: { x: window.x, y: window.y, width: window.width, height: window.height },
    chromeKind: window.chromeKind,
  }
}

export function dismissFlip3dGhost(
  ghosts: readonly Flip3dGhost[],
  id: string,
): Flip3dGhost[] {
  return ghosts.filter((ghost) => ghost.id !== id)
}

export function appendFlip3dGhost(
  ghosts: readonly Flip3dGhost[],
  next: Flip3dGhost,
): Flip3dGhost[] {
  const stacked = [...ghosts, next]
  if (stacked.length <= FLIP3D_MAX_GHOSTS) {
    return stacked
  }
  return stacked.slice(stacked.length - FLIP3D_MAX_GHOSTS)
}

/** 点选时把目标窗抽到队头，其余相对顺序不变。 */
export function bringFlip3dWindowToFront(order: readonly string[], windowId: string): string[] {
  const index = order.indexOf(windowId)
  if (index <= 0) {
    return [...order]
  }
  return [windowId, ...order.slice(0, index), ...order.slice(index + 1)]
}

/** 退出叠层：只把选中的那扇提到队头，其余保持进入前的相对顺序。 */
export function resolveFlip3dExitOrder(
  baseOrder: readonly string[],
  selectedId: string | undefined,
): string[] {
  if (!selectedId) {
    return [...baseOrder]
  }
  return bringFlip3dWindowToFront(baseOrder, selectedId)
}

/** 叠层期间窗口开关：保住进入时的相对顺序，新窗接到队尾。 */
export function syncFlip3dBaseOrder(
  baseOrder: readonly string[],
  liveIds: ReadonlySet<string>,
): string[] {
  const kept = baseOrder.filter((id) => liveIds.has(id))
  for (const id of liveIds) {
    if (!kept.includes(id)) {
      kept.push(id)
    }
  }
  return kept
}

/** 活窗视觉位只看队列。正向绕到队尾的先停在后一层再入场；反向飞入由 Flip3dFlight 驱动。 */
export function resolveFlip3dVisual(
  order: readonly string[],
  windowId: string,
  snapIds: readonly string[] = [],
): Flip3dVisual | undefined {
  const index = order.indexOf(windowId)
  if (index < 0) {
    return undefined
  }
  const wrapping = snapIds.length === 1 && snapIds[0] === windowId
  const fromBack = wrapping && order.length > 1 && index === order.length - 1
  return {
    rank: index,
    skipTransition: snapIds.includes(windowId),
    fromBack,
    opacity: fromBack ? 0 : 1,
  }
}
