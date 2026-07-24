import { filesLocationPathRoot, joinFilesAbsolutePath } from '../apps/files/files-path.ts'

const DEV_FILES_ROOT = filesLocationPathRoot('dev')

/** 全局 CAS store 在开发者数据卷下的命名空间 */
export const PACKAGE_STORE_NAMESPACE = 'npm'

/** 当前默认 store 根（可写命名空间） */
export const DEFAULT_PACKAGE_STORE_ROOT = joinFilesAbsolutePath(
  DEV_FILES_ROOT,
  PACKAGE_STORE_NAMESPACE,
)

/** 版本目录内表示解压已完整提交的标记文件名 */
export const PACKAGE_STORE_COMPLETE_MARKER = '.instant-ok'
