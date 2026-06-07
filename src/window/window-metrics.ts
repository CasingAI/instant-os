export const STATUS_BAR_HEIGHT = 22
export const DOCK_RESERVE = 96

export type WindowBounds = {
  x: number
  y: number
  width: number
  height: number
}

export function getMaximizedBounds(): WindowBounds {
  return {
    x: 0,
    y: STATUS_BAR_HEIGHT,
    width: window.innerWidth,
    height: window.innerHeight - STATUS_BAR_HEIGHT - DOCK_RESERVE,
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
