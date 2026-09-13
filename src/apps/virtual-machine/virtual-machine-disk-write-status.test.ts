/**
 * 硬盘差量状态行与页面关闭拦截判定。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-disk-write-status.test.ts
 */
import assert from 'node:assert/strict'
import {
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
  assert.equal(running.text, '改动先写入缓存，断电后会询问是否写入硬盘文件')
  assert.equal(running.atRisk, false)
  assert.equal(running.hud, false)

  const runningPending = vmDiskWriteStatus({
    mode: 'none',
    running: true,
    diskWrite: { pendingBytes: 4096, pendingRanges: 1, droppedWrites: 0, droppedBytes: 0 },
  })
  assert.equal(runningPending.tone, 'warn')
  assert.match(runningPending.text, /还有 4.0 KB 没写完/)
  assert.equal(runningPending.atRisk, true)

  const stopped = vmDiskWriteStatus({ mode: 'none', running: false, diskWrite: undefined })
  assert.equal(stopped.tone, 'off')
  assert.equal(stopped.text, '')
  assert.equal(stopped.atRisk, false)
  assert.equal(stopped.hud, false)
}

function testCacheModesReportDroppedWrites(): void {
  const healthy = vmDiskWriteStatus({
    mode: 'poweroff',
    running: true,
    diskWrite: { pendingBytes: 0, pendingRanges: 0, droppedWrites: 0, droppedBytes: 0 },
  })
  assert.equal(healthy.tone, 'info')
  assert.equal(healthy.text, '改动先写入缓存，关机后写入硬盘文件')
  assert.equal(healthy.atRisk, false)
  assert.equal(healthy.hud, false)

  const liveHealthy = vmDiskWriteStatus({
    mode: 'live',
    running: true,
    diskWrite: { pendingBytes: 0, pendingRanges: 0, droppedWrites: 0, droppedBytes: 0 },
  })
  assert.equal(liveHealthy.tone, 'off')
  assert.equal(liveHealthy.text, '改动尽快写入硬盘文件')
  assert.equal(liveHealthy.atRisk, false)

  const lost = vmDiskWriteStatus({
    mode: 'poweroff',
    running: true,
    diskWrite: { pendingBytes: 0, pendingRanges: 0, droppedWrites: 3, droppedBytes: 8192 },
  })
  assert.equal(lost.tone, 'danger')
  assert.match(lost.text, /3 条硬盘改动没能保存（约 8.0 KB）/)
  assert.equal(lost.atRisk, false)
  assert.equal(lost.hud, true)

  const lostWithPending = vmDiskWriteStatus({
    mode: 'poweroff',
    running: true,
    diskWrite: { pendingBytes: 4096, pendingRanges: 1, droppedWrites: 3, droppedBytes: 8192 },
  })
  assert.equal(lostWithPending.tone, 'danger')
  assert.equal(lostWithPending.atRisk, true)
  assert.equal(lostWithPending.hud, true)
}

function testCacheModesInFlightBytesCountAsAtRisk(): void {
  const status = vmDiskWriteStatus({
    mode: 'poweroff',
    running: true,
    diskWrite: { pendingBytes: 4096, pendingRanges: 1, droppedWrites: 0, droppedBytes: 0 },
  })
  assert.equal(status.tone, 'warn')
  assert.equal(status.atRisk, true)
  assert.equal(status.hud, false)
  // poweroff 在途字节正在进缓存，不是在写硬盘文件
  assert.equal(status.text, '改动正在写入缓存，还剩 4.0 KB')

  const live = vmDiskWriteStatus({
    mode: 'live',
    running: true,
    diskWrite: { pendingBytes: 4096, pendingRanges: 1, droppedWrites: 0, droppedBytes: 0 },
  })
  assert.equal(live.tone, 'warn')
  assert.equal(live.atRisk, true)
  // live 在途字节正在进硬盘文件
  assert.equal(live.text, '正在写入硬盘文件，还剩 4.0 KB')
}

function testStoppedCacheModeDoesNotGuard(): void {
  const status = vmDiskWriteStatus({
    mode: 'poweroff',
    running: false,
    diskWrite: { pendingBytes: 4096, pendingRanges: 1, droppedWrites: 0, droppedBytes: 0 },
  })
  assert.equal(status.tone, 'off')
  assert.equal(status.text, '')
  assert.equal(status.atRisk, false)
  assert.equal(status.hud, false)
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
  assert.equal(
    shouldGuardVmUnload({ flushing: false, awaitingGuestShutdown: false, unflushedBytes: 1 }),
    true,
  )
}

function testCombineDiskWriteLoss(): void {
  const runtimeLoss = { pendingBytes: 0, pendingRanges: 0, droppedWrites: 2, droppedBytes: 512 }
  assert.deepEqual(combineDiskWriteLoss(runtimeLoss, 3), { droppedWrites: 5, droppedBytes: 512 })
  assert.deepEqual(combineDiskWriteLoss(undefined, 1), { droppedWrites: 1, droppedBytes: 0 })
  assert.deepEqual(combineDiskWriteLoss(runtimeLoss, 0), { droppedWrites: 2, droppedBytes: 512 })
  assert.equal(combineDiskWriteLoss(undefined, 0), undefined)
  assert.equal(combineDiskWriteLoss(undefined, -1), undefined)
  assert.equal(combineDiskWriteLoss(undefined, Number.NaN), undefined)
}

testFormatBytes()
testCombineDiskWriteLoss()
testNoneModeWarnsButNeverGuards()
testCacheModesReportDroppedWrites()
testCacheModesInFlightBytesCountAsAtRisk()
testStoppedCacheModeDoesNotGuard()
testTotalUnflushedBytes()
testShouldGuardVmUnload()
console.log('virtual-machine-disk-write-status.test.ts ok')
