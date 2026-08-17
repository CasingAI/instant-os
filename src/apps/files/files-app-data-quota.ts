/**
 * 应用数据空间：独立总上限 + 按应用记账。
 * 记账口径：/dev/apps/{appId}/Data 子树文件字节（dev 卷本就计入全局数据空间，
 * 此处是应用维度视图与独立硬上限）。
 */
import { formatStorageSize } from '../../os/format-storage-size.ts'
import { APP_DATA_APPS_DIR_NAME, APP_DATA_DIR_NAME } from './files-app-data-root.ts'
import { listChildNodes, listLocalVolumeSubtreeNodes } from './files-storage.ts'

/** 应用数据空间独立硬上限（512 MB，独立于用户文件/全局数据空间） */
export const APP_DATA_CAPACITY_BYTES = 512 * 1024 * 1024

export class AppDataStorageFullError extends Error {
  constructor() {
    super(`应用数据空间已满（${formatStorageSize(APP_DATA_CAPACITY_BYTES)} 上限）`)
    this.name = 'AppDataStorageFullError'
  }
}

/** 每个应用的 Data 子树字节（键为 appId 原样；无数据目录的应用不出现） */
export async function getAppDataBytesByApp(): Promise<Record<string, number>> {
  const appsDir = (await listChildNodes('dev', undefined)).find(
    (node) => node.kind === 'folder' && node.name === APP_DATA_APPS_DIR_NAME,
  )
  if (!appsDir) return {}

  const result: Record<string, number> = {}
  const appDirs = await listChildNodes('dev', appsDir.id)
  for (const appDir of appDirs) {
    if (appDir.kind !== 'folder') continue
    const dataDir = (await listChildNodes('dev', appDir.id)).find(
      (node) => node.kind === 'folder' && node.name === APP_DATA_DIR_NAME,
    )
    if (!dataDir) continue
    const { files } = await listLocalVolumeSubtreeNodes('dev', dataDir.id)
    result[appDir.name] = files.reduce((total, file) => total + file.byteSize, 0)
  }
  return result
}

/** 全部应用数据总字节 */
export async function getAppDataTotalBytes(): Promise<number> {
  const byApp = await getAppDataBytesByApp()
  return Object.values(byApp).reduce((total, bytes) => total + bytes, 0)
}

/** 写应用数据前预检：应用数据总量 + 增量不超过独立上限 */
export async function assertAppDataCapacity(additionalBytes: number): Promise<void> {
  if (additionalBytes <= 0) return
  const total = await getAppDataTotalBytes()
  if (total + additionalBytes > APP_DATA_CAPACITY_BYTES) {
    throw new AppDataStorageFullError()
  }
}
