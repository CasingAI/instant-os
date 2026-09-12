import type { InstantVmDiskWriteStats, InstantVmStatsSnapshot } from './virtual-machine-protocol.ts'
import type { VmDiskWriteLoss, VmDiskWriteModeId } from './virtual-machine-types.ts'

/**
 * 「硬盘写入」三模式在运行期的状态行与页面关闭拦截判定。
 *
 * 这些判断以前只散在组件里：运行期到底有没有数据没落盘、关页面该不该拦，谁也说不出
 * 一句话。抽成纯函数是为了让「什么情况下必须拦住用户」有确定答案，也能直跑断言。
 */

/** off=仅陈述模式、info=正常、warn=有数据悬着、danger=已经丢过数据或濒临内存上限。 */
export type VmDiskWriteTone = 'off' | 'info' | 'warn' | 'danger'

export type VmDiskWriteStatus = {
  tone: VmDiskWriteTone
  /** 一句话状态，直接展示给用户。 */
  text: string
  /**
   * 是否有「现在关掉页面就会丢」的数据（驱动 beforeunload 拦截）。
   * 注意已经丢掉的写入不算：它们不会因为再关一次页面而再丢一次，为它们弹原生提示只是噪音。
   */
  atRisk: boolean
}

export function formatVmDiskBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 MB'
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * 「关机时写入」攒到这个量就该提醒用户收手。
 *
 * 这些脏数据全在 iframe 内存里，攒得越多越接近浏览器的标签页内存上限；真被
 * 浏览器杀掉进程，整次开机的改动会一起消失（连落盘的机会都没有）。阈值取 256MB：
 * 对默认 128MB 的盘，等于「整盘重写过一轮还有余」，足够有代表性。
 */
export const VM_DISK_PENDING_WARN_BYTES = 256 * 1024 * 1024

/** 已经确定写不进镜像的量：这是真实的数据丢失，措辞不能留余地。 */
function lostText(droppedWrites: number, droppedBytes: number): string {
  const size = droppedBytes > 0 ? `（约 ${formatVmDiskBytes(droppedBytes)}）` : ''
  return `本次开机有 ${droppedWrites} 条磁盘写入未能写入镜像${size}，镜像可能不完整`
}

/**
 * 运行期该模式的一句话状态。
 *
 * `atRisk` 只在 live/poweroff 且确有未落盘数据时为真：none 模式本来就约定不保存
 * （文档也写明「要保留就靠快照」），为它拦页面关闭只会在每次关标签页时弹一个
 * 什么也救不回来的原生提示，那是噪音而不是保护。
 */
export function vmDiskWriteStatus(input: {
  mode: VmDiskWriteModeId
  running: boolean
  diskWrite: InstantVmDiskWriteStats | undefined
}): VmDiskWriteStatus {
  const { mode, running, diskWrite } = input
  const pendingBytes = diskWrite?.pendingBytes ?? 0
  const droppedWrites = diskWrite?.droppedWrites ?? 0
  const droppedBytes = diskWrite?.droppedBytes ?? 0

  if (mode === 'none') {
    return running
      ? {
          tone: 'warn',
          text: '不写入：本次开机的改动只留在内存，关机或关闭页面都会丢失',
          atRisk: false,
        }
      : { tone: 'off', text: '不写入：不改动镜像文件，需要保留改动请用快照', atRisk: false }
  }

  if (mode === 'live') {
    if (running && droppedWrites > 0) {
      return {
        tone: 'danger',
        text: lostText(droppedWrites, droppedBytes),
        // 已经丢掉的写入不会因为关页面再丢一次；只有还有悬着的才值得拦。
        atRisk: pendingBytes > 0,
      }
    }
    return running
      ? {
          tone: 'info',
          text: '实时写入：改动在运行中写回镜像',
          atRisk: pendingBytes > 0,
        }
      : { tone: 'off', text: '实时写入：运行中把改动写回镜像', atRisk: false }
  }

  // poweroff：运行期一条都不发，全部攒在 iframe 内存里。
  if (!running) {
    return { tone: 'off', text: '关机时写入：关机或断电时把本次改动写入镜像', atRisk: false }
  }
  if (droppedWrites > 0) {
    return { tone: 'danger', text: lostText(droppedWrites, droppedBytes), atRisk: pendingBytes > 0 }
  }
  if (pendingBytes > 0) {
    if (pendingBytes >= VM_DISK_PENDING_WARN_BYTES) {
      return {
        tone: 'danger',
        text: `关机时写入：本次开机已有 ${formatVmDiskBytes(pendingBytes)} 攒在内存里等待关机写入。攒得越多越接近浏览器内存上限，一旦标签页被系统回收就会全部丢失，建议尽快关机写入镜像`,
        atRisk: true,
      }
    }
    return {
      tone: 'warn',
      text: `关机时写入：本次开机已有 ${formatVmDiskBytes(pendingBytes)} 待写入镜像，请正常关机；此刻关闭页面会全部丢失`,
      atRisk: true,
    }
  }
  return { tone: 'info', text: '关机时写入：本次开机尚无改动，关机时一次性写入镜像', atRisk: false }
}

/**
 * 「上次有写入没落盘」的常驻告知文案（机器记录里的 diskWriteLoss）。
 * 这条要一直挂到用户确认，所以必须说清三件事：丢了什么、镜像可能怎样、该做什么。
 */
export function vmDiskWriteLossText(loss: VmDiskWriteLoss): string {
  const size = loss.droppedBytes > 0 ? `（约 ${formatVmDiskBytes(loss.droppedBytes)}）` : ''
  return `上次运行结束时，有 ${loss.droppedWrites} 条磁盘写入${size}没能写入镜像，镜像可能停在半提交状态。建议开机时让系统自检修复，修复前不要直接使用或导出该镜像；确认已处理后点「知道了」。`
}

/**
 * 合并一次会话的两处丢弃来源：iframe 侧回写器的丢弃计数（只存在于它的 stats 里）
 * 与宿主释放闸门丢掉的写入。两者时间上不相交（先读 stats、后关闸门），所以是相加而非取大；
 * 合计为 0 时不产生记录，返回 undefined。
 */
export function combineDiskWriteLoss(
  runtimeLoss: InstantVmDiskWriteStats | undefined,
  hostDiscardedWrites: number,
): { droppedWrites: number; droppedBytes: number } | undefined {
  const hostLost = Number.isFinite(hostDiscardedWrites) && hostDiscardedWrites > 0 ? hostDiscardedWrites : 0
  const droppedWrites = (runtimeLoss?.droppedWrites ?? 0) + hostLost
  if (droppedWrites <= 0) {
    return undefined
  }
  return { droppedWrites, droppedBytes: runtimeLoss?.droppedBytes ?? 0 }
}

/** 所有在跑机器的未落盘字节合计；无候选时返回 0。 */
export function totalUnflushedDiskBytes(
  snapshots: Iterable<InstantVmStatsSnapshot | undefined>,
): number {
  let total = 0
  for (const snapshot of snapshots) {
    total += snapshot?.diskWrite?.pendingBytes ?? 0
  }
  return total
}

/**
 * 是否要在关闭/刷新页面时拦一刀。
 *
 * 除了原本的「收口刷盘 / 等客机关机」两种情况，还必须在**运行期就有未落盘数据**时拦：
 * poweroff 模式整次开机的改动都攒在 iframe 内存里，关页面等于直接丢弃，而这件事
 * 在之前完全没有拦截——用户随手关个标签页就能丢掉几十分钟的安装进度。
 */
export function shouldGuardVmUnload(input: {
  flushing: boolean
  awaitingGuestShutdown: boolean
  unflushedBytes: number
}): boolean {
  return input.flushing || input.awaitingGuestShutdown || input.unflushedBytes > 0
}
