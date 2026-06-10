import { getMaximizedBounds, STATUS_BAR_HEIGHT, type WindowBounds } from './window-metrics.ts'

export const SNAP_THRESHOLD = 16

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
  const work = getMaximizedBounds()
  const width = Math.min(window.width, work.width)
  const height = Math.min(window.height, work.height)
  const y = Math.max(work.y, Math.min(window.y, work.y + work.height - height))

  if (window.snap === 'left') {
    return { x: work.x, y, width, height }
  }
  if (window.snap === 'right') {
    return { x: work.x + work.width - width, y, width, height }
  }

  return { x: window.x, y, width, height }
}

export function detectSnapTarget(clientX: number, clientY: number): SnapTarget | undefined {
  if (clientY <= STATUS_BAR_HEIGHT + SNAP_THRESHOLD) return 'top'
  if (clientX <= SNAP_THRESHOLD) return 'left'
  if (clientX >= window.innerWidth - SNAP_THRESHOLD) return 'right'
  return undefined
}

export function clampFloatingPosition(x: number, y: number, width: number) {
  const minVisible = 48
  const maxX = window.innerWidth - minVisible
  const maxY = window.innerHeight - minVisible
  const minX = minVisible - width
  const minY = STATUS_BAR_HEIGHT

  return {
    x: Math.max(minX, Math.min(x, maxX)),
    y: Math.max(minY, Math.min(y, maxY)),
  }
}
