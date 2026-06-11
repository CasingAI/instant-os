import { resolveEffectiveDockIconCenterYOffsetFromBottom } from '../dock/dock-layout-metrics.ts'
import type { WindowBounds } from './window-metrics.ts'

const MINIMIZE_SCALE = 0.07

export function buildMinimizeTransform(bounds: WindowBounds): string {
  const dockCenterX = window.innerWidth / 2
  const dockCenterY = window.innerHeight - resolveEffectiveDockIconCenterYOffsetFromBottom()
  const windowCenterX = bounds.x + bounds.width / 2
  const windowBottomY = bounds.y + bounds.height
  const translateX = dockCenterX - windowCenterX
  const translateY = dockCenterY - windowBottomY

  return `translate(${translateX}px, ${translateY}px) scale(${MINIMIZE_SCALE})`
}
