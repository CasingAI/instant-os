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
import {
  getFileBlobStorageInfo,
  listSparseOccupiedSlots,
  resetFilesDbForTests,
  SPARSE_DEFAULT_CHUNK_SIZE,
} from '../files/files-storage.ts'
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

/** 基础镜像内容：可辨识图案，用于验证种子播种与缓存路径都不丢基础内容。 */
function makeBaseBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i += 1) {
    bytes[i] = (i * 31 + 7) % 251
  }
  return bytes
}

async function testSessionCacheKeepsBaseSeedAcrossRepeatedWrites(): Promise<void> {
  useRealDiskOverlayStoreForTests()
  await resetFiles()
  const base = makeBaseBytes(4096)
  await filesCreateBinary('/user/seeded.img', base.buffer.slice(0) as ArrayBuffer)
  const store = await openDiskOverlayStore({ imagePath: '/user/seeded.img' })
  // 首次 append：未占槽从基础镜像播种；第二次 append：命中会话槽缓存。
  // 两条路径拼出的槽内容都必须 = 基础内容 + 各自写入，且互不丢对方。
  await store.append(64, new Uint8Array([1, 2, 3, 4]))
  await store.append(128, new Uint8Array([5, 6, 7, 8]))
  const run = await store.readRun(0, 256)
  assert.deepEqual([...run.subarray(0, 8)], [...base.subarray(0, 8)])
  assert.deepEqual([...run.subarray(64, 68)], [1, 2, 3, 4])
  assert.deepEqual([...run.subarray(68, 80)], [...base.subarray(68, 80)])
  assert.deepEqual([...run.subarray(128, 132)], [5, 6, 7, 8])
  assert.deepEqual([...run.subarray(132, 200)], [...base.subarray(132, 200)])
  useMemoryDiskOverlayStoreForTests()
}

async function testStraddlingAppendAcrossSlots(): Promise<void> {
  useRealDiskOverlayStoreForTests()
  await resetFiles()
  const slot = SPARSE_DEFAULT_CHUNK_SIZE
  const base = makeBaseBytes(slot + 4096)
  await filesCreateBinary('/user/wide.img', base.buffer.slice(0) as ArrayBuffer)
  const store = await openDiskOverlayStore({ imagePath: '/user/wide.img' })
  // 跨槽写：slot-32 起 64 字节，横跨槽 0 与槽 1（槽 1 是 4096 字节的尾槽）。
  const patch = new Uint8Array(64).fill(0xee)
  await store.append(slot - 32, patch)
  const run = await store.readRun(slot - 64, 128)
  assert.deepEqual([...run.subarray(0, 32)], [...base.subarray(slot - 64, slot - 32)])
  assert.deepEqual([...run.subarray(32, 96)], [...patch])
  assert.deepEqual([...run.subarray(96, 128)], [...base.subarray(slot + 32, slot + 64)])
  assert.deepEqual(await store.segments(), [
    { offset: 0, length: slot },
    { offset: slot, length: 4096 },
  ])
  assert.equal(store.dirtyBytes(), slot + 4096)
  useMemoryDiskOverlayStoreForTests()
}

async function testDirtyBytesMatchesRescan(): Promise<void> {
  useRealDiskOverlayStoreForTests()
  await resetFiles()
  const slot = SPARSE_DEFAULT_CHUNK_SIZE
  await filesCreateBinary('/user/dirty.img', makeBaseBytes(slot + 4096).buffer.slice(0) as ArrayBuffer)
  const store = await openDiskOverlayStore({ imagePath: '/user/dirty.img' })
  const rescan = async (): Promise<number> => {
    const node = await resolveNodeByAbsolutePath(vmDiskCacheAttachmentPath('/user/dirty.img'))
    const slots = node ? await listSparseOccupiedSlots(node.id) : []
    return slots.reduce((sum, item) => sum + item.length, 0)
  }
  assert.equal(store.dirtyBytes(), 0)
  await store.append(0, new Uint8Array([1]))
  assert.equal(store.dirtyBytes(), slot)
  assert.equal(store.dirtyBytes(), await rescan())
  // 同槽再写不重复计数
  await store.append(64, new Uint8Array([2]))
  assert.equal(store.dirtyBytes(), slot)
  assert.equal(store.dirtyBytes(), await rescan())
  // 跨进尾槽：dirty = 槽 0 + 尾槽 4096
  await store.append(slot, new Uint8Array([3]))
  assert.equal(store.dirtyBytes(), slot + 4096)
  assert.equal(store.dirtyBytes(), await rescan())
  useMemoryDiskOverlayStoreForTests()
}

async function testReopenedStoreSeedsFromAttachment(): Promise<void> {
  useRealDiskOverlayStoreForTests()
  await resetFiles()
  await filesCreateBinary('/user/reopen.img', new Uint8Array(4096).buffer)
  const key = { imagePath: '/user/reopen.img' }
  const first = await openDiskOverlayStore(key)
  await first.append(64, new Uint8Array([1, 2, 3, 4]))
  // 换一个新会话（清空 store 缓存）：已占槽的种子必须读自附加而非全零基础镜像。
  resetDiskOverlayStoreForTests()
  const second = await openDiskOverlayStore(key)
  assert.equal(second.dirtyBytes(), 4096)
  await second.append(128, new Uint8Array([5, 6, 7, 8]))
  const run = await second.readRun(0, 256)
  assert.deepEqual([...run.subarray(64, 68)], [1, 2, 3, 4])
  assert.deepEqual([...run.subarray(128, 132)], [5, 6, 7, 8])
  assert.deepEqual([...run.subarray(0, 8)], [0, 0, 0, 0, 0, 0, 0, 0])
  useMemoryDiskOverlayStoreForTests()
}

async function testRemoveClearsSessionState(): Promise<void> {
  useRealDiskOverlayStoreForTests()
  await resetFiles()
  await filesCreateBinary('/user/clear.img', new Uint8Array(4096).buffer)
  const key = { imagePath: '/user/clear.img' }
  const store = await openDiskOverlayStore(key)
  await store.append(0, new Uint8Array([9, 9, 9, 9]))
  assert.equal(store.dirtyBytes(), 4096)
  await store.remove()
  assert.equal(store.dirtyBytes(), 0)
  assert.deepEqual(await store.segments(), [])
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
await testSessionCacheKeepsBaseSeedAcrossRepeatedWrites()
await testStraddlingAppendAcrossSlots()
await testDirtyBytesMatchesRescan()
await testReopenedStoreSeedsFromAttachment()
await testRemoveClearsSessionState()
console.log('virtual-machine-disk-overlay-store.test.ts ok')
