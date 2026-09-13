/**
 * 关机刷盘覆盖层的进度跟踪。
 *
 * 关机收尾分两个阶段，进度信号来自两条通道，不能混在一起计量：
 *
 * - 阶段 A（guest，接收客机改动）：iframe 把写回合并器囤积的脏写逐批交给宿主，
 *   VM 侧 stats 的 diskWrite.pendingBytes 每 250ms 真实递减；此阶段宿主缓存
 *   等量增长，两边相加恒定，所以阶段 A 只能看 VM 侧 pending。
 * - 阶段 B（host，合并进硬盘文件）：drain 完成后宿主钉住基准 flushTotalBytes，
 *   按 1MB 段合并，pending 递减——getVirtualMachineDiskFlushProgress 本来就工作正常。
 *
 * 阶段判定不能只看单拍数值：drain 刚结束时宿主 cachePending 已满而 merge 基准未钉，
 * total==pending 与「merge 刚开始」数值上不可区分，只能靠「宿主 pending 出现递减」
 * 确认进入阶段 B；在此之前保持不确定扫动态。
 */

export type VmFlushStage = 'guest' | 'host' | 'indeterminate'

export type VmFlushProgressSample = {
  nowMs: number
  /** VM 侧合并器尚未交给宿主的脏字节（stats.diskWrite.pendingBytes）；stats 未到/无回写档为 undefined。 */
  guestPendingBytes: number | undefined
  /** 宿主差量层进度查询（getVirtualMachineDiskFlushProgress）的剩余字节。 */
  hostPendingBytes: number
  /** 宿主差量层进度查询的基准总量；0 = 尚无基准（挂载卷黑盒阶段）。 */
  hostTotalBytes: number
}

export type VmFlushProgress = {
  stage: VmFlushStage
  /** 当前阶段的剩余字节；indeterminate 阶段为 undefined（扫动态）。 */
  pendingBytes: number | undefined
  /** 当前阶段的基准总量；indeterminate 阶段为 undefined。 */
  totalBytes: number | undefined
  /** EMA 平滑后的速度；样本不足或无进展时为 undefined。 */
  speedBytesPerSec: number | undefined
  /** 距上次观测到 pending 下降的毫秒数；阶段刚切换时为 0（宽限期）。 */
  stalledMs: number
}

/** 停滞心跳阈值：超过此时长无进展，覆盖层追加「仍在写入」提示。 */
export const VM_FLUSH_STALL_THRESHOLD_MS = 4000

const SPEED_EMA_ALPHA = 0.3

function finiteOrUndefined(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined
}

export type VmFlushProgressTracker = (sample: VmFlushProgressSample) => VmFlushProgress

/**
 * 每 500ms 喂一拍的进度跟踪器。基准钉住（首拍记录、后续取 max 自愈，容忍
 * 首拍 stats 尚未到达或中途切入）、阶段切换时重置速度采样（防跨阶段负跳）。
 */
export function createVmFlushProgressTracker(): VmFlushProgressTracker {
  let stage: VmFlushStage = 'indeterminate'
  let guestBaseline: number | undefined
  let sawGuestStage = false
  let lastHostPending: number | undefined
  let lastSample: { atMs: number; pendingBytes: number } | null = null
  let speedBytesPerSec: number | undefined
  let lastProgressAtMs: number | undefined

  return (sample: VmFlushProgressSample): VmFlushProgress => {
    const guestPending = finiteOrUndefined(sample.guestPendingBytes)
    const hostPending = finiteOrUndefined(sample.hostPendingBytes) ?? 0
    const hostTotal = finiteOrUndefined(sample.hostTotalBytes) ?? 0

    // 宿主 pending 出现递减 = merge 确实在推进。阶段 A 里 cachePending 只增不减、
    // 过渡窗里保持不变，只有阶段 B 会递减，这条规则不会误判。
    const hostProgressing =
      hostTotal > 0 && lastHostPending !== undefined && hostPending < lastHostPending
    lastHostPending = hostPending

    let nextStage: VmFlushStage
    if (hostProgressing) {
      nextStage = 'host'
    } else if (guestPending !== undefined && guestPending > 0) {
      nextStage = 'guest'
    } else if (sawGuestStage) {
      // drain 已结束（含最后一帧 publishFinal=0）、merge 的递减还没观测到：过渡窗。
      nextStage = 'indeterminate'
    } else if (hostTotal > 0 && hostPending < hostTotal) {
      // 中途切入（切到别的机器再切回），宿主基准已钉且已在推进：直接进阶段 B。
      nextStage = 'host'
    } else {
      nextStage = 'indeterminate'
    }

    if (nextStage !== stage) {
      stage = nextStage
      lastSample = null
      speedBytesPerSec = undefined
      lastProgressAtMs = sample.nowMs
    }
    if (stage === 'guest') {
      sawGuestStage = true
      guestBaseline =
        guestBaseline === undefined ? guestPending : Math.max(guestBaseline, guestPending ?? 0)
    }

    let pendingBytes: number | undefined
    let totalBytes: number | undefined
    if (stage === 'guest') {
      pendingBytes = guestPending
      totalBytes = guestBaseline
    } else if (stage === 'host') {
      pendingBytes = hostPending
      totalBytes = hostTotal > 0 ? hostTotal : undefined
    }

    if (pendingBytes !== undefined) {
      if (lastSample) {
        const dtSec = (sample.nowMs - lastSample.atMs) / 1000
        const written = lastSample.pendingBytes - pendingBytes
        if (dtSec > 0 && written > 0) {
          const instant = written / dtSec
          speedBytesPerSec =
            speedBytesPerSec === undefined
              ? instant
              : speedBytesPerSec * (1 - SPEED_EMA_ALPHA) + instant * SPEED_EMA_ALPHA
          lastProgressAtMs = sample.nowMs
        }
      }
      lastSample = { atMs: sample.nowMs, pendingBytes }
    }

    const stalledMs =
      lastProgressAtMs === undefined ? 0 : Math.max(0, sample.nowMs - lastProgressAtMs)
    return { stage, pendingBytes, totalBytes, speedBytesPerSec, stalledMs }
  }
}
