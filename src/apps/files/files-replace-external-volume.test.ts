/**
 * 粘贴「替换」腾名原语单测：替换 = 永久删除旧文件（macOS/Windows/Linux 主流口径，
 * 不进废纸篓），镜像卷与本地卷语义一致。镜像卷曾是重灾区——旧实现 trashNode 直接
 * 抛「外部存储不支持移入废纸篓」导致替换必失败。
 * 运行：node --experimental-strip-types src/apps/files/files-replace-external-volume.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { createFat12Image } from './files-image-fat12-fixture.ts'
import { mountDiskImage, unmountDiskImage, resetImageMountRestoreForTests } from './files-image-actions.ts'
import { resetImageMountsForTests } from './files-image-mount-store.ts'
import { resetDiskImageOccupancyForTests } from './files-disk-image-occupancy.ts'
import { resetPersistedImageMountsForTests } from './files-image-mount-persist.ts'
import { resetFilesDbForTests } from './files-storage.ts'
import { copyNodeTo, invalidateFilesVfsPathCaches, listDirectory, removeNode, resolveNodeByAbsolutePath } from './files-vfs.ts'
import { filesCreateBinary, filesCreateText, filesMkdir, filesReadText, filesStat } from './files-api.ts'
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

  getItem(key: string): string | null {
    return this.map.get(key) ?? null
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

/** 镜像卷替换：删旧腾名 → 按原名拷入，旧文件不进废纸篓、新内容就位 */
async function testImageVolumeReplacePermanentlyDeletes(): Promise<void> {
  await resetFiles()
  const { locationId, root } = await mountTestImage()
  try {
    await filesCreateText(`${root}/vidmini.inf`, 'old driver')
    await filesCreateText('/user/vidmini.inf', 'new driver')
    const source = await resolveNodeByAbsolutePath('/user/vidmini.inf')
    const target = await resolveNodeByAbsolutePath(`${root}/vidmini.inf`)
    assert.ok(source)
    assert.ok(target)

    await removeNode(target.id)

    assert.equal(await filesStat(`${root}/vidmini.inf`), undefined)
    await assertTrashEmpty('镜像卷替换后废纸篓应为空')

    const copied = await copyNodeTo({
      sourceId: source.id,
      destLocationId: locationId,
      destParentId: undefined,
    })
    assert.equal(copied.name, 'vidmini.inf')
    assert.equal(await filesReadText(`${root}/vidmini.inf`), 'new driver')
    await assertTrashEmpty('替换拷入后废纸篓仍应为空')
  } finally {
    await unmountDiskImage(locationId)
  }
  console.log('ok: image volume replace permanently deletes')
}

/** 本地卷替换同样走永久删除（区别于删除键的软删），不产生废纸篓记录 */
async function testLocalVolumeReplacePermanentlyDeletes(): Promise<void> {
  await resetFiles()
  await filesMkdir('/user/staging')
  await filesCreateText('/user/staging/new.txt', 'new')
  await filesCreateText('/user/new.txt', 'old')
  const source = await resolveNodeByAbsolutePath('/user/staging/new.txt')
  const target = await resolveNodeByAbsolutePath('/user/new.txt')
  assert.ok(source)
  assert.ok(target)

  await removeNode(target.id)

  assert.equal(await filesStat('/user/new.txt'), undefined)
  await assertTrashEmpty('本地卷替换不应把旧文件移入废纸篓')

  const copied = await copyNodeTo({
    sourceId: source.id,
    destLocationId: 'local',
    destParentId: undefined,
  })
  assert.equal(copied.name, 'new.txt')
  console.log('ok: local volume replace permanently deletes')
}

await testImageVolumeReplacePermanentlyDeletes()
await testLocalVolumeReplacePermanentlyDeletes()
console.log('files-replace-external-volume.test.ts ok')
