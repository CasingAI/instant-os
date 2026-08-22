/**
 * 每个应用的独立数据目录：`/Applications/{appBundleDirName(appId)}/Data`。
 * Data 是 applications 卷 IndexedDB 里的真实文件（与用户文件同一全局 8GB）；
 * /Applications 卷其余部分（Contents、清单）仍是虚拟投影。
 */
import { appBundleDirName } from './files-app-id.ts'
import type { FilesNodeAttributes } from './files-types.ts'

/** Data 目录名（macOS 应用容器约定） */
export const APP_DATA_DIR_NAME = 'Data'

/** 旧版旁路 /dev/apps 下的父目录名（仅迁移用） */
export const APP_DATA_APPS_DIR_NAME = 'apps'

/** Data 根节点属性：应用内部 API 可写（系统层直写），文件管理器 / 终端只读浏览 */
export const APP_DATA_ROOT_ATTRIBUTES: FilesNodeAttributes = {
  readable: true,
  writable: false,
}

/** `/Applications/{appBundleDirName(appId)}/Data` */
export function appDataRootPath(appId: string): string {
  return `/Applications/${appBundleDirName(appId)}/${APP_DATA_DIR_NAME}`
}
