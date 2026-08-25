/**
 * 磁盘流宿主回写状态单测。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-disk-stream-host.test.ts
 */
import assert from 'node:assert/strict'
import { INSTANT_VM_DISK_RANGE_MAX_BYTES } from './virtual-machine-protocol.ts'
import { diskReadReplyStatus, diskWriteReplyStatus, DirtyOverlay } from './virtual-machine-disk-stream-host.ts'

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

testMissingStreamIs404()
testReadonlyStreamIs403()
testOutOfRangeIs416()
testTooLargeIs413()
testWritableInRangeIs200()
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

testMissingStreamIs404()
testReadonlyStreamIs403()
testOutOfRangeIs416()
testTooLargeIs413()
testWritableInRangeIs200()
testDiskReadFullFileIsStillPartial()
testOverlayReadOwnWrites()
testOverlayMergesAdjacentWrites()
testOverlayPartialReadFails()
console.log('virtual-machine-disk-stream-host.test.ts ok')
