/**
 * 流写入进度登记表单测（openStreamWrite 包装层挂钩）。
 * 运行：node --experimental-strip-types src/apps/files/files-write-progress.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { filesOpenStreamWrite, filesCreateText } from './files-api.ts'
import { invalidateFilesVfsPathCaches, resolveNodeByAbsolutePath } from './files-vfs.ts'
import { resetFilesDbForTests } from './files-storage.ts'
import { materializeArchiveEntries } from '../../archive/archive-materialize.ts'
import {
  getFilesWriteProgressSnapshot,
  resetFilesWriteProgressForTests,
  subscribeFilesWriteProgress,
  type FilesWriteProgressEntry,
} from './files-write-progress.ts'

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

async function resetState(): Promise<void> {
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()
  // 触发用户特殊文件夹自动创建，保持与其它套件一致的基线
  await resolveNodeByAbsolutePath('/user/.warmup-probe')
  invalidateFilesVfsPathCaches()
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 新建流写入：open 登记（total=expectedSize）、分片累加、close 移除、订阅有通知 */
async function testRegisterUpdateRemove(): Promise<void> {
  await resetState()
  resetFilesWriteProgressForTests()
  let notifyCount = 0
  const unsubscribe = subscribeFilesWriteProgress(() => {
    notifyCount += 1
  })

  const writer = await filesOpenStreamWrite('/user/wp.bin', { expectedSize: 1024 })
  const nodeId = writer.node.id
  let snapshot = getFilesWriteProgressSnapshot()
  assert.ok(snapshot.has(nodeId), 'open 后应登记写入中条目')
  assert.equal(snapshot.get(nodeId)?.total, 1024)
  assert.equal(snapshot.get(nodeId)?.written, 0)
  assert.ok(notifyCount >= 1, '登记应立即通知订阅者')

  await writer.write(utf8('hello'))
  snapshot = getFilesWriteProgressSnapshot()
  assert.equal(snapshot.get(nodeId)?.written, 5, 'written 应立即反映（快照直读）')

  await writer.write(utf8(' world'))
  snapshot = getFilesWriteProgressSnapshot()
  assert.equal(snapshot.get(nodeId)?.written, 11)

  // 节流通知：等一个节流窗口后订阅者应被唤醒
  await delay(160)
  assert.ok(notifyCount >= 2, 'written 更新应在节流窗口后通知订阅者')

  await writer.close()
  snapshot = getFilesWriteProgressSnapshot()
  assert.ok(!snapshot.has(nodeId), 'close 后条目应移除')
  unsubscribe()
  console.log('ok: register → written 累加 → close 移除 → 订阅通知')
}

/** abort 回滚：条目同样移除 */
async function testAbortRemovesEntry(): Promise<void> {
  await resetState()
  resetFilesWriteProgressForTests()
  const writer = await filesOpenStreamWrite('/user/wp-abort.bin', { expectedSize: 64 })
  await writer.write(utf8('partial'))
  assert.ok(getFilesWriteProgressSnapshot().has(writer.node.id))
  await writer.abort()
  assert.ok(!getFilesWriteProgressSnapshot().has(writer.node.id), 'abort 后条目应移除')
  console.log('ok: abort removes entry')
}

/** 覆盖写入：同样登记；close 后移除 */
async function testOverwriteRegisters(): Promise<void> {
  await resetState()
  resetFilesWriteProgressForTests()
  await filesCreateText('/user/wp-over.txt', 'old')
  const writer = await filesOpenStreamWrite('/user/wp-over.txt')
  const nodeId = writer.node.id
  assert.ok(getFilesWriteProgressSnapshot().has(nodeId), '覆盖写入也应登记')
  assert.equal(getFilesWriteProgressSnapshot().get(nodeId)?.total, undefined, '无 expectedSize 时 total 缺省')
  await writer.write(utf8('new-content'))
  await writer.close()
  assert.ok(!getFilesWriteProgressSnapshot().has(nodeId), 'close 后条目应移除')
  console.log('ok: overwrite registers and removes on close')
}

/** 解压批量落盘：顶层目标文件夹登记圆饼（总量=该子树字节），整批结束撤掉 */
async function testMaterializeRegistersTopLevelFolders(): Promise<void> {
  await resetState()
  resetFilesWriteProgressForTests()
  let sawEntry: FilesWriteProgressEntry | undefined
  const unsubscribe = subscribeFilesWriteProgress(() => {
    if (sawEntry) return
    for (const entry of getFilesWriteProgressSnapshot().values()) sawEntry = entry
  })
  try {
    const result = await materializeArchiveEntries({
      destRoot: '/user',
      entries: [
        { relativePath: 'extracted-top/a.txt', bytes: utf8('a'.repeat(3000)) },
        { relativePath: 'extracted-top/b.txt', bytes: utf8('b'.repeat(2000)) },
      ],
    })
    assert.equal(result.fileCount, 2)
    assert.equal(result.bytesWritten, 5000)
  } finally {
    unsubscribe()
  }
  assert.ok(sawEntry, '落盘期间应登记顶层目标文件夹的写入进度')
  assert.equal(sawEntry!.total, 5000, '圆饼总量应为该顶层子树的字节')
  assert.equal(getFilesWriteProgressSnapshot().size, 0, '整批结束后登记应撤掉')
  const top = await resolveNodeByAbsolutePath('/user/extracted-top', { follow: false })
  assert.ok(top?.kind === 'folder', '顶层目标文件夹应已落盘')
  console.log('ok: materialize registers top-level folder pie')
}

async function run(): Promise<void> {
  await testRegisterUpdateRemove()
  await testAbortRemovesEntry()
  await testOverwriteRegisters()
  await testMaterializeRegistersTopLevelFolders()
  console.log('files-write-progress: all passed')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
