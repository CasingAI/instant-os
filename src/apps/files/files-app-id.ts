/**
 * appId ↔ 文件系统目录段 的纯函数变换。
 * 每个应用有稳定唯一 appId；Applications 卷的包目录用 appId 派生的目录段（而非显示名）。
 * 内置应用目录段即 appId（如 `weather`）；生成应用 `gen:{uid}` 因 `:` 非法，
 * 目录段把冒号替换为下划线（`gen_`）。生成应用自身不感知文件系统，此变换对应用无副作用。
 */
import { sanitizeFilesPathSegment } from './files-path.ts'

const GEN_PREFIX = 'gen:'
const GEN_DIR_PREFIX = 'gen_'
export const APP_BUNDLE_SUFFIX = '.app'

/**
 * 应用包内系统目录名（布局约定，供版本布局模块与 /Applications 投影共用）：
 * Versions 放版本树（正整数正式版 + Draft 草稿）；Developer 放开发附属（聊天等）；
 * Dist 是第四期约定的发布产物目录（保留名）。
 */
export const APP_VERSIONS_DIR_NAME = 'Versions'
export const APP_DEVELOPER_DIR_NAME = 'Developer'
export const APP_DIST_DIR_NAME = 'Dist'
export const APP_DRAFT_DIR_NAME = 'Draft'

/** appId 转为安全的文件系统目录段（唯一）。内置应用原样；`gen:` 前缀的冒号换成下划线。 */
export function appDataDirName(appId: string): string {
  if (appId.startsWith(GEN_PREFIX)) {
    return `${GEN_DIR_PREFIX}${appId.slice(GEN_PREFIX.length)}`
  }
  return sanitizeFilesPathSegment(appId)
}

/** 目录段 → appId（`appDataDirName` 的逆变换）。非目录段派生的输入原样返回。 */
export function appDataDirNameToAppId(dirName: string): string {
  if (dirName.startsWith(GEN_DIR_PREFIX)) {
    return `${GEN_PREFIX}${dirName.slice(GEN_DIR_PREFIX.length)}`
  }
  return dirName
}

/** 应用包目录名（`{目录段}.app`）：真实路径与物理节点名。 */
export function appBundleDirName(appId: string): string {
  return `${appDataDirName(appId)}${APP_BUNDLE_SUFFIX}`
}

/** 应用包目录名 → appId（`appBundleDirName` 的逆变换）。非包名输入原样返回。 */
export function appBundleDirNameToAppId(bundleDirName: string): string {
  if (!bundleDirName.endsWith(APP_BUNDLE_SUFFIX)) return bundleDirName
  return appDataDirNameToAppId(bundleDirName.slice(0, -APP_BUNDLE_SUFFIX.length))
}
