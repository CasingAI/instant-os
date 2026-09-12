/**
 * 磁盘流宿主回写状态单测。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-disk-stream-host.test.ts
 */
import assert from 'node:assert/strict'
import { INSTANT_VM_DISK_RANGE_MAX_BYTES } from './virtual-machine-protocol.ts'
import {
  createOverlayFlusher,
  diskReadReplyStatus,
  diskWriteReplyStatus,
  drainThenFlushThenClose,
  DirtyOverlay,
  evaluateReleaseGate,
  getVirtualMachineDiskFlushProgress,
  OVERLAY_FLUSH_MAX_ATTEMPTS,
  OVERLAY_HIGH_WATER_BYTES,
  OVERLAY_LOW_WATER_BYTES,
  RELEASE_WRITE_GRACE_MAX_MS,
  type OverlayPersistSink,
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
  const runs = overlay.takeRunsForFlush()
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

function stubSink(overrides: Partial<OverlayPersistSink> = {}): OverlayPersistSink {
  return {
    async append() {},
    async flush() {},
    ...overrides,
  }
}

async function testFlusherRestoresDirtyRunsOnFailure(): Promise<void> {
  const pending = new DirtyOverlay()
  pending.write(0, new Uint8Array([1, 2, 3, 4]))
  pending.write(512, new Uint8Array([5, 6, 7, 8]))
  let call = 0
  const flusher = createOverlayFlusher(
    pending,
    stubSink({
      async append() {
        call += 1
        if (call === 1) return
        throw new Error('disk full')
      },
    }),
  )
  let threw = false
  try {
    await flusher.flushUntilEmpty()
  } catch {
    threw = true
  }
  assert.equal(threw, true)
  assert.equal(pending.dirtyBytes, 4)
  assert.deepEqual(pending.read(512, 4), new Uint8Array([5, 6, 7, 8]))
}

async function testFlusherRestoresAllRunsWhenPersistFlushFails(): Promise<void> {
  const pending = new DirtyOverlay()
  pending.write(0, new Uint8Array([1, 2, 3, 4]))
  pending.write(512, new Uint8Array([5, 6, 7, 8]))
  const flusher = createOverlayFlusher(
    pending,
    stubSink({
      async flush() {
        throw new Error('persist failed')
      },
    }),
  )
  await assert.rejects(() => flusher.flushUntilEmpty())
  assert.equal(pending.dirtyBytes, 8)
  assert.deepEqual(pending.read(0, 4), new Uint8Array([1, 2, 3, 4]))
  assert.deepEqual(pending.read(512, 4), new Uint8Array([5, 6, 7, 8]))
}

async function testFlusherSerializesConcurrentFlush(): Promise<void> {
  const pending = new DirtyOverlay()
  pending.write(0, new Uint8Array([1, 2, 3, 4]))
  let running = 0
  let maxRunning = 0
  const flusher = createOverlayFlusher(
    pending,
    stubSink({
      async append() {
        running += 1
        maxRunning = Math.max(maxRunning, running)
        await new Promise((resolve) => setTimeout(resolve, 10))
        running -= 1
      },
      async flush() {
        await new Promise((resolve) => setTimeout(resolve, 10))
      },
    }),
  )
  await Promise.all([flusher.flushUntilEmpty(), flusher.flushUntilEmpty(), flusher.flushUntilEmpty()])
  assert.equal(maxRunning, 1)
  assert.equal(pending.dirtyBytes, 0)
}

async function testReleaseDrainsThenFlushesThenCloses(): Promise<void> {
  const pending = new DirtyOverlay()
  const order: string[] = []
  let closed = false
  const flusher = createOverlayFlusher(
    pending,
    stubSink({
      async append() {
        if (closed) throw new Error('append after close')
        order.push('append')
      },
      async flush() {
        if (closed) throw new Error('flush after close')
        order.push('flush')
      },
    }),
  )
  let queuedWriteDone: () => void = () => undefined
  const queued = new Promise<void>((resolve) => {
    queuedWriteDone = resolve
  })
  const release = drainThenFlushThenClose({
    drain: async () => {
      order.push('drain-start')
      await queued
      pending.write(0, new Uint8Array([9, 8, 7, 6]))
      order.push('drain-end')
    },
    flushUntilEmpty: () => flusher.flushUntilEmpty(),
    close: async () => {
      closed = true
      order.push('close')
    },
  })
  queuedWriteDone()
  await release
  assert.deepEqual(order, ['drain-start', 'drain-end', 'append', 'flush', 'close'])
  assert.equal(pending.dirtyBytes, 0)
  assert.equal(closed, true)
}

async function testOverlayBackpressureFlushesBeforeAck(): Promise<void> {
  const pending = new DirtyOverlay()
  let persistRounds = 0
  const flusher = createOverlayFlusher(
    pending,
    stubSink({
      async flush() {
        persistRounds += 1
      },
    }),
  )
  pending.write(0, new Uint8Array(OVERLAY_HIGH_WATER_BYTES + 16))
  assert.equal(persistRounds, 0)
  await flusher.acknowledgeGuestWrite()
  assert.ok(persistRounds >= 1)
  assert.ok(pending.dirtyBytes <= OVERLAY_LOW_WATER_BYTES)
}

async function testFlushUntilEmptySerializesConcurrentCallers(): Promise<void> {
  const pending = new DirtyOverlay()
  pending.write(0, new Uint8Array([1, 2, 3, 4]))
  pending.write(512, new Uint8Array([5, 6, 7, 8]))
  let rounds = 0
  const flusher = createOverlayFlusher(
    pending,
    stubSink({
      async flush() {
        rounds += 1
        await new Promise((resolve) => setTimeout(resolve, 5))
      },
    }),
  )
  await Promise.all([flusher.flushUntilEmpty(), flusher.flushUntilEmpty(), flusher.flushUntilEmpty()])
  assert.equal(rounds, 1)
  assert.equal(pending.dirtyBytes, 0)
}

async function testFlushUntilEmptyGivesUpAfterMaxAttempts(): Promise<void> {
  const pending = new DirtyOverlay()
  pending.write(0, new Uint8Array([1, 2, 3, 4]))
  const flusher = createOverlayFlusher(
    pending,
    stubSink({
      async append() {
        throw new Error('disk full')
      },
    }),
  )
  await assert.rejects(() => flusher.flushUntilEmpty(), /已中止/)
  assert.equal(pending.dirtyBytes, 4)
}

async function testFlushFailureRecoversOnRetry(): Promise<void> {
  const pending = new DirtyOverlay()
  pending.write(0, new Uint8Array([1, 2, 3, 4]))
  let remainingFails = OVERLAY_FLUSH_MAX_ATTEMPTS
  const flusher = createOverlayFlusher(
    pending,
    stubSink({
      async append() {
        if (remainingFails > 0) {
          remainingFails -= 1
          throw new Error('transient')
        }
      },
    }),
  )
  await assert.rejects(() => flusher.flushUntilEmpty(), /已中止/)
  assert.equal(pending.dirtyBytes, 4)
  await flusher.flushUntilEmpty()
  assert.equal(pending.dirtyBytes, 0)
}

async function testFlushUntilEmptyKeepsReadDuringBackpressure(): Promise<void> {
  const overlay = new DirtyOverlay()
  overlay.write(0, new Uint8Array(OVERLAY_HIGH_WATER_BYTES + 16))
  assert.equal(diskReadReplyStatus({ size: OVERLAY_HIGH_WATER_BYTES + 4096 }, 0, 16), 206)
  const hit = overlay.read(0, 16)
  assert.ok(hit)
  const pending = new DirtyOverlay()
  pending.write(0, new Uint8Array(OVERLAY_HIGH_WATER_BYTES + 16))
  const flusher = createOverlayFlusher(
    pending,
    stubSink({
      async flush() {
        await new Promise((resolve) => setTimeout(resolve, 20))
      },
    }),
  )
  const ack = flusher.acknowledgeGuestWrite()
  assert.equal(diskReadReplyStatus({ size: OVERLAY_HIGH_WATER_BYTES + 4096 }, 0, 16), 206)
  await ack
  assert.ok(overlay.dirtyBytes > OVERLAY_LOW_WATER_BYTES)
  assert.ok(pending.dirtyBytes <= OVERLAY_LOW_WATER_BYTES)
}

async function testFlusherWithoutSinkIsNoop(): Promise<void> {
  const pending = new DirtyOverlay()
  pending.write(0, new Uint8Array([1, 2, 3, 4]))
  const flusher = createOverlayFlusher(pending, undefined)
  await flusher.acknowledgeGuestWrite()
  await flusher.flushUntilEmpty()
  assert.equal(pending.dirtyBytes, 4)
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
  assert.deepEqual(getVirtualMachineDiskFlushProgress([]), { pendingBytes: 0 })
  assert.deepEqual(getVirtualMachineDiskFlushProgress([undefined, undefined]), {
    pendingBytes: 0,
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
testOverlayListRunsAndClear()
await testFlusherRestoresDirtyRunsOnFailure()
await testFlusherRestoresAllRunsWhenPersistFlushFails()
await testFlusherSerializesConcurrentFlush()
await testReleaseDrainsThenFlushesThenCloses()
await testOverlayBackpressureFlushesBeforeAck()
await testFlushUntilEmptySerializesConcurrentCallers()
await testFlushUntilEmptyGivesUpAfterMaxAttempts()
await testFlushFailureRecoversOnRetry()
await testFlushUntilEmptyKeepsReadDuringBackpressure()
await testFlusherWithoutSinkIsNoop()
testReleaseGatePassesMessagesReceivedBeforeRelease()
testReleaseGateDropsReadsAfterRelease()
testReleaseGateGracesWritesWithinWindow()
testReleaseGateDropsWritesAfterGraceOrClose()
testReleaseGatePassesWithoutState()
testFlushProgressSumsEmptyIds()
console.log('virtual-machine-disk-stream-host.test.ts ok')
