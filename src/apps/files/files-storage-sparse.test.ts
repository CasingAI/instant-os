/**
 * 内部卷稀疏分块（缺席块 = 全零）单测。
 * 运行：node --experimental-strip-types src/apps/files/files-storage-sparse.test.ts
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
  getFilesBytesByLocation,
  getNodeBlobStoredBytes,
  newFilesNodeId,
  readBlobBytes,
  readBlobBytesRange,
  resetFilesDbForTests,
  writeBlobBytesRange,
} from './files-storage.ts'
import {
  filesCreateSparseBinary,
  filesStat,
  filesWriteBytesRange,
} from './files-api.ts'
import {
  invalidateFilesVfsPathCaches,
  resolveNodeByAbsolutePath,
} from './files-vfs.ts'
import { osNowMs } from '../../os/os-clock.ts'
import type { FilesBlobRecord, FilesNode } from './files-types.ts'

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

async function getBlobRecord(blobId: string): Promise<FilesBlobRecord | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(FILES_DB_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('open failed'))
  })
  const tx = db.transaction(FILES_BLOBS_STORE, 'readonly')
  const record = await new Promise<FilesBlobRecord | undefined>((resolve, reject) => {
    const request = tx.objectStore(FILES_BLOBS_STORE).get(blobId)
    request.onsuccess = () => resolve(request.result as FilesBlobRecord | undefined)
    request.onerror = () => reject(request.error ?? new Error('get blob failed'))
  })
  db.close()
  return record
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

async function run(): Promise<void> {
  await resetState()
  const logicalSize = 32 * 1024 * 1024
  const slotSize = 1 * 1024 * 1024

  // 1. 创建 32 MB 稀疏文件，逻辑大小 32 MB，实占 0，读出来全是 0
  {
    await filesCreateSparseBinary('/user/sparse32.bin', logicalSize, { chunkSize: slotSize })
    const node = await resolveNodeByAbsolutePath('/user/sparse32.bin')
    assert.ok(node)
    assert.equal(node.byteSize, logicalSize, '逻辑大小应为 32 MB')
    assert.equal(await getNodeBlobStoredBytes(node.id), 0, '实占字节应为 0')

    const whole = await readBlobBytes(node.id)
    assert.equal(whole?.byteLength, logicalSize, '整读返回完整逻辑长度')
    assert.ok(new Uint8Array(whole!).every((b) => b === 0), '整读应为全零')

    const tail = await readBlobBytesRange(node.id, logicalSize - 1024, 1024)
    assert.equal(tail?.byteLength, 1024, '范围读长度正确')
    assert.ok(new Uint8Array(tail!).every((b) => b === 0), '范围读应为全零')

    const stat = await filesStat('/user/sparse32.bin')
    assert.equal(stat?.byteSize, logicalSize, 'stat 逻辑大小正确')
    assert.equal(await getNodeBlobStoredBytes(node.id), 0, 'stat 占用为 0')

    const locationBytes = await getFilesBytesByLocation(['local'])
    assert.equal(locationBytes[0]?.bytes, 0, '卷占用为 0')
  }

  // 2. 在偏移 4 MB 处写入 1 MB 非零数据；实占应约为 1 MB，读出时周边仍为零
  {
    const offset = 4 * 1024 * 1024
    const size = 1 * 1024 * 1024
    const pattern = new Uint8Array(size).map((_, i) => ((i % 256) + 1) % 256)
    await filesWriteBytesRange('/user/sparse32.bin', offset, pattern)

    const node = await resolveNodeByAbsolutePath('/user/sparse32.bin')
    assert.ok(node)
    const stored = await getNodeBlobStoredBytes(node.id)
    assert.equal(stored, size, '实占应为写入的 1 MB')

    const before = await readBlobBytesRange(node.id, offset - 1024, 1024)
    assert.ok(new Uint8Array(before!).every((b) => b === 0), '写前区域仍为零')

    const written = await readBlobBytesRange(node.id, offset, size)
    assert.deepEqual(new Uint8Array(written!), pattern, '写入区域数据正确')

    const after = await readBlobBytesRange(node.id, offset + size, 1024)
    assert.ok(new Uint8Array(after!).every((b) => b === 0), '写后区域仍为零')

    const locationBytes = await getFilesBytesByLocation(['local'])
    assert.equal(locationBytes[0]?.bytes, size, '卷占用应为 1 MB')
  }

  // 3. 把刚写入的区域覆盖为 0，应该打洞回收，实占回到 0
  {
    const offset = 4 * 1024 * 1024
    const size = 1 * 1024 * 1024
    const zeros = new Uint8Array(size)
    await filesWriteBytesRange('/user/sparse32.bin', offset, zeros)

    const node = await resolveNodeByAbsolutePath('/user/sparse32.bin')
    assert.ok(node)
    assert.equal(await getNodeBlobStoredBytes(node.id), 0, '覆盖为零后实占应为 0')

    const blob = await getBlobRecord(node.id)
    assert.ok(blob)
    assert.equal(await countChunks(blob.id), 0, '应无分块记录')

    const stat = await filesStat('/user/sparse32.bin')
    assert.equal(stat?.byteSize, 32 * 1024 * 1024, '逻辑大小不变')
    assert.equal(await getNodeBlobStoredBytes(node.id), 0, '占用回到 0')
  }

  // 4. 有洞文件不能卸到 OPFS；blob 类型保持 chunked
  {
    const node = await resolveNodeByAbsolutePath('/user/sparse32.bin')
    assert.ok(node)
    const record = await getBlobRecord(node.id)
    assert.equal(record?.chunked, true, '稀疏文件保持 chunked')
    assert.equal(record?.opfsPath, undefined, '未卸到 OPFS')
    assert.equal(record?.uniformChunkSize, slotSize, '保留 uniformChunkSize')
  }

  // 5. 共享 COW 克隆保留源文件的洞
  {
    const source = await resolveNodeByAbsolutePath('/user/sparse32.bin')
    assert.ok(source)
    const cloneNode = makeFileNode('sparse32.clone.bin')
    const clone = await cloneFileNodeWithSharedBlob({
      sourceNodeId: source.id,
      node: cloneNode,
      metaBytes: estimateNodeMetaBytes(cloneNode),
      nameMode: 'exact',
    })

    // 写入 clone 的不同区域
    const offset = 8 * 1024 * 1024
    const size = 512 * 1024
    const data = new Uint8Array(size).map((_, i) => (i % 251) + 1)
    await writeBlobBytesRange({ nodeId: clone.id, offset, bytes: data })

    // 源文件仍为 0 实占
    assert.equal(await getNodeBlobStoredBytes(source.id), 0, '源文件实占保持为 0')

    // clone 实占为一个槽（写入落在 1 MB 槽内）
    assert.equal(await getNodeBlobStoredBytes(clone.id), slotSize, 'clone 实占为一个槽')

    // 源文件读旧位置仍为零
    const sourceTail = await readBlobBytesRange(source.id, offset, size)
    assert.ok(new Uint8Array(sourceTail!).every((b) => b === 0), '源文件该位置仍为零')

    // clone 对应位置为写入数据
    const cloneTail = await readBlobBytesRange(clone.id, offset, size)
    assert.deepEqual(new Uint8Array(cloneTail!), data, 'clone 数据正确')

    // clone 的洞区域仍为零
    const cloneHole = await readBlobBytesRange(clone.id, offset - size, size)
    assert.ok(new Uint8Array(cloneHole!).every((b) => b === 0), 'clone 其它洞仍为零')
  }

  // 6. 范围写不能扩展出空洞（offset > logical EOF 应抛错）
  {
    await filesCreateSparseBinary('/user/sparse-small.bin', 1024)
    await assert.rejects(
      () => filesWriteBytesRange('/user/sparse-small.bin', 1025, new Uint8Array([1])),
      /offset|超出文件末尾|空洞/,
      '超 EOF 写应拒绝',
    )
    const node = await resolveNodeByAbsolutePath('/user/sparse-small.bin')
    assert.ok(node)
    assert.equal(await getNodeBlobStoredBytes(node.id), 0, '拒绝后无额外占用')
  }

  console.log('files-storage-sparse: all passed')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
