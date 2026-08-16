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

const CROSS_PAGE_EDGE_PX = 56

export type PointerIconTarget = {
  slotOnPage: number
  targetPage: number
  /** 目标为「新建的一页」（拖到最后一页右边缘触发），图标落在新页第一格。 */
  newPage: boolean
}

export function resolvePointerIconTarget(
  clientX: number,
  clientY: number,
  pagerElement: HTMLElement,
  placementPage: number,
  pageCount: number,
  metrics: DesktopGridMetrics,
  gridPixelSize: { width: number; height: number },
  allowNewPage = false,
): PointerIconTarget {
  const pagerRect = pagerElement.getBoundingClientRect()
  const gridLeft = pagerRect.left + (pagerRect.width - gridPixelSize.width) / 2
  const gridTop = pagerRect.top + (pagerRect.height - gridPixelSize.height) / 2

  let targetPage = placementPage
  let newPage = false
  if (clientX < pagerRect.left + CROSS_PAGE_EDGE_PX && placementPage > 0) {
    targetPage = placementPage - 1
  } else if (
    clientX > pagerRect.right - CROSS_PAGE_EDGE_PX &&
    placementPage < pageCount - 1
  ) {
    targetPage = placementPage + 1
  } else if (
    allowNewPage &&
    clientX > pagerRect.right - CROSS_PAGE_EDGE_PX &&
    placementPage === pageCount - 1
  ) {
    targetPage = pageCount
    newPage = true
  }

  if (newPage) {
    return {
      slotOnPage: 0,
      targetPage,
      newPage: true,
    }
  }

  const stepX = DESKTOP_ICON_WIDTH + DESKTOP_ICON_GAP_X
  const stepY = DESKTOP_ICON_HEIGHT + DESKTOP_ICON_GAP_Y
  const offsetX = clientX - gridLeft
  const offsetY = clientY - gridTop
  const col = Math.max(
    0,
    Math.min(metrics.cols - 1, Math.floor((offsetX + stepX / 2) / stepX)),
  )
  const row = Math.max(
    0,
    Math.min(metrics.rows - 1, Math.floor((offsetY + stepY / 2) / stepY)),
  )
  const slotOnPage = row * metrics.cols + col

  return {
    slotOnPage,
    targetPage,
    newPage: false,
  }
}
