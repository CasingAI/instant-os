/**
 * 大文件正文进 OPFS：索引仍在 IndexedDB，配额仍看目录大小。
 * 运行：node --experimental-strip-types src/apps/files/files-storage-opfs.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { defaultFilesNodeAttributes } from './files-types.ts'
import {
  cloneFileNodeWithSharedBlob,
  collectSubtreeIds,
  deleteSubtree,
  estimateNodeMetaBytes,
  FILES_CHUNKS_STORE,
  FILES_DB_NAME,
  getFileBlobRefForTests,
  getFilesBytesByLocation,
  getFilesTotalBytes,
  newFilesNodeId,
  openStreamWriteBlob,
  readBlobBytes,
  readBlobBytesRange,
  resetFilesDbForTests,
  writeBlobBytes,
  writeBlobBytesRange,
} from './files-storage.ts'
import {
  filesCreateBinary,
  filesCreateText,
  filesOpenStreamWrite,
  filesReadBlobRange,
  filesWriteBinary,
  filesWriteBytesRange,
} from './files-api.ts'
import {
  invalidateFilesVfsPathCaches,
  resolveNodeByAbsolutePath,
} from './files-vfs.ts'
import {
  deleteOpfsBlob,
  opfsBlobExists,
  OPFS_SPILL_THRESHOLD,
  readOpfsBlobBytes,
  resetOpfsBlobsForTests,
  useMemoryOpfsForTests,
  writeOpfsBlobBytes,
  writeOpfsBlobRange,
} from './files-opfs-blobs.ts'
import { osNowMs } from '../../os/os-clock.ts'
import type { FilesNode } from './files-types.ts'

useMemoryOpfsForTests()

function patternedBytes(length: number): Uint8Array {
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i++) out[i] = i % 251
  return out
}

function makeFileNode(name: string): FilesNode {
  const now = osNowMs()
  return {
    id: newFilesNodeId(),
    locationId: 'local',
    parentId: undefined,
    name,
    kind: 'file',
    mimeType: 'application/octet-stream',
    byteSize: 0,
    createdAt: now,
    updatedAt: now,
    attributes: defaultFilesNodeAttributes('local'),
  }
}

async function countChunks(blobId: string): Promise<number> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(FILES_DB_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('open failed'))
  })
  const tx = db.transaction(FILES_CHUNKS_STORE, 'readonly')
  const range = IDBKeyRange.bound([blobId, 0], [blobId, Number.MAX_SAFE_INTEGER])
  const count = await new Promise<number>((resolve, reject) => {
    const request = tx.objectStore(FILES_CHUNKS_STORE).count(range)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('count failed'))
  })
  db.close()
  return count
}

async function resetState(): Promise<void> {
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()
  await resolveNodeByAbsolutePath('/user/.warmup-probe')
  invalidateFilesVfsPathCaches()
}

async function testOpfsModuleRoundTrip(): Promise<void> {
  resetOpfsBlobsForTests()
  const id = 'blob:opfs-mod'
  const data = patternedBytes(4096)
  await writeOpfsBlobBytes(id, data)
  assert.equal(await opfsBlobExists(id), true)
  const all = new Uint8Array((await readOpfsBlobBytes(id))!)
  assert.equal(all.byteLength, 4096)
  assert.equal(all[100], data[100])
  await writeOpfsBlobRange(id, 10, new Uint8Array([9, 8, 7]))
  const slice = new Uint8Array((await readOpfsBlobBytes(id))!.slice(10, 13))
  assert.deepEqual([...slice], [9, 8, 7])
  await deleteOpfsBlob(id)
  assert.equal(await opfsBlobExists(id), false)
  console.log('ok: opfs module write/read/range/delete')
}

async function testSmallFileStaysInIdb(): Promise<void> {
  await resetState()
  await filesCreateText('/user/small.txt', 'hello-opfs')
  const node = await resolveNodeByAbsolutePath('/user/small.txt')
  assert.ok(node)
  const ref = await getFileBlobRefForTests(node.id)
  assert.ok(ref)
  assert.equal(ref.backend, undefined)
  assert.equal(await opfsBlobExists(ref.blobId), false)
  console.log('ok: small file stays in IndexedDB')
}

async function testCreateOverThresholdGoesToOpfs(): Promise<void> {
  await resetState()
  const total = OPFS_SPILL_THRESHOLD + 64
  const data = patternedBytes(total)
  const before = await getFilesTotalBytes()
  await filesCreateBinary('/user/big.bin', data.buffer)
  const node = await resolveNodeByAbsolutePath('/user/big.bin')
  assert.ok(node)
  assert.equal(node.byteSize, total)
  const ref = await getFileBlobRefForTests(node.id)
  assert.ok(ref)
  assert.equal(ref.backend, 'opfs')
  assert.equal(await countChunks(ref.blobId), 0, 'OPFS 正文不应再分块进库')
  assert.equal(await opfsBlobExists(ref.blobId), true)
  const got = new Uint8Array((await readBlobBytes(node.id))!)
  assert.equal(got.byteLength, total)
  assert.equal(got[0], data[0])
  assert.equal(got[total - 1], data[total - 1])
  const loc = await getFilesBytesByLocation(['local'])
  assert.equal(loc[0]?.bytes, total)
  const after = await getFilesTotalBytes()
  assert.equal(after - before, estimateNodeMetaBytes(node) + total)
  console.log('ok: create > 25MB goes to OPFS, quota follows node size')
}

async function testQuotaDoesNotScanOpfs(): Promise<void> {
  await resetState()
  const total = OPFS_SPILL_THRESHOLD + 32
  const data = patternedBytes(total)
  await filesCreateBinary('/user/scan.bin', data.buffer)
  const node = await resolveNodeByAbsolutePath('/user/scan.bin')
  assert.ok(node)
  const ref = await getFileBlobRefForTests(node.id)
  assert.ok(ref)
  await deleteOpfsBlob(ref.blobId)
  assert.equal(await opfsBlobExists(ref.blobId), false)
  const loc = await getFilesBytesByLocation(['local'])
  assert.equal(loc[0]?.bytes, total, '占用只看目录大小，不扫 OPFS')
  console.log('ok: location bytes ignore missing OPFS payload')
}

async function testStreamExpectedSizeGoesDirectToOpfs(): Promise<void> {
  await resetState()
  const total = OPFS_SPILL_THRESHOLD + 128
  const data = patternedBytes(total)
  const writer = await filesOpenStreamWrite('/user/stream-direct.bin', {
    expectedSize: total,
  })
  const slice = 1 << 20
  for (let offset = 0; offset < total; offset += slice) {
    await writer.write(data.subarray(offset, Math.min(offset + slice, total)))
  }
  const node = await writer.close()
  const ref = await getFileBlobRefForTests(node.id)
  assert.ok(ref)
  assert.equal(ref.backend, 'opfs')
  assert.equal(await countChunks(ref.blobId), 0)
  const mid = new Uint8Array(await (await filesReadBlobRange('/user/stream-direct.bin', 100, 20)).arrayBuffer())
  assert.deepEqual([...mid], [...data.subarray(100, 120)])
  console.log('ok: expectedSize over threshold writes OPFS directly')
}

async function testStreamSpillWhenCrossingThreshold(): Promise<void> {
  await resetState()
  const under = OPFS_SPILL_THRESHOLD - (1 << 20)
  const extra = 2 << 20
  const first = patternedBytes(under)
  const second = patternedBytes(extra)
  const writer = await filesOpenStreamWrite('/user/spill.bin')
  await writer.write(first)
  const node = await resolveNodeByAbsolutePath('/user/spill.bin')
  assert.ok(node)
  const duringRef = await getFileBlobRefForTests(node.id)
  assert.ok(duringRef)
  assert.equal(duringRef.backend, undefined, '跨过阈值前仍在库里')
  await writer.write(second)
  const closed = await writer.close()
  const ref = await getFileBlobRefForTests(closed.id)
  assert.ok(ref)
  assert.equal(ref.backend, 'opfs')
  assert.equal(await countChunks(ref.blobId), 0, '搬到 OPFS 后库内分块应清空')
  assert.equal(closed.byteSize, under + extra)
  const tail = new Uint8Array((await readBlobBytesRange(closed.id, under, 16))!)
  assert.deepEqual([...tail], [...second.subarray(0, 16)])
  console.log('ok: stream spills to OPFS after crossing 25MB')
}

async function testCloneSharesOpfsAndCowForks(): Promise<void> {
  await resetState()
  const total = OPFS_SPILL_THRESHOLD + 256
  const data = patternedBytes(total)
  const srcNode = makeFileNode('cow-src.bin')
  const created = await openStreamWriteBlob({
    node: srcNode,
    isNew: true,
    metaBytes: estimateNodeMetaBytes(srcNode),
    previousByteSize: 0,
    expectedSize: total,
    nameMode: 'exact',
  })
  await created.write(data)
  const src = await created.close()
  const srcRef = await getFileBlobRefForTests(src.id)
  assert.ok(srcRef)
  assert.equal(srcRef.backend, 'opfs')

  const dstNode = makeFileNode('cow-dst.bin')
  const cloned = await cloneFileNodeWithSharedBlob({
    sourceNodeId: src.id,
    node: dstNode,
    metaBytes: estimateNodeMetaBytes(dstNode),
    nameMode: 'exact',
  })
  const dstRef = await getFileBlobRefForTests(cloned.id)
  assert.ok(dstRef)
  assert.equal(dstRef.blobId, srcRef.blobId)
  assert.equal(dstRef.refCount, 2)
  const quotaAfterClone = await getFilesTotalBytes()

  const patch = new Uint8Array([1, 2, 3, 4, 5])
  await writeBlobBytesRange({ nodeId: cloned.id, offset: 10, bytes: patch })
  const srcAfter = new Uint8Array((await readBlobBytesRange(src.id, 10, 5))!)
  const dstAfter = new Uint8Array((await readBlobBytesRange(cloned.id, 10, 5))!)
  assert.deepEqual([...srcAfter], [...data.subarray(10, 15)], '改副本不应动源文件')
  assert.deepEqual([...dstAfter], [1, 2, 3, 4, 5])
  const srcRefAfter = await getFileBlobRefForTests(src.id)
  const dstRefAfter = await getFileBlobRefForTests(cloned.id)
  assert.ok(srcRefAfter && dstRefAfter)
  assert.notEqual(srcRefAfter.blobId, dstRefAfter.blobId)
  assert.equal(srcRefAfter.refCount, 1)
  assert.equal(await opfsBlobExists(srcRefAfter.blobId), true)
  assert.equal(await opfsBlobExists(dstRefAfter.blobId), true)

  await deleteSubtree(await collectSubtreeIds(src.id))
  assert.equal(await opfsBlobExists(dstRefAfter.blobId), true, '删源后副本正文仍在')
  assert.deepEqual(
    [...new Uint8Array((await readBlobBytesRange(cloned.id, 10, 5))!)],
    [1, 2, 3, 4, 5],
  )
  await deleteSubtree(await collectSubtreeIds(cloned.id))
  assert.equal(await opfsBlobExists(dstRefAfter.blobId), false)
  assert.ok((await getFilesTotalBytes()) < quotaAfterClone)
  console.log('ok: clone shares OPFS; range write forks; delete last copy removes file')
}

async function testRangeWriteGrowsPastThreshold(): Promise<void> {
  await resetState()
  const start = 4 << 20
  await filesCreateBinary('/user/grow.bin', patternedBytes(start).buffer)
  const node = await resolveNodeByAbsolutePath('/user/grow.bin')
  assert.ok(node)
  const before = await getFileBlobRefForTests(node.id)
  assert.ok(before)
  assert.equal(before.backend, undefined)
  const extra = OPFS_SPILL_THRESHOLD
  await filesWriteBytesRange('/user/grow.bin', start, patternedBytes(extra).buffer)
  const grown = await resolveNodeByAbsolutePath('/user/grow.bin')
  assert.ok(grown)
  const ref = await getFileBlobRefForTests(grown.id)
  assert.ok(ref)
  assert.equal(ref.backend, 'opfs')
  assert.equal(grown.byteSize, start + extra)
  assert.equal(await countChunks(ref.blobId), 0)
  console.log('ok: range write past 25MB spills to OPFS')
}

async function testOpfsStaysAfterShrink(): Promise<void> {
  await resetState()
  const total = OPFS_SPILL_THRESHOLD + 16
  await filesCreateBinary('/user/shrink.bin', patternedBytes(total).buffer)
  const node = await resolveNodeByAbsolutePath('/user/shrink.bin')
  assert.ok(node)
  const small = patternedBytes(128)
  await filesWriteBinary('/user/shrink.bin', small.buffer)
  const after = await resolveNodeByAbsolutePath('/user/shrink.bin')
  assert.ok(after)
  const ref = await getFileBlobRefForTests(after.id)
  assert.ok(ref)
  assert.equal(ref.backend, 'opfs', '变短后仍留在 OPFS')
  assert.equal(after.byteSize, 128)
  const got = new Uint8Array((await readBlobBytes(after.id))!)
  assert.deepEqual([...got], [...small])
  console.log('ok: OPFS blob stays after shrink')
}

async function testAbortOpfsStreamRollsBack(): Promise<void> {
  await resetState()
  const before = await getFilesTotalBytes()
  const writer = await filesOpenStreamWrite('/user/abort-opfs.bin', {
    expectedSize: OPFS_SPILL_THRESHOLD + 8,
  })
  await writer.write(patternedBytes(1 << 20))
  const during = await resolveNodeByAbsolutePath('/user/abort-opfs.bin')
  assert.ok(during)
  const ref = await getFileBlobRefForTests(during.id)
  assert.ok(ref)
  await writer.abort()
  assert.equal(await resolveNodeByAbsolutePath('/user/abort-opfs.bin'), undefined)
  assert.equal(await opfsBlobExists(ref.blobId), false)
  assert.equal(await getFilesTotalBytes(), before)
  console.log('ok: abort OPFS stream removes node, file, and quota')
}

async function testWholeWriteOverThreshold(): Promise<void> {
  await resetState()
  await filesCreateText('/user/replace-big.bin', 'tiny')
  const total = OPFS_SPILL_THRESHOLD + 8
  const data = patternedBytes(total)
  await writeBlobBytes({
    id: (await resolveNodeByAbsolutePath('/user/replace-big.bin'))!.id,
    bytes: data.buffer,
    previousByteSize: 4,
    nameMetaDelta: 0,
  })
  const node = await resolveNodeByAbsolutePath('/user/replace-big.bin')
  assert.ok(node)
  const ref = await getFileBlobRefForTests(node.id)
  assert.ok(ref)
  assert.equal(ref.backend, 'opfs')
  assert.equal(new Uint8Array((await readBlobBytes(node.id))!)[7], data[7])
  console.log('ok: whole overwrite above threshold goes to OPFS')
}

async function run(): Promise<void> {
  await testOpfsModuleRoundTrip()
  await testSmallFileStaysInIdb()
  await testCreateOverThresholdGoesToOpfs()
  await testQuotaDoesNotScanOpfs()
  await testStreamExpectedSizeGoesDirectToOpfs()
  await testStreamSpillWhenCrossingThreshold()
  await testCloneSharesOpfsAndCowForks()
  await testRangeWriteGrowsPastThreshold()
  await testOpfsStaysAfterShrink()
  await testAbortOpfsStreamRollsBack()
  await testWholeWriteOverThreshold()
  console.log('files-storage-opfs: all passed')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
