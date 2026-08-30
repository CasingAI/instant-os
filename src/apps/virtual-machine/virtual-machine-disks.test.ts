/**
 * 磁盘加载失败清理、释放过程中新消息 404。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-disks.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import {
  claimDiskImagePath,
  releaseDiskImagePath,
  resetDiskImageOccupancyForTests,
} from '../files/files-disk-image-occupancy.ts'
import { filesCreateBinary } from '../files/files-api.ts'
import { resetFilesDbForTests } from '../files/files-storage.ts'
import { invalidateFilesVfsPathCaches } from '../files/files-vfs.ts'
import { resetOpfsBlobsForTests, useMemoryOpfsForTests } from '../files/files-opfs-blobs.ts'
import { INSTANT_VM_MESSAGE_TYPE } from './virtual-machine-protocol.ts'
import { getVmRuntimeOrigin } from './virtual-machine-runtime-config.ts'
import {
  claimVirtualMachineDiskImageOccupancy,
  loadVirtualMachineDisks,
  mountVirtualMachineRemovableMedia,
  releaseVirtualMachineDiskImageOccupancy,
  releaseVirtualMachineRemovableMedia,
  slotOfDevice,
  vmMountedDiskSlots,
} from './virtual-machine-disks.ts'
import {
  countVirtualMachineDiskStreams,
  enqueueStreamWork,
  registerVirtualMachineDiskStream,
  releaseVirtualMachineDiskStream,
  releaseVirtualMachineDiskStreams,
} from './virtual-machine-disk-stream-host.ts'

useMemoryOpfsForTests()

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

async function resetFiles(): Promise<void> {
  await resetFilesDbForTests()
  await resetOpfsBlobsForTests()
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
        diskWriteMode: 'live',
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
    diskWriteMode: 'live',
    devices: [{ id: 'd1', type: 'hdd', source: 'local', path: '/user/hda.img' }],
  })
  assert.equal(countVirtualMachineDiskStreams(), 1)
  await releaseVirtualMachineDiskStreams(disks)
  assert.equal(countVirtualMachineDiskStreams(), 0)
}

async function testReleaseInProgressReplies404(): Promise<void> {
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
  await releasing
  const readReply = replies.find((item) => item.type === INSTANT_VM_MESSAGE_TYPE.diskReadResult)
  const writeReply = replies.find((item) => item.type === INSTANT_VM_MESSAGE_TYPE.diskWriteResult)
  assert.equal(readReply?.status, 404)
  assert.equal(writeReply?.status, 404)
  assert.equal(countVirtualMachineDiskStreams(), 0)
}

async function testConnectedFlagSkipsLoadAndOccupancy(): Promise<void> {
  await resetFiles()
  await createDisk('/user/cd.img')
  const result = await loadVirtualMachineDisks({
    diskWriteMode: 'live',
    devices: [{ id: 'c', type: 'cdrom', source: 'local', path: '/user/cd.img', connected: false }],
  })
  assert.equal(result.cdrom, undefined)
  assert.equal(result.cdromStream, undefined)
  assert.equal(countVirtualMachineDiskStreams(), 0)

  // 弹出的设备不声明镜像占用；同一镜像连着的设备照旧会撞占用
  claimDiskImagePath('/user/cd.img', { kind: 'vm', id: 'other-vm' })
  claimVirtualMachineDiskImageOccupancy('vm-a', [
    { id: 'c', type: 'cdrom', source: 'local', path: '/user/cd.img', connected: false },
  ])
  assert.throws(() =>
    claimVirtualMachineDiskImageOccupancy('vm-a', [
      { id: 'c', type: 'cdrom', source: 'local', path: '/user/cd.img' },
    ]),
  )
  releaseDiskImagePath('/user/cd.img', { kind: 'vm', id: 'other-vm' })
  releaseVirtualMachineDiskImageOccupancy('vm-a')
  resetDiskImageOccupancyForTests()
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
    diskWriteMode: 'live',
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
        diskWriteMode: 'live',
      }),
    /文件不存在/,
  )
  // 可写的软驱不能落在挂载卷上
  await assert.rejects(
    () =>
      mountVirtualMachineRemovableMedia({
        machineId: 'vm-m',
        device: { id: 'f', type: 'floppy', source: 'mount', path: '/mount/floppy.img' },
        slot: 'fda',
        diskWriteMode: 'live',
      }),
    /无法回写/,
  )
  assert.equal(countVirtualMachineDiskStreams(), 0)

  const mountOptions = {
    machineId: 'vm-m',
    device: { id: 'c', type: 'cdrom', source: 'local', path: '/user/swap.iso' },
    slot: 'cdrom' as const,
    diskWriteMode: 'live' as const,
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

await testLoadFailureReleasesRegisteredStreams()
await testSuccessfulLoadThenReleaseClearsStreams()
await testReleaseInProgressReplies404()
await testConnectedFlagSkipsLoadAndOccupancy()
testEmptyDeviceConsumesSlotIndex()
await testDisconnectedDeviceSkipsItsSlotAtBoot()
await testRemovableMediaMountCommitRollback()
await testRemovableMediaReleaseScopedToSlot()
console.log('virtual-machine-disks.test.ts ok')
