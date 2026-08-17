/**
 * 每个应用的独立数据目录根：`/dev/apps/{appId}/Data`。
 * 物理真身位于 dev 卷（IndexedDB 数据空间）；/Applications 卷下 `.app/Data` 为只读投影。
 */
import { joinFilesAbsolutePath, sanitizeFilesPathSegment } from './files-path.ts'
import { ensureDevSystemFolder } from './files-system-vfs.ts'
import type { FilesNode, FilesNodeAttributes } from './files-types.ts'

/** Data 目录名（macOS 应用容器约定） */
export const APP_DATA_DIR_NAME = 'Data'

/** /dev 下存放应用数据目录的父目录名 */
export const APP_DATA_APPS_DIR_NAME = 'apps'

/** Data 根节点属性：应用内部 API 可写（父链 /dev/apps、/dev/apps/{appId} 保持系统只读） */
export const APP_DATA_ROOT_ATTRIBUTES: FilesNodeAttributes = {
  readable: true,
  writable: true,
}

/** appId（可能含 `:` 等非法路径字符）转为安全的路径段 */
export function sanitizeAppIdSegment(appId: string): string {
  return sanitizeFilesPathSegment(appId)
}

/** `/dev/apps/{appId}/Data` */
export function appDataRootPath(appId: string): string {
  return joinFilesAbsolutePath(
    '/dev',
    APP_DATA_APPS_DIR_NAME,
    sanitizeAppIdSegment(appId),
    APP_DATA_DIR_NAME,
  )
}

/** 确保应用数据目录存在（幂等，系统层创建并同步 VFS），返回 Data 根节点 */
export function ensureAppDataRoot(appId: string): Promise<FilesNode> {
  return ensureDevSystemFolder(appDataRootPath(appId), APP_DATA_ROOT_ATTRIBUTES)
}
