/**
 * 虚拟机硬盘缓存持久层单测（机会压缩附加 + 内存后端）。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-disk-overlay-store.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import {
  openDiskOverlayStore,
  replayDiskOverlayStore,
  resetDiskOverlayStoreForTests,
  useMemoryDiskOverlayStoreForTests,
  useRealDiskOverlayStoreForTests,
  vmDiskCacheAttachmentPath,
  inspectDiskCacheAttachment,
  VM_DISK_CACHE_ATTACHMENT_NAME,
  VM_DISK_CACHE_ATTACHMENT_TAG,
} from './virtual-machine-disk-overlay-store.ts'
import { filesCreateAttachment, filesCreateBinary, filesCreateSparseBinary } from '../files/files-api.ts'
import { getFileBlobStorageInfo, resetFilesDbForTests, SPARSE_DEFAULT_CHUNK_SIZE } from '../files/files-storage.ts'
import { invalidateFilesVfsPathCaches, resolveNodeByAbsolutePath } from '../files/files-vfs.ts'
import { resetOpfsBlobsForTests, useMemoryOpfsForTests } from '../files/files-opfs-blobs.ts'

useMemoryOpfsForTests()
useMemoryDiskOverlayStoreForTests()

async function resetFiles(): Promise<void> {
  await resetFilesDbForTests()
  await resetOpfsBlobsForTests()
  resetDiskOverlayStoreForTests()
  invalidateFilesVfsPathCaches()
}

async function testMemoryBackendAppendReplayRemove(): Promise<void> {
  await resetFiles()
  const key = { imagePath: '/user/a.img' }
  const store = await openDiskOverlayStore(key)
  await store.append(0, new Uint8Array([1, 2, 3, 4]))
  await store.append(512, new Uint8Array([5, 6, 7, 8]))
  const replayed: { offset: number; bytes: number[] }[] = []
  await replayDiskOverlayStore(key, (offset, bytes) => {
    replayed.push({ offset, bytes: [...bytes] })
  })
  assert.deepEqual(replayed, [
    { offset: 0, bytes: [1, 2, 3, 4] },
    { offset: 512, bytes: [5, 6, 7, 8] },
  ])
  await store.replaceAll([{ offset: 8, bytes: new Uint8Array([9, 9]) }])
  const records = await store.records()
  assert.equal(records.length, 1)
  assert.equal(records[0]?.offset, 8)
  await store.remove()
  assert.equal((await store.records()).length, 0)
}

async function testMemoryBackendSegmentsAndReadRun(): Promise<void> {
  await resetFiles()
  const store = await openDiskOverlayStore({ imagePath: '/user/mem.img' })
  await store.append(0, new Uint8Array([1, 2, 3, 4]))
  await store.append(64, new Uint8Array([5, 6]))
  assert.deepEqual(await store.segments(), [
    { offset: 0, length: 4 },
    { offset: 64, length: 2 },
  ])
  assert.deepEqual([...(await store.readRun(0, 4))], [1, 2, 3, 4])
  assert.deepEqual([...(await store.readRun(64, 2))], [5, 6])
}

async function testRepeatedWritesToSameSlotStayCompact(): Promise<void> {
  useRealDiskOverlayStoreForTests()
  await resetFiles()
  await filesCreateBinary('/user/repeat.img', new Uint8Array(4096).buffer)
  const key = { imagePath: '/user/repeat.img' }
  const store = await openDiskOverlayStore(key)
  const offset = 64
  const length = 64
  let lastVersion = new Uint8Array(0)
  let storedAfterFirst = -1
  for (let i = 0; i < 40; i += 1) {
    lastVersion = new Uint8Array(length).fill(i % 251)
    await store.append(offset, lastVersion)
    if (i === 0) {
      await store.flush()
      const node = await resolveNodeByAbsolutePath(vmDiskCacheAttachmentPath('/user/repeat.img'))
      storedAfterFirst = (await getFileBlobStorageInfo(node!.id))!.storedByteSize
    }
  }
  await store.flush()
  const attachNode = await resolveNodeByAbsolutePath(vmDiskCacheAttachmentPath('/user/repeat.img'))
  const storedAfterAll = (await getFileBlobStorageInfo(attachNode!.id))!.storedByteSize
  assert.equal(storedAfterAll, storedAfterFirst)
  assert.equal(storedAfterAll, 4096)
  const records = await store.records()
  assert.equal(records.length, 1)
  assert.deepEqual(records[0]?.bytes.subarray(offset, offset + length), lastVersion)
  useMemoryDiskOverlayStoreForTests()
}

async function testSameSlotDistinctOffsetsKeepBothWrites(): Promise<void> {
  useRealDiskOverlayStoreForTests()
  await resetFiles()
  const slot = SPARSE_DEFAULT_CHUNK_SIZE
  await filesCreateSparseBinary('/user/slot-map.img', slot * 2, { chunkSize: slot })
  const store = await openDiskOverlayStore({ imagePath: '/user/slot-map.img' })
  await store.append(19968, new Uint8Array([0xeb, 0x3c, 0x90]))
  await store.append(64 * 1024, new Uint8Array([0x4d, 0x5a]))
  const boot = await store.readOverlapping(19968, 3)
  assert.equal(boot.length, 1)
  assert.deepEqual([...boot[0]!.bytes], [0xeb, 0x3c, 0x90])
  const pe = await store.readOverlapping(64 * 1024, 2)
  assert.equal(pe.length, 1)
  assert.deepEqual([...pe[0]!.bytes], [0x4d, 0x5a])
  const slotRun = await store.readRun(0, slot)
  assert.deepEqual([...slotRun.subarray(19968, 19971)], [0xeb, 0x3c, 0x90])
  assert.deepEqual([...slotRun.subarray(64 * 1024, 64 * 1024 + 2)], [0x4d, 0x5a])
  useMemoryDiskOverlayStoreForTests()
}

async function testDisjointAndOverlappingSegments(): Promise<void> {
  await resetFiles()
  const store = await openDiskOverlayStore({ imagePath: '/user/seg.img' })
  await store.append(0, new Uint8Array([1, 2, 3, 4]))
  await store.append(512, new Uint8Array([5, 6, 7, 8]))
  assert.deepEqual(await store.segments(), [
    { offset: 0, length: 4 },
    { offset: 512, length: 4 },
  ])
  await store.append(2, new Uint8Array([9, 9, 9, 9]))
  assert.deepEqual(await store.segments(), [
    { offset: 0, length: 6 },
    { offset: 512, length: 4 },
  ])
  assert.deepEqual([...(await store.readRun(0, 6))], [1, 2, 9, 9, 9, 9])
}

async function testLegacyLogMigratesToSparseOnOpen(): Promise<void> {
  useRealDiskOverlayStoreForTests()
  await resetFiles()
  await filesCreateBinary('/user/legacy.img', new Uint8Array(4096).buffer)
  const records: { offset: number; bytes: number[] }[] = [
    { offset: 0, bytes: [1, 2] },
    { offset: 0, bytes: [9, 9] },
    { offset: 8, bytes: [3, 4] },
  ]
  const log = new Uint8Array(records.reduce((sum, r) => sum + 8 + r.bytes.length, 0))
  const view = new DataView(log.buffer)
  let cursor = 0
  for (const record of records) {
    view.setUint32(cursor, record.bytes.length, true)
    view.setUint32(cursor + 4, record.offset, true)
    log.set(record.bytes, cursor + 8)
    cursor += 8 + record.bytes.length
  }
  await filesCreateAttachment({
    mainFilePath: '/user/legacy.img',
    name: VM_DISK_CACHE_ATTACHMENT_NAME,
    bytes: log.buffer.slice(log.byteOffset, log.byteOffset + log.byteLength) as ArrayBuffer,
    tags: [VM_DISK_CACHE_ATTACHMENT_TAG],
    nameMode: 'exact',
  })
  const store = await openDiskOverlayStore({ imagePath: '/user/legacy.img' })
  const replayed: { offset: number; bytes: number[] }[] = []
  await replayDiskOverlayStore({ imagePath: '/user/legacy.img' }, (offset, bytes) => {
    replayed.push({ offset, bytes: [...bytes] })
  })
  assert.equal(replayed.length, 1)
  assert.equal(replayed[0]?.offset, 0)
  assert.deepEqual(replayed[0]?.bytes.slice(0, 2), [9, 9])
  assert.deepEqual(replayed[0]?.bytes.slice(8, 10), [3, 4])
  const attach = await resolveNodeByAbsolutePath(vmDiskCacheAttachmentPath('/user/legacy.img'))
  const info = await getFileBlobStorageInfo(attach!.id)
  assert.equal(info?.sparseSlots, true)
  assert.equal(info?.slotSize, SPARSE_DEFAULT_CHUNK_SIZE)
  assert.equal((await store.segments()).length, 1)
  useMemoryDiskOverlayStoreForTests()
}

async function testUntaggedSameNameRefusesReuse(): Promise<void> {
  useRealDiskOverlayStoreForTests()
  await resetFiles()
  await filesCreateBinary('/user/clash.img', new Uint8Array(4096).buffer)
  await filesCreateAttachment({
    mainFilePath: '/user/clash.img',
    name: VM_DISK_CACHE_ATTACHMENT_NAME,
    bytes: new Uint8Array([1, 2, 3, 4]).buffer,
    nameMode: 'exact',
  })
  await assert.rejects(
    () => openDiskOverlayStore({ imagePath: '/user/clash.img' }),
    /没有虚拟机硬盘缓存标签/,
  )
  useMemoryDiskOverlayStoreForTests()
}

async function testAttachmentBackendRoundTrip(): Promise<void> {
  useRealDiskOverlayStoreForTests()
  await resetFiles()
  await filesCreateSparseBinary('/user/b.img', 4096, { chunkSize: SPARSE_DEFAULT_CHUNK_SIZE })
  const key = { imagePath: '/user/b.img' }
  const store = await openDiskOverlayStore(key)
  await store.append(0, new Uint8Array([7, 7, 7, 7]))
  await store.append(64, new Uint8Array([8, 8]))
  await store.flush()
  const info = await inspectDiskCacheAttachment(key)
  assert.ok(info)
  assert.equal(info.records, 1)
  assert.equal(info.storedBytes, 4096)
  const overlapping = await store.readOverlapping(0, 8)
  assert.deepEqual([...overlapping[0]!.bytes.subarray(0, 4)], [7, 7, 7, 7])
  await store.remove()
  assert.equal(await inspectDiskCacheAttachment(key), undefined)
  const { filesStat } = await import('../files/files-api.ts')
  assert.equal(await filesStat(vmDiskCacheAttachmentPath('/user/b.img')), undefined)
  useMemoryDiskOverlayStoreForTests()
}

await testMemoryBackendAppendReplayRemove()
await testMemoryBackendSegmentsAndReadRun()
await testRepeatedWritesToSameSlotStayCompact()
await testSameSlotDistinctOffsetsKeepBothWrites()
await testDisjointAndOverlappingSegments()
await testLegacyLogMigratesToSparseOnOpen()
await testUntaggedSameNameRefusesReuse()
await testAttachmentBackendRoundTrip()
console.log('virtual-machine-disk-overlay-store.test.ts ok')
