/**
 * 流写入进度登记表单测（openStreamWrite 包装层挂钩）：登记表只承载百分比。
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
  registerFilesWriteProgress,
  resetFilesWriteProgressForTests,
  subscribeFilesWriteProgress,
  updateFilesWriteProgress,
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

/** 新建流写入：open 登记（fraction=0）、分片按字节百分比推进、close 移除、订阅有通知 */
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
  assert.equal(snapshot.get(nodeId)?.fraction, 0, '登记时占位，百分比从 0 起步')
  assert.ok(notifyCount >= 1, '登记应立即通知订阅者')

  await writer.write(utf8('hello'))
  snapshot = getFilesWriteProgressSnapshot()
  assert.equal(snapshot.get(nodeId)?.fraction, 5 / 1024, 'fraction 应立即反映（快照直读）')

  await writer.write(utf8(' world'))
  snapshot = getFilesWriteProgressSnapshot()
  assert.equal(snapshot.get(nodeId)?.fraction, 11 / 1024)

  // 节流通知：等一个节流窗口后订阅者应被唤醒
  await delay(160)
  assert.ok(notifyCount >= 2, 'fraction 更新应在节流窗口后通知订阅者')

  await writer.close()
  snapshot = getFilesWriteProgressSnapshot()
  assert.ok(!snapshot.has(nodeId), 'close 后条目应移除')
  unsubscribe()
  console.log('ok: register → fraction 推进 → close 移除 → 订阅通知')
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

/** 覆盖写入：同样登记；无 expectedSize 时 fraction 缺省（旋转弧）；close 后移除 */
async function testOverwriteRegisters(): Promise<void> {
  await resetState()
  resetFilesWriteProgressForTests()
  await filesCreateText('/user/wp-over.txt', 'old')
  const writer = await filesOpenStreamWrite('/user/wp-over.txt')
  const nodeId = writer.node.id
  assert.ok(getFilesWriteProgressSnapshot().has(nodeId), '覆盖写入也应登记')
  assert.equal(
    getFilesWriteProgressSnapshot().get(nodeId)?.fraction,
    undefined,
    '无 expectedSize 时 fraction 缺省',
  )
  await writer.write(utf8('new-content'))
  assert.equal(getFilesWriteProgressSnapshot().get(nodeId)?.fraction, undefined, '总量未知不推进百分比')
  await writer.close()
  assert.ok(!getFilesWriteProgressSnapshot().has(nodeId), 'close 后条目应移除')
  console.log('ok: overwrite registers and removes on close')
}

/** 解压批量落盘：顶层目标文件夹登记圆饼（按子树字节百分比推进），整批结束撤掉 */
async function testMaterializeRegistersTopLevelFolders(): Promise<void> {
  await resetState()
  resetFilesWriteProgressForTests()
  // 快照里的 entry 是会被原地更新的同一引用，必须在通知当下抓数值
  let firstSeenFraction: number | undefined
  const unsubscribe = subscribeFilesWriteProgress(() => {
    if (firstSeenFraction !== undefined) return
    const first = [...getFilesWriteProgressSnapshot().values()][0]
    firstSeenFraction = first?.fraction
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
  assert.equal(firstSeenFraction, 0, '登记时刚占位，百分比从 0 起步')
  assert.equal(getFilesWriteProgressSnapshot().size, 0, '整批结束后登记应撤掉')
  const top = await resolveNodeByAbsolutePath('/user/extracted-top', { follow: false })
  assert.ok(top?.kind === 'folder', '顶层目标文件夹应已落盘')
  console.log('ok: materialize registers top-level folder pie')
}

/** 登记表自身语义：fraction 夹取到 [0,1] */
async function testFractionClamp(): Promise<void> {
  resetFilesWriteProgressForTests()
  registerFilesWriteProgress('node-clamp', 0.25)
  updateFilesWriteProgress('node-clamp', 1.5)
  assert.equal(getFilesWriteProgressSnapshot().get('node-clamp')?.fraction, 1, '超出 1 应夹取')
  updateFilesWriteProgress('node-clamp', -1)
  assert.equal(getFilesWriteProgressSnapshot().get('node-clamp')?.fraction, 0, '低于 0 应夹取')
  resetFilesWriteProgressForTests()
  console.log('ok: fraction clamped to [0,1]')
}

async function run(): Promise<void> {
  await testRegisterUpdateRemove()
  await testAbortRemovesEntry()
  await testOverwriteRegisters()
  await testMaterializeRegistersTopLevelFolders()
  await testFractionClamp()
  console.log('files-write-progress: all passed')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
