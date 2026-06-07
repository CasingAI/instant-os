import type { WindowBounds } from './window-metrics.ts'

const DOCK_BOTTOM_OFFSET = 14
const DOCK_ICON_CENTER_OFFSET = 48
const MINIMIZE_SCALE = 0.07

export function buildMinimizeTransform(bounds: WindowBounds): string {
  const dockCenterX = window.innerWidth / 2
  const dockCenterY = window.innerHeight - DOCK_BOTTOM_OFFSET - DOCK_ICON_CENTER_OFFSET
  const windowCenterX = bounds.x + bounds.width / 2
  const windowBottomY = bounds.y + bounds.height
  const translateX = dockCenterX - windowCenterX
  const translateY = dockCenterY - windowBottomY

  return `translate(${translateX}px, ${translateY}px) scale(${MINIMIZE_SCALE})`
}
