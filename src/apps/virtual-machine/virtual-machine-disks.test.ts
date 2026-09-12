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
import { resetDiskOverlayStoreForTests, useMemoryDiskOverlayStoreForTests } from './virtual-machine-disk-overlay-store.ts'
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
  enqueueStreamWork,
  freezeVirtualMachineDiskStreamOverlays,
  registerVirtualMachineDiskStream,
  releaseVirtualMachineDiskStream,
  releaseVirtualMachineDiskStreams,
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
        diskWriteMode: 'persist',
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
    diskWriteMode: 'persist',
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
    diskWriteMode: 'persist',
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
    diskWriteMode: 'persist',
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
        diskWriteMode: 'persist',
      }),
    /文件不存在/,
  )
  // 挂载卷上的软盘不回写，因此不会因「无法回写」拒挂；文件不存在才失败
  await assert.rejects(
    () =>
      mountVirtualMachineRemovableMedia({
        machineId: 'vm-m',
        device: { id: 'f', type: 'floppy', source: 'mount', path: '/mount/floppy.img' },
        slot: 'fda',
        diskWriteMode: 'persist',
      }),
    /不存在/,
  )
  assert.equal(countVirtualMachineDiskStreams(), 0)

  const mountOptions = {
    machineId: 'vm-m',
    device: { id: 'c', type: 'cdrom', source: 'local', path: '/user/swap.iso' },
    slot: 'cdrom' as const,
    diskWriteMode: 'persist' as const,
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

async function testPersistOverlayMergesIntoImageOnRelease(): Promise<void> {
  await resetFiles()
  await createDisk('/user/merge.img')
  const streamId = await registerVirtualMachineDiskStream('/user/merge.img', {
    writable: true,
    persist: true,
    mergeOnRelease: true,
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

async function testPersistOverlayReplaysAfterReleaseWithoutMerge(): Promise<void> {
  await resetFiles()
  await createDisk('/user/replay.img')
  const first = await registerVirtualMachineDiskStream('/user/replay.img', {
    writable: true,
    persist: true,
    mergeOnRelease: false,
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
  await releaseVirtualMachineDiskStream(first)

  const second = await registerVirtualMachineDiskStream('/user/replay.img', {
    writable: true,
    persist: true,
    mergeOnRelease: false,
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

async function testNoneOverlayDiscardedOnRelease(): Promise<void> {
  await resetFiles()
  await createDisk('/user/volatile.img')
  const first = await registerVirtualMachineDiskStream('/user/volatile.img', {
    writable: true,
    persist: false,
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
  await releaseVirtualMachineDiskStream(first)

  const second = await registerVirtualMachineDiskStream('/user/volatile.img', {
    writable: true,
    persist: false,
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

async function testFrozenOverlayRestoresWithSnapshotPath(): Promise<void> {
  await resetFiles()
  await createDisk('/user/freeze.img')
  const live = await registerVirtualMachineDiskStream('/user/freeze.img', {
    writable: true,
    persist: true,
    mergeOnRelease: false,
  })
  const replies: Posted[] = []
  dispatchDiskMessage(
    {
      type: INSTANT_VM_MESSAGE_TYPE.diskWrite,
      requestId: 'freeze-write',
      streamId: live,
      offset: 0,
      bytes: new Uint8Array([4, 5, 6, 7]).buffer,
    },
    replies,
  )
  await waitForDiskReply(replies, (item) => item.status === 200)
  await freezeVirtualMachineDiskStreamOverlays([live], '/user/freeze.bin')
  await releaseVirtualMachineDiskStream(live)

  const restored = await registerVirtualMachineDiskStream('/user/freeze.img', {
    writable: true,
    persist: true,
    mergeOnRelease: false,
    snapshotPath: '/user/freeze.bin',
  })
  const reads: Posted[] = []
  dispatchDiskMessage(
    {
      type: INSTANT_VM_MESSAGE_TYPE.diskRead,
      requestId: 'freeze-read',
      streamId: restored,
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
  assert.deepEqual([...new Uint8Array(read.bytes)], [4, 5, 6, 7])
  const blob = await filesReadBlobRange('/user/freeze.img', 0, 4)
  const base = new Uint8Array(await blob.arrayBuffer())
  assert.deepEqual([...base], [0x11, 0x11, 0x11, 0x11])
  await releaseVirtualMachineDiskStream(restored)
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
await testPersistOverlayMergesIntoImageOnRelease()
await testPersistOverlayReplaysAfterReleaseWithoutMerge()
await testNoneOverlayDiscardedOnRelease()
await testFrozenOverlayRestoresWithSnapshotPath()
console.log('virtual-machine-disks.test.ts ok')
