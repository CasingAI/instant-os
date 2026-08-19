import type { WindowState } from '../os/types.ts'

/** 从 3D 叠层收回普通布局的动画时长（毫秒） */
export const FLIP3D_RESTORE_MS = 360

/** 进入叠层：从桌面位收到扇面 */
export const FLIP3D_ENTER_MS = 520

/** 前窗飞出到右侧并淡出 */
export const FLIP3D_FLIGHT_OUT_MS = 160

/** 接到队尾后淡入 */
export const FLIP3D_FLIGHT_IN_MS = 110

/** 点选非最前窗：先滑到队头再退出 */
export const FLIP3D_SELECT_MS = 160

export type Flip3dEnterResult = 'entered' | 'already-active' | 'empty'

export type Flip3dCycle = {
  flyingId: string
  direction: 1 | -1
  phase: 'out' | 'teleport' | 'in' | 'snap'
}

export type Flip3dVisual = {
  rank: number
  flyOut: boolean
  opacity: number
  skipTransition: boolean
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

/** 打断进行中的飞出时，把尚未写入队列的那一步立刻落地。 */
export function commitFlip3dCycle(
  order: readonly string[],
  cycle: Flip3dCycle | undefined,
): string[] {
  if (!cycle) {
    return [...order]
  }
  if (cycle.direction === 1 && cycle.phase === 'out') {
    return cycleFlip3dOrder(order, 1)
  }
  if (cycle.direction === -1 && cycle.phase === 'teleport') {
    return cycleFlip3dOrder(order, -1)
  }
  return [...order]
}

/** 点选时把目标窗抽到队头，其余相对顺序不变。 */
export function bringFlip3dWindowToFront(order: readonly string[], windowId: string): string[] {
  const index = order.indexOf(windowId)
  if (index <= 0) {
    return [...order]
  }
  return [windowId, ...order.slice(0, index), ...order.slice(index + 1)]
}

/** 把逻辑队列与飞出动画合成每扇窗的视觉位。 */
export function resolveFlip3dVisual(
  order: readonly string[],
  windowId: string,
  cycle: Flip3dCycle | undefined,
): Flip3dVisual | undefined {
  const index = order.indexOf(windowId)
  if (index < 0) {
    return undefined
  }

  if (!cycle) {
    return { rank: index, flyOut: false, opacity: 1, skipTransition: false }
  }

  if (cycle.phase === 'snap') {
    return { rank: index, flyOut: false, opacity: 1, skipTransition: true }
  }

  const isFlying = windowId === cycle.flyingId

  if (cycle.direction === 1) {
    if (cycle.phase === 'out') {
      if (isFlying) {
        return { rank: 0, flyOut: true, opacity: 0, skipTransition: false }
      }
      return { rank: index - 1, flyOut: false, opacity: 1, skipTransition: false }
    }
    if (cycle.phase === 'teleport') {
      if (isFlying) {
        return { rank: index, flyOut: false, opacity: 0, skipTransition: true }
      }
      return { rank: index, flyOut: false, opacity: 1, skipTransition: true }
    }
    return { rank: index, flyOut: false, opacity: 1, skipTransition: false }
  }

  if (cycle.phase === 'teleport') {
    if (isFlying) {
      return { rank: index, flyOut: true, opacity: 0, skipTransition: true }
    }
    return { rank: index, flyOut: false, opacity: 1, skipTransition: false }
  }
  if (cycle.phase === 'out') {
    if (isFlying) {
      return { rank: 0, flyOut: true, opacity: 0, skipTransition: true }
    }
    return { rank: index, flyOut: false, opacity: 1, skipTransition: false }
  }
  if (isFlying) {
    return { rank: 0, flyOut: false, opacity: 1, skipTransition: false }
  }
  return { rank: index, flyOut: false, opacity: 1, skipTransition: false }
}
