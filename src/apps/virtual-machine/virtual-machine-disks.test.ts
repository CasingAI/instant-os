/**
 * 磁盘加载失败清理、释放闸门语义（release 前已入队的写照常落盘、release 后读拒绝/写给宽限）。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-disks.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import {
  claimDiskImagePath,
  releaseDiskImagePath,
  resetDiskImageOccupancyForTests,
} from '../files/files-disk-image-occupancy.ts'
import { filesCreateBinary, filesReadBlobRange } from '../files/files-api.ts'
import { resetFilesDbForTests } from '../files/files-storage.ts'
import { invalidateFilesVfsPathCaches } from '../files/files-vfs.ts'
import { resetOpfsBlobsForTests, useMemoryOpfsForTests } from '../files/files-opfs-blobs.ts'
import { addMount, removeMount } from '../files/files-mount-store.ts'
import {
  resetDiskOverlayStoreForTests,
  useMemoryDiskOverlayStoreForTests,
  useRealDiskOverlayStoreForTests,
} from './virtual-machine-disk-overlay-store.ts'
import { INSTANT_VM_MESSAGE_TYPE } from './virtual-machine-protocol.ts'
import { getVmRuntimeOrigin } from './virtual-machine-runtime-config.ts'
import {
  claimVirtualMachineDiskImageOccupancy,
  isRemovableMediumInserted,
  loadVirtualMachineDisks,
  mountVirtualMachineRemovableMedia,
  releaseVirtualMachineDiskImageOccupancy,
  releaseVirtualMachineRemovableMedia,
  shouldSkipRemovableMediaPick,
  slotOfDevice,
  vmMountedDiskSlots,
} from './virtual-machine-disks.ts'
import {
  countVirtualMachineDiskStreams,
  DirtyOverlay,
  enqueueStreamWork,
  getVirtualMachineDiskFlushProgress,
  mergeOverlayIntoImage,
  registerVirtualMachineDiskStream,
  releaseVirtualMachineDiskStream,
  releaseVirtualMachineDiskStreams,
  requestVirtualMachineDiskStreamAbandon,
  setVirtualMachineDiskStreamMode,
} from './virtual-machine-disk-stream-host.ts'

useMemoryOpfsForTests()
useMemoryDiskOverlayStoreForTests()

type Posted = { status?: number; type?: string }

const messageListeners: Array<(event: MessageEvent) => void> = []

const windowLike = {
  addEventListener(type: string, listener: EventListener) {
    if (type === 'message') {
      messageListeners.push(listener as (event: MessageEvent) => void)
    }
  },
  removeEventListener() {},
  dispatchEvent(event: { type: string }) {
    if (event.type === 'message') {
      for (const listener of messageListeners) {
        listener(event as MessageEvent)
      }
    }
    return true
  },
  location: { origin: 'http://localhost:5173' },
}

;(globalThis as { window: typeof windowLike }).window = windowLike

function dispatchDiskMessage(data: object, replies: Posted[]): void {
  const origin = getVmRuntimeOrigin()
  const event = {
    type: 'message',
    origin,
    source: {
      postMessage(message: Posted) {
        replies.push(message)
      },
    },
    data,
  }
  windowLike.dispatchEvent(event)
}

async function waitForDiskReply(
  replies: Posted[],
  predicate: (item: Posted) => boolean,
): Promise<Posted> {
  const deadline = Date.now() + 1000
  while (Date.now() < deadline) {
    const found = replies.find(predicate)
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('timed out waiting for disk reply')
}

async function resetFiles(): Promise<void> {
  await resetFilesDbForTests()
  await resetOpfsBlobsForTests()
  resetDiskOverlayStoreForTests()
  invalidateFilesVfsPathCaches()
}

async function createDisk(path: string, size = 4096): Promise<void> {
  const payload = new Uint8Array(size)
  payload.fill(0x11)
  await filesCreateBinary(
    path,
    payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
  )
}

async function testLoadFailureReleasesRegisteredStreams(): Promise<void> {
  await resetFiles()
  await createDisk('/user/hda.img')
  assert.equal(countVirtualMachineDiskStreams(), 0)
  await assert.rejects(
    () =>
      loadVirtualMachineDisks({
        diskWriteMode: 'poweroff',
        devices: [
          { id: 'd1', type: 'hdd', source: 'local', path: '/user/hda.img' },
          { id: 'd2', type: 'hdd', source: 'local', path: '/user/missing.img' },
        ],
      }),
    /不存在/,
  )
  assert.equal(countVirtualMachineDiskStreams(), 0)
}

async function testSuccessfulLoadThenReleaseClearsStreams(): Promise<void> {
  await resetFiles()
  await createDisk('/user/hda.img')
  const disks = await loadVirtualMachineDisks({
    diskWriteMode: 'poweroff',
    devices: [{ id: 'd1', type: 'hdd', source: 'local', path: '/user/hda.img' }],
  })
  assert.equal(countVirtualMachineDiskStreams(), 1)
  await releaseVirtualMachineDiskStreams(disks)
  assert.equal(countVirtualMachineDiskStreams(), 0)
}

async function testReleaseInProgressDropsReadsButGracesWrites(): Promise<void> {
  await resetFiles()
  const replies: Posted[] = []
  await createDisk('/user/hda.img')
  const streamId = await registerVirtualMachineDiskStream('/user/hda.img', { writable: true })
  let releaseHold = () => undefined
  const held = new Promise<void>((resolve) => {
    releaseHold = resolve
  })
  void enqueueStreamWork(streamId, () => held)
  const releasing = releaseVirtualMachineDiskStream(streamId)
  dispatchDiskMessage(
    {
      type: INSTANT_VM_MESSAGE_TYPE.diskRead,
      requestId: 'read-during-release',
      streamId,
      offset: 0,
      length: 512,
    },
    replies,
  )
  dispatchDiskMessage(
    {
      type: INSTANT_VM_MESSAGE_TYPE.diskWrite,
      requestId: 'write-during-release',
      streamId,
      offset: 0,
      bytes: new Uint8Array([1, 2, 3, 4]).buffer,
    },
    replies,
  )
  releaseHold()
  const discarded = await releasing
  const readReply = replies.find((item) => item.type === INSTANT_VM_MESSAGE_TYPE.diskReadResult)
  const writeReply = replies.find((item) => item.type === INSTANT_VM_MESSAGE_TYPE.diskWriteResult)
  // 读在 release 开始后没有意义，照旧拒绝；写处在宽限期内，必须照常接收落盘
  assert.equal(readReply?.status, 404)
  assert.equal(writeReply?.status, 200)
  assert.equal(discarded, 0)
  assert.equal(countVirtualMachineDiskStreams(), 0)
}

async function testQueuedWriteBeforeReleaseIsFlushed(): Promise<void> {
  await resetFiles()
  const replies: Posted[] = []
  await createDisk('/user/hda.img')
  const streamId = await registerVirtualMachineDiskStream('/user/hda.img', { writable: true })
  let holdQueue = () => undefined
  const held = new Promise<void>((resolve) => {
    holdQueue = resolve
  })
  void enqueueStreamWork(streamId, () => held)
  // release 开始前已接收、但排在慢任务后面还没执行的写：丢弃等于丢掉已向客机
  // ack 的数据（hive 半提交根因），必须排干后照常落盘。
  dispatchDiskMessage(
    {
      type: INSTANT_VM_MESSAGE_TYPE.diskWrite,
      requestId: 'write-queued-before-release',
      streamId,
      offset: 0,
      bytes: new Uint8Array([5, 6, 7, 8]).buffer,
    },
    replies,
  )
  const releasing = releaseVirtualMachineDiskStream(streamId)
  holdQueue()
  const discarded = await releasing
  const writeReply = replies.find((item) => item.type === INSTANT_VM_MESSAGE_TYPE.diskWriteResult)
  assert.equal(writeReply?.status, 200)
  assert.equal(discarded, 0)
  assert.equal(countVirtualMachineDiskStreams(), 0)
}

async function testWriteAfterReleaseCompletesIs404(): Promise<void> {
  await resetFiles()
  const replies: Posted[] = []
  await createDisk('/user/hda.img')
  const streamId = await registerVirtualMachineDiskStream('/user/hda.img', { writable: true })
  await releaseVirtualMachineDiskStream(streamId)
  dispatchDiskMessage(
    {
      type: INSTANT_VM_MESSAGE_TYPE.diskWrite,
      requestId: 'write-after-release',
      streamId,
      offset: 0,
      bytes: new Uint8Array([1, 1, 1, 1]).buffer,
    },
    replies,
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  const writeReply = replies.find((item) => item.type === INSTANT_VM_MESSAGE_TYPE.diskWriteResult)
  assert.equal(writeReply?.status, 404)
  assert.equal(countVirtualMachineDiskStreams(), 0)
}

async function testConnectedFlagSkipsLoadAndOccupancy(): Promise<void> {
  await resetFiles()
  await createDisk('/user/cd.img')
  const result = await loadVirtualMachineDisks({
    diskWriteMode: 'poweroff',
    devices: [{ id: 'c', type: 'cdrom', source: 'local', path: '/user/cd.img', connected: false }],
  })
  assert.equal(result.cdrom, undefined)
  assert.equal(result.cdromStream, undefined)
  assert.equal(countVirtualMachineDiskStreams(), 0)

  // 弹出的设备不声明镜像占用；同一镜像连着的设备照旧会撞占用
  await claimDiskImagePath('/user/cd.img', { kind: 'vm', id: 'other-vm' })
  await claimVirtualMachineDiskImageOccupancy('vm-a', [
    { id: 'c', type: 'cdrom', source: 'local', path: '/user/cd.img', connected: false },
  ])
  await assert.rejects(() =>
    claimVirtualMachineDiskImageOccupancy('vm-a', [
      { id: 'c', type: 'cdrom', source: 'local', path: '/user/cd.img' },
    ]),
  )
  releaseDiskImagePath('/user/cd.img', { kind: 'vm', id: 'other-vm' })
  releaseVirtualMachineDiskImageOccupancy('vm-a')
  resetDiskImageOccupancyForTests()
}

function testRemovableMediaPickSkip(): void {
  const inserted = { id: 'c', type: 'cdrom' as const, source: 'local' as const, path: '/user/os.iso' }
  const ejected = { ...inserted, connected: false }
  const empty = { ...inserted, path: '' }
  assert.equal(isRemovableMediumInserted(inserted), true)
  assert.equal(isRemovableMediumInserted(ejected), false)
  assert.equal(isRemovableMediumInserted(empty), false)
  // 已挂着同一张：选盘确认同一路径是无操作
  assert.equal(shouldSkipRemovableMediaPick(inserted, '/user/os.iso'), true)
  // 弹出后再选同一张：必须重新插入，不能当无操作
  assert.equal(shouldSkipRemovableMediaPick(ejected, '/user/os.iso'), false)
  assert.equal(shouldSkipRemovableMediaPick(empty, '/user/other.iso'), false)
  assert.equal(shouldSkipRemovableMediaPick(inserted, undefined), true)
}

function testEmptyDeviceConsumesSlotIndex(): void {
  const devices = [
    { id: 'f1', type: 'floppy', source: 'local', path: '  ' },
    { id: 'f2', type: 'floppy', source: 'local', path: '/user/fdb.img' },
  ]
  // 空路径的软盘 1 也占 fda，软盘 2 不能被顶到 fda
  assert.equal(slotOfDevice(devices, 'f1'), 'fda')
  assert.equal(slotOfDevice(devices, 'f2'), 'fdb')
  assert.deepEqual(vmMountedDiskSlots(devices), {
    hda: false,
    hdb: false,
    cdrom: false,
    fda: false,
    fdb: true,
  })
  // 第二个光驱没有槽位可占
  assert.equal(
    slotOfDevice(
      [
        { id: 'c1', type: 'cdrom', source: 'local', path: '/user/a.iso' },
        { id: 'c2', type: 'cdrom', source: 'local', path: '/user/b.iso' },
      ],
      'c2',
    ),
    undefined,
  )
}

async function testDisconnectedDeviceSkipsItsSlotAtBoot(): Promise<void> {
  await resetFiles()
  await createDisk('/user/fda.img')
  await createDisk('/user/fdb.img')
  const result = await loadVirtualMachineDisks({
    diskWriteMode: 'poweroff',
    devices: [
      { id: 'f1', type: 'floppy', source: 'local', path: '/user/fda.img', connected: false },
      { id: 'f2', type: 'floppy', source: 'local', path: '/user/fdb.img' },
    ],
  })
  assert.equal(result.fdaStream, undefined)
  assert.ok(result.fdbStream)
  await releaseVirtualMachineDiskStreams(result)
  assert.equal(countVirtualMachineDiskStreams(), 0)
}

async function testRemovableMediaMountCommitRollback(): Promise<void> {
  await resetFiles()
  await createDisk('/user/swap.iso', 8192)

  await assert.rejects(
    () =>
      mountVirtualMachineRemovableMedia({
        machineId: 'vm-m',
        device: { id: 'c', type: 'cdrom', source: 'local', path: '/user/missing.iso' },
        slot: 'cdrom',
        diskWriteMode: 'poweroff',
      }),
    /文件不存在/,
  )
  // 挂载卷上的软盘在文件不存在时仍报不存在；真实存在的挂载盘由开机路径拒绝回写
  await assert.rejects(
    () =>
      mountVirtualMachineRemovableMedia({
        machineId: 'vm-m',
        device: { id: 'f', type: 'floppy', source: 'mount', path: '/mount/floppy.img' },
        slot: 'fda',
        diskWriteMode: 'poweroff',
      }),
    /不存在/,
  )
  assert.equal(countVirtualMachineDiskStreams(), 0)

  const mountOptions = {
    machineId: 'vm-m',
    device: { id: 'c', type: 'cdrom', source: 'local', path: '/user/swap.iso' },
    slot: 'cdrom' as const,
    diskWriteMode: 'poweroff' as const,
  }
  const first = await mountVirtualMachineRemovableMedia(mountOptions)
  assert.equal(first.stream.size, 8192)
  assert.equal(countVirtualMachineDiskStreams(), 1)
  await first.rollback()
  assert.equal(countVirtualMachineDiskStreams(), 0)

  // commit 与 rollback 互斥：回滚后重新挂载再提交
  const live = await mountVirtualMachineRemovableMedia(mountOptions)
  await live.commit()
  assert.equal(countVirtualMachineDiskStreams(), 1)

  // 同槽位换盘：commit 释放旧流，流总数不涨
  const second = await mountVirtualMachineRemovableMedia(mountOptions)
  assert.equal(countVirtualMachineDiskStreams(), 2)
  await second.commit()
  assert.equal(countVirtualMachineDiskStreams(), 1)

  await releaseVirtualMachineRemovableMedia('vm-m')
  assert.equal(countVirtualMachineDiskStreams(), 0)
}

async function testRemovableMediaReleaseScopedToSlot(): Promise<void> {
  await resetFiles()
  await createDisk('/user/floppy.img')
  const options = (slot: 'fda' | 'fdb') => ({
    machineId: 'vm-n',
    device: { id: slot, type: 'floppy' as const, source: 'local' as const, path: '/user/floppy.img' },
    slot,
    diskWriteMode: 'none' as const,
  })
  const fda = await mountVirtualMachineRemovableMedia(options('fda'))
  const fdb = await mountVirtualMachineRemovableMedia(options('fdb'))
  await fda.commit()
  await fdb.commit()
  assert.equal(countVirtualMachineDiskStreams(), 2)
  await releaseVirtualMachineRemovableMedia('vm-n', 'fda')
  assert.equal(countVirtualMachineDiskStreams(), 1)
  await releaseVirtualMachineRemovableMedia('other-vm')
  assert.equal(countVirtualMachineDiskStreams(), 1)
  await releaseVirtualMachineRemovableMedia('vm-n')
  assert.equal(countVirtualMachineDiskStreams(), 0)
}

async function testMergeOverlayTrimsPerSegment(): Promise<void> {
  await resetFiles()
  await createDisk('/user/trim.img')
  const overlay = new DirtyOverlay()
  overlay.write(0, new Uint8Array([1, 1, 1, 1]))
  overlay.write(64, new Uint8Array([2, 2, 2, 2]))
  overlay.write(128, new Uint8Array([3, 3, 3, 3]))
  // shouldAbort 在每段写之前回调：此刻前几段已写进文件并从覆盖层裁掉，
  // pendingBytes 随合并逐段递减（对齐 writeLiveOverlayIntoImage 的既有模式）
  const pendingBeforeEachSegment: number[] = []
  await mergeOverlayIntoImage('/user/trim.img', overlay, undefined, {
    shouldAbort: () => {
      pendingBeforeEachSegment.push(overlay.dirtyBytes)
      return false
    },
  })
  assert.deepEqual(pendingBeforeEachSegment, [12, 8, 4])
  assert.equal(overlay.dirtyBytes, 0)
}

async function testMergeOverlayAbortStopsAtSegmentBoundary(): Promise<void> {
  await resetFiles()
  await createDisk('/user/trim2.img')
  const overlay = new DirtyOverlay()
  overlay.write(0, new Uint8Array([1, 1, 1, 1]))
  overlay.write(64, new Uint8Array([2, 2, 2, 2]))
  overlay.write(128, new Uint8Array([3, 3, 3, 3]))
  let segmentChecks = 0
  await mergeOverlayIntoImage('/user/trim2.img', overlay, undefined, {
    shouldAbort: () => {
      segmentChecks += 1
      return segmentChecks > 2
    },
  })
  // 第三段前停下：前两段已写、pending 停在剩余段值（流已结束，剩余段随会话丢弃）
  assert.equal(overlay.dirtyBytes, 4)
  assert.deepEqual(await readRange('/user/trim2.img', 0, 4), [1, 1, 1, 1])
  assert.deepEqual(await readRange('/user/trim2.img', 64, 4), [2, 2, 2, 2])
  assert.deepEqual(await readRange('/user/trim2.img', 128, 4), [0x11, 0x11, 0x11, 0x11])
}

async function readRange(path: string, offset: number, length: number): Promise<number[]> {
  const blob = await filesReadBlobRange(path, offset, length)
  return [...new Uint8Array(await blob.arrayBuffer())]
}

async function testFlushProgressBaselineStableAcrossRelease(): Promise<void> {
  await resetFiles()
  await createDisk('/user/baseline.img')
  const streamId = await registerVirtualMachineDiskStream('/user/baseline.img', {
    writable: true,
    mode: 'poweroff',
  })
  const replies: Posted[] = []
  for (const [offset, payload] of [
    [0, [1, 2, 3, 4]],
    [1024, [5, 6, 7, 8]],
  ] as const) {
    dispatchDiskMessage(
      {
        type: INSTANT_VM_MESSAGE_TYPE.diskWrite,
        requestId: `baseline-write-${offset}`,
        streamId,
        offset,
        bytes: new Uint8Array(payload).buffer,
      },
      replies,
    )
    await waitForDiskReply(replies, (item) => item.status === 200)
  }
  // 收尾前：total 无记录，以当前 pending 兜底（保证 total ≥ pending）
  const before = getVirtualMachineDiskFlushProgress([streamId])
  assert.deepEqual(before, { pendingBytes: 8, totalBytes: 8 })

  // 收尾闸门期（drain 被压住）：多次查询 total 稳定不重置
  let releaseHold = () => undefined
  const held = new Promise<void>((resolve) => {
    releaseHold = resolve
  })
  void enqueueStreamWork(streamId, () => held)
  const releasing = releaseVirtualMachineDiskStream(streamId)
  for (let i = 0; i < 3; i += 1) {
    assert.deepEqual(getVirtualMachineDiskFlushProgress([streamId]), {
      pendingBytes: 8,
      totalBytes: 8,
    })
  }
  releaseHold()
  // 合并期间 total 由宿主记录值钉住（= drain 完成时的 pending），结束后 pending 归零、
  // 流记录清理
  await releasing
  assert.deepEqual(getVirtualMachineDiskFlushProgress([streamId]), {
    pendingBytes: 0,
    totalBytes: 0,
  })
  assert.deepEqual(await readRange('/user/baseline.img', 0, 4), [1, 2, 3, 4])
  assert.deepEqual(await readRange('/user/baseline.img', 1024, 4), [5, 6, 7, 8])
}

async function testPoweroffCacheMergesIntoImageOnRelease(): Promise<void> {
  await resetFiles()
  await createDisk('/user/merge.img')
  const streamId = await registerVirtualMachineDiskStream('/user/merge.img', {
    writable: true,
    mode: 'poweroff',
  })
  const replies: Posted[] = []
  dispatchDiskMessage(
    {
      type: INSTANT_VM_MESSAGE_TYPE.diskWrite,
      requestId: 'merge-write',
      streamId,
      offset: 0,
      bytes: new Uint8Array([9, 8, 7, 6]).buffer,
    },
    replies,
  )
  await waitForDiskReply(replies, (item) => item.status === 200)
  await releaseVirtualMachineDiskStream(streamId)
  const blob = await filesReadBlobRange('/user/merge.img', 0, 4)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  assert.deepEqual([...bytes], [9, 8, 7, 6])
}

async function testCacheReplaysAfterReleaseWithoutMerge(): Promise<void> {
  await resetFiles()
  await createDisk('/user/replay.img')
  const first = await registerVirtualMachineDiskStream('/user/replay.img', {
    writable: true,
    mode: 'none',
  })
  const replies: Posted[] = []
  dispatchDiskMessage(
    {
      type: INSTANT_VM_MESSAGE_TYPE.diskWrite,
      requestId: 'replay-write',
      streamId: first,
      offset: 0,
      bytes: new Uint8Array([3, 3, 3, 3]).buffer,
    },
    replies,
  )
  await waitForDiskReply(replies, (item) => item.status === 200)
  // none 档不带决策直接释放 = 按合并收尾；缓存落稳后仍留在主机磁盘上
  await releaseVirtualMachineDiskStream(first)

  const second = await registerVirtualMachineDiskStream('/user/replay.img', {
    writable: true,
    mode: 'none',
  })
  const reads: Posted[] = []
  dispatchDiskMessage(
    {
      type: INSTANT_VM_MESSAGE_TYPE.diskRead,
      requestId: 'replay-read',
      streamId: second,
      offset: 0,
      length: 4,
    },
    reads,
  )
  await waitForDiskReply(reads, (item) => item.type === INSTANT_VM_MESSAGE_TYPE.diskReadResult)
  const read = reads.find((item) => item.type === INSTANT_VM_MESSAGE_TYPE.diskReadResult) as
    | { bytes?: ArrayBuffer }
    | undefined
  assert.ok(read?.bytes)
  assert.deepEqual([...new Uint8Array(read.bytes)], [3, 3, 3, 3])
  await releaseVirtualMachineDiskStream(second)
}

async function testNoneCacheDiscardedOnDecision(): Promise<void> {
  await resetFiles()
  await createDisk('/user/volatile.img')
  const first = await registerVirtualMachineDiskStream('/user/volatile.img', {
    writable: true,
    mode: 'none',
  })
  const replies: Posted[] = []
  dispatchDiskMessage(
    {
      type: INSTANT_VM_MESSAGE_TYPE.diskWrite,
      requestId: 'volatile-write',
      streamId: first,
      offset: 0,
      bytes: new Uint8Array([7, 7, 7, 7]).buffer,
    },
    replies,
  )
  await waitForDiskReply(replies, (item) => item.status === 200)
  // 用户确认「不保存」：缓存删除，这次改动不进可见文件
  await releaseVirtualMachineDiskStream(first, { discardCache: true })

  const second = await registerVirtualMachineDiskStream('/user/volatile.img', {
    writable: true,
    mode: 'none',
  })
  const reads: Posted[] = []
  dispatchDiskMessage(
    {
      type: INSTANT_VM_MESSAGE_TYPE.diskRead,
      requestId: 'volatile-read',
      streamId: second,
      offset: 0,
      length: 4,
    },
    reads,
  )
  const read = (await waitForDiskReply(
    reads,
    (item) => item.type === INSTANT_VM_MESSAGE_TYPE.diskReadResult,
  )) as { bytes?: ArrayBuffer }
  assert.ok(read.bytes)
  assert.deepEqual([...new Uint8Array(read.bytes)], [0x11, 0x11, 0x11, 0x11])
  await releaseVirtualMachineDiskStream(second)
}

async function testLiveWritesThroughToImagePerBatch(): Promise<void> {
  await resetFiles()
  await createDisk('/user/live.img')
  const streamId = await registerVirtualMachineDiskStream('/user/live.img', {
    writable: true,
    mode: 'live',
  })
  const replies: Posted[] = []
  dispatchDiskMessage(
    {
      type: INSTANT_VM_MESSAGE_TYPE.diskWrite,
      requestId: 'live-write',
      streamId,
      offset: 16,
      bytes: new Uint8Array([4, 5, 6, 7]).buffer,
    },
    replies,
  )
  // 宿主点头 = 这一批已进可见文件
  await waitForDiskReply(replies, (item) => item.status === 200)
  const blob = await filesReadBlobRange('/user/live.img', 16, 4)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  assert.deepEqual([...bytes], [4, 5, 6, 7])
  await releaseVirtualMachineDiskStream(streamId)
}

async function testLiveAdoptsLeftoverCacheFromPreviousSession(): Promise<void> {
  await resetFiles()
  await createDisk('/user/adopt.img')
  // 上次按 none 档运行、没收尾就退出：缓存里有未合并记录
  const leftover = await registerVirtualMachineDiskStream('/user/adopt.img', {
    writable: true,
    mode: 'none',
  })
  const replies: Posted[] = []
  dispatchDiskMessage(
    {
      type: INSTANT_VM_MESSAGE_TYPE.diskWrite,
      requestId: 'adopt-write',
      streamId: leftover,
      offset: 0,
      bytes: new Uint8Array([2, 2, 2, 2]).buffer,
    },
    replies,
  )
  await waitForDiskReply(replies, (item) => item.status === 200)
  await releaseVirtualMachineDiskStream(leftover, { discardCache: false })

  // 用户改成尽快写入开机：残留缓存必须先收进可见文件，否则急救再合并会倒退覆盖
  const streamId = await registerVirtualMachineDiskStream('/user/adopt.img', {
    writable: true,
    mode: 'live',
  })
  const blob = await filesReadBlobRange('/user/adopt.img', 0, 4)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  assert.deepEqual([...bytes], [2, 2, 2, 2])
  await releaseVirtualMachineDiskStream(streamId)
}

async function testModeSwitchBetweenCacheModesKeepsCache(): Promise<void> {
  await resetFiles()
  await createDisk('/user/switch.img')
  const streamId = await registerVirtualMachineDiskStream('/user/switch.img', {
    writable: true,
    mode: 'none',
  })
  const replies: Posted[] = []
  dispatchDiskMessage(
    {
      type: INSTANT_VM_MESSAGE_TYPE.diskWrite,
      requestId: 'switch-write',
      streamId,
      offset: 0,
      bytes: new Uint8Array([8, 8, 8, 8]).buffer,
    },
    replies,
  )
  await waitForDiskReply(replies, (item) => item.status === 200)
  // none → poweroff：只改最终是否合并，缓存不删
  await setVirtualMachineDiskStreamMode(streamId, 'poweroff')
  await releaseVirtualMachineDiskStream(streamId)
  const blob = await filesReadBlobRange('/user/switch.img', 0, 4)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  assert.deepEqual([...bytes], [8, 8, 8, 8])
}

async function testStreamsDecideCacheAskedOnceAfterDrain(): Promise<void> {
  await resetFiles()
  await createDisk('/user/decide.img')
  const streamId = await registerVirtualMachineDiskStream('/user/decide.img', {
    writable: true,
    mode: 'none',
  })
  const replies: Posted[] = []
  dispatchDiskMessage(
    {
      type: INSTANT_VM_MESSAGE_TYPE.diskWrite,
      requestId: 'decide-write',
      streamId,
      offset: 0,
      bytes: new Uint8Array([6, 6, 6, 6]).buffer,
    },
    replies,
  )
  await waitForDiskReply(replies, (item) => item.status === 200)
  let asked = 0
  await releaseVirtualMachineDiskStreams(
    { hdaStream: { id: streamId } },
    {
      decideCache: async () => {
        asked += 1
        return 'discard'
      },
    },
  )
  assert.equal(asked, 1)
  const blob = await filesReadBlobRange('/user/decide.img', 0, 4)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  assert.deepEqual([...bytes], [0x11, 0x11, 0x11, 0x11])
}

/** 全部 none 流已放弃（如强制结束/硬控「放弃」）时收口：不再问「写入硬盘文件？」，缓存直接丢。 */
async function testStreamsDecideCacheSkippedWhenAllAbandoned(): Promise<void> {
  await resetFiles()
  await createDisk('/user/abandon.img')
  const streamId = await registerVirtualMachineDiskStream('/user/abandon.img', {
    writable: true,
    mode: 'none',
  })
  const replies: Posted[] = []
  dispatchDiskMessage(
    {
      type: INSTANT_VM_MESSAGE_TYPE.diskWrite,
      requestId: 'abandon-write',
      streamId,
      offset: 0,
      bytes: new Uint8Array([7, 7, 7, 7]).buffer,
    },
    replies,
  )
  await waitForDiskReply(replies, (item) => item.status === 200)
  requestVirtualMachineDiskStreamAbandon([streamId])
  let asked = 0
  await releaseVirtualMachineDiskStreams(
    { hdaStream: { id: streamId } },
    {
      decideCache: async () => {
        asked += 1
        return 'merge'
      },
    },
  )
  assert.equal(asked, 0, '全部流已 abandon：不保存档收尾不再弹问询（组件可能已卸载）')
  // 缓存被丢弃：重开读回原始字节，而不是按问询默认合并
  const second = await registerVirtualMachineDiskStream('/user/abandon.img', {
    writable: true,
    mode: 'none',
  })
  const reads: Posted[] = []
  dispatchDiskMessage(
    {
      type: INSTANT_VM_MESSAGE_TYPE.diskRead,
      requestId: 'abandon-read',
      streamId: second,
      offset: 0,
      length: 4,
    },
    reads,
  )
  const read = (await waitForDiskReply(
    reads,
    (item) => item.type === INSTANT_VM_MESSAGE_TYPE.diskReadResult,
  )) as { bytes?: ArrayBuffer }
  assert.ok(read.bytes)
  assert.deepEqual([...new Uint8Array(read.bytes)], [0x11, 0x11, 0x11, 0x11])
  await releaseVirtualMachineDiskStream(second)
}

/** 只读流（流式光驱）以 none 档注册：从未写过盘，不构成「要不要写入硬盘文件」的问询对象。 */
async function testStreamsDecideCacheSkippedForReadonlyNoneStream(): Promise<void> {
  await resetFiles()
  await createDisk('/user/cd.iso')
  const cdrom = await registerVirtualMachineDiskStream('/user/cd.iso', { writable: false })
  let asked = 0
  await releaseVirtualMachineDiskStreams(
    { cdromStream: { id: cdrom } },
    {
      decideCache: async () => {
        asked += 1
        return 'discard'
      },
    },
  )
  assert.equal(asked, 0, '只读 none 流不触发 decideCache：挂了光驱的机器正常关机不该弹问询')
  assert.equal(countVirtualMachineDiskStreams(), 0)
}

// ---- 挂载卷 mock FSA（对齐 files-location-mount-range.test.ts 的挂载模拟手段） ----

class MockWritableFileStream {
  file: MockFileHandle
  bytes: Uint8Array
  pos = 0
  closed = false

  constructor(file: MockFileHandle, keepExistingData: boolean) {
    this.file = file
    this.bytes = keepExistingData ? file.bytes.slice() : new Uint8Array(0)
  }

  async seek(offset: number): Promise<void> {
    this.pos = offset
  }

  async write(data: string | BufferSource): Promise<void> {
    if (this.closed) throw new Error('stream closed')
    const chunk =
      typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data as ArrayBuffer)
    const end = this.pos + chunk.byteLength
    if (this.bytes.byteLength < end) {
      const next = new Uint8Array(end)
      next.set(this.bytes)
      this.bytes = next
    }
    this.bytes.set(chunk, this.pos)
    this.pos = end
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.file.bytes = this.bytes
  }

  async abort(): Promise<void> {
    this.closed = true
  }
}

class MockFileHandle {
  kind = 'file' as const
  name: string
  bytes: Uint8Array

  constructor(name: string, bytes: Uint8Array) {
    this.name = name
    this.bytes = bytes
  }

  async getFile(): Promise<File> {
    return new File([this.bytes], this.name)
  }

  async createWritable(options?: { keepExistingData?: boolean }): Promise<MockWritableFileStream> {
    return new MockWritableFileStream(this, options?.keepExistingData === true)
  }
}

class MockDirHandle {
  kind = 'directory' as const
  name: string
  children: Map<string, MockDirHandle | MockFileHandle>

  constructor(
    name: string,
    children: Map<string, MockDirHandle | MockFileHandle> = new Map(),
  ) {
    this.name = name
    this.children = children
  }

  async getDirectoryHandle(name: string): Promise<MockDirHandle> {
    const child = this.children.get(name)
    if (child?.kind === 'directory') return child
    throw new Error(`not a directory: ${name}`)
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MockFileHandle> {
    const child = this.children.get(name)
    if (child?.kind === 'file') return child
    if (options?.create) {
      const created = new MockFileHandle(name, new Uint8Array(0))
      this.children.set(name, created)
      return created
    }
    throw new Error(`not a file: ${name}`)
  }

  async removeEntry(name: string): Promise<void> {
    this.children.delete(name)
  }

  async *entries(): AsyncGenerator<[string, MockDirHandle | MockFileHandle]> {
    for (const [name, handle] of this.children) yield [name, handle]
  }

  async queryPermission(): Promise<PermissionState> {
    return 'granted'
  }

  async requestPermission(): Promise<PermissionState> {
    return 'granted'
  }
}

/**
 * 挂载卷镜像（/mount/ 前缀）按 poweroff 档开机：挂载卷没有伴生缓存（附加也挂不
 * 上去），注册不重放持久缓存、不建缓存附加，不能因此让整机开机报错。
 * 用真（VFS 附加）缓存后端验证：无守卫时 replay 会走 filesCreateAttachment 抛
 * 「当前卷不支持文件附加」。
 */
async function testMountPathPoweroffRegisterSkipsCacheReplay(): Promise<void> {
  await resetFiles()
  const root = new MockDirHandle(
    'vm-vol',
    new Map([['disk.img', new MockFileHandle('disk.img', new Uint8Array(4096).fill(0x22))]]),
  )
  const record = await addMount(root as unknown as FileSystemDirectoryHandle)
  const rootPath = `/mount/${record.id.slice('mount:'.length)}`
  try {
    useRealDiskOverlayStoreForTests()
    const streamId = await registerVirtualMachineDiskStream(`${rootPath}/disk.img`, {
      writable: true,
      mode: 'poweroff',
    })
    assert.equal(countVirtualMachineDiskStreams(), 1)
    await releaseVirtualMachineDiskStream(streamId)
    assert.equal(countVirtualMachineDiskStreams(), 0)
    // 挂载目录里只有镜像本身：没有伴生缓存/临时产物被创建
    assert.deepEqual([...root.children.keys()], ['disk.img'])
  } finally {
    useMemoryDiskOverlayStoreForTests()
    await removeMount(record.id)
  }
}

await testLoadFailureReleasesRegisteredStreams()
await testSuccessfulLoadThenReleaseClearsStreams()
await testReleaseInProgressDropsReadsButGracesWrites()
await testQueuedWriteBeforeReleaseIsFlushed()
await testWriteAfterReleaseCompletesIs404()
await testConnectedFlagSkipsLoadAndOccupancy()
testRemovableMediaPickSkip()
testEmptyDeviceConsumesSlotIndex()
await testDisconnectedDeviceSkipsItsSlotAtBoot()
await testRemovableMediaMountCommitRollback()
await testRemovableMediaReleaseScopedToSlot()
await testMergeOverlayTrimsPerSegment()
await testMergeOverlayAbortStopsAtSegmentBoundary()
await testFlushProgressBaselineStableAcrossRelease()
await testPoweroffCacheMergesIntoImageOnRelease()
await testCacheReplaysAfterReleaseWithoutMerge()
await testNoneCacheDiscardedOnDecision()
await testLiveWritesThroughToImagePerBatch()
await testLiveAdoptsLeftoverCacheFromPreviousSession()
await testModeSwitchBetweenCacheModesKeepsCache()
await testStreamsDecideCacheAskedOnceAfterDrain()
await testStreamsDecideCacheSkippedWhenAllAbandoned()
await testStreamsDecideCacheSkippedForReadonlyNoneStream()
await testMountPathPoweroffRegisterSkipsCacheReplay()
console.log('virtual-machine-disks.test.ts ok')
