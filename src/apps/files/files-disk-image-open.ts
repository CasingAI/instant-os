/**
 * 虚拟硬盘：系统登记的磁盘镜像打开程序（无窗口）。
 *
 * 被打开（双击 /「打开方式」/ 终端 open）时：挂载镜像 → 选第一个可浏览分区
 * → 请求文件应用定位到该分区卷根。自己不建任何窗口；失败走系统通知横幅。
 */
import { DISK_IMAGE_EXTENSIONS } from './files-disk-image-name.ts'
import {
  firstBrowsableImageLocation,
  mountDiskImage,
} from './files-image-actions.ts'
import { requestFilesReveal } from './files-reveal-request.ts'
import { filesLocationPathRoot } from './files-path.ts'
import { registerFileOpenHandler } from '../../os/file-open-registry.ts'
import { postOsNotification } from '../../os/os-notifications.ts'
import { osOpenApp } from '../../os/os-open-app-bridge.ts'
import { registerWindowlessOpenHandler } from '../../os/windowless-open-registry.ts'

const APP_ID = 'disk-image' as const
const NOTIFICATION_ID = 'disk-image:open-failed'

registerFileOpenHandler({
  appId: APP_ID,
  extensions: [...DISK_IMAGE_EXTENSIONS],
  rank: 1,
})

registerWindowlessOpenHandler(APP_ID, async (options) => {
  const path = options?.documentId?.trim()
  if (!path) return
  try {
    const target = await openDiskImageAndReveal(path)
    requestFilesReveal(target)
    osOpenApp('files', { documentId: target })
  } catch (error) {
    postOsNotification({
      id: NOTIFICATION_ID,
      title: '无法挂载磁盘镜像',
      subtitle: fileNameOf(path),
      phase: 'failure',
      icon: { kind: 'app', appId: APP_ID },
      body: error instanceof Error ? error.message : String(error),
    })
  }
})

/** 挂载并返回第一个可浏览位置的卷根绝对路径（供文件应用定位） */
export async function openDiskImageAndReveal(imagePath: string): Promise<string> {
  const record = await mountDiskImage(imagePath)
  const browsable =
    firstBrowsableImageLocation(record.imagePath) ??
    (record.isPartitionAnchor || record.unreadableReason ? undefined : record.id)
  if (!browsable) {
    throw new Error(record.unreadableReason ?? '镜像里没有可识别的文件系统分区')
  }
  return filesLocationPathRoot(browsable)
}

function fileNameOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(slash + 1) : path
}
