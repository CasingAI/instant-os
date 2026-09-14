/**
 * 开机前残留缓存处理（resolveLeftoverDiskCacheBeforeBoot）的单测：
 * 检测跳过条件与 merge / discard / first-aid / keep 四个分支。
 * 走真（VFS 附加）缓存后端；镜像与 OPFS 用内存实现。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-leftover-cache.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { filesCreateBinary, filesReadBlobRange } from '../files/files-api.ts'
import { resetFilesDbForTests } from '../files/files-storage.ts'
import { invalidateFilesVfsPathCaches } from '../files/files-vfs.ts'
import { resetOpfsBlobsForTests, useMemoryOpfsForTests } from '../files/files-opfs-blobs.ts'
import {
  claimDiskImagePath,
  resetDiskImageOccupancyForTests,
} from '../files/files-disk-image-occupancy.ts'
import {
  openDiskOverlayStore,
  resetDiskOverlayStoreForTests,
} from './virtual-machine-disk-overlay-store.ts'
import { analyzeVirtualMachineDiskCache } from './virtual-machine-disk-first-aid.ts'
import { resolveLeftoverDiskCacheBeforeBoot } from './virtual-machine-leftover-cache.ts'
import type {
  VirtualMachineRecord,
  VmDiskWriteModeId,
  VmStorageDevice,
} from './virtual-machine-types.ts'

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

function makeMachine(
  devices: VmStorageDevice[],
  diskWriteMode: VmDiskWriteModeId = 'poweroff',
): VirtualMachineRecord {
  // 编排层只读 diskWriteMode 与 devices，其余字段与本组用例无关
  return { diskWriteMode, devices } as unknown as VirtualMachineRecord
}

function hdd(path: string): VmStorageDevice {
  return { id: `d-${path}`, type: 'hdd', source: 'local', path }
}

async function testNoCacheNeverAsks(): Promise<void> {
  await resetFiles()
  await createDisk('/user/clean.img')
  let asked = 0
  const outcome = await resolveLeftoverDiskCacheBeforeBoot(makeMachine([hdd('/user/clean.img')]), async () => {
    asked += 1
    return 'merge'
  })
  assert.equal(outcome, 'proceed')
  assert.equal(asked, 0)
}

async function testLiveModeSkipsDetection(): Promise<void> {
  await resetFiles()
  await createDisk('/user/live.img')
  await appendCache('/user/live.img', 0, [1, 2, 3, 4])
  let asked = 0
  const outcome = await resolveLeftoverDiskCacheBeforeBoot(
    makeMachine([hdd('/user/live.img')], 'live'),
    async () => {
      asked += 1
      return 'discard'
    },
  )
  // live 档的残留由注册磁盘流时自动合并，这里不问也不动
  assert.equal(outcome, 'proceed')
  assert.equal(asked, 0)
  assert.ok(await analyzeVirtualMachineDiskCache('/user/live.img'))
  assert.deepEqual(await readRange('/user/live.img', 0, 4), [0x11, 0x11, 0x11, 0x11])
}

async function testKeepLeavesCacheUntouched(): Promise<void> {
  await resetFiles()
  await createDisk('/user/keep.img')
  await appendCache('/user/keep.img', 0, [5, 5, 5, 5])
  const outcome = await resolveLeftoverDiskCacheBeforeBoot(
    makeMachine([hdd('/user/keep.img')]),
    async () => 'keep',
  )
  assert.equal(outcome, 'proceed')
  assert.ok(await analyzeVirtualMachineDiskCache('/user/keep.img'))
  assert.deepEqual(await readRange('/user/keep.img', 0, 4), [0x11, 0x11, 0x11, 0x11])
}

async function testFirstAidAbortsBootWithoutTouchingCache(): Promise<void> {
  await resetFiles()
  await createDisk('/user/aid.img')
  await appendCache('/user/aid.img', 0, [6, 6, 6, 6])
  const outcome = await resolveLeftoverDiskCacheBeforeBoot(
    makeMachine([hdd('/user/aid.img')]),
    async () => 'first-aid',
  )
  // 取消开机且缓存原样保留：镜像若被这次开机占用，磁盘工具就处理不了了
  assert.equal(outcome, 'abort')
  assert.ok(await analyzeVirtualMachineDiskCache('/user/aid.img'))
  assert.deepEqual(await readRange('/user/aid.img', 0, 4), [0x11, 0x11, 0x11, 0x11])
}

async function testMergeWritesIntoImageThenProceeds(): Promise<void> {
  await resetFiles()
  await createDisk('/user/merge.img')
  await appendCache('/user/merge.img', 0, [9, 9, 9, 9])
  await appendCache('/user/merge.img', 1024, [7, 7])
  const progresses: { mergedBytes: number; totalBytes: number }[] = []
  const outcome = await resolveLeftoverDiskCacheBeforeBoot(
    makeMachine([hdd('/user/merge.img')]),
    async () => 'merge',
    (info) => progresses.push(info),
  )
  assert.equal(outcome, 'proceed')
  assert.deepEqual(await readRange('/user/merge.img', 0, 4), [9, 9, 9, 9])
  assert.deepEqual(await readRange('/user/merge.img', 1024, 2), [7, 7])
  assert.equal(await analyzeVirtualMachineDiskCache('/user/merge.img'), undefined)
  assert.ok(progresses.length > 0)
  assert.equal(progresses.at(-1)?.mergedBytes, progresses.at(-1)?.totalBytes)
}

async function testDiscardDropsCacheWithoutTouchingImage(): Promise<void> {
  await resetFiles()
  await createDisk('/user/drop.img')
  await appendCache('/user/drop.img', 0, [3, 3, 3, 3])
  const outcome = await resolveLeftoverDiskCacheBeforeBoot(
    makeMachine([hdd('/user/drop.img')]),
    async () => 'discard',
  )
  assert.equal(outcome, 'proceed')
  assert.equal(await analyzeVirtualMachineDiskCache('/user/drop.img'), undefined)
  assert.deepEqual(await readRange('/user/drop.img', 0, 4), [0x11, 0x11, 0x11, 0x11])
}

async function testMultiDiskReportsOnceAndMergesAll(): Promise<void> {
  await resetFiles()
  await createDisk('/user/hda.img')
  await createDisk('/user/hdb.img')
  await appendCache('/user/hda.img', 0, [1, 1])
  await appendCache('/user/hdb.img', 0, [2, 2])
  const seen: string[][] = []
  const outcome = await resolveLeftoverDiskCacheBeforeBoot(
    makeMachine([hdd('/user/hda.img'), hdd('/user/hdb.img')]),
    async (reports) => {
      seen.push(reports.map((report) => report.imagePath))
      return 'merge'
    },
  )
  // 多盘残留一次询问、统一执行，不逐盘弹窗
  assert.deepEqual(seen, [['/user/hda.img', '/user/hdb.img']])
  assert.equal(outcome, 'proceed')
  assert.deepEqual(await readRange('/user/hda.img', 0, 2), [1, 1])
  assert.deepEqual(await readRange('/user/hdb.img', 0, 2), [2, 2])
}

async function testUnanalyzableDiskPassesAsNoLeftover(): Promise<void> {
  await resetFiles()
  // 路径不存在：分析失败按无残留放行，开机冲突由开机流程自身报错
  let asked = 0
  const outcome = await resolveLeftoverDiskCacheBeforeBoot(
    makeMachine([hdd('/user/missing.img')]),
    async () => {
      asked += 1
      return 'merge'
    },
  )
  assert.equal(outcome, 'proceed')
  assert.equal(asked, 0)
}

async function testMergeFailurePropagates(): Promise<void> {
  await resetFiles()
  await createDisk('/user/fail.img')
  await appendCache('/user/fail.img', 0, [4, 4, 4, 4])
  // 分析通过后才被别的工具占用（合并的占用前置检查会拒绝）：错误必须抛给调用方
  // 中止开机，不能带着失败的合并照开
  const pending = resolveLeftoverDiskCacheBeforeBoot(
    makeMachine([hdd('/user/fail.img')]),
    async () => {
      await claimDiskImagePath('/user/fail.img', { kind: 'app', id: 'other-tool', label: '其它工具' })
      return 'merge'
    },
  )
  await assert.rejects(pending)
  resetDiskImageOccupancyForTests()
}

await testNoCacheNeverAsks()
await testLiveModeSkipsDetection()
await testKeepLeavesCacheUntouched()
await testFirstAidAbortsBootWithoutTouchingCache()
await testMergeWritesIntoImageThenProceeds()
await testDiscardDropsCacheWithoutTouchingImage()
await testMultiDiskReportsOnceAndMergesAll()
await testUnanalyzableDiskPassesAsNoLeftover()
await testMergeFailurePropagates()
console.log('virtual-machine-leftover-cache.test.ts ok')
