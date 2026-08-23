/**
 * 设置页「文件」分类的明细口径：与 app-storage 中 filesBytesExcludingAppData 对齐。
 */
import { getAppDataTotalBytes } from './files-app-data-quota.ts'
import { filesLocationDisplayName } from './files-path.ts'
import { getFilesBytesByLocation, getFilesTotalBytes } from './files-storage.ts'
import type { FilesLocationId } from './files-types.ts'

export type DataSpaceFilesBreakdownRow = {
  id: string
  label: string
  bytes: number
  hint?: string
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

const VOLUME_HINTS: Partial<Record<FilesLocationId, string>> = {
  trash: '已删除但未清空的文件仍占数据空间',
}

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
      hint: VOLUME_HINTS[locationId],
    })
  }

  const applicationsBytes = bytesByLocation.get('applications') ?? 0
  const applicationsRemainder = Math.max(0, applicationsBytes - appDataBytes)
  if (applicationsRemainder > 0) {
    rows.push({
      id: 'applications-remainder',
      label: '应用包元数据',
      bytes: applicationsRemainder,
      hint: '应用程序卷中未归入「应用」分类的部分',
    })
  }

  const attributedBytes = rows.reduce((sum, row) => sum + row.bytes, 0)
  const unattributedBytes = totalBytes - attributedBytes
  if (unattributedBytes > 0) {
    rows.push({
      id: 'unattributed',
      label: '未归类',
      bytes: unattributedBytes,
      hint: '文件元数据或历史记账与分卷汇总存在差额',
    })
  }

  return {
    totalBytes,
    appDataBytes,
    rows,
    attributedBytes,
  }
}
