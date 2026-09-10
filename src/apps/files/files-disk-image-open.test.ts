/**
 * 虚拟硬盘打开程序（无窗口）：挂载后定位第一个可浏览分区 / 整盘卷。
 * 运行：node --experimental-strip-types src/apps/files/files-disk-image-open.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { mkfsvfat, fdisk } from 'libmount'
import { layoutEqualPartitions } from '../disk-utility/disk-utility-format.ts'
import { writeMbrPartitionSlots } from './files-image-partition.ts'
import { createFat32Image } from './files-image-fat32-fixture.ts'
import { closeImageMountsByPath, resetImageMountsForTests } from './files-image-mount-store.ts'
import { openDiskImageAndReveal } from './files-disk-image-open.ts'
import { resetImageMountRestoreForTests } from './files-image-actions.ts'
import { resetPersistedImageMountsForTests } from './files-image-mount-persist.ts'
import { filesCreateBinary } from './files-api.ts'

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

function bakeFatVolume(target: Uint8Array, capacityBytes: number, offset: number): void {
  const result = mkfsvfat(capacityBytes, { type: 'FAT32', secPerClus: 1, hiddSec: Math.floor(offset / 512) })
  if (!result) throw new Error('无法创建 FAT32 分区')
  for (const region of result.sectors.zeroRegions) {
    const start = offset + region.i * 512
    target.fill(0, start, start + region.count * 512)
  }
  for (const sector of result.sectors.dataSectors) {
    target.set(sector.data, offset + sector.i * 512)
  }
}

/** 40MB 双 FAT32 分区镜像 */
function createMultiPartitionImage(): Uint8Array {
  const totalSectors = (40 * 1024 * 1024) / 512
  const parts = layoutEqualPartitions(totalSectors, 2)
  const image = new Uint8Array(totalSectors * 512)

  const table = fdisk(
    parts.map((part, i) => ({ active: i === 0, type: 0x0c, relativeSectors: part.start, totalSectors: part.size })),
  )
  const mbr = table.dataSectors[0]?.data
  if (!mbr) throw new Error('MBR 生成失败')
  for (let i = 0; i < parts.length; i += 1) {
    writeMbrPartitionSlots(mbr, [
      { slot: i + 1, active: i === 0, partitionType: 0x0c, startSector: parts[i]!.start, sectorCount: parts[i]!.size },
    ])
  }
  image.set(mbr, 0)
  parts.forEach((part) => bakeFatVolume(image, part.size * 512, part.start * 512))
  return image
}

async function testWholeDiskImageOpensWholeVolume(): Promise<void> {
  await filesCreateBinary('/user/disk.img', createFat32Image().slice().buffer)
  const target = await openDiskImageAndReveal('/user/disk.img')
  // 无分区表：落到整盘卷根 `/media/{key}`（无 :partN 段）
  assert.match(target, /^\/media\/disk[^/:]*$/)
  await cleanup('/user/disk.img')
}

async function testPartitionedImageOpensFirstPartition(): Promise<void> {
  await filesCreateBinary('/user/multi.img', createMultiPartitionImage().slice().buffer)
  const target = await openDiskImageAndReveal('/user/multi.img')
  assert.match(target, /^\/media\/multi[^/]*:part1$/)
  await cleanup('/user/multi.img')
}

async function testMissingFileThrows(): Promise<void> {
  await assert.rejects(
    () => openDiskImageAndReveal('/user/nope.img'),
    /镜像文件不存在/,
  )
}

async function cleanup(path: string): Promise<void> {
  await closeImageMountsByPath(path).catch(() => undefined)
}

async function main(): Promise<void> {
  resetImageMountRestoreForTests()
  resetPersistedImageMountsForTests()
  await resetImageMountsForTests()
  await testWholeDiskImageOpensWholeVolume()
  await testPartitionedImageOpensFirstPartition()
  await testMissingFileThrows()
  console.log('files-disk-image-open.test.ts ok')
}

await main()
