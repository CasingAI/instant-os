/**
 * 按偏移随机写（range write）单测。
 * 运行：node --experimental-strip-types src/apps/files/files-storage-range-write.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { defaultFilesNodeAttributes } from './files-types.ts'
import {
  cloneFileNodeWithSharedBlob,
  estimateNodeMetaBytes,
  FILES_BLOBS_STORE,
  FILES_CHUNKS_STORE,
  FILES_DB_NAME,
  FILES_NODES_STORE,
  getFilesTotalBytes,
  newFilesNodeId,
  readBlobBytes,
  readBlobBytesRange,
  readBlobText,
  resetFilesDbForTests,
  writeBlobBytes,
  writeBlobBytesRange,
} from './files-storage.ts'
import {
  filesCreateBinary,
  filesCreateText,
  filesReadBlobRange,
  filesReadText,
  filesStat,
  filesWriteBinary,
  filesWriteBytesRange,
} from './files-api.ts'
import {
  invalidateFilesVfsPathCaches,
  resolveNodeByAbsolutePath,
} from './files-vfs.ts'
import { osNowMs } from '../../os/os-clock.ts'
import type { FilesNode } from './files-types.ts'

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function bytesToString(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return new TextDecoder().decode(view)
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

async function resetState(): Promise<void> {
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()
  await resolveNodeByAbsolutePath('/user/.warmup-probe')
  invalidateFilesVfsPathCaches()
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

async function getBlobRecord(blobId: string): Promise<{
  chunked?: boolean
  bytes?: ArrayBuffer
  chunkOffsets?: number[]
  byteSize?: number
  chunkCount?: number
} | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(FILES_DB_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('open failed'))
  })
  const tx = db.transaction(FILES_BLOBS_STORE, 'readonly')
  const record = await new Promise<
    { chunked?: boolean; bytes?: ArrayBuffer; chunkOffsets?: number[]; byteSize?: number; chunkCount?: number } | undefined
  >((resolve, reject) => {
    const request = tx.objectStore(FILES_BLOBS_STORE).get(blobId)
    request.onsuccess = () => resolve(request.result as { chunked?: boolean; bytes?: ArrayBuffer; chunkOffsets?: number[]; byteSize?: number; chunkCount?: number } | undefined)
    request.onerror = () => reject(request.error ?? new Error('blob get failed'))
  })
  db.close()
  return record
}

async function getNodeRecord(nodeId: string): Promise<{
  id: string
  byteSize: number
  blobId?: string
} | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(FILES_DB_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('open failed'))
  })
  const tx = db.transaction(FILES_NODES_STORE, 'readonly')
  const record = await new Promise<{ id: string; byteSize: number; blobId?: string } | undefined>((resolve, reject) => {
    const request = tx.objectStore(FILES_NODES_STORE).get(nodeId)
    request.onsuccess = () => resolve(request.result as { id: string; byteSize: number; blobId?: string } | undefined)
    request.onerror = () => reject(request.error ?? new Error('node get failed'))
  })
  db.close()
  return record
}

function patternedBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i += 1) {
    out[i] = (i * 7 + 13) % 251
  }
  return out
}

async function createSmallFile(name: string, text: string): Promise<FilesNode> {
  const node = makeFileNode(name)
  const created = await filesCreateText(`/user/${name}`, text)
  const resolved = await resolveNodeByAbsolutePath(`/user/${name}`)
  assert.ok(resolved)
  return resolved
}

/** 空文件 offset 0 写入 */
async function testEmptyFileWriteAt0(): Promise<void> {
  await resetState()
  const before = await getFilesTotalBytes()
  const node = await createSmallFile('empty-write.txt', '')
  const updated = await writeBlobBytesRange({
    nodeId: node.id,
    offset: 0,
    bytes: utf8('hello'),
  })
  assert.equal(updated.byteSize, 5)
  assert.equal(await readBlobText(node.id), 'hello')
  const after = await getFilesTotalBytes()
  assert.equal(after - before, estimateNodeMetaBytes(node) + 5)
  console.log('ok: empty file write at offset 0')
}

/** 已有整块 blob 文件中间写入，触发拆分 */
async function testWholeBlobMiddleWrite(): Promise<void> {
  await resetState()
  const node = await createSmallFile('whole-middle.txt', 'abcdef')
  const updated = await writeBlobBytesRange({
    nodeId: node.id,
    offset: 2,
    bytes: utf8('XYZ'),
  })
  assert.equal(updated.byteSize, 6)
  assert.equal(await readBlobText(node.id), 'abXYZf')
  console.log('ok: whole blob middle write')
}

/** 写入覆盖多个 chunks */
async function testOverwriteMultipleChunks(): Promise<void> {
  await resetState()
  const total = 20 * (1 << 20)
  const data = patternedBytes(total)
  const created = await filesCreateBinary('/user/multi-chunk.bin', data.buffer)
  const node = await resolveNodeByAbsolutePath('/user/multi-chunk.bin')
  assert.ok(node)

  const payload = patternedBytes(8 * (1 << 20))
  const updated = await writeBlobBytesRange({
    nodeId: node.id,
    offset: 6 * (1 << 20),
    bytes: payload.buffer,
  })
  assert.equal(updated.byteSize, total)

  const result = bytesToString((await readBlobBytes(node.id))!)
  const full = new Uint8Array(total)
  full.set(data.subarray(0, 6 * (1 << 20)), 0)
  full.set(payload, 6 * (1 << 20))
  full.set(data.subarray(14 * (1 << 20)), 14 * (1 << 20))
  assert.equal(result, bytesToString(full))
  console.log('ok: overwrite multiple chunks')
}

/** 写入覆盖文件前缀；range write 不截断，保留未覆盖尾部 */
async function testOverwritePrefixKeepsTail(): Promise<void> {
  await resetState()
  const node = await createSmallFile('replace.txt', 'old-content')
  const updated = await writeBlobBytesRange({
    nodeId: node.id,
    offset: 0,
    bytes: utf8('brand-new'),
  })
  // range write 只覆盖 [0, 9)，不截断原文件 11 字节的尾部
  assert.equal(updated.byteSize, 'old-content'.length)
  assert.equal(await readBlobText(node.id), 'brand-newnt')
  console.log('ok: range write does not truncate')
}

/** 写入后相邻小 chunk 自动合并（目标 chunkSize 控制） */
async function testAdjacentChunksMerge(): Promise<void> {
  await resetState()
  const total = 9 * (1 << 20)
  const data = patternedBytes(total)
  const node = makeFileNode('merge.bin')
  const writer = await filesCreateBinary('/user/merge.bin', data.buffer)
  const resolved = await resolveNodeByAbsolutePath('/user/merge.bin')
  assert.ok(resolved)

  const record = await getNodeRecord(resolved.id)
  assert.ok(record && record.blobId)

  // 在 offset 2MiB 处写入 100 字节，应保持合理的 chunk 数量
  const before = await countChunks(record.blobId)
  await writeBlobBytesRange({
    nodeId: resolved.id,
    offset: 2 * (1 << 20),
    bytes: patternedBytes(100),
  })
  const after = await countChunks(record.blobId)
  assert.ok(after <= before + 2, `chunk 数应受控：${before} -> ${after}`)
  console.log('ok: adjacent chunks stay bounded')
}

/** shared blob (refCount > 1) 写入时触发 COW */
async function testSharedBlobCowForks(): Promise<void> {
  await resetState()
  const src = makeFileNode('cow-src.bin')
  const created = await filesCreateBinary('/user/cow-src.bin', utf8('shared-original'))
  const srcNode = await resolveNodeByAbsolutePath('/user/cow-src.bin')
  assert.ok(srcNode)

  const dstNode = makeFileNode('cow-dst.bin')
  const cloned = await cloneFileNodeWithSharedBlob({
    sourceNodeId: srcNode.id,
    node: dstNode,
    metaBytes: estimateNodeMetaBytes(dstNode),
    nameMode: 'exact',
  })

  const updated = await writeBlobBytesRange({
    nodeId: srcNode.id,
    offset: 0,
    bytes: utf8('forked-content'),
  })
  // range write 不截断原文件，'shared-original' 尾部 'l' 保留
  assert.equal(updated.byteSize, 'shared-original'.length)
  assert.equal(await readBlobText(srcNode.id), 'forked-contentl')
  assert.equal(await readBlobText(cloned.id), 'shared-original')

  const srcRecord = await getNodeRecord(srcNode.id)
  const dstRecord = await getNodeRecord(cloned.id)
  assert.ok(srcRecord && dstRecord)
  assert.notEqual(srcRecord.blobId, dstRecord.blobId, 'COW 后 blobId 应不同')
  console.log('ok: shared blob COW forks on range write')
}

/** 配额在写入前后正确变化 */
async function testQuotaAdjustments(): Promise<void> {
  await resetState()
  const before = await getFilesTotalBytes()
  const node = await createSmallFile('quota.txt', 'aaaa')
  const afterCreate = await getFilesTotalBytes()
  assert.equal(afterCreate - before, estimateNodeMetaBytes(node) + 4)

  // 等长覆盖：净增量为 0
  await writeBlobBytesRange({ nodeId: node.id, offset: 0, bytes: utf8('bbbb') })
  assert.equal(await getFilesTotalBytes(), afterCreate)

  // 增长写入：覆盖 [2,4) 2 字节，新增 [4,8) 4 字节 → 净增 4
  await writeBlobBytesRange({ nodeId: node.id, offset: 2, bytes: utf8('XXXXXX') })
  assert.equal(await getFilesTotalBytes(), afterCreate + 4)
  console.log('ok: quota adjusts correctly')
}

/** readBlobBytesRange 在随机写后仍能正确读取任意区间 */
async function testRangeReadAfterRandomWrite(): Promise<void> {
  await resetState()
  const total = 4 * (1 << 20) + 500
  const data = patternedBytes(total)
  const node = makeFileNode('range-after-write.bin')
  await filesCreateBinary('/user/range-after-write.bin', data.buffer)
  const resolved = await resolveNodeByAbsolutePath('/user/range-after-write.bin')
  assert.ok(resolved)

  const patch = patternedBytes(700)
  await writeBlobBytesRange({ nodeId: resolved.id, offset: 1 * (1 << 20), bytes: patch.buffer })

  const full = new Uint8Array(total)
  full.set(data)
  full.set(patch, 1 * (1 << 20))

  const ranges: [number, number][] = [
    [0, 1],
    [0, total],
    [(1 << 20) - 10, 30],
    [(1 << 20) + 300, 400],
    [total - 100, 200],
  ]
  for (const [offset, length] of ranges) {
    const got = new Uint8Array((await readBlobBytesRange(resolved.id, offset, length))!)
    const want = full.subarray(Math.max(0, offset), Math.max(0, offset) + Math.max(0, length))
    assert.equal(got.byteLength, want.byteLength)
    for (let i = 0; i < want.byteLength; i += 1) {
      assert.equal(got[i], want[i])
    }
  }
  console.log('ok: range read after random write')
}

/** API 层：filesWriteBytesRange 通过绝对路径写入 */
async function testApiWriteBytesRange(): Promise<void> {
  await resetState()
  await filesCreateText('/user/api-range.txt', 'hello world')
  const entry = await filesWriteBytesRange('/user/api-range.txt', 6, utf8('everyone'))
  assert.equal(entry.byteSize, 'hello everyone'.length)
  assert.equal(await filesReadText('/user/api-range.txt'), 'hello everyone')

  // 扩展文件
  const entry2 = await filesWriteBytesRange('/user/api-range.txt', 14, utf8('!'))
  assert.equal(entry2.byteSize, 'hello everyone!'.length)
  assert.equal(await filesReadText('/user/api-range.txt'), 'hello everyone!')
  console.log('ok: filesWriteBytesRange API layer')
}

/** offset 超过文件末尾应抛错 */
async function testOffsetBeyondEndThrows(): Promise<void> {
  await resetState()
  const node = await createSmallFile('oob.txt', 'abc')
  await assert.rejects(
    writeBlobBytesRange({ nodeId: node.id, offset: 10, bytes: utf8('x') }),
    /超出/,
  )
  console.log('ok: offset beyond end throws')
}

/** 在分块 blob 的 chunk 边界处精确写入 */
async function testWriteAtChunkBoundary(): Promise<void> {
  await resetState()
  const total = 20 * (1 << 20)
  const data = patternedBytes(total)
  await filesCreateBinary('/user/boundary.bin', data.buffer)
  const node = await resolveNodeByAbsolutePath('/user/boundary.bin')
  assert.ok(node)

  const patch = utf8('BOUNDARY')
  await writeBlobBytesRange({ nodeId: node.id, offset: 4 * (1 << 20), bytes: patch })

  const got = new Uint8Array((await readBlobBytesRange(node.id, 4 * (1 << 20) - 4, 16))!)
  const want = new Uint8Array(16)
  want.set(data.subarray(4 * (1 << 20) - 4, 4 * (1 << 20)), 0)
  want.set(patch, 4)
  want.set(data.subarray(4 * (1 << 20) + 8, 4 * (1 << 20) + 12), 12)
  assert.equal(bytesToString(got), bytesToString(want))
  console.log('ok: write at chunk boundary')
}

async function run(): Promise<void> {
  await testEmptyFileWriteAt0()
  await testWholeBlobMiddleWrite()
  await testOverwriteMultipleChunks()
  await testOverwritePrefixKeepsTail()
  await testAdjacentChunksMerge()
  await testSharedBlobCowForks()
  await testQuotaAdjustments()
  await testRangeReadAfterRandomWrite()
  await testApiWriteBytesRange()
  await testOffsetBeyondEndThrows()
  await testWriteAtChunkBoundary()
  console.log('files-storage-range-write: all passed')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
