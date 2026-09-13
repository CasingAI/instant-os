/**
 * 磁盘工具急救的 VM 域实现：处理虚拟硬盘上未提交的缓存。
 *
 * 缓存是 `.img` 主文件上的 VFS 附加（见 virtual-machine-disk-overlay-store.ts），
 * 附加里带段表，分析/合并不必整读重放历史。急救三个动作：
 * - 分析：这份镜像上有没有缓存附加、约多大（段数与段字节总和）。
 * - 写入硬盘文件：按段表逐段流式合并进可见文件，完成后附加删除（中断则缓存保留，可再来）。
 * - 丢掉缓存：直接删除附加（确认弹窗由 UI 层负责）。
 *
 * 注意：openDiskOverlayStore 会按需「创建」空附加（ensureAttachmentExists），
 * 只读路径（分析）必须先用 filesListAttachments 确认附加存在，避免凭空造出空缓存。
 */
import { filesListAttachments, filesWriteBytesRange } from '../files/files-api.ts'
import { openQuietBlobWriter } from '../files/files-quiet-blob-write.ts'
import { openMountRangeWriter } from '../files/files-location-mount.ts'
import {
  claimDiskImagePath,
  diskImageOccupiedByVmError,
  getDiskImageOccupant,
  releaseDiskImagePath,
  type DiskImageOccupant,
} from '../files/files-disk-image-occupancy.ts'
import {
  inspectDiskCacheAttachment,
  openDiskOverlayStore,
  VM_DISK_CACHE_ATTACHMENT_TAG,
} from './virtual-machine-disk-overlay-store.ts'

export type VmDiskFirstAidReport = {
  imagePath: string
  /** 缓存附加实占（约） */
  cacheBytes: number
  /** 脏槽数 */
  cacheRecords: number
}

const FIRST_AID_OCCUPANT: DiskImageOccupant = {
  kind: 'app',
  id: 'disk-utility-first-aid',
  label: '磁盘工具急救',
}

/**
 * 附加是否存在；不存在时不能走 openDiskOverlayStore（那会创建空附加）。
 * 只看存在性不看 byteSize：节点账本的 byteSize 回写是节流异步的（刚写完可能是 0），
 * 真实内容以段表为准——为空由调用方按「无缓存」处理。
 */
async function findCacheAttachment(imagePath: string): Promise<boolean> {
  const items = await filesListAttachments(imagePath, { tag: VM_DISK_CACHE_ATTACHMENT_TAG })
  return items.length > 0
}

/** 急救入口的占用拦截文案：按占用类型给急救语境的动作提示。 */
function firstAidOccupiedError(path: string, occupant: DiskImageOccupant): string {
  if (occupant.kind === 'files-mount') {
    return `无法急救 ${path}：这份镜像正在文件里挂载，请先推出镜像卷再急救。`
  }
  if (occupant.kind === 'vm') {
    return `无法急救 ${path}：这份镜像正在被虚拟机使用，请先关机再急救。`
  }
  return `无法急救 ${path}：这份镜像正在被其它工具使用，请稍后再试。`
}

/**
 * 急救入口的占用前置检查：任何占用（挂载/虚拟机/其它工具）都不进急救。
 * 分析本身只读，但入口一开用户势必继续「写入硬盘文件」——那一步对挂载卷/
 * 在用镜像是破坏性写；merge 入口同样前置（claimDiskImagePath 作纵深）。
 */
function assertImageNotOccupied(imagePath: string): void {
  const occupant = getDiskImageOccupant(imagePath)
  if (occupant) {
    throw new Error(firstAidOccupiedError(imagePath, occupant))
  }
}

/** 分析：有没有虚拟机硬盘缓存附加、多大。没有返回 undefined。 */
export async function analyzeVirtualMachineDiskCache(
  imagePath: string,
): Promise<VmDiskFirstAidReport | undefined> {
  assertImageNotOccupied(imagePath)
  const inspect = await inspectDiskCacheAttachment({ imagePath })
  if (!inspect) {
    return undefined
  }
  return {
    imagePath,
    cacheBytes: inspect.storedBytes,
    cacheRecords: inspect.records,
  }
}

/**
 * 写入硬盘文件：按段表逐段流式合并进可见文件（不整读进内存），完成后附加删除。
 * 中止（signal）不是失败：已写入的段留下，剩余缓存保留，下次急救可再合并。
 */
export async function mergeVirtualMachineDiskCacheIntoImage(params: {
  imagePath: string
  signal?: AbortSignal
  onProgress?: (info: { mergedBytes: number; totalBytes: number }) => void
}): Promise<void> {
  const { imagePath, signal, onProgress } = params
  // 占用前置检查（三类 kind 各自急救文案）：只拦 files-mount 时 VM 占用会落到
  // claimDiskImagePath 的「无法挂载…」文案，动词与急救语境不符
  assertImageNotOccupied(imagePath)
  await claimDiskImagePath(imagePath, FIRST_AID_OCCUPANT)
  try {
    if (!(await findCacheAttachment(imagePath))) {
      return
    }
    const store = await openDiskOverlayStore({ imagePath })
    const segments = await store.segments()
    if (segments.length === 0) {
      await store.remove()
      return
    }
    let totalBytes = 0
    for (const seg of segments) {
      totalBytes += seg.length
    }
    const mountWriter = await openMountRangeWriter(imagePath)
    const writer = mountWriter ?? (await openQuietBlobWriter(imagePath))
    let mergedBytes = 0
    let aborted = false
    onProgress?.({ mergedBytes: 0, totalBytes })
    try {
      for (const seg of segments) {
        if (signal?.aborted === true) {
          aborted = true
          break
        }
        const bytes = await store.readRun(seg.offset, seg.length)
        if (writer) {
          await writer.writeAt(seg.offset, bytes)
        } else {
          await filesWriteBytesRange(imagePath, seg.offset, bytes)
        }
        mergedBytes += seg.length
        onProgress?.({ mergedBytes, totalBytes })
      }
      if (writer) {
        // 放弃路径也走 close：已写的段提交/落盘，只是不删附加
        await writer.flush()
        await writer.close()
      }
    } catch (error) {
      await writer?.abort().catch(() => undefined)
      throw error
    }
    if (!aborted) {
      await store.remove()
    }
  } finally {
    releaseDiskImagePath(imagePath, FIRST_AID_OCCUPANT)
  }
}

/** 丢掉缓存：删除附加（确认弹窗由 UI 层负责）。 */
export async function discardVirtualMachineDiskCache(imagePath: string): Promise<void> {
  // 虚拟机正在用时缓存是它的活动写通道，删掉会打断会话
  const occupant = getDiskImageOccupant(imagePath)
  if (occupant?.kind === 'vm') {
    throw new Error(diskImageOccupiedByVmError(imagePath))
  }
  if (!(await findCacheAttachment(imagePath))) {
    return
  }
  const store = await openDiskOverlayStore({ imagePath })
  await store.remove()
}
