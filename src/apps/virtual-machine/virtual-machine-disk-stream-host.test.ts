/**
 * 磁盘流宿主回写状态单测。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-disk-stream-host.test.ts
 */
import assert from 'node:assert/strict'
import { INSTANT_VM_DISK_RANGE_MAX_BYTES } from './virtual-machine-protocol.ts'
import {
  diskReadReplyStatus,
  diskWriteReplyStatus,
  DirtyOverlay,
  evaluateReleaseGate,
  getVirtualMachineDiskFlushProgress,
  RELEASE_WRITE_GRACE_MAX_MS,
  type StreamReleaseState,
} from './virtual-machine-disk-stream-host.ts'

function testMissingStreamIs404(): void {
  assert.equal(diskWriteReplyStatus(undefined, 0, 512), 404)
}

function testReadonlyStreamIs403(): void {
  assert.equal(diskWriteReplyStatus({ size: 4096, writable: false }, 0, 512), 403)
}

function testOutOfRangeIs416(): void {
  const entry = { size: 1024, writable: true }
  assert.equal(diskWriteReplyStatus(entry, 1024, 1), 416)
  assert.equal(diskWriteReplyStatus(entry, 512, 513), 416)
  assert.equal(diskWriteReplyStatus(entry, -1, 8), 416)
  assert.equal(diskWriteReplyStatus(entry, 0, 0), 416)
}

function testTooLargeIs413(): void {
  assert.equal(
    diskWriteReplyStatus(
      { size: INSTANT_VM_DISK_RANGE_MAX_BYTES + 4096, writable: true },
      0,
      INSTANT_VM_DISK_RANGE_MAX_BYTES + 1,
    ),
    413,
  )
}

function testWritableInRangeIs200(): void {
  assert.equal(diskWriteReplyStatus({ size: 4096, writable: true }, 512, 512), 200)
  assert.equal(diskWriteReplyStatus({ size: 4096, writable: true }, 0, 4096), 200)
}

function testDiskReadFullFileIsStillPartial(): void {
  assert.equal(diskReadReplyStatus(undefined, 0, 512), 404)
  assert.equal(diskReadReplyStatus({ size: 4096 }, -1, 8), 416)
  assert.equal(diskReadReplyStatus({ size: 4096 }, 4096, 1), 416)
  assert.equal(diskReadReplyStatus({ size: 4096 }, 0, 512), 206)
  assert.equal(diskReadReplyStatus({ size: 4096 }, 0, 4096), 206)
}

function testOverlayReadOwnWrites(): void {
  const overlay = new DirtyOverlay()
  const a = new Uint8Array([1, 2, 3, 4])
  const b = new Uint8Array([5, 6, 7, 8])
  overlay.write(0, a)
  overlay.write(512, b)
  assert.deepEqual(overlay.read(0, 4), a)
  assert.deepEqual(overlay.read(512, 4), b)
  assert.equal(overlay.read(1024, 4), undefined)
}

function testOverlayMergesAdjacentWrites(): void {
  const overlay = new DirtyOverlay()
  overlay.write(0, new Uint8Array([1, 2, 3, 4]))
  overlay.write(4, new Uint8Array([5, 6, 7, 8]))
  assert.equal(overlay.dirtyBytes, 8)
  assert.deepEqual(overlay.read(0, 8), new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
  const runs = overlay.listRuns()
  assert.equal(runs.length, 1)
  assert.equal(runs[0]?.offset, 0)
  assert.equal(runs[0]?.bytes.byteLength, 8)
}

function testOverlayPartialReadFails(): void {
  const overlay = new DirtyOverlay()
  overlay.write(0, new Uint8Array([1, 2, 3, 4]))
  overlay.write(8, new Uint8Array([5, 6, 7, 8]))
  assert.equal(overlay.read(0, 8), undefined)
  assert.deepEqual(overlay.read(0, 4), new Uint8Array([1, 2, 3, 4]))
  assert.deepEqual(overlay.read(8, 4), new Uint8Array([5, 6, 7, 8]))
}

/**
 * 256KB 对齐预取窗里只有后半段脏、且脏段贴着窗口末尾：旧实现会把这段
 * 贴到缓冲区开头并当成读满。NTLDR 与稍后拷进去的 PE 同窗时，引导簇会被
 * 导入表覆盖。
 */
function testOverlayReadGapBeforeTailRunDoesNotClaimFullCoverage(): void {
  const windowSize = 256 * 1024
  const ntldrOff = 19968
  const overlay = new DirtyOverlay()
  const dll = new Uint8Array(windowSize - 64 * 1024)
  dll[0] = 0x4d
  dll[1] = 0x5a
  dll[ntldrOff] = 0x50
  overlay.write(64 * 1024, dll)
  assert.equal(overlay.read(0, windowSize), undefined)
  const composed = new Uint8Array(windowSize)
  composed[ntldrOff] = 0xeb
  composed[ntldrOff + 1] = 0x3c
  composed[ntldrOff + 2] = 0x90
  for (const run of overlay.runsOverlapping(0, windowSize)) {
    composed.set(run.bytes, run.offset)
  }
  assert.deepEqual([...composed.subarray(ntldrOff, ntldrOff + 3)], [0xeb, 0x3c, 0x90])
  assert.equal(composed[64 * 1024], 0x4d)
  assert.equal(composed[64 * 1024 + 1], 0x5a)
  assert.equal(composed[64 * 1024 + ntldrOff], 0x50)
}

function testOverlayReadRequiresContiguousCoverageFromStart(): void {
  const overlay = new DirtyOverlay()
  overlay.write(8, new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]))
  assert.equal(overlay.read(0, 16), undefined)
  assert.deepEqual(overlay.read(8, 8), new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]))
}

function testOverlayListRunsAndClear(): void {
  const overlay = new DirtyOverlay()
  overlay.write(0, new Uint8Array([1, 2, 3, 4]))
  overlay.write(512, new Uint8Array([5, 6]))
  const runs = overlay.listRuns()
  assert.equal(runs.length, 2)
  assert.equal(overlay.dirtyBytes, 6)
  overlay.clear()
  assert.equal(overlay.dirtyBytes, 0)
  assert.equal(overlay.listRuns().length, 0)
}

function testOverlayTrimRemovesWrittenRange(): void {
  // live 档每批写进可见文件后裁掉覆盖层，断电进度只统计未写完的尾巴
  const overlay = new DirtyOverlay()
  overlay.write(0, new Uint8Array([1, 2, 3, 4]))
  overlay.write(512, new Uint8Array([5, 6, 7, 8]))
  overlay.trim(0, 4)
  assert.equal(overlay.dirtyBytes, 4)
  assert.equal(overlay.read(0, 4), undefined)
  assert.deepEqual(overlay.read(512, 4), new Uint8Array([5, 6, 7, 8]))
}

function testOverlayTrimSplitsPartiallyWrittenRun(): void {
  const overlay = new DirtyOverlay()
  overlay.write(0, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
  overlay.trim(2, 4)
  assert.equal(overlay.dirtyBytes, 4)
  assert.deepEqual(overlay.read(0, 2), new Uint8Array([1, 2]))
  assert.equal(overlay.read(2, 4), undefined)
  assert.deepEqual(overlay.read(6, 2), new Uint8Array([7, 8]))
  assert.equal(overlay.listRuns().length, 2)
}

function testOverlayTrimKeepsUnrelatedRuns(): void {
  const overlay = new DirtyOverlay()
  overlay.write(0, new Uint8Array([1, 2]))
  overlay.write(512, new Uint8Array([3, 4]))
  overlay.trim(100, 16)
  assert.equal(overlay.dirtyBytes, 4)
  assert.equal(overlay.listRuns().length, 2)
}

function testOverlayTrimClampsToWriteRanges(): void {
  const overlay = new DirtyOverlay()
  overlay.write(4, new Uint8Array([1, 2, 3, 4]))
  overlay.trim(0, 6)
  assert.equal(overlay.dirtyBytes, 2)
  assert.deepEqual(overlay.read(6, 2), new Uint8Array([3, 4]))
  overlay.trim(0, Number.MAX_SAFE_INTEGER)
  assert.equal(overlay.dirtyBytes, 0)
}

function releaseState(overrides: Partial<StreamReleaseState> = {}): StreamReleaseState {
  return {
    startedAt: 1_000,
    closing: false,
    acceptedWriteCount: 0,
    discardedWrites: 0,
    ...overrides,
  }
}

function testReleaseGatePassesMessagesReceivedBeforeRelease(): void {
  const state = releaseState({ closing: true })
  // release 前接收的消息（含排队中还没执行的写）必须照常执行，不许丢
  assert.equal(evaluateReleaseGate(state, 900, true), 'process')
  assert.equal(evaluateReleaseGate(state, 900, false), 'process')
  assert.equal(state.discardedWrites, 0)
}

function testReleaseGateDropsReadsAfterRelease(): void {
  const state = releaseState()
  assert.equal(evaluateReleaseGate(state, 1_500, false), 'drop')
  assert.equal(state.discardedWrites, 0)
}

function testReleaseGateGracesWritesWithinWindow(): void {
  const state = releaseState()
  assert.equal(evaluateReleaseGate(state, 1_000 + RELEASE_WRITE_GRACE_MAX_MS, true), 'process')
  assert.equal(state.acceptedWriteCount, 1)
  assert.equal(state.discardedWrites, 0)
}

function testReleaseGateDropsWritesAfterGraceOrClose(): void {
  const expired = releaseState()
  assert.equal(
    evaluateReleaseGate(expired, 1_000 + RELEASE_WRITE_GRACE_MAX_MS + 1, true),
    'drop',
  )
  assert.equal(expired.discardedWrites, 1)

  const closed = releaseState({ closing: true })
  assert.equal(evaluateReleaseGate(closed, 1_100, true), 'drop')
  assert.equal(closed.discardedWrites, 1)
}

function testReleaseGatePassesWithoutState(): void {
  assert.equal(evaluateReleaseGate(undefined, 5_000, true), 'process')
  assert.equal(evaluateReleaseGate(undefined, 5_000, false), 'process')
}

function testFlushProgressSumsEmptyIds(): void {
  assert.deepEqual(getVirtualMachineDiskFlushProgress([]), { pendingBytes: 0, totalBytes: 0 })
  assert.deepEqual(getVirtualMachineDiskFlushProgress([undefined, undefined]), {
    pendingBytes: 0,
    totalBytes: 0,
  })
}

testMissingStreamIs404()
testReadonlyStreamIs403()
testOutOfRangeIs416()
testTooLargeIs413()
testWritableInRangeIs200()
testDiskReadFullFileIsStillPartial()
testOverlayReadOwnWrites()
testOverlayMergesAdjacentWrites()
testOverlayPartialReadFails()
testOverlayReadGapBeforeTailRunDoesNotClaimFullCoverage()
testOverlayReadRequiresContiguousCoverageFromStart()
testOverlayListRunsAndClear()
testOverlayTrimRemovesWrittenRange()
testOverlayTrimSplitsPartiallyWrittenRun()
testOverlayTrimKeepsUnrelatedRuns()
testOverlayTrimClampsToWriteRanges()
testReleaseGatePassesMessagesReceivedBeforeRelease()
testReleaseGateDropsReadsAfterRelease()
testReleaseGateGracesWritesWithinWindow()
testReleaseGateDropsWritesAfterGraceOrClose()
testReleaseGatePassesWithoutState()
testFlushProgressSumsEmptyIds()
console.log('virtual-machine-disk-stream-host.test.ts ok')
