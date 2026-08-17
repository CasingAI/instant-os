/**
 * 应用数据记账：按应用统计 /Applications/{appBundleDirName(appId)}/Data 的字节。
 * 无独立子限额；容量由全局 4GB 数据空间兜底（applications 卷真实节点经
 * files-storage 的 assertCapacity 统一记账）。
 */
import { APP_DATA_DIR_NAME } from './files-app-data-root.ts'
import { appBundleDirNameToAppId } from './files-app-id.ts'
import { listChildNodes, listLocalVolumeSubtreeNodes } from './files-storage.ts'

const LOCATION_ID = 'applications' as const

/** 每个应用的 Data 子树字节（键为 appId 原样，如 `weather` / `gen:xxx`；无数据目录不出现） */
export async function getAppDataBytesByApp(): Promise<Record<string, number>> {
  const bundles = await listChildNodes(LOCATION_ID, undefined)
  const result: Record<string, number> = {}
  for (const bundle of bundles) {
    if (bundle.kind !== 'folder') continue
    const dataDir = (await listChildNodes(LOCATION_ID, bundle.id)).find(
      (node) => node.kind === 'folder' && node.name === APP_DATA_DIR_NAME,
    )
    if (!dataDir) continue
    const { files } = await listLocalVolumeSubtreeNodes(LOCATION_ID, dataDir.id)
    const bytes = files.reduce((total, file) => total + file.byteSize, 0)
    if (bytes > 0) {
      result[appBundleDirNameToAppId(bundle.name)] = bytes
    }
  }
  return result
}

/** 全部应用数据总字节 */
export async function getAppDataTotalBytes(): Promise<number> {
  const byApp = await getAppDataBytesByApp()
  return Object.values(byApp).reduce((total, bytes) => total + bytes, 0)
}
