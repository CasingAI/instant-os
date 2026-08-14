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
import { filesCreateText, filesMkdir, filesReadText } from './files-api.ts'
import { importExternalNodes } from './files-import-external.ts'
import { resetFilesDbForTests } from './files-storage.ts'
import {
  copyNodeTo,
  createTextFile,
  invalidateFilesVfsPathCaches,
  listDirectory,
  mkdir,
  renameNode,
  resolveNodeByAbsolutePath,
} from './files-vfs.ts'

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

async function main(): Promise<void> {
  await testConcurrentAutoSuffix()
  await testMkdirAutoSuffix()
  await testRenameAutoSuffix()
  await testCopyAutoSuffix()
  await testExactCreateRejectsExisting()
  await testConcurrentExactCreate()
  await testImportDedupAgainstCurrentDir()
  console.log('files-vfs-unique-names tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
