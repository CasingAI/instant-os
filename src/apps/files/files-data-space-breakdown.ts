/**
 * 设置页「文件」分类的明细口径：与 app-storage 中 filesBytesExcludingAppData 对齐。
 */
import { getAppDataTotalBytes } from './files-app-data-quota.ts'
import { filesLocationDisplayName } from './files-path.ts'
import { getFilesAttachmentBytes, getFilesBytesByLocation, getFilesTotalBytes } from './files-storage.ts'
import type { FilesLocationId } from './files-types.ts'

export type DataSpaceFilesBreakdownRow = {
  id: string
  label: string
  bytes: number
}

export type DataSpaceFilesBreakdown = {
  /** 文件系统总占用 − 应用 Data/Contents（与设置页「文件」分类一致） */
  totalBytes: number
  /** 应用 Data/Contents 合计（在「应用」分类单独展示） */
  appDataBytes: number
  rows: DataSpaceFilesBreakdownRow[]
  /** 分卷行合计；与 totalBytes 的差额见 rows 中的未归类行 */
  attributedBytes: number
}

const VOLUME_LOCATION_IDS: readonly FilesLocationId[] = ['local', 'dev', 'tmp', 'trash']

export async function loadDataSpaceFilesBreakdown(): Promise<DataSpaceFilesBreakdown> {
  const [filesTotal, appDataBytes, byLocation] = await Promise.all([
    getFilesTotalBytes(),
    getAppDataTotalBytes(),
    getFilesBytesByLocation([...VOLUME_LOCATION_IDS, 'applications']),
  ])

  const totalBytes = Math.max(0, filesTotal - appDataBytes)
  const bytesByLocation = new Map(byLocation.map((entry) => [entry.locationId, entry.bytes]))

  const rows: DataSpaceFilesBreakdownRow[] = []
  for (const locationId of VOLUME_LOCATION_IDS) {
    rows.push({
      id: locationId,
      label: filesLocationDisplayName(locationId),
      bytes: bytesByLocation.get(locationId) ?? 0,
    })
  }

  const applicationsBytes = bytesByLocation.get('applications') ?? 0
  const applicationsRemainder = Math.max(0, applicationsBytes - appDataBytes)
  if (applicationsRemainder > 0) {
    rows.push({
      id: 'applications-remainder',
      label: '应用包元数据',
      bytes: applicationsRemainder,
    })
  }

  const attributedBytes = rows.reduce((sum, row) => sum + row.bytes, 0)
  const unattributedBytes = totalBytes - attributedBytes
  if (unattributedBytes > 0) {
    rows.push({
      id: 'unattributed',
      label: '未归类',
      bytes: unattributedBytes,
    })
  }

  // 说明行（置于最后）：附加字节已计入上方各卷行（getFilesBytesByLocation 按卷扫
  // 全部 file 节点，附加在内），不参与 attributedBytes / 未归类，避免重复计量。
  // 不提供清理入口（缓存合并 / 丢弃归磁盘工具管）。
  const attachmentBytes = await getFilesAttachmentBytes()
  if (attachmentBytes > 0) {
    rows.push({
      id: 'attachments',
      label: '文件附加·虚拟机硬盘缓存等（已计入各卷）',
      bytes: attachmentBytes,
    })
  }

  return {
    totalBytes,
    appDataBytes,
    rows,
    attributedBytes,
  }
}
