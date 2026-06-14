import type { DesktopItemId } from '../os/desktop-folder-types.ts'
import { moveDesktopItemInOrder } from '../os/desktop-folder-operations.ts'
import {
  DESKTOP_ICON_GAP_X,
  DESKTOP_ICON_GAP_Y,
  DESKTOP_ICON_HEIGHT,
  DESKTOP_ICON_WIDTH,
} from '../os/launcher-layout-storage.ts'

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
  order: DesktopItemId[],
  draggingItemId: DesktopItemId,
  hoverIndex: number,
): DesktopItemId[] {
  const fromIndex = order.indexOf(draggingItemId)
  if (fromIndex < 0) {
    return order
  }

  const toIndex = Math.max(0, Math.min(hoverIndex, order.length - 1))
  return moveDesktopItemInOrder(order, fromIndex, toIndex)
}

export function getPageSlice(order: DesktopItemId[], pageIndex: number, iconsPerPage: number): DesktopItemId[] {
  const start = pageIndex * iconsPerPage
  return order.slice(start, start + iconsPerPage)
}
