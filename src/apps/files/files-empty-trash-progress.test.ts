/**
 * 清空废纸篓工作量估算与进度上报单测：
 * - estimateEmptyTrashWorkload 与 estimateDeleteWorkload 同口径（节点数 + 字节 → 工作单位）
 * - emptyTrash 的 onProgress 按单位单调推进、收尾 {done: total, total}
 * - 空废纸篓工作量恒为 0（运行器侧兜底为 1，短操作不弹窗）
 * - abort 检查点在删除每个根节点前生效
 * 运行：node --experimental-strip-types src/apps/files/files-empty-trash-progress.test.ts
 */
import 'fake-indexeddb/auto'
import './files-mount-test-window.ts'
import assert from 'node:assert/strict'
import { filesWorkloadUnits } from './files-op-progress-policy.ts'
import { collectSubtreeIds, resetFilesDbForTests } from './files-storage.ts'
import {
  createTextFile,
  emptyTrash,
  estimateEmptyTrashWorkload,
  invalidateFilesVfsPathCaches,
  listDirectory,
  mkdir,
  trashNode,
} from './files-vfs.ts'

async function resetState(): Promise<void> {
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()
}

/** 废纸篓里放一个嵌套文件夹（5 个 2KB 文件）+ 2 个零散文件，返回期望节点数 */
async function seedTrash(): Promise<{ nodeCount: number }> {
  const folder = await mkdir({ locationId: 'local', parentId: undefined, name: 'big' })
  for (let i = 0; i < 5; i += 1) {
    await createTextFile({
      locationId: 'local',
      parentId: folder.id,
      name: `f${i}.txt`,
      text: 'x'.repeat(2000),
    })
  }
  const a = await createTextFile({ locationId: 'local', parentId: undefined, name: 'a.txt', text: 'a' })
  const b = await createTextFile({ locationId: 'local', parentId: undefined, name: 'b.txt', text: 'b' })
  await trashNode(folder.id)
  await trashNode(a.id)
  await trashNode(b.id)
  return { nodeCount: 8 } // 1 文件夹 + 5 文件 + 2 零散文件
}

async function testEmptyTrashWorkloadWhenTrashEmpty(): Promise<void> {
  await resetState()
  const workload = await estimateEmptyTrashWorkload()
  assert.equal(workload.nodeCount, 0)
  assert.equal(workload.byteSize, 0)
  assert.equal(workload.totalUnits, 0)
  console.log('empty trash workload (empty) ok')
}

async function testWorkloadStatsNested(): Promise<void> {
  await resetState()
  const { nodeCount } = await seedTrash()
  const workload = await estimateEmptyTrashWorkload()
  assert.equal(workload.nodeCount, nodeCount)
  // reclaimBytes 至少含 5×2000 + 2 字节的文件内容
  assert.ok(workload.byteSize > 10000, `byteSize=${workload.byteSize}`)
  // 与 estimateDeleteWorkload 同口径：逐 root 独立折算单位再求和（整体折算只是下界）
  const roots = await listDirectory('trash', undefined)
  let expectedUnits = 0
  for (const root of roots) {
    const subtree = await collectSubtreeIds(root.id)
    expectedUnits += filesWorkloadUnits(subtree.nodeIds.length, subtree.reclaimBytes)
  }
  assert.equal(workload.totalUnits, expectedUnits)
  assert.ok(workload.totalUnits >= filesWorkloadUnits(workload.nodeCount, workload.byteSize))
  console.log('empty trash workload (nested) ok')
}

async function testProgressMovesByUnits(): Promise<void> {
  await resetState()
  await seedTrash()
  const workload = await estimateEmptyTrashWorkload()
  const reports: Array<{ done: number; total: number }> = []
  await emptyTrash({ onProgress: (p) => reports.push(p) })
  assert.ok(reports.length >= 2, `reports=${reports.length}`)
  const last = reports[reports.length - 1]!
  assert.equal(last.done, last.total)
  assert.equal(last.total, workload.totalUnits)
  for (let i = 1; i < reports.length; i += 1) {
    assert.ok(reports[i]!.done >= reports[i - 1]!.done, `monotonic at ${i}`)
  }
  console.log('empty trash progress ok')
}

async function testEmptyTrashQuickSeries(): Promise<void> {
  await resetState()
  const reports: Array<{ done: number; total: number }> = []
  await emptyTrash({ onProgress: (p) => reports.push(p) })
  // 空废纸篓：total 兜底为 1，立即完成（策略上不弹窗）
  assert.equal(reports.length, 2)
  assert.equal(reports[0]!.done, 0)
  assert.equal(reports[0]!.total, 1)
  assert.equal(reports[1]!.done, 1)
  assert.equal(reports[1]!.total, 1)
  console.log('empty trash quick series ok')
}

async function testAbortMidway(): Promise<void> {
  await resetState()
  await seedTrash()
  await assert.rejects(emptyTrash({ signal: AbortSignal.abort() }))
  console.log('empty trash abort ok')
}

const tests = [
  testEmptyTrashWorkloadWhenTrashEmpty,
  testWorkloadStatsNested,
  testProgressMovesByUnits,
  testEmptyTrashQuickSeries,
  testAbortMidway,
]
for (const t of tests) {
  await t()
}
console.log('files-empty-trash-progress all ok')