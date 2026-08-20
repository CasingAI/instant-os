import type { WindowState } from '../os/types.ts'
import type { WindowBounds } from './window-metrics.ts'

/** 从 3D 叠层收回普通布局的动画时长（毫秒） */
export const FLIP3D_RESTORE_MS = 360

/** 进入叠层：从桌面位收到扇面 */
export const FLIP3D_ENTER_MS = 520

/** 假窗窗框飞出/飞入 */
export const FLIP3D_FLIGHT_OUT_MS = 160

/** 连按时最多保留几个假窗，避免 DOM 堆起来拖死主线程 */
export const FLIP3D_MAX_GHOSTS = 4

/** 点选非最前窗：先滑到队头再退出 */
export const FLIP3D_SELECT_MS = 160

export type Flip3dEnterResult = 'entered' | 'already-active' | 'empty'

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
  /** 绕到队尾的那一帧：先停在更后一层再淡入，避免硬切出现 */
  fromBack: boolean
  opacity: number
}

/** 与显示桌面 peek 相同的可见窗：未关闭、未最小化；无窗口会话仅展开面板时计入。 */
export function isFlip3dEligibleWindow(window: WindowState): boolean {
  if (window.closing || window.minimized) {
    return false
  }
  if (window.windowless && !window.windowlessPanel) {
    return false
  }
  return true
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

/** 活窗视觉位只看队列。绕到队尾的那扇先停在后一层再入场，其余滑过去。 */
export function resolveFlip3dVisual(
  order: readonly string[],
  windowId: string,
  snapIds: readonly string[] = [],
): Flip3dVisual | undefined {
  const index = order.indexOf(windowId)
  if (index < 0) {
    return undefined
  }
  const wrapping = snapIds.includes(windowId)
  const fromBack = wrapping && order.length > 1 && index === order.length - 1
  return {
    rank: index,
    skipTransition: wrapping,
    fromBack,
    opacity: fromBack ? 0 : 1,
  }
}
