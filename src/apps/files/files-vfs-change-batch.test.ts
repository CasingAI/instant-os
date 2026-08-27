/**
 * VFS 变更批量合并单测：粘贴「替换」= 逐个永久删除旧文件再逐个拷入，若每步都
 * 广播 FILES_VFS_CHANGED_EVENT，文件管理器的 80ms debounce 会读到「旧文件删光、
 * 新文件未拷」的中间态，列表闪空再逐个长回。批量包裹后合并为结束时的单次广播。
 * 运行：node --experimental-strip-types src/apps/files/files-vfs-change-batch.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { createFat12Image } from './files-image-fat12-fixture.ts'
import { mountDiskImage, unmountDiskImage, resetImageMountRestoreForTests } from './files-image-actions.ts'
import { resetImageMountsForTests } from './files-image-mount-store.ts'
import { resetDiskImageOccupancyForTests } from './files-disk-image-occupancy.ts'
import { resetPersistedImageMountsForTests } from './files-image-mount-persist.ts'
import { resetFilesDbForTests } from './files-storage.ts'
import {
  FILES_VFS_CHANGED_EVENT,
  copyNodeTo,
  getCachedListDirectory,
  invalidateFilesVfsPathCaches,
  listDirectory,
  removeNode,
  resolveNodeByAbsolutePath,
  runWithFilesVfsChangeBatch,
} from './files-vfs.ts'
import { filesCreateBinary, filesCreateText, filesReadText, filesStat } from './files-api.ts'
import { filesLocationPathRoot } from './files-path.ts'
import { isImageLocationId } from './files-types.ts'

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>()

  get length(): number {
    return this.map.size
  }

  clear(): void {
    this.map.clear()
  }

  getItem(key: string | null): string | null {
    return key === null ? null : this.map.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.map.delete(key)
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}

;(globalThis as { localStorage?: Storage }).localStorage ??= new MemoryStorage()

// node 无 window；files-vfs 每次广播都走 window.dispatchEvent，装最小计数壳观察批次数。
// 只统计 VFS 变更事件：镜像卷读写还会派发挂载/存储容量等别的事件，不能混入
type CountingWindow = {
  addEventListener: () => void
  removeEventListener: () => void
  dispatchEvent: (event: { type: string }) => boolean
}
let vfsEventDispatches = 0
;(globalThis as { window?: CountingWindow }).window = {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: (event) => {
    if (event.type === FILES_VFS_CHANGED_EVENT) vfsEventDispatches += 1
    return true
  },
}

async function resetFiles(): Promise<void> {
  await resetImageMountsForTests()
  resetDiskImageOccupancyForTests()
  resetPersistedImageMountsForTests()
  resetImageMountRestoreForTests()
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()
}

async function assertTrashEmpty(context: string): Promise<void> {
  const trashRoot = await listDirectory('trash', undefined)
  assert.deepEqual(trashRoot.map((item) => item.name), [], context)
}

async function mountTestImage(): Promise<{ locationId: string; root: string }> {
  const image = createFat12Image()
  await filesCreateBinary(
    '/user/disk.img',
    image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength),
  )
  const mounted = await mountDiskImage('/user/disk.img')
  assert.equal(isImageLocationId(mounted.id), true)
  return { locationId: mounted.id, root: filesLocationPathRoot(mounted.id) }
}

async function stageReplaceFixture(root: string): Promise<{ sourceId: string; targetId: string }> {
  await filesCreateText(`${root}/vidmini.inf`, 'old driver')
  await filesCreateText('/user/vidmini.inf', 'new driver')
  const source = await resolveNodeByAbsolutePath('/user/vidmini.inf')
  const target = await resolveNodeByAbsolutePath(`${root}/vidmini.inf`)
  assert.ok(source)
  assert.ok(target)
  return { sourceId: source.id, targetId: target.id }
}

async function assertReplaceEndState(
  locationId: string,
  root: string,
  context: string,
): Promise<void> {
  assert.equal(await filesReadText(`${root}/vidmini.inf`), 'new driver', context)
  const listed = await listDirectory(locationId, undefined)
  assert.deepEqual(listed.map((item) => item.name), ['vidmini.inf'], context)
  await assertTrashEmpty(`${context}：废纸篓应为空`)
}

/** 批量包裹的替换：结束前不广播事件（但缓存即时失效），结束时恰好广播一次 */
async function testBatchedReplaceEmitsSingleNotification(): Promise<void> {
  await resetFiles()
  const { locationId, root } = await mountTestImage()
  try {
    const { sourceId, targetId } = await stageReplaceFixture(root)
    await listDirectory(locationId, undefined)
    vfsEventDispatches = 0

    await runWithFilesVfsChangeBatch(async () => {
      await removeNode(targetId)
      // 批量期间不广播，但缓存必须即时失效——收尾刷新才不会命中陈旧目录列表
      assert.equal(getCachedListDirectory(locationId, undefined), undefined)
      assert.equal(await filesStat(`${root}/vidmini.inf`), undefined)
      await copyNodeTo({
        sourceId,
        destLocationId: locationId,
        destParentId: undefined,
      })
      assert.equal(vfsEventDispatches, 0, '批量结束前不应广播 VFS 变更事件')
    })

    assert.equal(vfsEventDispatches, 1, '批量替换应合并为一次广播')
    await assertReplaceEndState(locationId, root, '批量替换终态')
  } finally {
    await unmountDiskImage(locationId)
  }
  console.log('ok: batched replace emits a single notification')
}

/** 对照：同样的操作不套批量时，每步各广播一次（这正是列表闪空的根源） */
async function testUnbatchedReplaceEmitsPerOperation(): Promise<void> {
  await resetFiles()
  const { locationId, root } = await mountTestImage()
  try {
    const { sourceId, targetId } = await stageReplaceFixture(root)
    vfsEventDispatches = 0

    await removeNode(targetId)
    await copyNodeTo({
      sourceId,
      destLocationId: locationId,
      destParentId: undefined,
    })

    assert.equal(vfsEventDispatches, 2, '无批量时删除与拷入应各自广播')
    await assertReplaceEndState(locationId, root, '无批量替换终态')
  } finally {
    await unmountDiskImage(locationId)
  }
  console.log('ok: unbatched replace emits per operation')
}

await testBatchedReplaceEmitsSingleNotification()
await testUnbatchedReplaceEmitsPerOperation()
console.log('files-vfs-change-batch.test.ts ok')
