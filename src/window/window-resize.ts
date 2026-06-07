import { getMaximizedBounds, type WindowBounds } from './window-metrics.ts'

export const MIN_WINDOW_WIDTH = 280
export const MIN_WINDOW_HEIGHT = 160
export const RESIZE_HANDLE_SIZE = 6

export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const RESIZE_DIRECTIONS: ResizeDirection[] = [
  'n',
  's',
  'e',
  'w',
  'ne',
  'nw',
  'se',
  'sw',
]

export function getResizeCursor(direction: ResizeDirection): string {
  const cursors: Record<ResizeDirection, string> = {
    n: 'n-resize',
    s: 's-resize',
    e: 'e-resize',
    w: 'w-resize',
    ne: 'ne-resize',
    nw: 'nw-resize',
    se: 'se-resize',
    sw: 'sw-resize',
  }
  return cursors[direction]
}

export function computeEdgeExtremeBounds(
  current: WindowBounds,
  direction: ResizeDirection,
): WindowBounds {
  const work = getMaximizedBounds()
  let { x, y, width, height } = current

  if (direction.includes('n')) {
    const bottom = y + height
    y = work.y
    height = bottom - work.y
  }
  if (direction.includes('s')) {
    height = work.y + work.height - y
  }
  if (direction.includes('w')) {
    const right = x + width
    x = work.x
    width = right - work.x
  }
  if (direction.includes('e')) {
    width = work.x + work.width - x
  }

  width = Math.max(MIN_WINDOW_WIDTH, width)
  height = Math.max(MIN_WINDOW_HEIGHT, height)

  if (x + width > work.x + work.width) {
    x = work.x + work.width - width
  }
  if (y + height > work.y + work.height) {
    y = work.y + work.height - height
  }
  if (x < work.x) x = work.x
  if (y < work.y) y = work.y

  return { x, y, width, height }
}

export function clampFloatingSize(width: number, height: number): Pick<WindowBounds, 'width' | 'height'> {
  const work = getMaximizedBounds()
  return {
    width: Math.max(MIN_WINDOW_WIDTH, Math.min(width, work.width)),
    height: Math.max(MIN_WINDOW_HEIGHT, Math.min(height, work.height)),
  }
}

export function computeResizedBounds(
  startBounds: WindowBounds,
  direction: ResizeDirection,
  deltaX: number,
  deltaY: number,
): WindowBounds {
  let { x, y, width, height } = startBounds
  const work = getMaximizedBounds()

  if (direction.includes('e')) {
    width = startBounds.width + deltaX
  }
  if (direction.includes('w')) {
    width = startBounds.width - deltaX
    x = startBounds.x + deltaX
  }
  if (direction.includes('s')) {
    height = startBounds.height + deltaY
  }
  if (direction.includes('n')) {
    height = startBounds.height - deltaY
    y = startBounds.y + deltaY
  }

  if (width < MIN_WINDOW_WIDTH) {
    if (direction.includes('w')) {
      x = startBounds.x + startBounds.width - MIN_WINDOW_WIDTH
    }
    width = MIN_WINDOW_WIDTH
  }

  if (height < MIN_WINDOW_HEIGHT) {
    if (direction.includes('n')) {
      y = startBounds.y + startBounds.height - MIN_WINDOW_HEIGHT
    }
    height = MIN_WINDOW_HEIGHT
  }

  if (x < work.x) {
    width -= work.x - x
    x = work.x
  }
  if (y < work.y) {
    height -= work.y - y
    y = work.y
  }
  if (x + width > work.x + work.width) {
    width = work.x + work.width - x
  }
  if (y + height > work.y + work.height) {
    height = work.y + work.height - y
  }

  width = Math.max(MIN_WINDOW_WIDTH, width)
  height = Math.max(MIN_WINDOW_HEIGHT, height)

  return { x, y, width, height }
}
