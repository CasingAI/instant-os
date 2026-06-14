import type { AppId } from '../os/types.ts'

export const FOLDER_OVERLAY_COLS = 4
export const FOLDER_OVERLAY_CELL_WIDTH = 80
export const FOLDER_OVERLAY_COLUMN_GAP = 12
export const FOLDER_OVERLAY_ROW_GAP = 20
export const FOLDER_OVERLAY_ICON_SIZE = 64
export const FOLDER_OVERLAY_LABEL_GAP = 6
export const FOLDER_OVERLAY_LABEL_HEIGHT = 15

export const FOLDER_OVERLAY_CELL_HEIGHT =
  FOLDER_OVERLAY_ICON_SIZE + FOLDER_OVERLAY_LABEL_GAP + FOLDER_OVERLAY_LABEL_HEIGHT

export function moveFolderAppInOrder(
  appIds: AppId[],
  fromIndex: number,
  toIndex: number,
): AppId[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= appIds.length ||
    toIndex >= appIds.length ||
    fromIndex === toIndex
  ) {
    return appIds
  }

  const next: AppId[] = [...appIds]
  const [moved] = next.splice(fromIndex, 1)
  if (!moved) {
    return appIds
  }
  next.splice(toIndex, 0, moved)
  return next
}

export function buildFolderPreviewOrder(
  appIds: AppId[],
  draggingAppId: AppId,
  hoverIndex: number,
): AppId[] {
  const fromIndex = appIds.indexOf(draggingAppId)
  if (fromIndex < 0) {
    return appIds
  }

  const toIndex = Math.max(0, Math.min(hoverIndex, appIds.length - 1))
  return moveFolderAppInOrder(appIds, fromIndex, toIndex)
}

export function resolveFolderGridHoverIndex(
  clientX: number,
  clientY: number,
  gridEl: HTMLElement,
  appCount: number,
): number {
  if (appCount <= 0) {
    return 0
  }

  const rect = gridEl.getBoundingClientRect()
  const style = getComputedStyle(gridEl)
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0
  const paddingTop = Number.parseFloat(style.paddingTop) || 0

  const x = clientX - rect.left - paddingLeft
  const y = clientY - rect.top - paddingTop

  const colStride = FOLDER_OVERLAY_CELL_WIDTH + FOLDER_OVERLAY_COLUMN_GAP
  const rowStride = FOLDER_OVERLAY_CELL_HEIGHT + FOLDER_OVERLAY_ROW_GAP

  const col = Math.max(0, Math.min(FOLDER_OVERLAY_COLS - 1, Math.floor(x / colStride)))
  const row = Math.max(0, Math.floor(y / rowStride))
  const index = row * FOLDER_OVERLAY_COLS + col

  return Math.max(0, Math.min(index, appCount - 1))
}

export function isPointerOutsideElement(clientX: number, clientY: number, element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  return (
    clientX < rect.left ||
    clientX > rect.right ||
    clientY < rect.top ||
    clientY > rect.bottom
  )
}
