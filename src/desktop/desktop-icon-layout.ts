import type { DesktopItemId } from '../os/desktop-folder-types.ts'
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

/**
 * 拖拽预览：把拖动中的图标从原页移除，插入到目标页的目标槽位。
 * 目标页超过当前页数时视为「新建一页」，图标落在新页第一格。
 */
export function buildPreviewPages(
  pages: DesktopItemId[][],
  draggingItemId: DesktopItemId,
  targetPage: number,
  slotOnPage: number,
): DesktopItemId[][] {
  const next = pages.map((page) => page.filter((id) => id !== draggingItemId))

  const clampedPage = Math.max(0, targetPage)
  if (clampedPage >= next.length) {
    while (next.length < clampedPage) {
      next.push([])
    }
    next.push([draggingItemId])
  } else {
    const page = [...next[clampedPage]]
    const slot = Math.max(0, Math.min(slotOnPage, page.length))
    page.splice(slot, 0, draggingItemId)
    next[clampedPage] = page
  }

  while (next.length > 1 && next[next.length - 1].length === 0) {
    next.pop()
  }
  return next
}
