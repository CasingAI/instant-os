import {
  DESKTOP_ICON_GAP_X,
  DESKTOP_ICON_GAP_Y,
  DESKTOP_ICON_HEIGHT,
  DESKTOP_ICON_WIDTH,
  moveDesktopIconInOrder,
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

  const toIndex = Math.max(0, Math.min(hoverIndex, order.length - 1))
  return moveDesktopIconInOrder(order, fromIndex, toIndex)
}

export function getPageSlice(order: AppId[], pageIndex: number, iconsPerPage: number): AppId[] {
  const start = pageIndex * iconsPerPage
  return order.slice(start, start + iconsPerPage)
}
