/**
 * 机会压缩（稀疏存储）开关单测：普通文件 ↔ 稀疏分块的双向转换。
 * 运行：node --experimental-strip-types src/apps/files/files-set-sparse.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { defaultFilesNodeAttributes } from './files-types.ts'
import {
  cloneFileNodeWithSharedBlob,
  estimateNodeMetaBytes,
  FILES_BLOBS_STORE,
  FILES_DB_NAME,
  getFileBlobStorageInfo,
  getFilesTotalBytes,
  getNodeBlobStoredBytes,
  newFilesNodeId,
  readBlobBytes,
  readBlobBytesRange,
  resetFilesDbForTests,
} from './files-storage.ts'
import { useMemoryOpfsForTests } from './files-opfs-blobs.ts'
import {
  filesCreateBinary,
  filesCreateSparseBinary,
  filesSetSparse,
  filesStat,
} from './files-api.ts'
import {
  invalidateFilesVfsPathCaches,
  resolveNodeByAbsolutePath,
  writeBinaryFile,
  writeTextFile,
} from './files-vfs.ts'
import { osNowMs } from '../../os/os-clock.ts'
import type { FilesNode } from './files-types.ts'

const SLOT = 1024 * 1024

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
  useMemoryOpfsForTests()
  invalidateFilesVfsPathCaches()
  await resolveNodeByAbsolutePath('/user/.warmup-probe')
  invalidateFilesVfsPathCaches()
}

/** 8 MiB 混合内容：只在前 1 KiB 和第 4 MiB 处有非零数据，其余全零 */
function makeMixedPayload(): Uint8Array {
  const payload = new Uint8Array(8 * SLOT)
  payload.fill(0xab, 0, 1024)
  payload.fill(0xcd, 4 * SLOT, 4 * SLOT + 1024)
  return payload
}

async function getBlobRecord(blobId: string | undefined) {
  if (!blobId) return undefined
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(FILES_DB_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('open failed'))
  })
  const tx = db.transaction(FILES_BLOBS_STORE, 'readonly')
  const record = await new Promise((resolve, reject) => {
    const request = tx.objectStore(FILES_BLOBS_STORE).get(blobId)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('get blob failed'))
  })
  db.close()
  return record as { id: string; refCount?: number; storedByteSize?: number } | undefined
}

async function run(): Promise<void> {
  // 1. 普通整块文件 → 稀疏化：只保留非零块，内容与版本戳不变
  {
    await resetState()
    const payload = makeMixedPayload()
    const stat = await filesCreateBinary('/user/mixed.bin', payload.buffer)
    const node = await resolveNodeByAbsolutePath('/user/mixed.bin')
    assert.ok(node)
    const revBefore = node.contentRevisionId
    assert.equal(await getNodeBlobStoredBytes(node.id), payload.byteLength, '普通文件全量落库')

    const updated = await filesSetSparse('/user/mixed.bin', true, { chunkSize: SLOT })
    assert.equal(updated.sparse, true, '开启机会压缩')
    assert.equal(updated.byteSize, payload.byteLength, '逻辑大小不变')
    const sparseNode = await resolveNodeByAbsolutePath('/user/mixed.bin')
    assert.ok(sparseNode)
    const sparseStat = await filesStat('/user/mixed.bin')
    assert.equal(sparseStat?.sparse, true, 'API 入口带出标志')
    assert.equal(await getNodeBlobStoredBytes(sparseNode.id), 2 * SLOT, '实占只剩两个非零块')

    const whole = await readBlobBytes(node.id)
    assert.deepEqual(new Uint8Array(whole!), payload, '稀疏化后内容一致')
    const after = await resolveNodeByAbsolutePath('/user/mixed.bin')
    assert.equal(after?.contentRevisionId, revBefore, '内容未变，版本戳不变')
    assert.equal(after?.sparse, true, '标志落库')
  }

  // 2. 物化：缺席零块补全，实占回到全量，内容一致
  {
    await resetState()
    const payload = makeMixedPayload()
    await filesCreateBinary('/user/mixed.bin', payload.buffer)
    await filesSetSparse('/user/mixed.bin', true, { chunkSize: SLOT })
    const sparseNode = await resolveNodeByAbsolutePath('/user/mixed.bin')
    assert.ok(sparseNode)
    assert.equal(await getNodeBlobStoredBytes(sparseNode.id), 2 * SLOT, '稀疏后只剩两个非零块')

    const dense = await filesSetSparse('/user/mixed.bin', false)
    assert.equal(dense.sparse, false, '关闭机会压缩')
    const denseNode = await resolveNodeByAbsolutePath('/user/mixed.bin')
    assert.ok(denseNode)
    assert.equal(await getNodeBlobStoredBytes(denseNode.id), payload.byteLength, '物化后实占全量')

    const whole = await resolveNodeByAbsolutePath('/user/mixed.bin')
    assert.ok(whole)
    const content = await readBlobBytes(whole.id)
    assert.deepEqual(new Uint8Array(content!), payload, '物化后内容一致')
  }

  // 3. 再次稀疏化 → 回到稀疏；已稀疏时再开是 no-op（版本戳不变）
  {
    await resetState()
    const payload = makeMixedPayload()
    await filesCreateBinary('/user/mixed.bin', payload.buffer)
    await filesSetSparse('/user/mixed.bin', true, { chunkSize: SLOT })
    await filesSetSparse('/user/mixed.bin', false)
    const sparse2 = await filesSetSparse('/user/mixed.bin', true, { chunkSize: SLOT })
    assert.equal(sparse2.sparse, true)
    const sparseNode = await resolveNodeByAbsolutePath('/user/mixed.bin')
    assert.ok(sparseNode)
    assert.equal(await getNodeBlobStoredBytes(sparseNode.id), 2 * SLOT, '往返后仍只存非零块')

    const node = await resolveNodeByAbsolutePath('/user/mixed.bin')
    assert.ok(node)
    const revBefore = node.contentRevisionId
    const noop = await filesSetSparse('/user/mixed.bin', true)
    assert.equal(noop.sparse, true)
    const after = await resolveNodeByAbsolutePath('/user/mixed.bin')
    assert.equal(after?.contentRevisionId, revBefore, '已是稀疏时转换不触碰内容')
    assert.equal(await getNodeBlobStoredBytes(after!.id), 2 * SLOT, 'no-op 不重写')
  }

  // 4. 空白磁盘镜像：稀疏新建 → 开启只更新标志；关闭则在 OPFS 物化全量
  {
    await resetState()
    await filesCreateSparseBinary('/user/blank.img', 32 * SLOT, { chunkSize: SLOT })
    const opened = await filesSetSparse('/user/blank.img', true)
    assert.equal(opened.sparse, true)
    const blankNode = await resolveNodeByAbsolutePath('/user/blank.img')
    assert.ok(blankNode)
    assert.equal(await getNodeBlobStoredBytes(blankNode.id), 0, '空白盘占用 0')

    const dense = await filesSetSparse('/user/blank.img', false)
    assert.equal(dense.sparse, false)
    const denseNode = await resolveNodeByAbsolutePath('/user/blank.img')
    assert.ok(denseNode)
    assert.equal(await getNodeBlobStoredBytes(denseNode.id), 32 * SLOT, '物化后实占全量')
    const zero = await readBlobBytesRange((await resolveNodeByAbsolutePath('/user/blank.img'))!.id, 0, 1024)
    assert.ok(new Uint8Array(zero!).every((b) => b === 0), '内容仍全零')
  }

  // 5. 共享克隆：对一份副本稀疏化，另一份不受影响（COW 分叉）
  {
    await resetState()
    const payload = makeMixedPayload()
    await filesCreateBinary('/user/shared.bin', payload.buffer)
    const sourceNode = await resolveNodeByAbsolutePath('/user/shared.bin')
    assert.ok(sourceNode)
    const cloneNode = makeFileNode('shared.clone.bin')
    const cloned = await cloneFileNodeWithSharedBlob({
      sourceNodeId: sourceNode.id,
      node: cloneNode,
      metaBytes: estimateNodeMetaBytes(cloneNode),
      nameMode: 'exact',
    })
    const before = await getFilesTotalBytes()

    const sparseSrc = await filesSetSparse('/user/shared.bin', true, { chunkSize: SLOT })
    assert.equal(sparseSrc.sparse, true)
    const sparseNode = await resolveNodeByAbsolutePath('/user/shared.bin')
    assert.ok(sparseNode)
    assert.equal(await getNodeBlobStoredBytes(sparseNode.id), 2 * SLOT, '源副本稀疏化')

    const cloneAgain = await resolveNodeByAbsolutePath('/user/shared.clone.bin')
    assert.ok(cloneAgain)
    assert.equal(await getNodeBlobStoredBytes(cloneAgain.id), payload.byteLength, '克隆副本仍整份')
    const cloneContent = await readBlobBytes(cloneAgain.id)
    assert.deepEqual(new Uint8Array(cloneContent!), payload, '克隆副本内容未被污染')

    const after = await getFilesTotalBytes()
    assert.ok(after < before, '整体占用下降（源稀疏化释放零块）')
  }

  // 6. 保存（整文件覆盖）保持稀疏：稀疏文件 writeBinaryFile 整写后不物化，
  //    sparse 标志 / uniformChunkSize 保留，内容一致
  {
    await resetState()
    const payload = makeMixedPayload()
    await filesCreateBinary('/user/save.bin', payload.buffer)
    await filesSetSparse('/user/save.bin', true, { chunkSize: SLOT })
    const sparseBefore = await resolveNodeByAbsolutePath('/user/save.bin')
    assert.ok(sparseBefore)
    assert.equal(await getNodeBlobStoredBytes(sparseBefore.id), 2 * SLOT, '转换后两个非零块')
    const revBefore = sparseBefore.contentRevisionId

    // 新内容：非零只放在第 2 槽前 1 KiB，其余 8 MiB 全零
    const next = new Uint8Array(8 * SLOT)
    next.fill(0xcd, 2 * SLOT, 2 * SLOT + 1024)
    await writeBinaryFile('/user/save.bin', next.buffer)

    const saved = await resolveNodeByAbsolutePath('/user/save.bin')
    assert.ok(saved)
    assert.equal(await getNodeBlobStoredBytes(saved.id), SLOT, '整写后只剩一个非零块')
    assert.notEqual(saved.contentRevisionId, revBefore, '内容已更新')
    const savedInfo = await getFileBlobStorageInfo(saved.id)
    assert.equal(savedInfo?.storedByteSize, SLOT, 'blob 实占为 1 MiB')
    assert.equal(savedInfo?.bodyStore, 'IndexedDB', '稀疏文件不卸 OPFS')
    const savedBlob = await getBlobRecord(savedInfo?.blobId)
    assert.equal(savedBlob?.uniformChunkSize, SLOT, '槽粒度保留')
    assert.equal(savedBlob?.chunkCount, 8, '槽数不因全零缺席而减少')
    const content = await readBlobBytes(saved.id)
    assert.deepEqual(new Uint8Array(content!), next, '保存后内容一致')
    const stat = await filesStat('/user/save.bin')
    assert.equal(stat?.sparse, true, '保存后 API 入口仍带稀疏标志')
  }

  // 7. 空白磁盘镜像整文件保存：只改首字节其余全零，实占只涨一个槽
  {
    await resetState()
    await filesCreateSparseBinary('/user/blank32.img', 32 * SLOT, { chunkSize: SLOT })
    const nodeBefore = await resolveNodeByAbsolutePath('/user/blank32.img')
    assert.ok(nodeBefore)
    assert.equal(await getNodeBlobStoredBytes(nodeBefore.id), 0, '空白盘零占用')

    const text = String.fromCharCode(0x41) + '\0'.repeat(32 * SLOT - 1)
    await writeTextFile('/user/blank32.img', text)
    const node = await resolveNodeByAbsolutePath('/user/blank32.img')
    assert.ok(node)
    assert.equal(await getNodeBlobStoredBytes(node.id), SLOT, '整写后仍只占一个槽')
    const head = await readBlobBytesRange(node.id, 0, 1024)
    const expectedHead = new Uint8Array(1024)
    expectedHead[0] = 0x41
    assert.deepEqual(new Uint8Array(head!), expectedHead, '首字节已落库，其余仍为零')
  }

  // 8. 整文件写成全零：整体打洞，实占回到 0
  {
    await resetState()
    const payload = makeMixedPayload()
    await filesCreateBinary('/user/hole.bin', payload.buffer)
    await filesSetSparse('/user/hole.bin', true, { chunkSize: SLOT })
    await writeTextFile('/user/hole.bin', '\0'.repeat(8 * SLOT))
    const node = await resolveNodeByAbsolutePath('/user/hole.bin')
    assert.ok(node)
    assert.equal(await getNodeBlobStoredBytes(node.id), 0, '全零保存整体打洞')
    const info = await getFileBlobStorageInfo(node.id)
    assert.equal(info?.storedByteSize, 0, 'blob 零实占')
    assert.equal(info?.bodyStore, 'IndexedDB', '全零打洞后仍留在 IndexedDB')
    const blob = await getBlobRecord(info?.blobId)
    assert.equal(blob?.chunkCount, 8, '槽数保留')
    const content = await readBlobBytes(node.id)
    assert.ok(new Uint8Array(content!).every((b) => b === 0), '读出仍全零')
  }

  // 9. 尾槽：不足一个槽的尾部按实际长度计实占
  {
    await resetState()
    const tail = new Uint8Array(SLOT + 100)
    tail.fill(0x42, SLOT, SLOT + 100)
    await filesCreateBinary('/user/tail.bin', tail.buffer)
    await filesSetSparse('/user/tail.bin', true, { chunkSize: SLOT })
    let node = await resolveNodeByAbsolutePath('/user/tail.bin')
    assert.ok(node)
    assert.equal(await getNodeBlobStoredBytes(node.id), 100, '首槽全零、尾槽 100 B 实占 100 B')

    const headNonZero = new Uint8Array(SLOT + 100)
    headNonZero.fill(0x61, 0, 1024)
    await writeBinaryFile('/user/tail.bin', headNonZero.buffer)
    node = await resolveNodeByAbsolutePath('/user/tail.bin')
    assert.ok(node)
    assert.equal(await getNodeBlobStoredBytes(node.id), SLOT, '首槽非零、尾槽全零只占整槽')
    const content = await readBlobBytes(node.id)
    assert.deepEqual(new Uint8Array(content!), headNonZero, '尾槽内容一致')
  }

  // 10. COW 共享克隆：保存克隆分叉出独立稀疏块，源保持原占用与内容
  {
    await resetState()
    const payload = makeMixedPayload()
    await filesCreateBinary('/user/cow-src.bin', payload.buffer)
    await filesSetSparse('/user/cow-src.bin', true, { chunkSize: SLOT })
    const srcSparse = await resolveNodeByAbsolutePath('/user/cow-src.bin')
    assert.ok(srcSparse)
    const cloneNode = makeFileNode('cow-copy.bin')
    await cloneFileNodeWithSharedBlob({
      sourceNodeId: srcSparse.id,
      node: cloneNode,
      metaBytes: estimateNodeMetaBytes(cloneNode),
      nameMode: 'exact',
    })
    invalidateFilesVfsPathCaches()

    const next = new Uint8Array(8 * SLOT)
    next.fill(0xcd, SLOT, SLOT + 1024)
    await writeBinaryFile('/user/cow-copy.bin', next.buffer)
    const copy = await resolveNodeByAbsolutePath('/user/cow-copy.bin')
    assert.ok(copy)
    assert.equal(await getNodeBlobStoredBytes(copy.id), SLOT, '克隆分叉后仅存其非零块')
    const srcAgain = await resolveNodeByAbsolutePath('/user/cow-src.bin')
    assert.ok(srcAgain)
    assert.equal(await getNodeBlobStoredBytes(srcAgain.id), 2 * SLOT, '源保持原稀疏占用')
    assert.deepEqual(new Uint8Array((await readBlobBytes(srcAgain.id))!), payload, '源内容未受影响')
    assert.deepEqual(new Uint8Array((await readBlobBytes(copy.id))!), next, '克隆内容为保存值')
  }

  // 11. 回归：dense 文件与 OPFS 大文件的整写保存行为不变
  {
    await resetState()
    const payload = makeMixedPayload()
    await filesCreateBinary('/user/dense.bin', payload.buffer)
    await writeBinaryFile('/user/dense.bin', payload.buffer)
    const node = await resolveNodeByAbsolutePath('/user/dense.bin')
    assert.ok(node)
    assert.equal(await getNodeBlobStoredBytes(node.id), payload.byteLength, 'dense 保存仍全量')
  }
  {
    await resetState()
    const big = new Uint8Array(26 * 1024 * 1024)
    await filesCreateBinary('/user/big-opfs.bin', big.buffer)
    const before = await resolveNodeByAbsolutePath('/user/big-opfs.bin')
    assert.ok(before)
    assert.equal(await getNodeBlobStoredBytes(before.id), 26 * 1024 * 1024, '大文件落 OPFS 前全量')
    await writeTextFile('/user/big-opfs.bin', '\0'.repeat(26 * 1024 * 1024))
    const after = await resolveNodeByAbsolutePath('/user/big-opfs.bin')
    assert.ok(after)
    assert.equal(await getNodeBlobStoredBytes(after.id), 26 * 1024 * 1024, 'OPFS 大文件整写仍全量')
  }

  console.log('ok: filesSetSparse conversions, COW fork, quotas, save-keeps-sparse')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})