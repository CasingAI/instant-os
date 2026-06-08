import {
  DESKTOP_ICON_GAP_X,
  DESKTOP_ICON_GAP_Y,
  DESKTOP_ICON_HEIGHT,
  DESKTOP_ICON_WIDTH,
} from '../os/launcher-layout-storage.ts'
import type { AppId } from '../os/types.ts'

export type IconSlotPosition = {
  left: number
  top: number
}

export function getIconSlotPosition(slotIndex: number, cols: number): IconSlotPosition {
  const stepX = DESKTOP_ICON_WIDTH + DESKTOP_ICON_GAP_X
  const stepY = DESKTOP_ICON_HEIGHT + DESKTOP_ICON_GAP_Y
  const col = slotIndex % cols
  const row = Math.floor(slotIndex / cols)

  return {
    left: col * stepX,
    top: row * stepY,
  }
}

export function buildPreviewOrder(
  order: AppId[],
  draggingAppId: AppId,
  hoverIndex: number,
): AppId[] {
  const fromIndex = order.indexOf(draggingAppId)
  if (fromIndex < 0) {
    return order
  }

  const clampedHover = Math.max(0, Math.min(hoverIndex, order.length - 1))
  const next = [...order]
  const [moved] = next.splice(fromIndex, 1)
  const insertIndex = fromIndex < clampedHover ? clampedHover - 1 : clampedHover
  next.splice(insertIndex, 0, moved)
  return next
}

export function getPageSlice(order: AppId[], pageIndex: number, iconsPerPage: number): AppId[] {
  const start = pageIndex * iconsPerPage
  return order.slice(start, start + iconsPerPage)
}
