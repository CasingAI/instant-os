/**
 * 三模式落盘状态行与页面关闭拦截判定。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-disk-write-status.test.ts
 */
import assert from 'node:assert/strict'
import {
  VM_DISK_PENDING_WARN_BYTES,
  combineDiskWriteLoss,
  formatVmDiskBytes,
  shouldGuardVmUnload,
  totalUnflushedDiskBytes,
  vmDiskWriteStatus,
} from './virtual-machine-disk-write-status.ts'
import { emptyVmStatsSnapshot } from './virtual-machine-protocol.ts'

function testFormatBytes(): void {
  assert.equal(formatVmDiskBytes(0), '0 MB')
  assert.equal(formatVmDiskBytes(-1), '0 MB')
  assert.equal(formatVmDiskBytes(Number.NaN), '0 MB')
  assert.equal(formatVmDiskBytes(512), '512 B')
  assert.equal(formatVmDiskBytes(2048), '2.0 KB')
  assert.equal(formatVmDiskBytes(16 * 1024 * 1024), '16.0 MB')
  assert.equal(formatVmDiskBytes(3 * 1024 * 1024 * 1024), '3.00 GB')
}

function testNoneModeWarnsButNeverGuards(): void {
  const running = vmDiskWriteStatus({ mode: 'none', running: true, diskWrite: undefined })
  assert.equal(running.tone, 'warn')
  assert.match(running.text, /关闭页面都会丢失/)
  // none 是明确约定不保存的模式，不该在每次关标签页时弹原生提示。
  assert.equal(running.atRisk, false)

  const stopped = vmDiskWriteStatus({ mode: 'none', running: false, diskWrite: undefined })
  assert.equal(stopped.tone, 'off')
  assert.equal(stopped.atRisk, false)
}

function testLiveModeReportsDroppedWrites(): void {
  const healthy = vmDiskWriteStatus({
    mode: 'live',
    running: true,
    diskWrite: { pendingBytes: 0, pendingRanges: 0, droppedWrites: 0, droppedBytes: 0 },
  })
  assert.equal(healthy.tone, 'info')
  assert.equal(healthy.atRisk, false)

  const lost = vmDiskWriteStatus({
    mode: 'live',
    running: true,
    diskWrite: { pendingBytes: 0, pendingRanges: 0, droppedWrites: 3, droppedBytes: 8192 },
  })
  assert.equal(lost.tone, 'danger')
  assert.match(lost.text, /3 条磁盘写入未能写入镜像（约 8.0 KB）/)
  // 已经丢掉的写入不会因为再关一次页面而再丢一次，为它弹原生提示只是噪音。
  assert.equal(lost.atRisk, false)

  const lostWithPending = vmDiskWriteStatus({
    mode: 'live',
    running: true,
    diskWrite: { pendingBytes: 4096, pendingRanges: 1, droppedWrites: 3, droppedBytes: 8192 },
  })
  assert.equal(lostWithPending.tone, 'danger')
  assert.equal(lostWithPending.atRisk, true, '还有悬着的写入时仍然要拦')
}

function testLiveInFlightBytesCountAsAtRisk(): void {
  const status = vmDiskWriteStatus({
    mode: 'live',
    running: true,
    diskWrite: { pendingBytes: 4096, pendingRanges: 1, droppedWrites: 0, droppedBytes: 0 },
  })
  assert.equal(status.tone, 'info')
  assert.equal(status.atRisk, true, 'live 在途未发送的字节同样经不起直接关页面')
}

function testPoweroffModeSurfacesPendingBytes(): void {
  const idle = vmDiskWriteStatus({
    mode: 'poweroff',
    running: true,
    diskWrite: { pendingBytes: 0, pendingRanges: 0, droppedWrites: 0, droppedBytes: 0 },
  })
  assert.equal(idle.tone, 'info')
  assert.equal(idle.atRisk, false)

  const dirty = vmDiskWriteStatus({
    mode: 'poweroff',
    running: true,
    diskWrite: {
      pendingBytes: 128 * 1024 * 1024,
      pendingRanges: 42,
      droppedWrites: 0,
      droppedBytes: 0,
    },
  })
  assert.equal(dirty.tone, 'warn')
  assert.match(dirty.text, /已有 128.0 MB 待写入镜像/)
  assert.match(dirty.text, /此刻关闭页面会全部丢失/)
  assert.equal(dirty.atRisk, true)

  const lost = vmDiskWriteStatus({
    mode: 'poweroff',
    running: true,
    diskWrite: {
      pendingBytes: 1024,
      pendingRanges: 1,
      droppedWrites: 2,
      droppedBytes: 1024,
    },
  })
  assert.equal(lost.tone, 'danger', '丢过数据时优先报丢失，而不是报还剩多少')
  assert.equal(lost.atRisk, true, '还有 1.0 KB 悬着，关了仍然会丢')
}

function testStoppedPoweroffDoesNotGuard(): void {
  const status = vmDiskWriteStatus({
    mode: 'poweroff',
    running: false,
    diskWrite: { pendingBytes: 4096, pendingRanges: 1, droppedWrites: 0, droppedBytes: 0 },
  })
  assert.equal(status.tone, 'off')
  assert.equal(status.atRisk, false, '机器已经停了就没有「关了会丢」的数据')
}

function testTotalUnflushedBytes(): void {
  const first = emptyVmStatsSnapshot()
  first.diskWrite = { pendingBytes: 1024, pendingRanges: 1, droppedWrites: 0, droppedBytes: 0 }
  const second = emptyVmStatsSnapshot()
  second.diskWrite = { pendingBytes: 2048, pendingRanges: 1, droppedWrites: 0, droppedBytes: 0 }
  assert.equal(totalUnflushedDiskBytes([first, undefined, second]), 3072)
  assert.equal(totalUnflushedDiskBytes([]), 0)
  assert.equal(totalUnflushedDiskBytes([undefined]), 0)
}

function testShouldGuardVmUnload(): void {
  assert.equal(
    shouldGuardVmUnload({ flushing: false, awaitingGuestShutdown: false, unflushedBytes: 0 }),
    false,
  )
  assert.equal(
    shouldGuardVmUnload({ flushing: true, awaitingGuestShutdown: false, unflushedBytes: 0 }),
    true,
  )
  assert.equal(
    shouldGuardVmUnload({ flushing: false, awaitingGuestShutdown: true, unflushedBytes: 0 }),
    true,
  )
  // 这条是本次修复的核心：poweroff 运行期攒着整次开机的改动，以前完全不拦。
  assert.equal(
    shouldGuardVmUnload({ flushing: false, awaitingGuestShutdown: false, unflushedBytes: 1 }),
    true,
  )
}

function testPoweroffPendingOverThresholdEscalates(): void {
  const big = vmDiskWriteStatus({
    mode: 'poweroff',
    running: true,
    diskWrite: {
      pendingBytes: VM_DISK_PENDING_WARN_BYTES,
      pendingRanges: 900,
      droppedWrites: 0,
      droppedBytes: 0,
    },
  })
  assert.equal(big.tone, 'danger')
  assert.match(big.text, /建议尽快关机写入镜像/)
  assert.equal(big.atRisk, true)
  // 差一个字节就不到阈值，仍是 warn。
  const justUnder = vmDiskWriteStatus({
    mode: 'poweroff',
    running: true,
    diskWrite: {
      pendingBytes: VM_DISK_PENDING_WARN_BYTES - 1,
      pendingRanges: 900,
      droppedWrites: 0,
      droppedBytes: 0,
    },
  })
  assert.equal(justUnder.tone, 'warn')
}

function testCombineDiskWriteLoss(): void {
  const runtimeLoss = { pendingBytes: 0, pendingRanges: 0, droppedWrites: 2, droppedBytes: 512 }
  // 两处来源相加：iframe 侧回写器丢的 + 宿主释放闸门丢的。
  assert.deepEqual(combineDiskWriteLoss(runtimeLoss, 3), { droppedWrites: 5, droppedBytes: 512 })
  // 只有宿主侧丢：没有 iframe 侧字节数可用，droppedBytes 记 0（不编造数字）。
  assert.deepEqual(combineDiskWriteLoss(undefined, 1), { droppedWrites: 1, droppedBytes: 0 })
  assert.deepEqual(combineDiskWriteLoss(runtimeLoss, 0), { droppedWrites: 2, droppedBytes: 512 })
  // 两处都为零时不产生记录——否则会凭空长出「丢过数据」的横幅。
  assert.equal(combineDiskWriteLoss(undefined, 0), undefined)
  assert.equal(combineDiskWriteLoss(undefined, -1), undefined)
  assert.equal(combineDiskWriteLoss(undefined, Number.NaN), undefined)
}

testFormatBytes()
testCombineDiskWriteLoss()
testNoneModeWarnsButNeverGuards()
testLiveModeReportsDroppedWrites()
testLiveInFlightBytesCountAsAtRisk()
testPoweroffModeSurfacesPendingBytes()
testPoweroffPendingOverThresholdEscalates()
testStoppedPoweroffDoesNotGuard()
testTotalUnflushedBytes()
testShouldGuardVmUnload()
console.log('virtual-machine-disk-write-status.test.ts ok')
