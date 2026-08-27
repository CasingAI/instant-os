/**
 * 单文件覆盖事务回归：替换文件不再「先删后拷」，而是打开目标的覆盖流——
 * 各后端 close 才提交（内部卷切 blob 指针、FAT 镜像卷改名交换、挂载卷 temp+move 交换），
 * abort 只丢弃暂存内容，旧文件在提交前原样。粘贴（overwriteNodeWithSource）与
 * 外部导入的覆盖路径共用这套语义。
 * 覆盖：内部卷 / FAT12 镜像卷 / 挂载卷（mock FSA）三后端的提交与回滚，及无临时残留。
 * 运行：node --experimental-strip-types src/apps/files/files-overwrite-transaction.test.ts
 */
import 'fake-indexeddb/auto'
import './files-mount-test-window.ts'
import assert from 'node:assert/strict'
import { createFat12Image } from './files-image-fat12-fixture.ts'
import { mountDiskImage, unmountDiskImage, resetImageMountRestoreForTests } from './files-image-actions.ts'
import { resetImageMountsForTests } from './files-image-mount-store.ts'
import { resetDiskImageOccupancyForTests } from './files-disk-image-occupancy.ts'
import { resetPersistedImageMountsForTests } from './files-image-mount-persist.ts'
import { resetFilesDbForTests } from './files-storage.ts'
import { addMount, removeMount } from './files-mount-store.ts'
import { invalidateFilesVfsPathCaches, listDirectory, overwriteNodeWithSource, resolveNodeByAbsolutePath } from './files-vfs.ts'
import {
  filesCreateBinary,
  filesCreateText,
  filesList,
  filesOpenStreamWrite,
  filesReadText,
  filesStat,
} from './files-api.ts'
import { filesLocationPathRoot } from './files-path.ts'
import { isImageLocationId } from './files-types.ts'
import { createMockMountRoot } from './files-mount-test-fsa.ts'

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

async function assertNoTempResidue(names: readonly string[], context: string): Promise<void> {
  const residue = names.filter((name) => name.includes('__instant-w__') || name.includes('__instant-old__'))
  assert.deepEqual(residue, [], context)
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

/** 内部卷：覆盖提交换内容，节点身份（id/名）不变，源文件不动 */
async function testInternalVolumeOverwriteCommits(): Promise<void> {
  await resetFiles()
  await filesCreateText('/user/report.txt', 'old body')
  await filesCreateText('/user/incoming.txt', 'new body')
  const target = await resolveNodeByAbsolutePath('/user/report.txt')
  const source = await resolveNodeByAbsolutePath('/user/incoming.txt')
  assert.ok(target)
  assert.ok(source)

  const written = await overwriteNodeWithSource({ targetId: target!.id, sourceId: source!.id })

  assert.equal(written.id, target!.id, '覆盖后节点 id 不变')
  assert.equal(written.name, 'report.txt')
  assert.equal(await filesReadText('/user/report.txt'), 'new body')
  assert.equal((await filesStat('/user/incoming.txt'))?.byteSize, 'new body'.length, '源文件不动')
  console.log('ok: internal volume overwrite commits')
}

/** 内部卷：泵内容中途取消 → 回滚，旧内容原样 */
async function testInternalVolumeOverwriteAbortKeepsOld(): Promise<void> {
  await resetFiles()
  await filesCreateText('/user/report.txt', 'old body')
  // 源超过 1MB：泵完第一块后取消，确保 abort 真正落在事务中途
  const big = 'new body '.padEnd(2 * 1024 * 1024, 'x')
  await filesCreateText('/user/incoming.txt', big)
  const target = await resolveNodeByAbsolutePath('/user/report.txt')
  const source = await resolveNodeByAbsolutePath('/user/incoming.txt')
  assert.ok(target)
  assert.ok(source)
  const controller = new AbortController()

  await assert.rejects(
    () =>
      overwriteNodeWithSource({
        targetId: target!.id,
        sourceId: source!.id,
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
  )
  assert.equal(await filesReadText('/user/report.txt'), 'old body')
  console.log('ok: internal volume overwrite abort keeps old content')
}

/** 镜像卷：覆盖提交经 FAT 改名交换落盘，原名/节点不变，无临时残留、不进废纸篓 */
async function testImageVolumeOverwriteCommits(): Promise<void> {
  await resetFiles()
  const { locationId, root } = await mountTestImage()
  try {
    await filesCreateText(`${root}/vidmini.inf`, 'old driver')
    await filesCreateText('/user/vidmini.inf', 'new driver')
    const target = await resolveNodeByAbsolutePath(`${root}/vidmini.inf`)
    const source = await resolveNodeByAbsolutePath('/user/vidmini.inf')
    assert.ok(target)
    assert.ok(source)

    const written = await overwriteNodeWithSource({ targetId: target!.id, sourceId: source!.id })

    assert.equal(written.id, target!.id, '镜像卷覆盖后节点 id 不变')
    assert.equal(await filesReadText(`${root}/vidmini.inf`), 'new driver')
    const listed = await listDirectory(locationId, undefined)
    assert.deepEqual(listed.map((item) => item.name), ['vidmini.inf'])
    await assertNoTempResidue(listed.map((item) => item.name), '覆盖提交不应残留临时文件')
    await assertTrashEmpty('覆盖提交不产生废纸篓记录')
  } finally {
    await unmountDiskImage(locationId)
  }
  console.log('ok: image volume overwrite commits via rename swap')
}

/** 镜像卷：开局即取消 → 目标完全不被动，无临时残留 */
async function testImageVolumeOverwritePreAbortKeepsOld(): Promise<void> {
  await resetFiles()
  const { locationId, root } = await mountTestImage()
  try {
    await filesCreateText(`${root}/vidmini.inf`, 'old driver')
    await filesCreateText('/user/vidmini.inf', 'new driver')
    const target = await resolveNodeByAbsolutePath(`${root}/vidmini.inf`)
    const source = await resolveNodeByAbsolutePath('/user/vidmini.inf')
    assert.ok(target)
    assert.ok(source)
    const controller = new AbortController()
    controller.abort()

    await assert.rejects(() =>
      overwriteNodeWithSource({
        targetId: target!.id,
        sourceId: source!.id,
        signal: controller.signal,
      }),
    )
    assert.equal(await filesReadText(`${root}/vidmini.inf`), 'old driver')
    const listed = await listDirectory(locationId, undefined)
    assert.deepEqual(listed.map((item) => item.name), ['vidmini.inf'])
    await assertNoTempResidue(listed.map((item) => item.name), '取消不应残留临时文件')
  } finally {
    await unmountDiskImage(locationId)
  }
  console.log('ok: image volume overwrite pre-abort leaves target untouched')
}

/** 挂载卷：覆盖提交（回退路径为覆盖写本体）+ 中断回滚保旧内容，均无临时残留 */
async function testMountVolumeOverwriteTransaction(): Promise<void> {
  await resetFiles()
  const record = await addMount(createMockMountRoot())
  const rootPath = `/mount/${record.id.slice('mount:'.length)}`
  try {
    // 中断回滚：abort 只删暂存文件，旧内容原样
    const aborted = await filesOpenStreamWrite(`${rootPath}/package.json`)
    await aborted.write(new TextEncoder().encode('{"name":"y"}\n'))
    await aborted.abort()
    assert.equal(await filesReadText(`${rootPath}/package.json`), '{"name":"x"}\n')

    // 覆盖提交：换上新内容，节点身份不变
    await filesCreateText('/user/pkg.json', '{"name":"z"}\n')
    const target = await resolveNodeByAbsolutePath(`${rootPath}/package.json`)
    const source = await resolveNodeByAbsolutePath('/user/pkg.json')
    assert.ok(target)
    assert.ok(source)
    const written = await overwriteNodeWithSource({ targetId: target!.id, sourceId: source!.id })
    assert.equal(written.id, target!.id, '挂载卷覆盖后节点 id 不变')
    assert.equal(await filesReadText(`${rootPath}/package.json`), '{"name":"z"}\n')

    const names = (await filesList(rootPath)).map((item) => item.name)
    assert.deepEqual(names.sort(), ['package.json', 'src'])
    await assertNoTempResidue(names, '挂载卷覆盖不应残留临时文件')
  } finally {
    await removeMount(record.id)
  }
  console.log('ok: mount volume overwrite transaction (commit + abort keeps old)')
}

async function main(): Promise<void> {
  await testInternalVolumeOverwriteCommits()
  await testInternalVolumeOverwriteAbortKeepsOld()
  await testImageVolumeOverwriteCommits()
  await testImageVolumeOverwritePreAbortKeepsOld()
  await testMountVolumeOverwriteTransaction()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
