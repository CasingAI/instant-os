import {
  DESKTOP_ICON_GAP_X,
  DESKTOP_ICON_GAP_Y,
  DESKTOP_ICON_HEIGHT,
  DESKTOP_ICON_WIDTH,
} from '../os/launcher-layout-storage.ts'

export type DesktopGridMetrics = {
  cols: number
  rows: number
  iconsPerPage: number
}

export function computeDesktopGridMetrics(width: number, height: number): DesktopGridMetrics {
  const stepX = DESKTOP_ICON_WIDTH + DESKTOP_ICON_GAP_X
  const stepY = DESKTOP_ICON_HEIGHT + DESKTOP_ICON_GAP_Y
  const cols = Math.max(1, Math.floor(width / stepX))
  const rows = Math.max(1, Math.floor(height / stepY))

  return {
    cols,
    rows,
    iconsPerPage: cols * rows,
  }
}

export function computeDesktopGridPixelSize(cols: number, rows: number) {
  return {
    width: cols * DESKTOP_ICON_WIDTH + Math.max(0, cols - 1) * DESKTOP_ICON_GAP_X,
    height: rows * DESKTOP_ICON_HEIGHT + Math.max(0, rows - 1) * DESKTOP_ICON_GAP_Y,
  }
}

export function pointerToGlobalIconIndex(
  clientX: number,
  clientY: number,
  gridElement: HTMLElement,
  pageIndex: number,
  metrics: DesktopGridMetrics,
  totalIcons: number,
): number {
  const rect = gridElement.getBoundingClientRect()
  const stepX = DESKTOP_ICON_WIDTH + DESKTOP_ICON_GAP_X
  const stepY = DESKTOP_ICON_HEIGHT + DESKTOP_ICON_GAP_Y
  const offsetX = clientX - rect.left
  const offsetY = clientY - rect.top
  const col = Math.max(0, Math.min(metrics.cols - 1, Math.floor(offsetX / stepX)))
  const row = Math.max(0, Math.min(metrics.rows - 1, Math.floor(offsetY / stepY)))
  const slotOnPage = row * metrics.cols + col
  const globalIndex = pageIndex * metrics.iconsPerPage + slotOnPage

  return Math.max(0, Math.min(globalIndex, Math.max(0, totalIcons - 1)))
}

export function chunkDesktopPages<T>(items: T[], pageSize: number): T[][] {
  if (items.length === 0) {
    return [[]]
  }

  if (pageSize <= 0) {
    return [items]
  }

  const pages: T[][] = []
  for (let index = 0; index < items.length; index += pageSize) {
    pages.push(items.slice(index, index + pageSize))
  }
  return pages
}
