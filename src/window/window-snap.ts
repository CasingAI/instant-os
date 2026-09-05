import { getMaximizedBounds, STATUS_BAR_HEIGHT, type WindowBounds } from './window-metrics.ts'
import { clampFloatingSize } from './window-resize.ts'

export const SNAP_THRESHOLD = 16
export const NARROW_WORK_AREA_WIDTH = 520

export type SnapTarget = 'left' | 'right' | 'top'

export { STATUS_BAR_HEIGHT }

export function getLeftSnapBounds(): WindowBounds {
  const work = getMaximizedBounds()
  const width = Math.floor(work.width / 2)

  return {
    x: work.x,
    y: work.y,
    width,
    height: work.height,
  }
}

export function getRightSnapBounds(): WindowBounds {
  const work = getMaximizedBounds()
  const leftWidth = Math.floor(work.width / 2)

  return {
    x: work.x + leftWidth,
    y: work.y,
    width: work.width - leftWidth,
    height: work.height,
  }
}

export function getSnapBounds(target: SnapTarget): WindowBounds {
  if (target === 'left') return getLeftSnapBounds()
  if (target === 'right') return getRightSnapBounds()
  return getMaximizedBounds()
}

export function reanchorSnappedWindow(window: WindowBounds & { snap?: 'left' | 'right' }): WindowBounds {
  if (window.snap === 'left' || window.snap === 'right') {
    return getSnapBounds(window.snap)
  }

  const work = getMaximizedBounds()
  const width = Math.min(window.width, work.width)
  const height = Math.min(window.height, work.height)
  const y = Math.max(work.y, Math.min(window.y, work.y + work.height - height))

  return { x: window.x, y, width, height }
}

export function detectSnapTarget(clientX: number, clientY: number): SnapTarget | undefined {
  if (clientY <= STATUS_BAR_HEIGHT + SNAP_THRESHOLD) return 'top'
  if (clientX <= SNAP_THRESHOLD) return 'left'
  if (clientX >= window.innerWidth - SNAP_THRESHOLD) return 'right'
  return undefined
}

export function isNarrowWorkArea(): boolean {
  return getMaximizedBounds().width < NARROW_WORK_AREA_WIDTH
}

export function fitFloatingWindowBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  options?: { minWidth?: number; minHeight?: number },
): WindowBounds {
  const work = getMaximizedBounds()
  const size = clampFloatingSize(width, height, options)
  let nextX = x
  let nextY = y

  if (nextX + size.width > work.x + work.width) {
    nextX = work.x + work.width - size.width
  }
  if (nextY + size.height > work.y + work.height) {
    nextY = work.y + work.height - size.height
  }
  if (nextX < work.x) {
    nextX = work.x
  }
  if (nextY < work.y) {
    nextY = work.y
  }

  return { x: nextX, y: nextY, width: size.width, height: size.height }
}

export function clampFloatingPosition(x: number, y: number, width: number, height: number) {
  // 拖拽/弹窗落点一律把整窗收进工作区：窗口悬出工作区（Dock 带以下/屏外）时，
  // 盖满窗口的 HUD 等遮罩会把盒子落进不可见区，看起来像渲染越界
  const fitted = fitFloatingWindowBounds(x, y, width, height)
  return { x: fitted.x, y: fitted.y }
}
