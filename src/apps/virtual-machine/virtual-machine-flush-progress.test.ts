/**
 * 关机刷盘覆盖层进度跟踪：阶段 A（接收客机改动）/ 阶段 B（合并进硬盘文件）两段计量。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-flush-progress.test.ts
 */
import assert from 'node:assert/strict'
import {
  createVmFlushProgressTracker,
  VM_FLUSH_SPEED_WINDOW_MS,
  VM_FLUSH_STALL_THRESHOLD_MS,
  type VmFlushProgress,
} from './virtual-machine-flush-progress.ts'

const MB = 1024 * 1024

function sample(
  nowMs: number,
  guestPendingBytes: number | undefined,
  hostPendingBytes: number,
  hostTotalBytes: number,
): { nowMs: number; guestPendingBytes: number | undefined; hostPendingBytes: number; hostTotalBytes: number } {
  return { nowMs, guestPendingBytes, hostPendingBytes, hostTotalBytes }
}

function percent(progress: VmFlushProgress): number | undefined {
  if (progress.pendingBytes === undefined || progress.totalBytes === undefined) {
    return undefined
  }
  return (1 - progress.pendingBytes / progress.totalBytes) * 100
}

function testGuestStageDecreasesFromPinnedBaseline(): void {
  const track = createVmFlushProgressTracker()
  // drain 开始：宿主缓存还是空的，VM 侧 192MB 待传。首拍钉住基准。
  const first = track(sample(0, 192 * MB, 0, 0))
  assert.equal(first.stage, 'guest')
  assert.equal(first.totalBytes, 192 * MB)
  assert.equal(first.pendingBytes, 192 * MB)
  assert.equal(percent(first), 0)

  // VM pending 真实递减、宿主 cache 等量增长（两者相加恒定，不能用宿主侧计量）。
  const mid = track(sample(1000, 96 * MB, 96 * MB, 96 * MB))
  assert.equal(mid.stage, 'guest')
  assert.equal(mid.totalBytes, 192 * MB)
  assert.equal(mid.pendingBytes, 96 * MB)
  assert.equal(percent(mid), 50)
  assert.ok(mid.speedBytesPerSec !== undefined && mid.speedBytesPerSec > 0)

  const done = track(sample(2000, 1 * MB, 191 * MB, 191 * MB))
  assert.equal(done.stage, 'guest')
  assert.ok(percent(done)! > 99)
}

function testGuestBaselineSelfHealsWhenFirstSampleMissesPeak(): void {
  const track = createVmFlushProgressTracker()
  // 首拍 stats 尚未到达（guestPending undefined），第二拍才看到 150MB——
  // 实际峰值 192MB 已错过；若之后观测到更大的值，基准取 max 自愈。
  track(sample(0, undefined, 0, 0))
  const entry = track(sample(500, 150 * MB, 42 * MB, 42 * MB))
  assert.equal(entry.stage, 'guest')
  assert.equal(entry.totalBytes, 150 * MB)
  const healed = track(sample(1000, 160 * MB, 74 * MB, 74 * MB))
  assert.equal(healed.totalBytes, 160 * MB)
  assert.equal(healed.pendingBytes, 160 * MB)
}

function testHostStageStartsOnObservedDecrease(): void {
  const track = createVmFlushProgressTracker()
  track(sample(0, 64 * MB, 0, 0))
  // drain 完成（最后一帧 pending=0），merge 基准未钉：宿主 total==pending，与
  // merge 刚开始数值上不可区分——维持不确定态，不许谎报 0%。
  const handoff = track(sample(500, 0, 64 * MB, 64 * MB))
  assert.equal(handoff.stage, 'indeterminate')
  assert.equal(handoff.pendingBytes, undefined)
  assert.equal(handoff.totalBytes, undefined)

  // merge 钉基准 64MB 并按 1MB 段递减：第一拍递减确认进入阶段 B。
  const merging = track(sample(1000, 0, 63 * MB, 64 * MB))
  assert.equal(merging.stage, 'host')
  assert.equal(merging.totalBytes, 64 * MB)
  assert.equal(merging.pendingBytes, 63 * MB)

  const later = track(sample(2500, 0, 32 * MB, 64 * MB))
  assert.equal(later.stage, 'host')
  assert.equal(percent(later), 50)
  assert.ok(later.speedBytesPerSec !== undefined && later.speedBytesPerSec > 0)
}

function testMidMergeEntryGoesStraightToHostStage(): void {
  const track = createVmFlushProgressTracker()
  // 切到别的机器再切回：没经历过阶段 A，但宿主基准已钉且 pending < total。
  const progress = track(sample(0, 0, 30 * MB, 64 * MB))
  assert.equal(progress.stage, 'host')
  assert.equal(progress.totalBytes, 64 * MB)
  assert.equal(progress.pendingBytes, 30 * MB)
}

function testMountedVolumeBlackBoxStaysIndeterminate(): void {
  const track = createVmFlushProgressTracker()
  // 挂载卷 close 黑盒：无 stats、宿主无基准，保持扫动不确定态。
  const progress = track(sample(0, undefined, 0, 0))
  assert.equal(progress.stage, 'indeterminate')
  assert.equal(progress.pendingBytes, undefined)
  const again = track(sample(500, undefined, 0, 0))
  assert.equal(again.stage, 'indeterminate')
}

function testStaleGuestStatsDoNotBlockHostProgress(): void {
  const track = createVmFlushProgressTracker()
  track(sample(0, 100 * MB, 0, 0))
  track(sample(500, 50 * MB, 50 * MB, 50 * MB))
  // stats 流中断，最后一帧停在 50MB，但宿主 merge 已经开始递减：
  // 宿主递减优先于陈旧 guest pending，直接进阶段 B。
  const progress = track(sample(1000, 50 * MB, 49 * MB, 50 * MB))
  assert.equal(progress.stage, 'host')
  assert.equal(progress.pendingBytes, 49 * MB)
}

function testSpeedResetsAcrossStageSwitch(): void {
  const track = createVmFlushProgressTracker()
  track(sample(0, 200 * MB, 0, 0))
  const guestFast = track(sample(1000, 100 * MB, 100 * MB, 100 * MB))
  assert.ok(guestFast.speedBytesPerSec! >= 100 * MB)
  track(sample(2000, 0, 200 * MB, 200 * MB))
  // 刚切进阶段 B：采样重置，没有跨阶段的负跳污染，首拍无速度。
  const entered = track(sample(2500, 0, 199 * MB, 200 * MB))
  assert.equal(entered.stage, 'host')
  assert.equal(entered.speedBytesPerSec, undefined)
  const next = track(sample(4000, 0, 198 * MB, 200 * MB))
  assert.ok(next.speedBytesPerSec !== undefined && next.speedBytesPerSec < 10 * MB)
}

function testBurstyBatchPaceReportsTrueAverageSpeed(): void {
  const track = createVmFlushProgressTracker()
  // drain 逐批往返：批周期 1s、采样 500ms——每隔一拍才有一次 1MB 下降。
  // 「只在下降拍更新」的估计会把一批 ÷ 采样间隔误当恒速（报 2MB/s，虚高一倍）；
  // 窗口速度必须贴近全程均速 1MB/s。
  const total = 16 * MB
  let last: VmFlushProgress | undefined
  for (let tick = 0; tick <= 10; tick += 1) {
    const delivered = Math.floor(tick / 2) * MB
    last = track(sample(tick * 500, total - delivered, 0, 0))
  }
  assert.equal(last?.stage, 'guest')
  const expected = (5 * MB) / 5 // 5MB / 5s
  assert.ok(last?.speedBytesPerSec !== undefined)
  assert.ok(Math.abs(last!.speedBytesPerSec! - expected) / expected < 0.05)
}

function testSpeedSagsAndDropsDuringStall(): void {
  const track = createVmFlushProgressTracker()
  track(sample(0, 10 * MB, 0, 0))
  const moving = track(sample(1000, 9 * MB, 0, 0))
  assert.equal(moving.speedBytesPerSec, 1 * MB)
  // 停滞：pending 不再下降，窗口跨度被真实拉长，速度随之下坠而不是原地冻结。
  const stalled2s = track(sample(2000, 9 * MB, 0, 0))
  assert.ok(stalled2s.speedBytesPerSec !== undefined)
  assert.ok(stalled2s.speedBytesPerSec! < moving.speedBytesPerSec!)
  const stalled5s = track(sample(5000, 9 * MB, 0, 0))
  assert.ok(stalled5s.speedBytesPerSec !== undefined)
  assert.ok(stalled5s.speedBytesPerSec! < stalled2s.speedBytesPerSec!)
  // 停滞超过窗口：峰值样本滑出窗口，不再有可计量的下降，速度交回 undefined。
  const stalledOut = track(sample(1001 + VM_FLUSH_SPEED_WINDOW_MS, 9 * MB, 0, 0))
  assert.equal(stalledOut.speedBytesPerSec, undefined)
}

function testPendingRiseInsideWindowDoesNotYieldSpeed(): void {
  const track = createVmFlushProgressTracker()
  track(sample(0, 10 * MB, 0, 0))
  // 客机收尾仍在写入新脏数据：pending 上涨。锚点跟随窗口峰值，不产生负速度。
  const risen = track(sample(1000, 12 * MB, 0, 0))
  assert.equal(risen.speedBytesPerSec, undefined)
  // 峰值之后开始下降：速度从峰值起算，只计真实下降段。
  const falling = track(sample(2000, 11 * MB, 0, 0))
  assert.equal(falling.speedBytesPerSec, 1 * MB)
}

function testStallHeartbeat(): void {
  const track = createVmFlushProgressTracker()
  track(sample(0, 100 * MB, 0, 0))
  const moving = track(sample(500, 99 * MB, 1 * MB, 1 * MB))
  assert.equal(moving.stalledMs, 0)

  // pending 不再下降：stalledMs 从上次进展起算，跨阈值后 UI 追加心跳文案。
  track(sample(1000, 99 * MB, 2 * MB, 2 * MB))
  const stalled = track(sample(500 + VM_FLUSH_STALL_THRESHOLD_MS + 1, 99 * MB, 3 * MB, 3 * MB))
  assert.equal(stalled.stage, 'guest')
  assert.ok(stalled.stalledMs > VM_FLUSH_STALL_THRESHOLD_MS)

  // 恢复进展后归零。
  const resumed = track(sample(9500, 90 * MB, 12 * MB, 12 * MB))
  assert.equal(resumed.stalledMs, 0)
}

function testInvalidNumbersAreTolerated(): void {
  const track = createVmFlushProgressTracker()
  const progress = track(sample(0, Number.NaN, Number.NaN, -1))
  assert.equal(progress.stage, 'indeterminate')
  const next = track(sample(500, 10 * MB, 0, 0))
  assert.equal(next.stage, 'guest')
  assert.equal(next.totalBytes, 10 * MB)
}

testGuestStageDecreasesFromPinnedBaseline()
testGuestBaselineSelfHealsWhenFirstSampleMissesPeak()
testHostStageStartsOnObservedDecrease()
testMidMergeEntryGoesStraightToHostStage()
testMountedVolumeBlackBoxStaysIndeterminate()
testStaleGuestStatsDoNotBlockHostProgress()
testSpeedResetsAcrossStageSwitch()
testBurstyBatchPaceReportsTrueAverageSpeed()
testSpeedSagsAndDropsDuringStall()
testPendingRiseInsideWindowDoesNotYieldSpeed()
testStallHeartbeat()
testInvalidNumbersAreTolerated()
console.log('virtual-machine-flush-progress.test.ts ok')
