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
  OVERLAY_FLUSH_MAX_ATTEMPTS,
  OVERLAY_HIGH_WATER_BYTES,
  OVERLAY_LOW_WATER_BYTES,
} from './virtual-machine-disk-stream-host.ts'
import type { QuietBlobWriter } from '../files/files-quiet-blob-write.ts'

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

function stubWriter(overrides: Partial<QuietBlobWriter> = {}): QuietBlobWriter {
  return {
    async writeAt() {},
    async flush() {},
    async close() {},
    async abort() {},
    ...overrides,
  }
}

function stubEntry(writer: QuietBlobWriter) {
  return {
    path: '/x.img',
    size: OVERLAY_HIGH_WATER_BYTES + 4096,
    writable: true,
    quietWriter: writer,
  }
}

async function testFlusherRestoresDirtyRunsOnFailure(): Promise<void> {
  const overlay = new DirtyOverlay()
  overlay.write(0, new Uint8Array([1, 2, 3, 4]))
  overlay.write(512, new Uint8Array([5, 6, 7, 8]))
  let call = 0
  const flusher = createOverlayFlusher(
    's1',
    stubEntry(
      stubWriter({
        async writeAt() {
          call += 1
          if (call === 1) return
          throw new Error('disk full')
        },
      }),
    ),
    overlay,
  )
  let threw = false
  try {
    await flusher.flushUntilEmpty()
  } catch {
    threw = true
  }
  assert.equal(threw, true)
  assert.equal(overlay.dirtyBytes, 4)
  assert.deepEqual(overlay.read(512, 4), new Uint8Array([5, 6, 7, 8]))
}

async function testFlusherRestoresAllRunsWhenPersistFlushFails(): Promise<void> {
  const overlay = new DirtyOverlay()
  overlay.write(0, new Uint8Array([1, 2, 3, 4]))
  overlay.write(512, new Uint8Array([5, 6, 7, 8]))
  const flusher = createOverlayFlusher(
    's1b',
    stubEntry(
      stubWriter({
        async flush() {
          throw new Error('persist failed')
        },
      }),
    ),
    overlay,
  )
  await assert.rejects(() => flusher.flushUntilEmpty())
  assert.equal(overlay.dirtyBytes, 8)
  assert.deepEqual(overlay.read(0, 4), new Uint8Array([1, 2, 3, 4]))
  assert.deepEqual(overlay.read(512, 4), new Uint8Array([5, 6, 7, 8]))
}

async function testFlusherSerializesConcurrentFlush(): Promise<void> {
  const overlay = new DirtyOverlay()
  overlay.write(0, new Uint8Array([1, 2, 3, 4]))
  let running = 0
  let maxRunning = 0
  const flusher = createOverlayFlusher(
    's2',
    stubEntry(
      stubWriter({
        async writeAt() {
          running += 1
          maxRunning = Math.max(maxRunning, running)
          await new Promise((resolve) => setTimeout(resolve, 10))
          running -= 1
        },
        async flush() {
          await new Promise((resolve) => setTimeout(resolve, 10))
        },
      }),
    ),
    overlay,
  )
  await Promise.all([flusher.flushUntilEmpty(), flusher.flushUntilEmpty(), flusher.flushUntilEmpty()])
  assert.equal(maxRunning, 1)
  assert.equal(overlay.dirtyBytes, 0)
}

async function testReleaseDrainsThenFlushesThenCloses(): Promise<void> {
  const overlay = new DirtyOverlay()
  const order: string[] = []
  let closed = false
  const writer = stubWriter({
    async writeAt() {
      if (closed) throw new Error('writeAt after close')
      order.push('writeAt')
    },
    async flush() {
      if (closed) throw new Error('flush after close')
      order.push('flush')
    },
    async close() {
      closed = true
      order.push('close')
    },
  })
  const flusher = createOverlayFlusher('s3', stubEntry(writer), overlay)
  let queuedWriteDone: () => void = () => undefined
  const queued = new Promise<void>((resolve) => {
    queuedWriteDone = resolve
  })
  const release = drainThenFlushThenClose({
    drain: async () => {
      order.push('drain-start')
      await queued
      overlay.write(0, new Uint8Array([9, 8, 7, 6]))
      order.push('drain-end')
    },
    flushUntilEmpty: () => flusher.flushUntilEmpty(),
    close: () => writer.close(),
  })
  queuedWriteDone()
  await release
  assert.deepEqual(order, ['drain-start', 'drain-end', 'writeAt', 'flush', 'close'])
  assert.equal(overlay.dirtyBytes, 0)
  assert.equal(closed, true)
}

async function testOverlayBackpressureFlushesBeforeAck(): Promise<void> {
  const overlay = new DirtyOverlay()
  let persistRounds = 0
  const flusher = createOverlayFlusher(
    's4',
    stubEntry(
      stubWriter({
        async flush() {
          persistRounds += 1
        },
      }),
    ),
    overlay,
  )
  overlay.write(0, new Uint8Array(OVERLAY_HIGH_WATER_BYTES + 16))
  assert.equal(persistRounds, 0)
  await flusher.acknowledgeGuestWrite()
  assert.ok(persistRounds >= 1)
  assert.ok(overlay.dirtyBytes <= OVERLAY_LOW_WATER_BYTES)
}

async function testFlushUntilEmptySerializesConcurrentCallers(): Promise<void> {
  const overlay = new DirtyOverlay()
  overlay.write(0, new Uint8Array([1, 2, 3, 4]))
  overlay.write(512, new Uint8Array([5, 6, 7, 8]))
  let rounds = 0
  const flusher = createOverlayFlusher(
    's5',
    stubEntry(
      stubWriter({
        async flush() {
          rounds += 1
          await new Promise((resolve) => setTimeout(resolve, 5))
        },
      }),
    ),
    overlay,
  )
  await Promise.all([flusher.flushUntilEmpty(), flusher.flushUntilEmpty(), flusher.flushUntilEmpty()])
  assert.equal(rounds, 1)
  assert.equal(overlay.dirtyBytes, 0)
}

async function testFlushUntilEmptyGivesUpAfterMaxAttempts(): Promise<void> {
  const overlay = new DirtyOverlay()
  overlay.write(0, new Uint8Array([1, 2, 3, 4]))
  const flusher = createOverlayFlusher(
    's6',
    stubEntry(
      stubWriter({
        async writeAt() {
          throw new Error('disk full')
        },
      }),
    ),
    overlay,
  )
  await assert.rejects(() => flusher.flushUntilEmpty(), /已中止/)
  assert.equal(overlay.dirtyBytes, 4)
}

async function testFlushFailureRecoversOnRetry(): Promise<void> {
  const overlay = new DirtyOverlay()
  overlay.write(0, new Uint8Array([1, 2, 3, 4]))
  let remainingFails = OVERLAY_FLUSH_MAX_ATTEMPTS
  const flusher = createOverlayFlusher(
    's7',
    stubEntry(
      stubWriter({
        async writeAt() {
          if (remainingFails > 0) {
            remainingFails -= 1
            throw new Error('transient')
          }
        },
      }),
    ),
    overlay,
  )
  await assert.rejects(() => flusher.flushUntilEmpty(), /已中止/)
  assert.equal(overlay.dirtyBytes, 4)
  await flusher.flushUntilEmpty()
  assert.equal(overlay.dirtyBytes, 0)
}

async function testFlushUntilEmptyKeepsReadDuringBackpressure(): Promise<void> {
  const overlay = new DirtyOverlay()
  overlay.write(0, new Uint8Array(OVERLAY_HIGH_WATER_BYTES + 16))
  assert.equal(diskReadReplyStatus({ size: OVERLAY_HIGH_WATER_BYTES + 4096 }, 0, 16), 206)
  const hit = overlay.read(0, 16)
  assert.ok(hit)
  const flusher = createOverlayFlusher(
    's8',
    stubEntry(
      stubWriter({
        async flush() {
          await new Promise((resolve) => setTimeout(resolve, 20))
        },
      }),
    ),
    overlay,
  )
  const ack = flusher.acknowledgeGuestWrite()
  assert.equal(diskReadReplyStatus({ size: OVERLAY_HIGH_WATER_BYTES + 4096 }, 0, 16), 206)
  await ack
  assert.ok(overlay.dirtyBytes <= OVERLAY_LOW_WATER_BYTES)
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
await testFlusherRestoresDirtyRunsOnFailure()
await testFlusherRestoresAllRunsWhenPersistFlushFails()
await testFlusherSerializesConcurrentFlush()
await testReleaseDrainsThenFlushesThenCloses()
await testOverlayBackpressureFlushesBeforeAck()
await testFlushUntilEmptySerializesConcurrentCallers()
await testFlushUntilEmptyGivesUpAfterMaxAttempts()
await testFlushFailureRecoversOnRetry()
await testFlushUntilEmptyKeepsReadDuringBackpressure()
console.log('virtual-machine-disk-stream-host.test.ts ok')
