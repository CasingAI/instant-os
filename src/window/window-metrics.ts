import { resolveDockReservePx } from '../dock/dock-settings-storage.ts'

export const STATUS_BAR_HEIGHT = 22
export const TITLEBAR_HEIGHT = 34
export const IMMERSIVE_FRAME_CHROME_TOP = STATUS_BAR_HEIGHT + TITLEBAR_HEIGHT
export const FULLSCREEN_CHROME_TOP_TRIGGER_PX = 5
/** Tall enough that fast pointer flicks still cross this band below chrome. */
export const FULLSCREEN_CHROME_DISMISS_CATCHER_PX = 48

export type WindowBounds = {
  x: number
  y: number
  width: number
  height: number
}

export function getMaximizedBounds(): WindowBounds {
  const dockReserve = resolveDockReservePx()
  return {
    x: 0,
    y: STATUS_BAR_HEIGHT,
    width: window.innerWidth,
    height: window.innerHeight - STATUS_BAR_HEIGHT - dockReserve,
  }
}

export function getFullscreenBounds(): WindowBounds {
  return {
    x: 0,
    y: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  }
}
