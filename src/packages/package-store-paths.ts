import { filesLocationPathRoot, joinFilesAbsolutePath } from '../apps/files/files-path.ts'

const DEV_FILES_ROOT = filesLocationPathRoot('dev')

/** 全局 CAS store 在开发者数据卷下的命名空间 */
export const PACKAGE_STORE_NAMESPACE = 'npm'

/** 当前默认 store 根（可写命名空间） */
export const DEFAULT_PACKAGE_STORE_ROOT = joinFilesAbsolutePath(
  DEV_FILES_ROOT,
  PACKAGE_STORE_NAMESPACE,
)

/** 旧版落在用户卷下的 store；迁移后可变为指向新根的兼容 symlink */
export const LEGACY_PACKAGE_STORE_ROOT = '/user/.instant-pkg-store'
