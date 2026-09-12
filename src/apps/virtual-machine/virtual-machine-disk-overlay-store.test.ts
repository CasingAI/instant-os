/**
 * 虚拟机硬盘差量耐久层单测。
 * 运行：node --experimental-strip-types src/apps/virtual-machine/virtual-machine-disk-overlay-store.test.ts
 */
import assert from 'node:assert/strict'
import {
  openDiskOverlayStore,
  overlayStoreHasRecords,
  overlayStoreId,
  replayDiskOverlayStore,
  resetDiskOverlayStoreForTests,
  useMemoryDiskOverlayStoreForTests,
  writeDiskOverlaySnapshot,
} from './virtual-machine-disk-overlay-store.ts'

useMemoryDiskOverlayStoreForTests()

function testOverlayIdsDifferBySnapshot(): void {
  const live = overlayStoreId({ imagePath: '/user/Disks/xp.img' })
  const snap = overlayStoreId({
    imagePath: '/user/Disks/xp.img',
    snapshotPath: '/user/Disks/xp.bin',
  })
  assert.notEqual(live, snap)
  assert.equal(live, overlayStoreId({ imagePath: '/user/Disks/xp.img' }))
}

async function testAppendReplayAndCrashTail(): Promise<void> {
  resetDiskOverlayStoreForTests()
  const key = { imagePath: '/user/a.img' }
  const store = await openDiskOverlayStore(key)
  await store.append(0, new Uint8Array([1, 2, 3, 4]))
  await store.append(512, new Uint8Array([5, 6, 7, 8]))
  const replayed: { offset: number; bytes: number[] }[] = []
  await replayDiskOverlayStore(key, (offset, bytes) => {
    replayed.push({ offset, bytes: [...bytes] })
  })
  assert.deepEqual(replayed, [
    { offset: 0, bytes: [1, 2, 3, 4] },
    { offset: 512, bytes: [5, 6, 7, 8] },
  ])
  assert.equal(await overlayStoreHasRecords(key), true)
}

async function testReplaceAllCompactsAndRemove(): Promise<void> {
  resetDiskOverlayStoreForTests()
  const key = { imagePath: '/user/b.img', snapshotPath: '/user/b.bin' }
  await writeDiskOverlaySnapshot(key, [
    { offset: 8, bytes: new Uint8Array([9, 9]) },
    { offset: 100, bytes: new Uint8Array([1]) },
  ])
  const store = await openDiskOverlayStore(key)
  const records = await store.records()
  assert.equal(records.length, 2)
  assert.equal(records[0]?.offset, 8)
  assert.deepEqual([...(records[0]?.bytes ?? [])], [9, 9])
  await store.remove()
  assert.equal(await overlayStoreHasRecords(key), false)
}

async function testReplayEmptyStore(): Promise<void> {
  resetDiskOverlayStoreForTests()
  const key = { imagePath: '/user/missing.img' }
  assert.equal(await overlayStoreHasRecords(key), false)
  let writes = 0
  await replayDiskOverlayStore(key, () => {
    writes += 1
  })
  assert.equal(writes, 0)
}

testOverlayIdsDifferBySnapshot()
await testAppendReplayAndCrashTail()
await testReplaceAllCompactsAndRemove()
await testReplayEmptyStore()
console.log('virtual-machine-disk-overlay-store.test.ts ok')
