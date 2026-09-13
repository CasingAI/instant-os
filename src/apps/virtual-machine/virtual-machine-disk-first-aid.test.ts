/**
 * 磁盘工具急救的 VM 域单测：分析 / 写入硬盘文件（进度与中止）/ 丢掉缓存。
 * 走真（VFS 附加）缓存后端；镜像与 OPFS 用内存实现。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-disk-first-aid.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { filesCreateBinary, filesListAttachments, filesReadBlobRange } from '../files/files-api.ts'
import { resetFilesDbForTests } from '../files/files-storage.ts'
import { invalidateFilesVfsPathCaches } from '../files/files-vfs.ts'
import { resetOpfsBlobsForTests, useMemoryOpfsForTests } from '../files/files-opfs-blobs.ts'
import {
  claimDiskImagePath,
  releaseDiskImagePath,
  resetDiskImageOccupancyForTests,
} from '../files/files-disk-image-occupancy.ts'
import {
  openDiskOverlayStore,
  resetDiskOverlayStoreForTests,
  VM_DISK_CACHE_ATTACHMENT_TAG,
} from './virtual-machine-disk-overlay-store.ts'
import {
  analyzeVirtualMachineDiskCache,
  discardVirtualMachineDiskCache,
  mergeVirtualMachineDiskCacheIntoImage,
} from './virtual-machine-disk-first-aid.ts'

useMemoryOpfsForTests()

async function resetFiles(): Promise<void> {
  await resetFilesDbForTests()
  await resetOpfsBlobsForTests()
  resetDiskOverlayStoreForTests()
  resetDiskImageOccupancyForTests()
  invalidateFilesVfsPathCaches()
}

async function createDisk(path: string, size = 4096): Promise<void> {
  const payload = new Uint8Array(size)
  payload.fill(0x11)
  await filesCreateBinary(
    path,
    payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
  )
}

async function readRange(path: string, offset: number, length: number): Promise<number[]> {
  const blob = await filesReadBlobRange(path, offset, length)
  return [...new Uint8Array(await blob.arrayBuffer())]
}

async function appendCache(path: string, offset: number, bytes: number[]): Promise<void> {
  const store = await openDiskOverlayStore({ imagePath: path })
  await store.append(offset, new Uint8Array(bytes))
}

async function testAnalyzeMergeDiscardLifecycle(): Promise<void> {
  await resetFiles()
  await createDisk('/user/aid.img')

  // 无缓存：分析返回 undefined，且不凭空创建附加
  assert.equal(await analyzeVirtualMachineDiskCache('/user/aid.img'), undefined)
  assert.equal(
    (await filesListAttachments('/user/aid.img', { tag: VM_DISK_CACHE_ATTACHMENT_TAG })).length,
    0,
  )

  // 追加两笔（同一槽）：分析按实占，合并后镜像字节已变
  await appendCache('/user/aid.img', 0, [9, 9, 9, 9])
  await appendCache('/user/aid.img', 1024, [7, 7])
  const report = await analyzeVirtualMachineDiskCache('/user/aid.img')
  assert.ok(report)
  assert.equal(report.imagePath, '/user/aid.img')
  assert.equal(report.cacheBytes, 4096)
  assert.equal(report.cacheRecords, 1)

  // 写入硬盘文件：进度累计到头，镜像字节已变，附加删除
  const progress: { mergedBytes: number; totalBytes: number }[] = []
  await mergeVirtualMachineDiskCacheIntoImage({
    imagePath: '/user/aid.img',
    onProgress: (info) => progress.push(info),
  })
  assert.deepEqual(await readRange('/user/aid.img', 0, 4), [9, 9, 9, 9])
  assert.deepEqual(await readRange('/user/aid.img', 1024, 2), [7, 7])
  const last = progress.at(-1)
  assert.ok(last)
  assert.equal(last.totalBytes, 4096)
  assert.equal(last.mergedBytes, 4096)
  assert.equal(await analyzeVirtualMachineDiskCache('/user/aid.img'), undefined)

  // 再追加 → 丢掉缓存：附加删除且镜像字节不变
  await appendCache('/user/aid.img', 2048, [5, 5, 5])
  const again = await analyzeVirtualMachineDiskCache('/user/aid.img')
  assert.ok(again)
  assert.equal(again.cacheBytes, 4096)
  await discardVirtualMachineDiskCache('/user/aid.img')
  assert.equal(await analyzeVirtualMachineDiskCache('/user/aid.img'), undefined)
  assert.deepEqual(await readRange('/user/aid.img', 2048, 3), [0x11, 0x11, 0x11])
}

async function testAnalyzeMergesOverlappingRecords(): Promise<void> {
  await resetFiles()
  await createDisk('/user/overlap.img')
  // 相邻/重叠记录合并成一段
  await appendCache('/user/overlap.img', 16, [1, 2])
  await appendCache('/user/overlap.img', 18, [3, 4])
  const report = await analyzeVirtualMachineDiskCache('/user/overlap.img')
  assert.ok(report)
  assert.equal(report.cacheRecords, 1)
  assert.equal(report.cacheBytes, 4096)
  await discardVirtualMachineDiskCache('/user/overlap.img')
}

async function testAbortKeepsCacheAndImage(): Promise<void> {
  await resetFiles()
  await createDisk('/user/abort.img')
  await appendCache('/user/abort.img', 0, [1, 2, 3, 4])
  const controller = new AbortController()
  controller.abort()
  await mergeVirtualMachineDiskCacheIntoImage({
    imagePath: '/user/abort.img',
    signal: controller.signal,
  })
  // 中止不是失败：缓存保留，镜像未动，还可再次急救
  const report = await analyzeVirtualMachineDiskCache('/user/abort.img')
  assert.ok(report)
  assert.deepEqual(await readRange('/user/abort.img', 0, 4), [0x11, 0x11, 0x11, 0x11])
  await mergeVirtualMachineDiskCacheIntoImage({ imagePath: '/user/abort.img' })
  assert.deepEqual(await readRange('/user/abort.img', 0, 4), [1, 2, 3, 4])
  assert.equal(await analyzeVirtualMachineDiskCache('/user/abort.img'), undefined)
}

/** 放弃在段间停下：可见文件已含前几段、附加保留，再次合并只写剩余段。 */
async function testAbortBetweenSegmentsKeepsRemainder(): Promise<void> {
  await resetFiles()
  const slot = 1024 * 1024
  await createDisk('/user/rest.img', slot * 3)
  await appendCache('/user/rest.img', 0, [1, 1, 1, 1])
  await appendCache('/user/rest.img', slot, [2, 2])
  await appendCache('/user/rest.img', slot * 2, [3, 3, 3])
  const controller = new AbortController()
  const progress: number[] = []
  await mergeVirtualMachineDiskCacheIntoImage({
    imagePath: '/user/rest.img',
    signal: controller.signal,
    onProgress: (info) => {
      progress.push(info.mergedBytes)
      if (info.mergedBytes >= slot) {
        controller.abort()
      }
    },
  })
  assert.deepEqual(await readRange('/user/rest.img', 0, 4), [1, 1, 1, 1])
  assert.deepEqual(await readRange('/user/rest.img', slot, 2), [0x11, 0x11])
  assert.deepEqual(await readRange('/user/rest.img', slot * 2, 3), [0x11, 0x11, 0x11])
  const report = await analyzeVirtualMachineDiskCache('/user/rest.img')
  assert.ok(report)
  assert.equal(report.cacheRecords, 3)
  assert.equal(report.cacheBytes, slot * 3)
  assert.equal(Math.max(...progress), slot)
  await mergeVirtualMachineDiskCacheIntoImage({ imagePath: '/user/rest.img' })
  assert.deepEqual(await readRange('/user/rest.img', slot, 2), [2, 2])
  assert.deepEqual(await readRange('/user/rest.img', slot * 2, 3), [3, 3, 3])
  assert.equal(await analyzeVirtualMachineDiskCache('/user/rest.img'), undefined)
}

async function testMergeRejectsWhenVmOccupies(): Promise<void> {
  await resetFiles()
  await createDisk('/user/locked.img')
  await appendCache('/user/locked.img', 0, [6, 6])
  await claimDiskImagePath('/user/locked.img', { kind: 'vm', id: 'vm-1' })
  await assert.rejects(
    () => mergeVirtualMachineDiskCacheIntoImage({ imagePath: '/user/locked.img' }),
    /虚拟机/,
  )
  releaseDiskImagePath('/user/locked.img', { kind: 'vm', id: 'vm-1' })
  // 占用在失败路径上也正确释放：磁盘工具自己还能再进
  await mergeVirtualMachineDiskCacheIntoImage({ imagePath: '/user/locked.img' })
  assert.equal(await analyzeVirtualMachineDiskCache('/user/locked.img'), undefined)
}

async function testDiscardRejectsWhenVmOccupies(): Promise<void> {
  await resetFiles()
  await createDisk('/user/vmbusy.img')
  await appendCache('/user/vmbusy.img', 0, [8, 8])
  await claimDiskImagePath('/user/vmbusy.img', { kind: 'vm', id: 'vm-2' })
  await assert.rejects(
    () => discardVirtualMachineDiskCache('/user/vmbusy.img'),
    /虚拟机/,
  )
  // 占用期间分析同样被拦；缓存未被误删改用附加列表确认
  await assert.rejects(() => analyzeVirtualMachineDiskCache('/user/vmbusy.img'), /虚拟机/)
  assert.equal(
    (await filesListAttachments('/user/vmbusy.img', { tag: VM_DISK_CACHE_ATTACHMENT_TAG })).length,
    1,
  )
  releaseDiskImagePath('/user/vmbusy.img', { kind: 'vm', id: 'vm-2' })
  await discardVirtualMachineDiskCache('/user/vmbusy.img')
  assert.equal(await analyzeVirtualMachineDiskCache('/user/vmbusy.img'), undefined)
}

async function testDiscardWithoutCacheIsNoop(): Promise<void> {
  await resetFiles()
  await createDisk('/user/clean.img')
  await discardVirtualMachineDiskCache('/user/clean.img')
  assert.equal(await analyzeVirtualMachineDiskCache('/user/clean.img'), undefined)
  assert.equal(
    (await filesListAttachments('/user/clean.img', { tag: VM_DISK_CACHE_ATTACHMENT_TAG })).length,
    0,
  )
}

/** 急救入口的占用拦截：分析阶段就拦（files-mount / vm / 其它工具一视同仁）。 */
async function testAnalyzeRejectsWhenImageOccupied(): Promise<void> {
  await resetFiles()
  await createDisk('/user/busy.img')
  await appendCache('/user/busy.img', 0, [4, 4])

  await claimDiskImagePath('/user/busy.img', { kind: 'files-mount', id: 'image:busy' })
  await assert.rejects(() => analyzeVirtualMachineDiskCache('/user/busy.img'), /挂载/)
  releaseDiskImagePath('/user/busy.img', { kind: 'files-mount', id: 'image:busy' })

  await claimDiskImagePath('/user/busy.img', { kind: 'vm', id: 'vm-x' })
  await assert.rejects(() => analyzeVirtualMachineDiskCache('/user/busy.img'), /虚拟机/)
  releaseDiskImagePath('/user/busy.img', { kind: 'vm', id: 'vm-x' })

  await claimDiskImagePath('/user/busy.img', { kind: 'app', id: 'tool-x', label: '刻录工具' })
  await assert.rejects(() => analyzeVirtualMachineDiskCache('/user/busy.img'), /使用/)
  releaseDiskImagePath('/user/busy.img', { kind: 'app', id: 'tool-x', label: '刻录工具' })

  // 占用释放后照常分析，且拦截没有动缓存
  const report = await analyzeVirtualMachineDiskCache('/user/busy.img')
  assert.ok(report)
  assert.equal(report.cacheBytes, 4096)
  await discardVirtualMachineDiskCache('/user/busy.img')
}

await testAnalyzeMergeDiscardLifecycle()
await testAnalyzeMergesOverlappingRecords()
await testAbortKeepsCacheAndImage()
await testAbortBetweenSegmentsKeepsRemainder()
await testMergeRejectsWhenVmOccupies()
await testDiscardRejectsWhenVmOccupies()
await testDiscardWithoutCacheIsNoop()
await testAnalyzeRejectsWhenImageOccupied()
console.log('virtual-machine-disk-first-aid.test.ts ok')
