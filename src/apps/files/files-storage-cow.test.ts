/**
 * VFS 写时复制（clone COW）单测。
 * 运行：node --experimental-strip-types src/apps/files/files-storage-cow.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { defaultFilesNodeAttributes } from './files-types.ts'
import {
  cloneFileNodeWithSharedBlob,
  createFileWithBlob,
  estimateNodeMetaBytes,
  FILES_DB_NAME,
  FILES_DB_VERSION,
  FILES_BLOBS_STORE,
  FILES_META_STORE,
  FILES_NODES_STORE,
  getFileBlobRefForTests,
  getFilesTotalBytes,
  newFilesNodeId,
  readBlobText,
  resetFilesDbForTests,
  writeBlobText,
  deleteSubtree,
  collectSubtreeIds,
} from './files-storage.ts'
import { osNowMs } from '../../os/os-clock.ts'
import type { FilesNode } from './files-types.ts'

function makeFileNode(name: string): FilesNode {
  const now = osNowMs()
  return {
    id: newFilesNodeId(),
    locationId: 'local',
    parentId: undefined,
    name,
    kind: 'file',
    mimeType: 'text/plain',
    byteSize: 0,
    createdAt: now,
    updatedAt: now,
    attributes: defaultFilesNodeAttributes('local'),
  }
}

async function seedLegacyV2Database(): Promise<void> {
  await resetFilesDbForTests()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(FILES_DB_NAME, 2)
    request.onerror = () => reject(request.error ?? new Error('open v2 failed'))
    request.onupgradeneeded = () => {
      const db = request.result
      const nodes = db.createObjectStore(FILES_NODES_STORE, { keyPath: 'id' })
      nodes.createIndex('by-parent', ['locationId', 'parentId'], { unique: false })
      nodes.createIndex('by-location', 'locationId', { unique: false })
      db.createObjectStore(FILES_BLOBS_STORE, { keyPath: 'id' })
      db.createObjectStore(FILES_META_STORE, { keyPath: 'key' })
    }
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(
        [FILES_NODES_STORE, FILES_BLOBS_STORE, FILES_META_STORE],
        'readwrite',
      )
      const id = 'file:legacy-cow'
      const text = 'legacy-body'
      const bytes = new TextEncoder().encode(text)
      const copy = new Uint8Array(bytes.byteLength)
      copy.set(bytes)
      tx.objectStore(FILES_NODES_STORE).put({
        id,
        locationId: 'local',
        parentId: '',
        name: 'legacy.txt',
        kind: 'file',
        mimeType: 'text/plain',
        byteSize: bytes.byteLength,
        createdAt: 1,
        updatedAt: 1,
        // 故意不写 blobId
      })
      tx.objectStore(FILES_BLOBS_STORE).put({
        id,
        bytes: copy.buffer,
        // 故意不写 refCount
      })
      tx.objectStore(FILES_META_STORE).put({
        key: 'byte-total',
        totalBytes: bytes.byteLength + 32,
      })
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error ?? new Error('seed v2 failed'))
    }
  })
}

{
  await resetFilesDbForTests()
  const payload = 'hello-cow-shared'
  const sourceNode = makeFileNode('a.txt')
  const created = await createFileWithBlob({
    node: sourceNode,
    text: payload,
    metaBytes: estimateNodeMetaBytes(sourceNode),
  })
  const afterCreate = await getFilesTotalBytes()
  const sourceRef = await getFileBlobRefForTests(created.id)
  assert.ok(sourceRef)
  assert.equal(sourceRef.refCount, 1)

  const destNode = makeFileNode('a-copy.txt')
  const destMeta = estimateNodeMetaBytes(destNode)
  const cloned = await cloneFileNodeWithSharedBlob({
    sourceNodeId: created.id,
    node: destNode,
    metaBytes: destMeta,
  })
  const afterClone = await getFilesTotalBytes()
  const sharedSource = await getFileBlobRefForTests(created.id)
  const sharedDest = await getFileBlobRefForTests(cloned.id)
  assert.ok(sharedSource && sharedDest)
  assert.equal(sharedSource.blobId, sharedDest.blobId)
  assert.equal(sharedSource.refCount, 2)
  assert.equal(sharedDest.refCount, 2)
  // 复制只增加目标元数据，不拷贝内容
  assert.equal(afterClone - afterCreate, destMeta)
  assert.equal(await readBlobText(created.id), payload)
  assert.equal(await readBlobText(cloned.id), payload)
  console.log('ok: clone shares blob and quota')
}

{
  await resetFilesDbForTests()
  const original = 'shared-before'
  const sourceNode = makeFileNode('b.txt')
  const created = await createFileWithBlob({
    node: sourceNode,
    text: original,
    metaBytes: estimateNodeMetaBytes(sourceNode),
  })
  const destNode = makeFileNode('b-copy.txt')
  const cloned = await cloneFileNodeWithSharedBlob({
    sourceNodeId: created.id,
    node: destNode,
    metaBytes: estimateNodeMetaBytes(destNode),
  })
  const beforeWrite = await getFilesTotalBytes()
  const forked = await writeBlobText({
    id: cloned.id,
    text: 'shared-after-fork',
    previousByteSize: cloned.byteSize,
    nameMetaDelta: 0,
  })
  const afterWrite = await getFilesTotalBytes()
  assert.equal(await readBlobText(created.id), original)
  assert.equal(await readBlobText(forked.id), 'shared-after-fork')
  const srcRef = await getFileBlobRefForTests(created.id)
  const dstRef = await getFileBlobRefForTests(forked.id)
  assert.ok(srcRef && dstRef)
  assert.notEqual(srcRef.blobId, dstRef.blobId)
  assert.equal(srcRef.refCount, 1)
  assert.equal(dstRef.refCount, 1)
  assert.ok(afterWrite - beforeWrite >= 'shared-after-fork'.length - 4)
  console.log('ok: write forks shared blob')
}

{
  await resetFilesDbForTests()
  const sourceNode = makeFileNode('c.txt')
  const created = await createFileWithBlob({
    node: sourceNode,
    text: 'keep-me',
    metaBytes: estimateNodeMetaBytes(sourceNode),
  })
  const destNode = makeFileNode('c-copy.txt')
  const cloned = await cloneFileNodeWithSharedBlob({
    sourceNodeId: created.id,
    node: destNode,
    metaBytes: estimateNodeMetaBytes(destNode),
  })
  const subtree = await collectSubtreeIds(created.id)
  await deleteSubtree(subtree)
  assert.equal(await readBlobText(cloned.id), 'keep-me')
  const left = await getFileBlobRefForTests(cloned.id)
  assert.ok(left)
  assert.equal(left.refCount, 1)
  console.log('ok: delete source keeps clone readable')
}

{
  await resetFilesDbForTests()
  const sourceNode = makeFileNode('d.txt')
  const created = await createFileWithBlob({
    node: sourceNode,
    text: 'solo',
    metaBytes: estimateNodeMetaBytes(sourceNode),
  })
  const before = await getFileBlobRefForTests(created.id)
  assert.ok(before)
  const blobIdBefore = before.blobId
  await writeBlobText({
    id: created.id,
    text: 'solo-updated',
    previousByteSize: created.byteSize,
    nameMetaDelta: 0,
  })
  const after = await getFileBlobRefForTests(created.id)
  assert.ok(after)
  assert.equal(after.blobId, blobIdBefore)
  assert.equal(after.refCount, 1)
  assert.equal(await readBlobText(created.id), 'solo-updated')
  console.log('ok: exclusive write stays in place')
}

{
  await seedLegacyV2Database()
  assert.equal(FILES_DB_VERSION, 4)
  // 首次业务打开触发 v2→v3 迁移
  const text = await readBlobText('file:legacy-cow')
  assert.equal(text, 'legacy-body')
  const ref = await getFileBlobRefForTests('file:legacy-cow')
  assert.ok(ref)
  assert.equal(ref.refCount, 1)
  assert.equal(ref.blobId, 'file:legacy-cow')
  await writeBlobText({
    id: 'file:legacy-cow',
    text: 'legacy-migrated',
    previousByteSize: 'legacy-body'.length,
    nameMetaDelta: 0,
  })
  assert.equal(await readBlobText('file:legacy-cow'), 'legacy-migrated')
  console.log('ok: v2 data migrates and remains writable')
}

console.log('files-storage-cow: all passed')
