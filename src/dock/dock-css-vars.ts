const DOCK_RESERVE_FALLBACK_PX = 80

/** 读取当前已应用到 :root 的 Dock 底部预留高度（px），供 fixed 定位浮层避让。 */
export function readAppliedDockReservePx(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--dock-reserve').trim()
  if (!raw) {
    return DOCK_RESERVE_FALLBACK_PX
  }
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : DOCK_RESERVE_FALLBACK_PX
}
