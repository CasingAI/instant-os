/**
 * VFS 同目录重名修复单测：
 * - 存储层唯一索引（by-parent-name）兜底
 * - 事务内自动加后缀 vs 精确路径两种语义
 * - 并发创建不会出现两条同名
 * - 外部导入子目录同名不覆盖旧文件
 * 运行：node --experimental-strip-types src/apps/files/files-vfs-unique-names.test.ts
 */
import 'fake-indexeddb/auto'
import './files-mount-test-window.ts'
import assert from 'node:assert/strict'
import { filesCreateText, filesMkdir, filesOpenStreamWrite, filesReadText, filesUpsertBatch } from './files-api.ts'
import { importExternalNodes } from './files-import-external.ts'
import {
  createFolderNode,
  estimateNodeMetaBytes,
  FilesPathExistsError,
  newFilesNodeId,
  resetFilesDbForTests,
  type FilesNode,
} from './files-storage.ts'
import {
  copyNodeTo,
  createTextFile,
  invalidateFilesVfsPathCaches,
  listDirectory,
  mkdir,
  renameNode,
  resolveNodeByAbsolutePath,
} from './files-vfs.ts'

function makeFolderNode(name: string): FilesNode {
  const now = Date.now()
  return {
    id: newFilesNodeId(),
    locationId: 'local',
    parentId: undefined,
    name,
    kind: 'folder',
    mimeType: undefined,
    byteSize: 0,
    createdAt: now,
    updatedAt: now,
    attributes: { readable: true, writable: true },
  }
}

async function resetState(): Promise<void> {
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()
}

async function testConcurrentAutoSuffix(): Promise<void> {
  await resetState()
  // 两条并发自动加后缀创建同一期望名：一条原名、一条「 2」，不会两条一样
  const [a, b] = await Promise.all([
    createTextFile({ locationId: 'local', parentId: undefined, name: 'foo.txt', text: '1' }),
    createTextFile({ locationId: 'local', parentId: undefined, name: 'foo.txt', text: '2' }),
  ])
  assert.deepEqual([a.name, b.name].sort(), ['foo 2.txt', 'foo.txt'])
  const root = await listDirectory('local', undefined)
  assert.equal(root.filter((node) => node.name === 'foo.txt').length, 1)
  assert.equal(root.filter((node) => node.name === 'foo 2.txt').length, 1)
  console.log('ok: concurrent auto-suffix creates unique names')
}

async function testMkdirAutoSuffix(): Promise<void> {
  await resetState()
  await filesMkdir('/user/dir')
  const second = await mkdir({ locationId: 'local', parentId: undefined, name: 'dir' })
  assert.equal(second.name, 'dir 2')
  console.log('ok: mkdir auto-suffix')
}

async function testRenameAutoSuffix(): Promise<void> {
  await resetState()
  await filesCreateText('/user/r1.txt', '1')
  await filesCreateText('/user/r2.txt', '2')
  const target = (await resolveNodeByAbsolutePath('/user/r1.txt'))!
  const renamed = await renameNode(target.id, 'r2.txt')
  assert.equal(renamed.name, 'r2 2.txt')
  assert.ok(await resolveNodeByAbsolutePath('/user/r2 2.txt'))
  assert.ok(await resolveNodeByAbsolutePath('/user/r2.txt'))
  console.log('ok: rename auto-suffix')
}

async function testCopyAutoSuffix(): Promise<void> {
  await resetState()
  await filesCreateText('/user/copy-me.txt', 'orig')
  const source = (await resolveNodeByAbsolutePath('/user/copy-me.txt'))!
  const copied = await copyNodeTo({
    sourceId: source.id,
    destLocationId: 'local',
    destParentId: undefined,
  })
  assert.equal(copied.name, 'copy-me 2.txt')
  console.log('ok: copy auto-suffix')
}

async function testExactCreateRejectsExisting(): Promise<void> {
  await resetState()
  await filesCreateText('/user/exact.txt', '1')
  await assert.rejects(() => filesCreateText('/user/exact.txt', '2'), /路径已存在/)
  await assert.rejects(() => filesMkdir('/user/exact.txt'), /路径已存在/)
  console.log('ok: exact create rejects existing path')
}

async function testConcurrentExactCreate(): Promise<void> {
  await resetState()
  // 并发精确创建同一路径：最多一条成功，不会改成「 2」
  const results = await Promise.allSettled([
    filesCreateText('/user/race.txt', '1'),
    filesCreateText('/user/race.txt', '2'),
  ])
  const fulfilled = results.filter((result) => result.status === 'fulfilled')
  const rejected = results.filter((result) => result.status === 'rejected')
  assert.equal(fulfilled.length, 1)
  assert.equal(rejected.length, 1)
  const reason = (rejected[0] as { reason: Error }).reason
  assert.match(reason.message, /路径已存在/)
  const node = await resolveNodeByAbsolutePath('/user/race.txt')
  assert.ok(node)
  console.log('ok: concurrent exact create allows at most one winner')
}

async function testImportDedupAgainstCurrentDir(): Promise<void> {
  await resetState()
  await filesMkdir('/user/target')
  await filesMkdir('/user/target/sub')
  await filesCreateText('/user/target/sub/existing.txt', 'original')

  const target = (await resolveNodeByAbsolutePath('/user/target'))!
  const imported = new File([new Uint8Array([0x62, 0x62])], 'existing.txt')
  await importExternalNodes({
    nodes: [
      {
        name: 'sub',
        kind: 'folder',
        children: [{ name: 'existing.txt', kind: 'file', file: imported }],
      },
    ],
    dest: { destLocationId: 'local', destParentId: target.id },
    onUiChange: () => {},
  })

  // 原目录同名文件不被覆盖
  assert.equal(await filesReadText('/user/target/sub/existing.txt'), 'original')
  // 新内容写进实际创建的 sub 2，而不是计划名 sub
  assert.ok(await resolveNodeByAbsolutePath('/user/target/sub 2'))
  const written = await resolveNodeByAbsolutePath('/user/target/sub 2/existing.txt')
  assert.ok(written)
  assert.equal(written?.byteSize, 2)
  console.log('ok: import dedup checks current dir and writes real folder name')
}

/** 并发 folder-return 撞车：双方都拿到库中已存在的同一条节点（模拟跨 tab） */
async function testFolderReturnCollisionIdentity(): Promise<void> {
  await resetState()
  const nodeA = makeFolderNode('ensure-collide')
  const nodeB = makeFolderNode('ensure-collide')
  const [r1, r2] = await Promise.all([
    createFolderNode({
      node: nodeA,
      metaBytes: estimateNodeMetaBytes(nodeA),
      nameMode: 'folder-return',
    }),
    createFolderNode({
      node: nodeB,
      metaBytes: estimateNodeMetaBytes(nodeB),
      nameMode: 'folder-return',
    }),
  ])
  // 败方不能把「自己构造但从未写入」的节点当结果返回
  assert.equal(r1.id, r2.id)
  assert.ok(r1.id === nodeA.id || r1.id === nodeB.id, '返回的是已落库的节点之一')
  const listed = await listDirectory('local', undefined)
  assert.equal(listed.filter((node) => node.name === 'ensure-collide').length, 1)
  console.log('ok: folder-return collision returns stored identity')
}

/** 并发精确批量 upsert 同一路径：一条成功，另一条整批失败且为 FilesPathExistsError */
async function testUpsertBatchConcurrentCollision(): Promise<void> {
  await resetState()
  const results = await Promise.allSettled([
    filesUpsertBatch([{ path: '/user/batch.txt', text: 'one' }]),
    filesUpsertBatch([{ path: '/user/batch.txt', text: 'two' }]),
  ])
  const fulfilled = results.filter((result) => result.status === 'fulfilled')
  const rejected = results.filter((result) => result.status === 'rejected')
  assert.equal(fulfilled.length, 1)
  assert.equal(rejected.length, 1)
  const reason = (rejected[0] as { reason: unknown }).reason
  assert.ok(reason instanceof FilesPathExistsError, '批量撞名应抛 FilesPathExistsError')
  const text = await filesReadText('/user/batch.txt')
  assert.ok(text === 'one' || text === 'two')
  console.log('ok: concurrent exact batch leaves at most one winner')
}

/** unique-suffix 流式打开：writer.node 为实际占位名，路径缓存按实际名 */
async function testStreamWriteUniqueSuffixPlaceholder(): Promise<void> {
  await resetState()
  await filesCreateText('/user/stream.txt', 'existing')
  const writer = await filesOpenStreamWrite('/user/stream.txt', { nameMode: 'unique-suffix' })
  assert.equal(writer.node.name, 'stream 2.txt')
  await writer.write(new Uint8Array([1, 2]))
  const closed = await writer.close()
  assert.equal(closed.name, 'stream 2.txt')
  assert.ok(await resolveNodeByAbsolutePath('/user/stream 2.txt'))
  // 原文件未被覆盖
  assert.equal(await filesReadText('/user/stream.txt'), 'existing')
  console.log('ok: stream write unique-suffix uses real placeholder name')
}

/** 并发导入同名文件：各得原名与后缀，互不覆盖 */
async function testImportConcurrentSameName(): Promise<void> {
  await resetState()
  const fileA = new File([new Uint8Array([0x61])], 'same.txt')
  const fileB = new File([new Uint8Array([0x62])], 'same.txt')
  await Promise.all([
    importExternalNodes({
      nodes: [{ name: 'same.txt', kind: 'file', file: fileA }],
      dest: { destLocationId: 'local', destParentId: undefined },
      onUiChange: () => {},
    }),
    importExternalNodes({
      nodes: [{ name: 'same.txt', kind: 'file', file: fileB }],
      dest: { destLocationId: 'local', destParentId: undefined },
      onUiChange: () => {},
    }),
  ])
  const names = (await listDirectory('local', undefined))
    .filter((node) => node.name.startsWith('same'))
    .map((node) => node.name)
    .sort()
  assert.deepEqual(names, ['same 2.txt', 'same.txt'])
  console.log('ok: concurrent import same name dedups without overwrite')
}

async function main(): Promise<void> {
  await testConcurrentAutoSuffix()
  await testMkdirAutoSuffix()
  await testRenameAutoSuffix()
  await testCopyAutoSuffix()
  await testExactCreateRejectsExisting()
  await testConcurrentExactCreate()
  await testImportDedupAgainstCurrentDir()
  await testFolderReturnCollisionIdentity()
  await testUpsertBatchConcurrentCollision()
  await testStreamWriteUniqueSuffixPlaceholder()
  await testImportConcurrentSameName()
  console.log('files-vfs-unique-names tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
