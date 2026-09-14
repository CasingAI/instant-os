/**
 * 数据空间账本（byte-total）计账口径回归：
 * - OPFS 落盘文件的覆盖写不再全额入账（2026-09-14 账面 15.9GB vs 实占 6.6GB 事故的主源）；
 * - IDB→OPFS 迁移（spill）要扣掉旧 IDB 实占；
 * - reconcileFilesByteTotal 自愈幂等。
 * 运行：node --experimental-strip-types src/apps/files/files-byte-total-reconcile.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import {
  filesCreateBinary,
  filesWriteBytesRange,
} from './files-api.ts'
import {
  getFileBlobStorageInfo,
  getFilesTotalBytes,
  reconcileFilesByteTotal,
  resetFilesDbForTests,
} from './files-storage.ts'
import { resolveNodeByAbsolutePath } from './files-vfs.ts'
import { invalidateFilesVfsPathCaches } from './files-vfs.ts'
import { resetOpfsBlobsForTests, useMemoryOpfsForTests } from './files-opfs-blobs.ts'

useMemoryOpfsForTests()

async function resetFiles(): Promise<void> {
  await resetFilesDbForTests()
  await resetOpfsBlobsForTests()
  invalidateFilesVfsPathCaches()
}

const MIB = 1024 * 1024
/** > OPFS_SPILL_THRESHOLD(25MiB)：创建即溢出到 OPFS */
const BIG = 26 * MIB

async function bodyStoreOf(path: string): Promise<string | undefined> {
  const node = await resolveNodeByAbsolutePath(path)
  assert.ok(node, `${path} 应存在`)
  return (await getFileBlobStorageInfo(node.id))?.bodyStore
}

async function testOpfsOverwriteWriteCostsNothing(): Promise<void> {
  await resetFiles()
  const payload = new Uint8Array(BIG)
  payload.fill(0x3c)
  await filesCreateBinary(
    '/user/opfs-overwrite.img',
    payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
  )
  assert.equal(await bodyStoreOf('/user/opfs-overwrite.img'), 'OPFS', '大文件应落 OPFS（测试前提）')
  const before = await getFilesTotalBytes()

  // 覆盖文件中段同一区域两次：账面都不该动（旧实现每次 +writeLen）
  const patch = new Uint8Array(MIB)
  patch.fill(0x7d)
  await filesWriteBytesRange('/user/opfs-overwrite.img', 3 * MIB, patch)
  const afterFirst = await getFilesTotalBytes()
  assert.equal(afterFirst, before, 'OPFS 覆盖写不应增加账面（第一次）')
  await filesWriteBytesRange('/user/opfs-overwrite.img', 3 * MIB, patch)
  const afterSecond = await getFilesTotalBytes()
  assert.equal(afterSecond, before, 'OPFS 覆盖写不应增加账面（第二次）')

  // 尾部越界写：只按实际增长计
  const tail = new Uint8Array(4096)
  tail.fill(0x11)
  await filesWriteBytesRange('/user/opfs-overwrite.img', BIG, tail)
  const afterGrow = await getFilesTotalBytes()
  assert.equal(afterGrow, before + 4096, '越界写只计实际增长')
}

async function testSpillSubtractsOldIdbStored(): Promise<void> {
  await resetFiles()
  // 20MiB 非零：低于 25MiB 阈值，留在 IDB（无洞，实占=逻辑）
  const payload = new Uint8Array(20 * MIB)
  payload.fill(0x5a)
  await filesCreateBinary(
    '/user/spill-later.img',
    payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
  )
  const stat = await bodyStoreOf('/user/spill-later.img')
  assert.equal(stat, 'IndexedDB', '测试前提：先在 IDB')
  const before = await getFilesTotalBytes()

  // 一次性写 10MiB 非零，把逻辑长度推过阈值 → 触发 IDB→OPFS 迁移
  const patch = new Uint8Array(10 * MIB)
  patch.fill(0x77)
  await filesWriteBytesRange('/user/spill-later.img', 20 * MIB, patch)
  const after = await bodyStoreOf('/user/spill-later.img')
  assert.equal(after, 'OPFS', '迁移后应落 OPFS')
  const afterNode = await resolveNodeByAbsolutePath('/user/spill-later.img')
  assert.equal(afterNode?.byteSize, 30 * MIB)

  // 账面增量 = 新 OPFS 全长(30MiB) − 旧 IDB 实占(20MiB) = 10MiB（旧实现按写入全长 10MiB 恰好也对，
  // 但若旧实占更大就会漏扣——这里直接锁死公式）
  const total = await getFilesTotalBytes()
  assert.equal(total, before + 10 * MIB, 'spill 增量 = 新全长 − 旧实占')
}

async function testReconcileIsIdempotent(): Promise<void> {
  await resetFiles()
  const payload = new Uint8Array(MIB)
  payload.fill(0x21)
  await filesCreateBinary(
    '/user/reconcile.bin',
    payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
  )
  const [a1, b1] = await reconcileFilesByteTotal()
  const counter = await getFilesTotalBytes()
  assert.equal(b1, counter, 'reconcile 后计数器应等于重算值')
  const [a2, b2] = await reconcileFilesByteTotal()
  assert.equal(a2, b2, '幂等：健康账本第二次重算应零变化')
  assert.ok(a1 > 0, '重算值应为正（含元数据+内容）')
}

await testOpfsOverwriteWriteCostsNothing()
await testSpillSubtractsOldIdbStored()
await testReconcileIsIdempotent()
console.log('files-byte-total-reconcile.test.ts ok')
