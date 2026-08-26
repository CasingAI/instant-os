/** Files 操作迷你窗的尺寸与位置计算（纯函数，可单测）。 */

export const FILES_OP_WINDOW_WIDTH = 340
export const FILES_OP_WINDOW_HEIGHT = 118
export const FILES_OP_WINDOW_COLLAPSED_SIZE = 44

export type FilesOpWindowPosition = { x: number; y: number }

/**
 * 迷你窗默认位置：对齐 Finder 拷贝窗——水平居中、落在视口上部（约 18% 高度处）。
 * 边界夹紧由拖拽层的 clampFloatingPosition 负责，这里只给初始落点。
 */
export function defaultFilesOpWindowPosition(
  viewport: { width: number; height: number },
  size: { width: number; height: number },
): FilesOpWindowPosition {
  return {
    x: Math.max(8, Math.round((viewport.width - size.width) / 2)),
    y: Math.max(48, Math.round(viewport.height * 0.18)),
  }
}