import type { AppId } from '../os/types.ts'
import { resolveEffectiveDockIconCenterYOffsetFromBottom } from './dock-layout-metrics.ts'

export type DockIconCenter = {
  x: number
  y: number
}

export function resolveDockAppIconCenter(appId: AppId): DockIconCenter | undefined {
  const dock = document.querySelector('.dock')
  if (!dock || !(dock instanceof HTMLElement) || dock.classList.contains('dock--hidden')) {
    return undefined
  }

  const item = dock.querySelector(`[data-dock-app-id="${CSS.escape(appId)}"]`)
  if (!item || !(item instanceof HTMLElement)) {
    return undefined
  }

  const icon = item.querySelector('.dock__icon')
  const target = icon instanceof HTMLElement ? icon : item
  const rect = target.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    return undefined
  }

  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  }
}

export function resolveFallbackDockIconCenter(): DockIconCenter {
  return {
    x: window.innerWidth / 2,
    y: window.innerHeight - resolveEffectiveDockIconCenterYOffsetFromBottom(),
  }
}
