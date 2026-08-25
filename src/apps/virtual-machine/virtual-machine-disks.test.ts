/**
 * 磁盘加载失败清理、释放过程中新消息 404。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-disks.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { filesCreateBinary } from '../files/files-api.ts'
import { resetFilesDbForTests } from '../files/files-storage.ts'
import { invalidateFilesVfsPathCaches } from '../files/files-vfs.ts'
import { resetOpfsBlobsForTests, useMemoryOpfsForTests } from '../files/files-opfs-blobs.ts'
import { INSTANT_VM_MESSAGE_TYPE } from './virtual-machine-protocol.ts'
import { getVmRuntimeOrigin } from './virtual-machine-runtime-config.ts'
import { loadVirtualMachineDisks } from './virtual-machine-disks.ts'
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

await testLoadFailureReleasesRegisteredStreams()
await testSuccessfulLoadThenReleaseClearsStreams()
await testReleaseInProgressReplies404()
console.log('virtual-machine-disks.test.ts ok')
