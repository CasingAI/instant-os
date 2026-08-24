/**
 * 虚拟机镜像流 I/O 窗口聚合单测。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-disk-stream-metrics.test.ts
 */
import assert from 'node:assert/strict'
import {
  getVmDiskStreamIoSnapshot,
  listVmDiskStreamIds,
  recordVmDiskStreamIo,
  releaseVmDiskStreamMetrics,
  VM_DISK_STREAM_IO_WINDOW_MS,
} from './virtual-machine-disk-stream-metrics.ts'

function testReadsAndWritesGoToMatchingDirection(): void {
  const streamId = 'ds-dir'
  const now = 1_000_000
  recordVmDiskStreamIo({
    streamId,
    direction: 'read',
    bytes: 4096,
    durationMs: 10,
    at: now - 100,
  })
  recordVmDiskStreamIo({
    streamId,
    direction: 'write',
    bytes: 8192,
    durationMs: 20,
    at: now - 50,
  })
  const snapshot = getVmDiskStreamIoSnapshot([streamId], now, 1_000)
  assert.equal(snapshot.readOpsPerSec, 1)
  assert.equal(snapshot.writeOpsPerSec, 1)
  assert.equal(snapshot.opsPerSec, 2)
  assert.equal(snapshot.readBytesPerSec, 4096)
  assert.equal(snapshot.writeBytesPerSec, 8192)
  assert.equal(snapshot.avgReadDurationMs, 10)
  assert.equal(snapshot.avgWriteDurationMs, 20)
  releaseVmDiskStreamMetrics(streamId)
}

function testExpiredSamplesAreDropped(): void {
  const streamId = 'ds-expire'
  const now = 2_000_000
  recordVmDiskStreamIo({
    streamId,
    direction: 'read',
    bytes: 1024,
    durationMs: 5,
    at: now - 4_000,
  })
  recordVmDiskStreamIo({
    streamId,
    direction: 'read',
    bytes: 2048,
    durationMs: 8,
    at: now - 500,
  })
  const snapshot = getVmDiskStreamIoSnapshot([streamId], now, VM_DISK_STREAM_IO_WINDOW_MS)
  assert.equal(snapshot.readOpsPerSec, 1 / 3)
  assert.equal(snapshot.readBytesPerSec, 2048 / 3)
  assert.equal(snapshot.avgReadDurationMs, 8)
  releaseVmDiskStreamMetrics(streamId)
}

function testUnrecordedFailuresDoNotCount(): void {
  const streamId = 'ds-fail'
  const now = 3_000_000
  recordVmDiskStreamIo({
    streamId,
    direction: 'write',
    bytes: 512,
    durationMs: 4,
    at: now - 100,
  })
  const snapshot = getVmDiskStreamIoSnapshot([streamId], now, 1_000)
  assert.equal(snapshot.writeOpsPerSec, 1)
  assert.equal(snapshot.readOpsPerSec, 0)
  assert.equal(snapshot.avgReadDurationMs, undefined)
  releaseVmDiskStreamMetrics(streamId)
}

function testMultipleStreamsAreAggregated(): void {
  const hda = 'ds-hda'
  const cdrom = 'ds-cdrom'
  const now = 4_000_000
  recordVmDiskStreamIo({
    streamId: hda,
    direction: 'write',
    bytes: 3000,
    durationMs: 10,
    at: now - 100,
  })
  recordVmDiskStreamIo({
    streamId: hda,
    direction: 'write',
    bytes: 1000,
    durationMs: 30,
    at: now - 80,
  })
  recordVmDiskStreamIo({
    streamId: cdrom,
    direction: 'read',
    bytes: 6000,
    durationMs: 12,
    at: now - 60,
  })
  recordVmDiskStreamIo({
    streamId: 'ds-other-vm',
    direction: 'read',
    bytes: 99_000,
    durationMs: 1,
    at: now - 40,
  })
  const snapshot = getVmDiskStreamIoSnapshot([hda, cdrom], now, 1_000)
  assert.equal(snapshot.writeOpsPerSec, 2)
  assert.equal(snapshot.readOpsPerSec, 1)
  assert.equal(snapshot.opsPerSec, 3)
  assert.equal(snapshot.writeBytesPerSec, 4000)
  assert.equal(snapshot.readBytesPerSec, 6000)
  assert.equal(snapshot.avgWriteDurationMs, 20)
  assert.equal(snapshot.avgReadDurationMs, 12)
  releaseVmDiskStreamMetrics(hda)
  releaseVmDiskStreamMetrics(cdrom)
  releaseVmDiskStreamMetrics('ds-other-vm')
}

function testLatencyIsEmptyWithoutSamples(): void {
  const streamId = 'ds-idle'
  const now = 5_000_000
  const snapshot = getVmDiskStreamIoSnapshot([streamId], now, 1_000)
  assert.equal(snapshot.avgReadDurationMs, undefined)
  assert.equal(snapshot.avgWriteDurationMs, undefined)
  assert.equal(snapshot.opsPerSec, 0)
  assert.equal(snapshot.readBytesPerSec, 0)
  assert.equal(snapshot.writeBytesPerSec, 0)
}

function testEmptyStreamListIsEmptySnapshot(): void {
  const now = 6_000_000
  recordVmDiskStreamIo({
    streamId: 'ds-orphan',
    direction: 'read',
    bytes: 100,
    durationMs: 3,
    at: now - 10,
  })
  const snapshot = getVmDiskStreamIoSnapshot([], now, 1_000)
  assert.equal(snapshot.opsPerSec, 0)
  assert.equal(snapshot.avgReadDurationMs, undefined)
  releaseVmDiskStreamMetrics('ds-orphan')
}

function testReleaseRemovesSamples(): void {
  const streamId = 'ds-release'
  const now = 7_000_000
  recordVmDiskStreamIo({
    streamId,
    direction: 'read',
    bytes: 4096,
    durationMs: 9,
    at: now - 20,
  })
  releaseVmDiskStreamMetrics(streamId)
  const snapshot = getVmDiskStreamIoSnapshot([streamId], now, 1_000)
  assert.equal(snapshot.readOpsPerSec, 0)
  assert.equal(snapshot.avgReadDurationMs, undefined)
}

function testListVmDiskStreamIdsSkipsStateAndMissing(): void {
  assert.deepEqual(listVmDiskStreamIds(undefined), [])
  assert.deepEqual(
    listVmDiskStreamIds({
      hdaStream: { id: 'ds-hda', size: 1 },
      cdromStream: { id: 'ds-cd', size: 2 },
      stateStream: { id: 'ds-state', size: 3 },
    }),
    ['ds-hda', 'ds-cd'],
  )
}

testReadsAndWritesGoToMatchingDirection()
testExpiredSamplesAreDropped()
testUnrecordedFailuresDoNotCount()
testMultipleStreamsAreAggregated()
testLatencyIsEmptyWithoutSamples()
testEmptyStreamListIsEmptySnapshot()
testReleaseRemovesSamples()
testListVmDiskStreamIdsSkipsStateAndMissing()
console.log('virtual-machine-disk-stream-metrics.test.ts ok')
