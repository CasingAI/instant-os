/**
 * 磁盘镜像 FAT 修复：修复计划、字节补丁、复扫验证与写入范围约束。
 * 运行：node --experimental-strip-types src/apps/disk-utility/disk-utility-repair.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { createFat12Image } from '../files/files-image-fat12-fixture.ts'
import { createExfatImage } from '../files/files-image-exfat-fixture.ts'
import { createFat32Image } from '../files/files-image-fat32-fixture.ts'
import { FatImageVolume, type ImageDiskIo } from '../files/files-image-fat-volume.ts'
import { filesCreateBinary, filesReadBlob } from '../files/files-api.ts'
import { resetFilesDbForTests } from '../files/files-storage.ts'
import { invalidateFilesVfsPathCaches } from '../files/files-vfs.ts'
import { resetImageMountsForTests } from '../files/files-image-mount-store.ts'
import { resetImageMountRestoreForTests } from '../files/files-image-actions.ts'
import { resetPersistedImageMountsForTests } from '../files/files-image-mount-persist.ts'
import { resetDiskImageOccupancyForTests } from '../files/files-disk-image-occupancy.ts'
import { applyDiskImageRepair, planDiskImageRepair } from './disk-utility-repair.ts'

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

async function putImage(name: string, bytes: Uint8Array): Promise<string> {
  const path = `/user/${name}`
  await filesCreateBinary(
    path,
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  )
  return path
}

async function readImage(path: string): Promise<Uint8Array> {
  return new Uint8Array(await (await filesReadBlob(path)).arrayBuffer())
}

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

function setFat12Entry(image: Uint8Array, cluster: number, value: number, copy = 0): void {
  const fatOffset = (1 + copy) * 512
  const offset = fatOffset + Math.floor((cluster * 3) / 2)
  if ((cluster & 1) === 0) {
    image[offset] = value & 0xff
    image[offset + 1] = (image[offset + 1]! & 0xf0) | ((value >>> 8) & 0x0f)
  } else {
    image[offset] = (image[offset]! & 0x0f) | ((value & 0x0f) << 4)
    image[offset + 1] = (value >>> 4) & 0xff
  }
}

function readFat12Entry(image: Uint8Array, cluster: number, copy = 0): number {
  const fatOffset = (1 + copy) * 512
  const offset = fatOffset + Math.floor((cluster * 3) / 2)
  const pair = image[offset]! | (image[offset + 1]! << 8)
  return cluster % 2 === 0 ? pair & 0x0fff : pair >>> 4
}

function addFat12File(image: Uint8Array, slot: number, cluster: number, size: number): void {
  const offset = 3 * 512 + slot * 32
  writeDirEntry(image, offset, `FILE${slot}   TXT`.slice(0, 11).padEnd(11, ' '), cluster, size, false)
}

function writeDirEntry(
  image: Uint8Array,
  offset: number,
  name: string,
  cluster: number,
  size: number,
  fat32: boolean,
): void {
  image.set(new TextEncoder().encode(name), offset)
  image[offset + 11] = 0x20
  image[offset + 26] = cluster & 0xff
  image[offset + 27] = (cluster >>> 8) & 0xff
  if (fat32) {
    image[offset + 20] = (cluster >>> 16) & 0xff
    image[offset + 21] = (cluster >>> 24) & 0xff
  }
  image[offset + 28] = size & 0xff
  image[offset + 29] = (size >>> 8) & 0xff
  image[offset + 30] = (size >>> 16) & 0xff
  image[offset + 31] = (size >>> 24) & 0xff
}

function readFat12DirEntry(image: Uint8Array, slot: number): { cluster: number; size: number } {
  const offset = 3 * 512 + slot * 32
  return {
    cluster: image[offset + 26]! | (image[offset + 27]! << 8),
    size:
      image[offset + 28]! |
      (image[offset + 29]! << 8) |
      (image[offset + 30]! << 16) |
      ((image[offset + 31]! << 24) >>> 0),
  }
}

function readFat32Layout(image: Uint8Array): {
  reserved: number
  fatCount: number
  fatSizeSectors: number
  rootOffset: number
} {
  const u16 = (offset: number) => image[offset]! | (image[offset + 1]! << 8)
  const u32 = (offset: number) =>
    image[offset]! |
    (image[offset + 1]! << 8) |
    (image[offset + 2]! << 16) |
    ((image[offset + 3]! << 24) >>> 0)
  const reserved = u16(14)
  const fatCount = image[16]!
  const fatSizeSectors = u16(22) || u32(36)
  return { reserved, fatCount, fatSizeSectors, rootOffset: (reserved + fatCount * fatSizeSectors) * 512 }
}

function setFat32Entry(image: Uint8Array, cluster: number, value: number, copy = 0): void {
  const { reserved, fatSizeSectors } = readFat32Layout(image)
  const offset = (reserved + copy * fatSizeSectors) * 512 + cluster * 4
  image[offset] = value & 0xff
  image[offset + 1] = (value >>> 8) & 0xff
  image[offset + 2] = (value >>> 16) & 0xff
  image[offset + 3] = (image[offset + 3]! & 0xf0) | ((value >>> 24) & 0x0f)
}

function readFat32Entry(image: Uint8Array, cluster: number, copy = 0): number {
  const { reserved, fatSizeSectors } = readFat32Layout(image)
  const offset = (reserved + copy * fatSizeSectors) * 512 + cluster * 4
  return (
    image[offset]! |
    (image[offset + 1]! << 8) |
    (image[offset + 2]! << 16) |
    ((image[offset + 3]! << 24) >>> 0)
  ) & 0x0fffffff
}

function addFat32File(image: Uint8Array, slot: number, cluster: number, size: number): void {
  const { rootOffset } = readFat32Layout(image)
  // mkfsvfat 的根目录是空的（无卷标签项），从 slot 0 顺序写；
  // 首字节 0x00 表示目录结束，不能跳过空槽往后写
  writeDirEntry(image, rootOffset + slot * 32, `FILE${slot}   TXT`.slice(0, 11).padEnd(11, ' '), cluster, size, true)
}

function readFat32DirEntry(image: Uint8Array, slot: number): { cluster: number; size: number } {
  const { rootOffset } = readFat32Layout(image)
  const offset = rootOffset + slot * 32
  return {
    cluster: ((image[offset + 20]! | (image[offset + 21]! << 8)) << 16) | (image[offset + 26]! | (image[offset + 27]! << 8)),
    size:
      image[offset + 28]! |
      (image[offset + 29]! << 8) |
      (image[offset + 30]! << 16) |
      ((image[offset + 31]! << 24) >>> 0),
  }
}

function changedOffsets(before: Uint8Array, after: Uint8Array): number[] {
  assert.equal(after.byteLength, before.byteLength)
  const offsets: number[] = []
  for (let i = 0; i < before.byteLength; i += 1) {
    if (before[i] !== after[i]) offsets.push(i)
  }
  return offsets
}

async function testFat12OrphanChainRecovery(): Promise<void> {
  await resetFiles()
  const image = createFat12Image()
  addFat12File(image, 0, 2, 512)
  setFat12Entry(image, 2, 0xfff)
  setFat12Entry(image, 2, 0xfff, 1)
  for (const copy of [0, 1]) {
    setFat12Entry(image, 5, 6, copy)
    setFat12Entry(image, 6, 0xfff, copy)
  }
  const path = await putImage('repair-orphan.img', image)
  const beforePlan = await readImage(path)
  const { report, plan } = await planDiskImageRepair({ path })
  assert.equal(report.status, 'issues')
  assert.ok(plan)
  assert.equal(plan.actions.some((action) => action.kind === 'orphan'), true)
  assert.equal(plan.writes.length > 0, true)
  // 计划阶段只读，不修改镜像
  assert.deepEqual(await readImage(path), beforePlan)

  const result = await applyDiskImageRepair({ plan })
  assert.equal(result.after.status, 'clean')
  assert.equal(result.applied.length, plan.actions.length)
  const after = await readImage(path)
  assert.equal(readFat12Entry(after, 5), 0)
  assert.equal(readFat12Entry(after, 5, 1), 0)
  assert.equal(readFat12Entry(after, 6), 0)
  assert.equal(readFat12Entry(after, 2), 0xfff)
  assert.deepEqual(readFat12DirEntry(after, 0), { cluster: 2, size: 512 })

  const volume = new FatImageVolume(memoryDisk(after))
  await volume.prepare()
  const data = await volume.readFile('FILE0.TXT')
  assert.equal(data.byteLength, 512)
}

async function testFat12CrossLinkTruncation(): Promise<void> {
  await resetFiles()
  const image = createFat12Image()
  addFat12File(image, 0, 2, 512)
  addFat12File(image, 1, 2, 512)
  setFat12Entry(image, 2, 0xfff)
  setFat12Entry(image, 2, 0xfff, 1)
  const path = await putImage('repair-crosslink.img', image)
  const { plan } = await planDiskImageRepair({ path })
  assert.ok(plan)
  assert.equal(plan.actions.some((action) => action.kind === 'cross-link'), true)

  const result = await applyDiskImageRepair({ plan })
  assert.equal(result.after.status, 'clean')
  const after = await readImage(path)
  // 保留第一个引用者，截断后引用者
  assert.deepEqual(readFat12DirEntry(after, 0), { cluster: 2, size: 512 })
  assert.deepEqual(readFat12DirEntry(after, 1), { cluster: 0, size: 0 })
  assert.equal(readFat12Entry(after, 2), 0xfff)
}

async function testFat12CopiesDifferAndOrphanLoop(): Promise<void> {
  await resetFiles()
  const image = createFat12Image()
  setFat12Entry(image, 5, 6)
  setFat12Entry(image, 6, 5)
  setFat12Entry(image, 5, 0xfff, 1)
  const path = await putImage('repair-copies.img', image)
  const { plan } = await planDiskImageRepair({ path })
  assert.ok(plan)
  assert.equal(plan.actions.some((action) => action.kind === 'fat-sync'), true)

  const result = await applyDiskImageRepair({ plan })
  assert.equal(result.after.status, 'clean')
  const after = await readImage(path)
  const copy0 = after.slice(1 * 512, 2 * 512)
  const copy1 = after.slice(2 * 512, 3 * 512)
  assert.deepEqual([...copy1], [...copy0])
  assert.equal(readFat12Entry(after, 5), 0)
  assert.equal(readFat12Entry(after, 6), 0)
}

async function testFat32ChainEndedFree(): Promise<void> {
  await resetFiles()
  // 2MB 镜像只有 4000 簇（< 4085），按簇数规则会被判成 FAT12，需用足够大的 FAT32 镜像
  const image = createFat32Image(64 * 1024 * 1024)
  addFat32File(image, 0, 3, 1024)
  for (const copy of [0, 1]) {
    setFat32Entry(image, 3, 4, copy)
    setFat32Entry(image, 4, 0, copy)
  }
  const path = await putImage('repair-fat32.img', image)
  const { report, plan } = await planDiskImageRepair({ path })
  assert.equal(report.status, 'issues')
  assert.ok(plan)
  assert.equal(report.issues.some((issue) => issue.code === 'chain-ended-free'), true)

  const result = await applyDiskImageRepair({ plan })
  assert.equal(result.after.status, 'clean')
  const after = await readImage(path)
  assert.deepEqual(readFat32DirEntry(after, 0), { cluster: 3, size: 1024 })
  assert.equal(readFat32Entry(after, 3) & 0x0fffffff, 4)
  assert.equal(readFat32Entry(after, 4) & 0x0fffffff, 0x0fffffff)

  const volume = new FatImageVolume(memoryDisk(after))
  await volume.prepare()
  const data = await volume.readFile('FILE0.TXT')
  assert.equal(data.byteLength, 1024)
}

async function testFat12SizeMismatchShrinkAndRelease(): Promise<void> {
  await resetFiles()
  // 大小超出簇链容量：收缩目录项大小
  const shrink = createFat12Image()
  addFat12File(shrink, 0, 2, 1536)
  setFat12Entry(shrink, 2, 3)
  setFat12Entry(shrink, 3, 0xfff)
  setFat12Entry(shrink, 2, 3, 1)
  setFat12Entry(shrink, 3, 0xfff, 1)
  const shrinkPath = await putImage('repair-shrink.img', shrink)
  const shrinkPlan = (await planDiskImageRepair({ path: shrinkPath })).plan
  assert.ok(shrinkPlan)
  const shrinkResult = await applyDiskImageRepair({ plan: shrinkPlan })
  assert.equal(shrinkResult.after.status, 'clean')
  const shrinkAfter = await readImage(shrinkPath)
  assert.deepEqual(readFat12DirEntry(shrinkAfter, 0), { cluster: 2, size: 1024 })
  assert.equal(readFat12Entry(shrinkAfter, 3), 0xfff)

  // 簇链超出文件大小：截断并释放多余簇
  await resetFiles()
  const release = createFat12Image()
  addFat12File(release, 0, 2, 512)
  for (const copy of [0, 1]) {
    setFat12Entry(release, 2, 3, copy)
    setFat12Entry(release, 3, 4, copy)
    setFat12Entry(release, 4, 0xfff, copy)
  }
  const releasePath = await putImage('repair-release.img', release)
  const releasePlan = (await planDiskImageRepair({ path: releasePath })).plan
  assert.ok(releasePlan)
  const releaseResult = await applyDiskImageRepair({ plan: releasePlan })
  assert.equal(releaseResult.after.status, 'clean')
  const releaseAfter = await readImage(releasePath)
  assert.equal(readFat12Entry(releaseAfter, 2), 0xfff)
  assert.equal(readFat12Entry(releaseAfter, 3), 0)
  assert.equal(readFat12Entry(releaseAfter, 4), 0)
  assert.deepEqual(readFat12DirEntry(releaseAfter, 0), { cluster: 2, size: 512 })
}

async function testFat12MissingChainAndInvalidStart(): Promise<void> {
  await resetFiles()
  const image = createFat12Image()
  addFat12File(image, 0, 0, 512)
  addFat12File(image, 1, 999, 512)
  const path = await putImage('repair-dir-entry.img', image)
  const { plan } = await planDiskImageRepair({ path })
  assert.ok(plan)
  assert.equal(plan.actions.filter((action) => action.kind === 'dir-entry').length, 2)

  const result = await applyDiskImageRepair({ plan })
  assert.equal(result.after.status, 'clean')
  const after = await readImage(path)
  assert.deepEqual(readFat12DirEntry(after, 0), { cluster: 0, size: 0 })
  assert.deepEqual(readFat12DirEntry(after, 1), { cluster: 0, size: 0 })
}

async function testUnrepairableStructuralIssues(): Promise<void> {
  await resetFiles()
  // 引导区不可识别：整卷拒绝修复
  const blankPath = await putImage('repair-blank.img', new Uint8Array(64 * 1024))
  const blank = await planDiskImageRepair({ path: blankPath })
  assert.equal(blank.report.status, 'failed')
  assert.equal(blank.plan, undefined)

  // exFAT：不支持扫描，同样没有修复计划
  const exfatPath = await putImage(
    'repair-exfat.img',
    createExfatImage({ sizeBytes: 2 * 1024 * 1024, partitioned: true }),
  )
  const exfat = await planDiskImageRepair({
    path: exfatPath,
    partition: {
      index: 1,
      startBytes: 2048 * 512,
      sizeBytes: 2 * 1024 * 1024,
      typeByte: 0x07,
      typeLabel: 'NTFS/HPFS/exFAT',
      active: false,
    },
  })
  assert.equal(exfat.report.status, 'unsupported')
  assert.equal(exfat.plan, undefined)
}

async function testWritesStayInMetadataRegion(): Promise<void> {
  await resetFiles()
  const image = createFat12Image()
  addFat12File(image, 0, 2, 512)
  addFat12File(image, 1, 2, 512)
  setFat12Entry(image, 2, 0xfff)
  setFat12Entry(image, 2, 0xfff, 1)
  for (const copy of [0, 1]) {
    setFat12Entry(image, 5, 6, copy)
    setFat12Entry(image, 6, 0xfff, copy)
  }
  const path = await putImage('repair-scope.img', image)
  const before = await readImage(path)
  const { plan } = await planDiskImageRepair({ path })
  assert.ok(plan)
  await applyDiskImageRepair({ plan })
  const after = await readImage(path)
  // FAT12 fixture：保留扇区 0，FAT 副本占扇区 1-2，根目录占扇区 3，元数据区 = 前 4 个扇区
  for (const offset of changedOffsets(before, after)) {
    assert.equal(offset < 4 * 512, true, `写入越界到数据区：${offset}`)
  }
}

await testFat12OrphanChainRecovery()
await testFat12CrossLinkTruncation()
await testFat12CopiesDifferAndOrphanLoop()
await testFat32ChainEndedFree()
await testFat12SizeMismatchShrinkAndRelease()
await testFat12MissingChainAndInvalidStart()
await testUnrepairableStructuralIssues()
await testWritesStayInMetadataRegion()
console.log('disk-utility-repair.test.ts ok')
