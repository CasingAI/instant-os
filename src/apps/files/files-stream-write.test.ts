/**
 * 分块 blob 流式写（Streaming Write）单测。
 * 运行：node --experimental-strip-types src/apps/files/files-stream-write.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { defaultFilesNodeAttributes } from './files-types.ts'
import {
  cloneFileNodeWithSharedBlob,
  collectSubtreeIds,
  deleteSubtree,
  estimateNodeMetaBytes,
  FILES_BLOBS_STORE,
  FILES_CHUNKS_STORE,
  FILES_DB_NAME,
  FILES_NODES_STORE,
  getFileBlobRefForTests,
  getFilesTotalBytes,
  newFilesNodeId,
  openStreamWriteBlob,
  readBlobBytes,
  readBlobBytesRange,
  readBlobText,
  resetFilesDbForTests,
  sweepOrphanChunksOnce,
  writeBlobBytes,
  writeBlobText,
} from './files-storage.ts'
import {
  filesCreateBinary,
  filesCreateText,
  filesOpenStreamWrite,
  filesReadBlob,
  filesReadBlobRange,
  filesReadText,
  filesStat,
  filesUpsertBatch,
  filesWriteBinary,
} from './files-api.ts'
import { invalidateFilesVfsPathCaches, resolveNodeByAbsolutePath } from './files-vfs.ts'
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
  // 触发用户特殊文件夹自动创建，使其元数据计入配额基线（否则配额断言偏移）
  await resolveNodeByAbsolutePath('/user/.warmup-probe')
  invalidateFilesVfsPathCaches()
}

/** API 层：新建 → 流中可见 → close → 读回一致 + 配额正确 */
async function testStreamCreateAndReadBack(): Promise<void> {
  await resetState()
  const before = await getFilesTotalBytes()
  const writer = await filesOpenStreamWrite('/user/stream.bin')
  await writer.write(utf8('hello'))
  // 流中文件已存在（byteSize 0，close 前逐步长大）
  const during = await filesStat('/user/stream.bin')
  assert.ok(during, '流中文件应已存在')
  assert.equal(during!.name, 'stream.bin')
  await writer.write(utf8(' '))
  await writer.write(utf8('world'))
  const node = await writer.close()
  assert.equal(node.byteSize, 'hello world'.length)

  const text = await filesReadText('/user/stream.bin')
  assert.equal(text, 'hello world')
  const entry = await filesStat('/user/stream.bin')
  assert.equal(entry?.byteSize, 'hello world'.length)
  assert.ok(entry?.contentRevisionId)
  // 配额：元数据 + 内容
  const after = await getFilesTotalBytes()
  assert.equal(after - before, estimateNodeMetaBytes(node) + 'hello world'.length)
  console.log('ok: stream create → read back → quota')
}

/** API 层：abort 新建 → 文件消失 + 配额回退 */
async function testAbortNewFile(): Promise<void> {
  await resetState()
  const before = await getFilesTotalBytes()
  const writer = await filesOpenStreamWrite('/user/abort-new.bin')
  await writer.write(utf8('partial-data'))
  const during = await filesStat('/user/abort-new.bin')
  assert.ok(during, 'abort 前文件存在')
  await writer.abort()
  const after = await filesStat('/user/abort-new.bin')
  assert.equal(after, undefined, 'abort 后文件应消失')
  assert.equal(await getFilesTotalBytes(), before, 'abort 后配额应回退')
  console.log('ok: abort new file removes node and rolls back quota')
}

/** API 层：abort 覆盖 → 旧内容原样 + 配额不变 */
async function testAbortOverwriteKeepsOld(): Promise<void> {
  await resetState()
  await filesCreateText('/user/keep.txt', 'old-content')
  const before = await getFilesTotalBytes()
  const writer = await filesOpenStreamWrite('/user/keep.txt')
  await writer.write(utf8('new-content-that-should-be-discarded'))
  await writer.abort()
  assert.equal(await filesReadText('/user/keep.txt'), 'old-content')
  assert.equal(await getFilesTotalBytes(), before, 'abort 覆盖后配额应不变')
  console.log('ok: abort overwrite keeps old content')
}

/** API 层：close 覆盖 → 内容替换 + 旧 blob 释放 */
async function testOverwriteCloseReplaces(): Promise<void> {
  await resetState()
  await filesCreateText('/user/replace.txt', 'old-content')
  const before = await getFilesTotalBytes()
  const writer = await filesOpenStreamWrite('/user/replace.txt')
  await writer.write(utf8('new-content'))
  const node = await writer.close()
  assert.equal(node.byteSize, 'new-content'.length)
  assert.equal(await filesReadText('/user/replace.txt'), 'new-content')
  const after = await getFilesTotalBytes()
  // 覆盖：元数据不变，旧内容释放；净增 = 新内容 - 旧内容
  assert.equal(after - before, 'new-content'.length - 'old-content'.length)
  console.log('ok: overwrite close replaces content and releases old')
}

/** 存储层：覆盖 chunked 文件时旧 chunk 被清理（无孤儿） */
async function testOverwriteChunkedCleansOldChunks(): Promise<void> {
  await resetState()
  const node = makeFileNode('c.bin')
  const writer = await openStreamWriteBlob({
    node,
    isNew: true,
    metaBytes: estimateNodeMetaBytes(node),
    previousByteSize: 0,
    nameMode: 'exact',
  })
  await writer.write(utf8('first'))
  const closed = await writer.close()
  const firstRef = await getFileBlobRefForTests(closed.id)
  assert.ok(firstRef)
  assert.equal(await countChunks(firstRef.blobId), 1)

  // 用整块写覆盖 chunked 文件
  await writeBlobText({
    id: closed.id,
    text: 'second',
    previousByteSize: 'first'.length,
    nameMetaDelta: 0,
  })
  assert.equal(await readBlobText(closed.id), 'second')
  assert.equal(await countChunks(firstRef.blobId), 0, '旧 chunk 应被清理')
  console.log('ok: whole write over chunked file cleans old chunks')
}

/** 存储层：close 覆盖 chunked 文件时旧 chunk 被清理（无孤儿） */
async function testStreamOverwriteChunkedCleansOldChunks(): Promise<void> {
  await resetState()
  const node = makeFileNode('d.bin')
  const w1 = await openStreamWriteBlob({
    node,
    isNew: true,
    metaBytes: estimateNodeMetaBytes(node),
    previousByteSize: 0,
    nameMode: 'exact',
  })
  await w1.write(utf8('aaaa'))
  const first = await w1.close()
  const firstRef = await getFileBlobRefForTests(first.id)
  assert.ok(firstRef)
  assert.equal(await countChunks(firstRef.blobId), 1)

  const w2 = await openStreamWriteBlob({
    node: first,
    isNew: false,
    metaBytes: 0,
    previousByteSize: 'aaaa'.length,
    nameMode: 'exact',
  })
  const before = await getFilesTotalBytes()
  await w2.write(utf8('bbbb'))
  await w2.close()
  assert.equal(await readBlobText(first.id), 'bbbb')
  assert.equal(await countChunks(firstRef.blobId), 0, '被覆盖的旧 chunk 应被清理')
  // 等长覆盖：净增为 0
  assert.equal((await getFilesTotalBytes()) - before, 0)
  console.log('ok: stream overwrite of chunked file cleans old chunks')
}

/** 存储层：克隆 chunked 文件后删源，克隆仍可读；删除子树清理 chunk 与配额 */
async function testCloneAndDeleteChunked(): Promise<void> {
  await resetState()
  const srcNode = makeFileNode('src.bin')
  const writer = await openStreamWriteBlob({
    node: srcNode,
    isNew: true,
    metaBytes: estimateNodeMetaBytes(srcNode),
    previousByteSize: 0,
    nameMode: 'exact',
  })
  await writer.write(utf8('keep-me'))
  const src = await writer.close()

  const dstNode = makeFileNode('clone.bin')
  const cloned = await cloneFileNodeWithSharedBlob({
    sourceNodeId: src.id,
    node: dstNode,
    metaBytes: estimateNodeMetaBytes(dstNode),
    nameMode: 'exact',
  })
  const srcRef = await getFileBlobRefForTests(src.id)
  const dstRef = await getFileBlobRefForTests(cloned.id)
  assert.ok(srcRef && dstRef)
  assert.equal(srcRef.blobId, dstRef.blobId)
  assert.equal(srcRef.refCount, 2)

  // 删除源：克隆仍可读，chunk 保留
  await deleteSubtree(await collectSubtreeIds(src.id))
  assert.equal(await readBlobText(cloned.id), 'keep-me')
  assert.equal(await countChunks(srcRef.blobId), 1)

  // 删除克隆：chunk 全部清理，配额回退到 0
  const totalBefore = await getFilesTotalBytes()
  await deleteSubtree(await collectSubtreeIds(cloned.id))
  assert.equal(await countChunks(srcRef.blobId), 0)
  const totalAfter = await getFilesTotalBytes()
  assert.ok(totalBefore > 0)
  assert.ok(totalAfter < totalBefore)
  console.log('ok: clone/delete chunked blob keeps refs and cleans chunks')
}

/** 存储层：流式覆盖已克隆（shared）的 chunked 文件 → COW fork，源保持 */
async function testStreamOverwriteSharedForks(): Promise<void> {
  await resetState()
  const srcNode = makeFileNode('s.bin')
  const w1 = await openStreamWriteBlob({
    node: srcNode,
    isNew: true,
    metaBytes: estimateNodeMetaBytes(srcNode),
    previousByteSize: 0,
    nameMode: 'exact',
  })
  await w1.write(utf8('shared-original'))
  const src = await w1.close()

  const dstNode = makeFileNode('s-copy.bin')
  await cloneFileNodeWithSharedBlob({
    sourceNodeId: src.id,
    node: dstNode,
    metaBytes: estimateNodeMetaBytes(dstNode),
    nameMode: 'exact',
  })

  // 流式覆盖 src（shared）→ fork 新 blob，dst 仍读旧内容
  const w2 = await openStreamWriteBlob({
    node: src,
    isNew: false,
    metaBytes: 0,
    previousByteSize: 'shared-original'.length,
    nameMode: 'exact',
  })
  await w2.write(utf8('forked'))
  const forked = await w2.close()
  assert.equal(await readBlobText(forked.id), 'forked')
  assert.equal(await readBlobText(dstNode.id), 'shared-original')
  const forkedRef = await getFileBlobRefForTests(forked.id)
  const dstRef = await getFileBlobRefForTests(dstNode.id)
  assert.ok(forkedRef && dstRef)
  assert.notEqual(forkedRef.blobId, dstRef.blobId)
  assert.equal(dstRef.refCount, 1)
  console.log('ok: stream overwrite of shared chunked blob forks COW')
}

/** 存储层：空流 close → byteSize 0 文件；readBlobBytes 返回 undefined 或空 */
async function testEmptyStream(): Promise<void> {
  await resetState()
  const node = makeFileNode('empty.bin')
  const writer = await openStreamWriteBlob({
    node,
    isNew: true,
    metaBytes: estimateNodeMetaBytes(node),
    previousByteSize: 0,
    nameMode: 'exact',
  })
  const closed = await writer.close()
  assert.equal(closed.byteSize, 0)
  const bytes = await readBlobBytes(closed.id)
  assert.ok(bytes === undefined || bytes.byteLength === 0)
  console.log('ok: empty stream creates zero-byte file')
}

/** 存储层：孤儿 chunk（无 blob 记录）被清理，正常 chunk 保留 */
async function testSweepOrphanChunks(): Promise<void> {
  await resetState()
  const node = makeFileNode('sweep.bin')
  const writer = await openStreamWriteBlob({
    node,
    isNew: true,
    metaBytes: estimateNodeMetaBytes(node),
    previousByteSize: 0,
    nameMode: 'exact',
  })
  await writer.write(utf8('keep'))
  const closed = await writer.close()
  const ref = await getFileBlobRefForTests(closed.id)
  assert.ok(ref)

  // 手动插入孤儿 chunk（模拟崩溃残留：有 chunk、无 blob 记录）
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(FILES_DB_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('open failed'))
  })
  const orphanBlobId = 'blob:orphan-sweep-test'
  const tx = db.transaction(FILES_CHUNKS_STORE, 'readwrite')
  const chunkStore = tx.objectStore(FILES_CHUNKS_STORE)
  chunkStore.put({ blobId: orphanBlobId, chunkIndex: 0, bytes: copyBytes('junk-a') })
  chunkStore.put({ blobId: orphanBlobId, chunkIndex: 1, bytes: copyBytes('junk-b') })
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('seed failed'))
  })
  assert.equal(await countChunks(orphanBlobId), 2)

  await sweepOrphanChunksOnce(db)
  db.close()

  assert.equal(await countChunks(orphanBlobId), 0, '孤儿 chunk 应被清理')
  assert.equal(await countChunks(ref.blobId), 1, '正常 chunk 应保留')
  assert.equal(await readBlobText(closed.id), 'keep')
  console.log('ok: orphan chunk sweep removes dangling chunks')
}

function copyBytes(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

/** 读取 blob 记录的 chunkOffsets（新格式偏移索引）。 */
async function getChunkOffsets(blobId: string): Promise<number[] | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(FILES_DB_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('open failed'))
  })
  const tx = db.transaction(FILES_BLOBS_STORE, 'readonly')
  const record = await new Promise<{ chunkOffsets?: number[] } | undefined>((resolve, reject) => {
    const request = tx.objectStore(FILES_BLOBS_STORE).get(blobId)
    request.onsuccess = () => resolve(request.result as { chunkOffsets?: number[] } | undefined)
    request.onerror = () => reject(request.error ?? new Error('blob get failed'))
  })
  db.close()
  return record?.chunkOffsets
}

/** 读取完整 blob 记录（检查 chunked / bytes / chunkOffsets）。 */
async function getBlobRecord(
  blobId: string,
): Promise<{ chunked?: boolean; bytes?: ArrayBuffer; chunkOffsets?: number[] } | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(FILES_DB_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('open failed'))
  })
  const tx = db.transaction(FILES_BLOBS_STORE, 'readonly')
  const record = await new Promise<
    { chunked?: boolean; bytes?: ArrayBuffer; chunkOffsets?: number[] } | undefined
  >((resolve, reject) => {
    const request = tx.objectStore(FILES_BLOBS_STORE).get(blobId)
    request.onsuccess = () =>
      resolve(
        request.result as { chunked?: boolean; bytes?: ArrayBuffer; chunkOffsets?: number[] } | undefined,
      )
    request.onerror = () => reject(request.error ?? new Error('blob get failed'))
  })
  db.close()
  return record
}

/** 写 [0, n) 的确定性字节（非 2 的幂模数，便于逐字节校验）。 */
function patternedBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i += 1) {
    out[i] = (i * 7 + 13) % 251
  }
  return out
}

function bytesToUint8(bytes: ArrayBuffer): Uint8Array {
  return new Uint8Array(bytes)
}

/** 存储层：新格式等长块写入 → chunkOffsets/块数/尾部块正确 */
async function testChunkedWriteSplitsAndOffsets(): Promise<void> {
  await resetState()
  const chunkSize = 4 * 1024
  const node = makeFileNode('splits.bin')
  const writer = await openStreamWriteBlob({
    node,
    isNew: true,
    metaBytes: estimateNodeMetaBytes(node),
    previousByteSize: 0,
    chunkSize,
    nameMode: 'exact',
  })
  // 数据 = 1MiB + 128KiB（第一次 write） + 32KiB（第二次 write）
  const firstSize = (1 << 20) + (128 << 10)
  const secondSize = 32 << 10
  const total = firstSize + secondSize
  const data = patternedBytes(total)
  await writer.write(data.subarray(0, firstSize))
  await writer.write(data.subarray(firstSize))
  const closed = await writer.close()

  const ref = await getFileBlobRefForTests(closed.id)
  assert.ok(ref)
  assert.equal(ref.byteLength, total)
  const offsets = await getChunkOffsets(ref.blobId)
  assert.ok(Array.isArray(offsets) && offsets.length > 1, '应生成多条 chunk')

  // 中间块恒为 chunkSize；最后一块 = 剩余（>= MIN_TAIL = 1MiB）
  for (let i = 1; i < offsets.length; i += 1) {
    assert.equal(offsets[i] - offsets[i - 1], chunkSize, `第 ${i} 块应为等长`)
  }
  const tailBytes = total - offsets[offsets.length - 1]
  assert.ok(tailBytes >= 1 << 20, `尾部块不应微小（实际 ${tailBytes}）`)
  assert.equal(tailBytes, 1 << 20, '尾部块应正好等于 MIN_TAIL（写入恰被切平）')
  console.log('ok: chunked write produces equal-size middle chunks + no tiny tail')
}

/** 存储层：readBlobBytesRange 多区间与整读裁切逐字节一致 */
async function testRangeReadMatchesFullRead(): Promise<void> {
  await resetState()
  const chunkSize = 4 * 1024
  const node = makeFileNode('range.bin')
  const writer = await openStreamWriteBlob({
    node,
    isNew: true,
    metaBytes: estimateNodeMetaBytes(node),
    previousByteSize: 0,
    chunkSize,
    nameMode: 'exact',
  })
  const total = (1 << 20) + (128 << 10) + (32 << 10)
  const data = patternedBytes(total)
  // 分成不规整的 write 块，制造多种切块路径
  for (let offset = 0; offset < total; offset += 97 * 1024) {
    await writer.write(data.subarray(offset, offset + 97 * 1024))
  }
  const closed = await writer.close()
  const ref = await getFileBlobRefForTests(closed.id)
  assert.ok(ref)

  const all = await readBlobBytes(closed.id)
  assert.ok(all)
  const full = bytesToUint8(all)
  assert.equal(full.byteLength, total)

  const ranges: [number, number][] = [
    [0, 1],
    [0, total],
    [100, 50],
    [5000, 8192], // 跨块
    [chunkSize - 1, 2], // 正好跨块边界
    [total - 1, 1], // 末字节
    [total, 1], // 越界
    [total + 100, 10], // 深越界
    [-10, 20], // 负偏移 → 从 0 起
    [4096, 0], // 零长度
  ]
  for (const [offset, length] of ranges) {
    const range = await readBlobBytesRange(closed.id, offset, length)
    assert.ok(range, `range read 应返回（offset=${offset} length=${length}）`)
    const got = bytesToUint8(range)
    const want = full.subarray(Math.max(0, offset), Math.max(0, offset) + Math.max(0, length))
    assert.equal(
      got.byteLength,
      want.byteLength,
      `长度不一致 offset=${offset} length=${length}`,
    )
    for (let i = 0; i < want.byteLength; i += 1) {
      assert.equal(got[i], want[i], `字节不一致 offset=${offset} length=${length} idx=${i}`)
    }
  }
  console.log('ok: readBlobBytesRange equals full-read slice for all ranges')
}

/** 存储层：旧格式（无 chunkOffsets）chunk blob 范围读回退整读裁切 */
async function testOldFormatRangeFallback(): Promise<void> {
  await resetState()
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(FILES_DB_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('open failed'))
  })
  const node = makeFileNode('old.bin')
  const blobId = 'blob:old-format-test'
  const payload = patternedBytes(300)
  const tx = db.transaction(
    [FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_CHUNKS_STORE],
    'readwrite',
  )
  const now = osNowMs()
  tx.objectStore(FILES_NODES_STORE).put({
    id: node.id,
    locationId: 'local',
    parentId: '',
    name: 'old.bin',
    kind: 'file',
    mimeType: 'application/octet-stream',
    byteSize: payload.byteLength,
    createdAt: now,
    updatedAt: now,
    blobId,
    attributes: defaultFilesNodeAttributes('local'),
  })
  // 旧格式：chunked 但无 chunkOffsets，且 chunk 不等长
  tx.objectStore(FILES_BLOBS_STORE).put({
    id: blobId,
    refCount: 1,
    chunked: true,
    byteSize: payload.byteLength,
    chunkCount: 2,
  })
  tx.objectStore(FILES_CHUNKS_STORE).put({
    blobId,
    chunkIndex: 0,
    bytes: payload.slice(0, 100).buffer,
  })
  tx.objectStore(FILES_CHUNKS_STORE).put({
    blobId,
    chunkIndex: 1,
    bytes: payload.slice(100).buffer,
  })
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('seed failed'))
  })
  db.close()

  const full = await readBlobBytes(node.id)
  assert.ok(full)
  assert.equal(full.byteLength, payload.byteLength)

  for (const [offset, length] of [
    [0, payload.byteLength],
    [50, 200],
    [250, 100],
    [299, 1],
    [1000, 10],
  ] as [number, number][]) {
    const range = await readBlobBytesRange(node.id, offset, length)
    assert.ok(range)
    const got = bytesToUint8(range)
    const want = bytesToUint8(full).subarray(
      Math.max(0, offset),
      Math.max(0, offset) + Math.max(0, length),
    )
    assert.equal(got.byteLength, want.byteLength)
    for (let i = 0; i < want.byteLength; i += 1) {
      assert.equal(got[i], want[i])
    }
  }
  console.log('ok: old-format chunk blob range read falls back to full-read slice')
}

/** API 层：filesReadBlobRange 本地卷范围读（含 chunkSize 透传） */
async function testApiRangeRead(): Promise<void> {
  await resetState()
  const writer = await filesOpenStreamWrite('/user/api-range.bin', { chunkSize: 4 * 1024 })
  const total = (1 << 20) + (128 << 10)
  const data = patternedBytes(total)
  for (let offset = 0; offset < total; offset += 64 * 1024) {
    await writer.write(data.subarray(offset, offset + 64 * 1024))
  }
  await writer.close()

  const blob = await filesReadBlobRange('/user/api-range.bin', 70000, 5000)
  const got = new Uint8Array(await blob.arrayBuffer())
  const want = data.subarray(70000, 75000)
  assert.equal(got.byteLength, 5000)
  for (let i = 0; i < want.byteLength; i += 1) {
    assert.equal(got[i], want[i])
  }
  console.log('ok: filesReadBlobRange reads range via API layer')
}

const MIB = 1 << 20

/** API 层：整块写超过 16MiB → 自动分块（新建 + 覆写两条路径），范围读一致 */
async function testWholeWriteLargeChunks(): Promise<void> {
  await resetState()
  const total = 20 * MIB
  const data = patternedBytes(total)

  // 新建路径（createFileWithBytes）
  const created = await filesCreateBinary('/user/big-new.bin', data.buffer)
  const createdNode = await resolveNodeByAbsolutePath('/user/big-new.bin')
  assert.ok(createdNode)
  const createdRef = await getFileBlobRefForTests(createdNode.id)
  assert.ok(createdRef)
  assert.equal(createdRef.byteLength, total)
  assert.deepEqual(
    await getChunkOffsets(createdRef.blobId),
    [0, 4 * MIB, 8 * MIB, 12 * MIB, 16 * MIB],
    '新建大文件应切成 5 块 4MiB',
  )

  // 覆写路径（writeFileContentCow）
  await filesCreateText('/user/big-over.bin', 'placeholder')
  await filesWriteBinary('/user/big-over.bin', data.buffer)
  const overNode = await resolveNodeByAbsolutePath('/user/big-over.bin')
  assert.ok(overNode)
  const ref = await getFileBlobRefForTests(overNode.id)
  assert.ok(ref)
  assert.equal(ref.byteLength, total)
  assert.deepEqual(
    await getChunkOffsets(ref.blobId),
    [0, 4 * MIB, 8 * MIB, 12 * MIB, 16 * MIB],
    '覆写大文件应切成 5 块 4MiB',
  )

  const blob = await filesReadBlobRange('/user/big-over.bin', 7 * MIB + 1000, 5000)
  const got = new Uint8Array(await blob.arrayBuffer())
  const want = data.subarray(7 * MIB + 1000, 7 * MIB + 6000)
  assert.equal(got.byteLength, 5000)
  for (let i = 0; i < want.byteLength; i += 1) {
    assert.equal(got[i], want[i])
  }
  assert.equal((await filesReadBlob('/user/big-over.bin')).size, total)
  console.log('ok: whole write > 16MiB auto-chunks with equal-size blocks')
}

/** API 层：整块写 ≤ 16MiB → 维持单条 bytes 记录，范围读仍正确 */
async function testWholeWriteSmallStaysWhole(): Promise<void> {
  await resetState()
  const total = 1 * MIB
  const data = patternedBytes(total)
  await filesCreateText('/user/small.bin', 'placeholder')
  await filesWriteBinary('/user/small.bin', data.buffer)
  const node = await resolveNodeByAbsolutePath('/user/small.bin')
  assert.ok(node)
  const ref = await getFileBlobRefForTests(node.id)
  assert.ok(ref)
  const rec = await getBlobRecord(ref.blobId)
  assert.ok(rec, 'blob 记录应存在')
  assert.equal(rec.chunked, undefined, '小文件不应分块')
  assert.equal(rec.chunkOffsets, undefined, '小文件不应有偏移索引')
  assert.ok(rec.bytes && rec.bytes.byteLength === total, '应存单条 bytes')

  const blob = await filesReadBlobRange('/user/small.bin', 100, 50)
  const got = new Uint8Array(await blob.arrayBuffer())
  const want = data.subarray(100, 150)
  assert.equal(got.byteLength, 50)
  for (let i = 0; i < 50; i += 1) {
    assert.equal(got[i], want[i])
  }
  console.log('ok: whole write <= 16MiB stays single bytes record')
}

/** API 层：阈值边界 —— 恰好 16MiB 不分块，16MiB+1 分块 */
async function testWholeWriteBoundary(): Promise<void> {
  await resetState()
  const at = 16 * MIB
  await filesCreateText('/user/at.bin', 'placeholder')
  await filesWriteBinary('/user/at.bin', patternedBytes(at).buffer)
  const atNode = await resolveNodeByAbsolutePath('/user/at.bin')
  assert.ok(atNode)
  const atRef = await getFileBlobRefForTests(atNode.id)
  assert.ok(atRef)
  assert.equal(await getChunkOffsets(atRef.blobId), undefined, '恰好 16MiB 不分块')

  const over = 16 * MIB + 1
  await filesCreateText('/user/over.bin', 'placeholder')
  await filesWriteBinary('/user/over.bin', patternedBytes(over).buffer)
  const overNode = await resolveNodeByAbsolutePath('/user/over.bin')
  assert.ok(overNode)
  const overRef = await getFileBlobRefForTests(overNode.id)
  assert.ok(overRef)
  const offsets = await getChunkOffsets(overRef.blobId)
  assert.deepEqual(offsets, [0, 4 * MIB, 8 * MIB, 12 * MIB, 16 * MIB], '16MiB+1 应分 5 块')
  console.log('ok: threshold boundary at 16MiB splits only above')
}

/** 存储层：整块覆写已克隆（shared）的分块文件 → COW fork 新分块，克隆仍读旧内容 */
async function testWholeWriteSharedCowForksChunked(): Promise<void> {
  await resetState()
  const original = 20 * MIB + 100 * 1024
  const origData = patternedBytes(original)
  const srcNode = makeFileNode('cow-src.bin')
  const w1 = await openStreamWriteBlob({
    node: srcNode,
    isNew: true,
    metaBytes: estimateNodeMetaBytes(srcNode),
    previousByteSize: 0,
    nameMode: 'exact',
  })
  await w1.write(origData)
  const src = await w1.close()
  const srcRef = await getFileBlobRefForTests(src.id)
  assert.ok(srcRef)
  assert.ok((await getChunkOffsets(srcRef.blobId))?.length > 1, '源应为分块')

  const dstNode = makeFileNode('cow-dst.bin')
  const cloned = await cloneFileNodeWithSharedBlob({
    sourceNodeId: src.id,
    node: dstNode,
    metaBytes: estimateNodeMetaBytes(dstNode),
    nameMode: 'exact',
  })
  const clonedRef = await getFileBlobRefForTests(cloned.id)
  assert.ok(clonedRef)
  assert.equal(clonedRef.blobId, srcRef.blobId, '克隆应共享源 blob')
  assert.equal(clonedRef.refCount, 2)

  const newData = patternedBytes(17 * MIB + 3)
  const updated = await writeBlobBytes({
    id: src.id,
    bytes: newData.buffer,
    previousByteSize: original,
    nameMetaDelta: 0,
  })
  const updatedRef = await getFileBlobRefForTests(updated.id)
  assert.ok(updatedRef)
  assert.notEqual(updatedRef.blobId, srcRef.blobId, '覆写 shared 应 fork 新 blob')
  assert.deepEqual(
    await getChunkOffsets(updatedRef.blobId),
    [0, 4 * MIB, 8 * MIB, 12 * MIB, 16 * MIB],
    '新 blob 应分块',
  )

  // 克隆仍读旧内容（区间抽样逐字节比对）
  const dstRefAfter = await getFileBlobRefForTests(cloned.id)
  assert.equal(dstRefAfter?.blobId, srcRef.blobId, '克隆仍共享旧 blob')
  assert.equal(dstRefAfter?.refCount, 1, '旧 blob 引用降为 1')
  for (const [off, len] of [
    [0, 4096],
    [10 * MIB, 8192],
    [original - 100, 100],
  ] as [number, number][]) {
    const got = bytesToUint8((await readBlobBytesRange(cloned.id, off, len))!)
    const want = origData.subarray(off, off + len)
    assert.equal(got.byteLength, want.byteLength, `区间 ${off} 长度`)
    for (let i = 0; i < want.byteLength; i += 1) {
      assert.equal(got[i], want[i], `区间 ${off} idx=${i}`)
    }
  }
  console.log('ok: whole COW overwrite of shared chunked blob forks chunked')
}

/** API 层：upsertBatch 大文件自动分块、小文件维持整块，整读一致 */
async function testWholeWriteUpsertBatchChunks(): Promise<void> {
  await resetState()
  const total = 17 * MIB
  const data = patternedBytes(total)
  const entries = await filesUpsertBatch([
    { path: '/user/batch-big.bin', bytes: data.buffer },
    { path: '/user/batch-small.bin', bytes: patternedBytes(100).buffer },
  ])
  assert.equal(entries.length, 2)
  const big = await resolveNodeByAbsolutePath('/user/batch-big.bin')
  const small = await resolveNodeByAbsolutePath('/user/batch-small.bin')
  assert.ok(big && small)
  const bigRef = await getFileBlobRefForTests(big.id)
  assert.ok(bigRef)
  assert.deepEqual(
    await getChunkOffsets(bigRef.blobId),
    [0, 4 * MIB, 8 * MIB, 12 * MIB, 16 * MIB],
    'batch 大文件应分块',
  )
  assert.equal((await filesReadBlob('/user/batch-big.bin')).size, total)
  const smallRef = await getFileBlobRefForTests(small.id)
  assert.ok(smallRef)
  const smallRec = await getBlobRecord(smallRef.blobId)
  assert.equal(smallRec?.chunked, undefined, 'batch 小文件应整块')
  console.log('ok: upsert batch auto-chunks large item, keeps small whole')
}

async function run(): Promise<void> {
  await testStreamCreateAndReadBack()
  await testAbortNewFile()
  await testAbortOverwriteKeepsOld()
  await testOverwriteCloseReplaces()
  await testOverwriteChunkedCleansOldChunks()
  await testStreamOverwriteChunkedCleansOldChunks()
  await testCloneAndDeleteChunked()
  await testStreamOverwriteSharedForks()
  await testEmptyStream()
  await testSweepOrphanChunks()
  await testChunkedWriteSplitsAndOffsets()
  await testRangeReadMatchesFullRead()
  await testOldFormatRangeFallback()
  await testApiRangeRead()
  await testWholeWriteLargeChunks()
  await testWholeWriteSmallStaysWhole()
  await testWholeWriteBoundary()
  await testWholeWriteSharedCowForksChunked()
  await testWholeWriteUpsertBatchChunks()
  console.log('files-stream-write: all passed')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
