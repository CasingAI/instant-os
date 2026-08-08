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
  FILES_CHUNKS_STORE,
  FILES_DB_NAME,
  getFileBlobRefForTests,
  getFilesTotalBytes,
  newFilesNodeId,
  openStreamWriteBlob,
  readBlobBytes,
  readBlobText,
  resetFilesDbForTests,
  sweepOrphanChunksOnce,
  writeBlobText,
} from './files-storage.ts'
import {
  filesCreateText,
  filesOpenStreamWrite,
  filesReadBlob,
  filesReadText,
  filesStat,
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
  })
  await writer.write(utf8('keep-me'))
  const src = await writer.close()

  const dstNode = makeFileNode('clone.bin')
  const cloned = await cloneFileNodeWithSharedBlob({
    sourceNodeId: src.id,
    node: dstNode,
    metaBytes: estimateNodeMetaBytes(dstNode),
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
  })
  await w1.write(utf8('shared-original'))
  const src = await w1.close()

  const dstNode = makeFileNode('s-copy.bin')
  await cloneFileNodeWithSharedBlob({
    sourceNodeId: src.id,
    node: dstNode,
    metaBytes: estimateNodeMetaBytes(dstNode),
  })

  // 流式覆盖 src（shared）→ fork 新 blob，dst 仍读旧内容
  const w2 = await openStreamWriteBlob({
    node: src,
    isNew: false,
    metaBytes: 0,
    previousByteSize: 'shared-original'.length,
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
  console.log('files-stream-write: all passed')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
