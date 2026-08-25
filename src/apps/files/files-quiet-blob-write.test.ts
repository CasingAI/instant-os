/**
 * 安静写入通道：小文件先溢到 OPFS，关闭时派 VFS modified。
 * 运行：node --experimental-strip-types src/apps/files/files-quiet-blob-write.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { filesCopy, filesCreateBinary, filesWatch } from './files-api.ts'
import { openQuietBlobWriter } from './files-quiet-blob-write.ts'
import {
  getFileBlobStorageInfo,
  resetFilesDbForTests,
} from './files-storage.ts'
import { invalidateFilesVfsPathCaches, resolveNodeByAbsolutePath } from './files-vfs.ts'
import { resetOpfsBlobsForTests, useMemoryOpfsForTests } from './files-opfs-blobs.ts'

useMemoryOpfsForTests()

async function resetFiles(): Promise<void> {
  await resetFilesDbForTests()
  await resetOpfsBlobsForTests()
  invalidateFilesVfsPathCaches()
}

async function testQuietWriterSpillsSmallIdbBlobAndEmitsModified(): Promise<void> {
  await resetFiles()
  const payload = new Uint8Array(4096)
  payload.fill(0x3c)
  await filesCreateBinary(
    '/user/small.img',
    payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
  )
  const before = await resolveNodeByAbsolutePath('/user/small.img')
  assert.ok(before)
  const beforeInfo = await getFileBlobStorageInfo(before.id)
  assert.equal(beforeInfo?.bodyStore, 'IndexedDB')
  const beforeRevision = before.contentRevisionId

  const events: string[] = []
  const stop = filesWatch('/user/small.img', (change) => {
    events.push(change.kind)
  })
  const writer = await openQuietBlobWriter('/user/small.img')
  assert.ok(writer, '小镜像溢到 OPFS 后应打开安静通道')
  assert.ok(events.includes('modified'), '溢出到 OPFS 后应派发 VFS modified')
  const afterOpen = await resolveNodeByAbsolutePath('/user/small.img')
  assert.ok(afterOpen)
  const afterInfo = await getFileBlobStorageInfo(afterOpen.id)
  assert.equal(afterInfo?.bodyStore, 'OPFS')
  assert.equal(afterOpen.contentRevisionId, beforeRevision)

  const patch = new Uint8Array([1, 2, 3, 4])
  await writer.writeAt(0, patch)
  await writer.flush()
  const mid = await resolveNodeByAbsolutePath('/user/small.img')
  assert.equal(mid?.contentRevisionId, beforeRevision)

  events.length = 0
  await writer.close()
  stop()
  assert.ok(events.includes('modified'))
}

async function testQuietWriterSpillsSharedBlobAndEmitsModified(): Promise<void> {
  await resetFiles()
  const payload = new Uint8Array(4096)
  payload.fill(0x5a)
  await filesCreateBinary(
    '/user/shared.img',
    payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
  )
  await filesCopy('/user/shared.img', '/user')
  const events: string[] = []
  const stop = filesWatch('/user/shared.img', (change) => {
    events.push(change.kind)
  })
  const writer = await openQuietBlobWriter('/user/shared.img')
  stop()
  assert.ok(writer, '共享 Blob 溢出后应打开安静通道')
  assert.ok(events.includes('modified'), '共享 Blob 溢到 OPFS 后应派发 VFS modified')
  const info = await getFileBlobStorageInfo(
    (await resolveNodeByAbsolutePath('/user/shared.img'))!.id,
  )
  assert.equal(info?.bodyStore, 'OPFS')
  await writer.close()
}

await testQuietWriterSpillsSmallIdbBlobAndEmitsModified()
await testQuietWriterSpillsSharedBlobAndEmitsModified()
console.log('files-quiet-blob-write.test.ts ok')
