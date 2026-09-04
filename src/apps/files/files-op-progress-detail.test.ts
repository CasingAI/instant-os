/**
 * 进度上报真实化单测：
 * - estimateDeleteWorkload 对镜像卷不再把整棵目录当成 1 单位（按真实子树统计节点与字节）
 * - removeNode 删除镜像卷文件夹按子项推进（items/bytes 单调、收尾 done=total、文件确实删掉）
 * - copyNodeTo 上报 currentName / items / bytes（树内真实进度，不是顶层 1/1）
 * - copyNodeTo 文件夹源：onDestRootReady 在子项拷贝开始前触发，且此时已登记圆饼
 * - copyNodeTo 字节估 0 的非空树（挂载卷懒解析尺寸）：仍登记圆饼，按项数百分比推进
 * 运行：node --experimental-strip-types src/apps/files/files-op-progress-detail.test.ts
 */
import 'fake-indexeddb/auto'
import './files-mount-test-window.ts'
import assert from 'node:assert/strict'
import { createFat12Image } from './files-image-fat12-fixture.ts'
import type { ImageDiskIo } from './files-image-volume.ts'
import { openImageMount, resetImageMountsForTests } from './files-image-mount-store.ts'
import { resetFilesDbForTests } from './files-storage.ts'
import { filesWorkloadUnits } from './files-op-progress-policy.ts'
import {
  copyNodeTo,
  createTextFile,
  estimateDeleteWorkload,
  FILES_VFS_CHANGED_EVENT,
  invalidateFilesVfsPathCaches,
  listDirectory,
  mkdir,
  removeNode,
  resolveNodeByAbsolutePath,
  runWithFilesVfsChangeBatch,
  type FilesVfsOpProgress,
} from './files-vfs.ts'
import type { FilesNode } from './files-types.ts'
import {
  getFilesWriteProgressSnapshot,
  subscribeFilesWriteProgress,
  type FilesWriteProgressEntry,
} from './files-write-progress.ts'

function memoryDisk(bytes: Uint8Array): ImageDiskIo {
  return {
    size: bytes.byteLength,
    async read(offset, length) {
      return bytes.slice(offset, offset + length)
    },
    async write(offset, data) {
      bytes.set(data, offset)
    },
  }
}

async function resetAll(): Promise<void> {
  await resetImageMountsForTests()
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()
}

/** 挂上 FAT12 镜像并在卷上铺一棵小目录树（folder/sub/{a.txt,b.txt} + folder/root.txt） */
async function mountWithTree(): Promise<{ locationId: string; folderId: string }> {
  const image = createFat12Image()
  const mounted = await openImageMount({
    imagePath: '/user/progress-detail.img',
    fileName: 'progress-detail.img',
    io: memoryDisk(image),
  })
  const folder = await mkdir({ locationId: mounted.id, parentId: undefined, name: 'folder' })
  const sub = await mkdir({ locationId: mounted.id, parentId: folder.id, name: 'sub' })
  await createTextFile({ locationId: mounted.id, parentId: folder.id, name: 'root.txt', text: 'root' })
  await createTextFile({
    locationId: mounted.id,
    parentId: sub.id,
    name: 'a.txt',
    text: 'a'.repeat(2000),
  })
  await createTextFile({
    locationId: mounted.id,
    parentId: sub.id,
    name: 'b.txt',
    text: 'b'.repeat(3000),
  })
  return { locationId: mounted.id, folderId: folder.id }
}

async function testEstimateDeleteWorkloadCountsImageSubtree(): Promise<void> {
  await resetAll()
  const { folderId } = await mountWithTree()
  const workload = await estimateDeleteWorkload(folderId)
  // 1 文件夹 + 1 子文件夹 + 3 文件 = 5 节点；字节 = 4 + 2000 + 3000
  assert.equal(workload.nodeCount, 5, `nodeCount=${workload.nodeCount}`)
  assert.equal(workload.byteSize, 5004, `byteSize=${workload.byteSize}`)
  assert.equal(workload.totalUnits, filesWorkloadUnits(5, 5004))
  console.log('estimate-delete-workload image subtree ok')
}

async function testRemoveImageFolderReportsPerItem(): Promise<void> {
  await resetAll()
  const { locationId, folderId } = await mountWithTree()
  const events: FilesVfsOpProgress[] = []
  await removeNode(folderId, { onProgress: (progress) => events.push(progress) })

  assert.ok(events.length >= 5, `删除 5 个子项应有至少 5 次上报，实际 ${events.length}`)
  const itemsSeq = events.map((event) => event.items?.done ?? 0)
  for (let index = 1; index < itemsSeq.length; index += 1) {
    assert.ok(itemsSeq[index]! >= itemsSeq[index - 1]!, 'items 应单调不减')
  }
  const last = events[events.length - 1]!
  assert.equal(last.done, last.total, '收尾应 done=total')
  assert.equal(last.items?.done, 5)
  assert.equal(last.bytes?.done, 5004)
  assert.ok(events.some((event) => event.currentName === 'sub'), '应上报过当前名 sub')

  const rootChildren = await listDirectory(locationId, undefined)
  assert.equal(rootChildren.some((node) => node.name === 'folder'), false, '文件夹应已删除')
  console.log('remove-image-folder per-item progress ok')
}

async function testCopyReportsTreeDetail(): Promise<void> {
  await resetAll()
  const { folderId } = await mountWithTree()
  const dest = await mkdir({ locationId: 'local', parentId: undefined, name: 'copydest' })
  const events: FilesVfsOpProgress[] = []
  await copyNodeTo({
    sourceId: folderId,
    destLocationId: 'local',
    destParentId: dest.id,
    onProgress: (progress) => events.push(progress),
  })
  assert.ok(events.length > 0)
  const last = events[events.length - 1]!
  assert.equal(last.done, last.total)
  assert.equal(last.items?.done, 5)
  assert.equal(last.items?.total, 5)
  assert.equal(last.bytes?.done, 5004)
  assert.ok(events.some((event) => event.currentName === 'a.txt'), '复制过程应上报当前文件名')
  const created = await resolveNodeByAbsolutePath('/user/copydest/folder/sub/a.txt')
  assert.ok(created, '目标文件应已创建')
  console.log('copy tree detail progress ok')
}

/**
 * 粘贴包在一次变更合并里：目标根文件夹的 created 仍要立即广播（列表马上出现它），
 * 建根后登记写入进度（圆饼占位 fraction=0，随后按字节百分比推进），
 * 整棵完成撤掉登记。
 */
async function testCopyRootFolderPieAndImmediateBroadcast(): Promise<void> {
  await resetAll()
  const { folderId } = await mountWithTree()
  const dest = await mkdir({ locationId: 'local', parentId: undefined, name: 'piedest' })
  // 快照里的 entry 是会被原地更新的同一引用，必须在通知当下抓数值
  let firstSeenFraction: number | undefined
  const unsubscribe = subscribeFilesWriteProgress(() => {
    if (firstSeenFraction !== undefined) return
    const first = [...getFilesWriteProgressSnapshot().values()][0]
    firstSeenFraction = first?.fraction
  })
  let batchEvents = 0
  const onVfsChanged = () => {
    batchEvents += 1
  }
  window.addEventListener(FILES_VFS_CHANGED_EVENT, onVfsChanged)
  const events: FilesVfsOpProgress[] = []
  try {
    await runWithFilesVfsChangeBatch(async () => {
      await copyNodeTo({
        sourceId: folderId,
        destLocationId: 'local',
        destParentId: dest.id,
        onProgress: (progress) => events.push(progress),
      })
      assert.ok(batchEvents > 0, '批量期间目标根文件夹的 created 应立即广播')
      const listing = await listDirectory('local', dest.id)
      assert.ok(
        listing.some((node) => node.kind === 'folder' && node.name === 'folder'),
        '批量期间目标根文件夹应已可见',
      )
    })
  } finally {
    unsubscribe()
    window.removeEventListener(FILES_VFS_CHANGED_EVENT, onVfsChanged)
  }
  assert.equal(firstSeenFraction, 0, '拷贝期间应登记目标根圆饼，登记时从 0 起步')
  assert.equal(getFilesWriteProgressSnapshot().size, 0, '整棵完成后登记应撤掉')
  const last = events[events.length - 1]!
  assert.equal(last.done, last.total)
  assert.equal(last.items?.done, 5)
  console.log('copy root folder pie + immediate broadcast ok')
}

/**
 * 目标根就绪回调必须发生在拷子项之前：此时列表才能叠上圆饼。
 * 判定：回调触发时进度仍只有根文件夹本身（1 项），圆饼已占位登记（fraction=0），
 * 且回调拿到的就是后来 copyNodeTo 返回的那个根。
 */
async function testCopyDestRootReadyBeforeChildren(): Promise<void> {
  await resetAll()
  const { folderId } = await mountWithTree()
  const dest = await mkdir({ locationId: 'local', parentId: undefined, name: 'ready-dest' })
  const events: FilesVfsOpProgress[] = []
  let readyRoot: FilesNode | undefined
  let itemsDoneAtReady = -1
  let pieAtReady: FilesWriteProgressEntry | undefined
  let pieFractionAtReady: number | undefined
  const copied = await copyNodeTo({
    sourceId: folderId,
    destLocationId: 'local',
    destParentId: dest.id,
    onProgress: (progress) => events.push(progress),
    onDestRootReady: (root) => {
      readyRoot = root
      itemsDoneAtReady = events[events.length - 1]?.items?.done ?? -1
      pieAtReady = [...getFilesWriteProgressSnapshot().values()][0]
      pieFractionAtReady = pieAtReady?.fraction
    },
  })
  assert.ok(readyRoot, '文件夹源应在拷子项前通知目标根已就绪')
  assert.equal(readyRoot!.id, copied.id, '就绪回调的根应与 copyNodeTo 返回值同一节点')
  assert.equal(readyRoot!.kind, 'folder')
  assert.equal(itemsDoneAtReady, 1, '就绪时只应完成根文件夹本身，子项尚未开始')
  assert.ok(pieAtReady, '就绪时圆饼应已登记')
  assert.equal(pieAtReady!.nodeId, copied.id)
  assert.equal(pieFractionAtReady, 0)
  assert.equal(getFilesWriteProgressSnapshot().size, 0, '整棵完成后登记应撤掉')
  const last = events[events.length - 1]!
  assert.equal(last.items?.done, 5)
  console.log('copy dest-root-ready before children ok')
}

/**
 * 字节估 0 但树非空（挂载卷尺寸懒解析的常态，mount:* 列表建节点字节恒 0）：
 * 不能当空树跳过登记——圆饼按项数百分比推进，登记时 fraction=0 占位，
 * 整棵完成后撤掉。空树（只有根自己）仍不登记。
 */
async function testCopyZeroByteEstimateStillRegistersPie(): Promise<void> {
  await resetAll()
  const image = createFat12Image()
  const mounted = await openImageMount({
    imagePath: '/user/zero-byte.img',
    fileName: 'zero-byte.img',
    io: memoryDisk(image),
  })
  const folder = await mkdir({ locationId: mounted.id, parentId: undefined, name: 'emptyish' })
  await createTextFile({ locationId: mounted.id, parentId: folder.id, name: 'e.txt', text: '' })
  const dest = await mkdir({ locationId: 'local', parentId: undefined, name: 'zero-pie-dest' })
  let pieAtReady: FilesWriteProgressEntry | undefined
  let pieFractionAtReady: number | undefined
  const copied = await copyNodeTo({
    sourceId: folder.id,
    destLocationId: 'local',
    destParentId: dest.id,
    onDestRootReady: () => {
      pieAtReady = [...getFilesWriteProgressSnapshot().values()][0]
      pieFractionAtReady = pieAtReady?.fraction
    },
  })
  assert.ok(pieAtReady, '字节估 0 的非空树也必须登记目标根圆饼')
  assert.equal(pieAtReady!.nodeId, copied.id)
  assert.equal(pieFractionAtReady, 0, '登记时占位，随后按项数百分比推进')
  assert.equal(getFilesWriteProgressSnapshot().size, 0, '整棵完成后登记应撤掉')
  console.log('copy zero-byte estimate pie ok')
}

await testEstimateDeleteWorkloadCountsImageSubtree()
await testRemoveImageFolderReportsPerItem()
await testCopyReportsTreeDetail()
await testCopyRootFolderPieAndImmediateBroadcast()
await testCopyDestRootReadyBeforeChildren()
await testCopyZeroByteEstimateStillRegistersPie()
console.log('files-op-progress-detail.test.ts: ok')
