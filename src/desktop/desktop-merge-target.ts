import type { DesktopGridMetrics } from './desktop-grid-layout.ts'
import {
  DESKTOP_ICON_HEIGHT,
  DESKTOP_ICON_WIDTH,
} from '../os/launcher-layout-storage.ts'
import type { DesktopItemId } from '../os/desktop-folder-types.ts'
import { getIconSlotPosition } from './desktop-icon-layout.ts'

export function resolveMergeTargetItem(
  clientX: number,
  clientY: number,
  pagerElement: HTMLElement,
  pageIndex: number,
  pagerWidth: number,
  metrics: DesktopGridMetrics,
  gridPixelSize: { width: number; height: number },
  pages: DesktopItemId[][],
  draggingItemId: DesktopItemId,
): DesktopItemId | undefined {
  const pagerRect = pagerElement.getBoundingClientRect()
  const pageOffsetX = pagerRect.left + pageIndex * pagerWidth
  const gridLeft = pageOffsetX + (pagerWidth - gridPixelSize.width) / 2
  const gridTop = pagerRect.top + (pagerRect.height - gridPixelSize.height) / 2

  const pageItems = pages[pageIndex] ?? []

  for (let slotOnPage = 0; slotOnPage < pageItems.length; slotOnPage += 1) {
    const itemId = pageItems[slotOnPage]
    if (itemId === draggingItemId) {
      continue
    }

    const slotPosition = getIconSlotPosition(slotOnPage, metrics.cols)
    const iconLeft = gridLeft + slotPosition.left
    const iconTop = gridTop + slotPosition.top

    if (
      clientX >= iconLeft &&
      clientX <= iconLeft + DESKTOP_ICON_WIDTH &&
      clientY >= iconTop &&
      clientY <= iconTop + DESKTOP_ICON_HEIGHT
    ) {
      return itemId
    }
  }

  return undefined
}
