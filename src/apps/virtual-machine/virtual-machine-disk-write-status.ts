import type { InstantVmDiskWriteStats, InstantVmStatsSnapshot } from './virtual-machine-protocol.ts'
import type { VmDiskWriteLoss, VmDiskWriteModeId } from './virtual-machine-types.ts'

/**
 * 「硬盘写入」在运行期的状态行与页面关闭拦截判定。
 *
 * 差量耐久之后，关页面不再等于丢掉整次开机；拦截只针对在途批次和尚未完成的合并。
 */

export type VmDiskWriteTone = 'off' | 'info' | 'warn' | 'danger'

export type VmDiskWriteStatus = {
  tone: VmDiskWriteTone
  text: string
  /**
   * 是否有「现在关掉页面就会丢」的数据（驱动 beforeunload 拦截）。
   * 已丢掉的写入、以及已经写入耐久差量的改动都不算。
   */
  atRisk: boolean
  /** 必须压在画面上，不能塞进灯条。 */
  hud: boolean
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

function lostText(droppedWrites: number, droppedBytes: number): string {
  const size = droppedBytes > 0 ? `（约 ${formatVmDiskBytes(droppedBytes)}）` : ''
  return `有 ${droppedWrites} 条硬盘改动没能保存${size}，硬盘文件可能不完整`
}

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
          text: '本次改动不会写入硬盘文件',
          atRisk: false,
          hud: false,
        }
      : { tone: 'off', text: '', atRisk: false, hud: false }
  }

  if (running && droppedWrites > 0) {
    return {
      tone: 'danger',
      text: lostText(droppedWrites, droppedBytes),
      atRisk: pendingBytes > 0,
      hud: true,
    }
  }
  if (running && pendingBytes > 0) {
    return {
      tone: 'warn',
      text: `正在保存硬盘改动，还剩 ${formatVmDiskBytes(pendingBytes)}`,
      atRisk: true,
      hud: false,
    }
  }
  return { tone: 'off', text: '', atRisk: false, hud: false }
}

export function vmDiskWriteLossText(loss: VmDiskWriteLoss): string {
  const size = loss.droppedBytes > 0 ? `（约 ${formatVmDiskBytes(loss.droppedBytes)}）` : ''
  return `上次运行结束时，有 ${loss.droppedWrites} 条硬盘改动${size}没能保存，硬盘文件可能不完整。建议开机时让系统自检修复，修好前不要直接使用或导出。`
}

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
 * 关闭/刷新页面时是否拦一刀：刷盘/合并中、等客机关机、或还有在途未写入差量的字节。
 */
export function shouldGuardVmUnload(input: {
  flushing: boolean
  awaitingGuestShutdown: boolean
  unflushedBytes: number
}): boolean {
  return input.flushing || input.awaitingGuestShutdown || input.unflushedBytes > 0
}
