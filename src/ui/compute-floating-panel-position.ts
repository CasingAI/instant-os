export type FloatingPanelPosition = {
  top: number
  left: number
  /** 面板最终落在锚点下方还是上方（放不下上方时仍按 below 夹紧） */
  placement: 'below' | 'above'
}

export const FLOATING_PANEL_GAP = 6
export const FLOATING_PANEL_VIEWPORT_PADDING = 8

export function resolveFloatingPanelWidth(preferredWidth: number): number {
  return Math.min(preferredWidth, window.innerWidth - FLOATING_PANEL_VIEWPORT_PADDING * 2)
}

export function computeFloatingPanelPosition(
  anchor: DOMRect,
  panelWidth: number,
  panelHeight: number,
  align: 'left' | 'right' = 'left',
): FloatingPanelPosition {
  const padding = FLOATING_PANEL_VIEWPORT_PADDING
  const maxLeft = window.innerWidth - panelWidth - padding
  const maxTop = window.innerHeight - panelHeight - padding

  let top = anchor.bottom + FLOATING_PANEL_GAP
  let left = align === 'right' ? anchor.right - panelWidth : anchor.left
  let placement: 'below' | 'above' = 'below'

  if (top > maxTop) {
    const aboveTop = anchor.top - panelHeight - FLOATING_PANEL_GAP
    if (aboveTop >= padding) {
      top = aboveTop
      placement = 'above'
    } else {
      top = Math.max(padding, maxTop)
    }
  }

  left = Math.min(Math.max(left, padding), Math.max(padding, maxLeft))
  top = Math.min(Math.max(top, padding), Math.max(padding, maxTop))

  return { top, left, placement }
}
