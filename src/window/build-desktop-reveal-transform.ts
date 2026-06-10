import type { WindowBounds } from './window-metrics.ts'

/** 滑出后仍留在屏幕内的边缘宽度，与 macOS Show Desktop 一致 */
export const DESKTOP_REVEAL_EDGE_PEEK = 10

/** 屏幕边缘可点击热区（略大于可见条，便于点中） */
export const DESKTOP_REVEAL_PEEK_HIT = 16

export type DesktopPeekScreenBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type DesktopRevealEdge = 'left' | 'right' | 'top' | 'bottom'

export function getDesktopRevealEdge(bounds: WindowBounds): DesktopRevealEdge {
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  const distLeft = centerX
  const distRight = window.innerWidth - centerX
  const distTop = centerY
  const distBottom = window.innerHeight - centerY

  const minDist = Math.min(distLeft, distRight, distTop, distBottom)

  if (minDist === distLeft) {
    return 'left'
  }
  if (minDist === distRight) {
    return 'right'
  }
  if (minDist === distTop) {
    return 'top'
  }
  return 'bottom'
}

export function buildDesktopRevealTransform(bounds: WindowBounds): string {
  const edge = getDesktopRevealEdge(bounds)
  const peek = DESKTOP_REVEAL_EDGE_PEEK

  if (edge === 'left') {
    return `translate(${-bounds.x - bounds.width + peek}px, 0)`
  }
  if (edge === 'right') {
    return `translate(${window.innerWidth - bounds.x - peek}px, 0)`
  }
  if (edge === 'top') {
    return `translate(0, ${-bounds.y - bounds.height + peek}px)`
  }
  return `translate(0, ${window.innerHeight - bounds.y - peek}px)`
}

export function getDesktopPeekScreenBounds(
  bounds: WindowBounds,
  edge: DesktopRevealEdge,
): DesktopPeekScreenBounds {
  const hit = DESKTOP_REVEAL_PEEK_HIT
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const windowTop = bounds.y
  const windowBottom = bounds.y + bounds.height
  const windowLeft = bounds.x
  const windowRight = bounds.x + bounds.width

  if (edge === 'left') {
    const y = Math.max(0, windowTop)
    const bottom = Math.min(viewportHeight, windowBottom)
    return { x: 0, y, width: hit, height: Math.max(0, bottom - y) }
  }
  if (edge === 'right') {
    const y = Math.max(0, windowTop)
    const bottom = Math.min(viewportHeight, windowBottom)
    return { x: viewportWidth - hit, y, width: hit, height: Math.max(0, bottom - y) }
  }
  if (edge === 'top') {
    const x = Math.max(0, windowLeft)
    const right = Math.min(viewportWidth, windowRight)
    return { x, y: 0, width: Math.max(0, right - x), height: hit }
  }
  const x = Math.max(0, windowLeft)
  const right = Math.min(viewportWidth, windowRight)
  return { x, y: viewportHeight - hit, width: Math.max(0, right - x), height: hit }
}
