import {
  resolveDockAppIconCenter,
  resolveFallbackDockIconCenter,
} from '../dock/resolve-dock-app-icon-center.ts'
import type { AppId } from '../os/types.ts'
import type { WindowBounds } from './window-metrics.ts'

const MINIMIZE_SCALE = 0.07

export function buildMinimizeTransform(bounds: WindowBounds, appId: AppId): string {
  const dockCenter = resolveDockAppIconCenter(appId) ?? resolveFallbackDockIconCenter()
  const windowCenterX = bounds.x + bounds.width / 2
  const windowBottomY = bounds.y + bounds.height
  const translateX = dockCenter.x - windowCenterX
  const translateY = dockCenter.y - windowBottomY

  return `translate(${translateX}px, ${translateY}px) scale(${MINIMIZE_SCALE})`
}
