/**
 * 多分区镜像挂载：MBR 分区独立成卷、路径解析与锚点级联卸载。
 * 运行：node --experimental-strip-types src/apps/files/files-image-partition-mount.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { mkfsvfat, fdisk } from 'libmount'
import { layoutEqualPartitions } from '../disk-utility/disk-utility-format.ts'
import { writeMbrPartitionSlots } from './files-image-partition.ts'
import { createFat32Image } from './files-image-fat32-fixture.ts'
import { openImageMount, closeImageMountsByPath, listImageMounts } from './files-image-mount-store.ts'
import type { ImageDiskIo } from './files-image-fat-volume.ts'
import { filesLocationPathRoot, parseFilesAbsolutePath } from './files-path.ts'
import { makeImagePartitionLocationId, isImagePartitionLocationId, parseImagePartitionLocationId } from './files-types.ts'
import { getCachedImageMount, getImageVolume } from './files-image-mount-store.ts'

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

/** 把 mkfsvfat 生成的 FAT 卷铺到镜像指定偏移（不整盘填零，只覆盖扇区） */
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

/** 40MB 双 FAT32 分区镜像：分区表 + 两份卷 */
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
  parts.forEach((part, index) => bakeFatVolume(image, part.size * 512, part.start * 512))
  return image
}

async function testPartitionDiscoveryAndIsolation(): Promise<void> {
  const mounted = await openImageMount({
    imagePath: '/user/multi.img',
    fileName: 'multi.img',
    io: memoryDisk(createMultiPartitionImage()),
  })
  try {
    const records = listImageMounts().filter((r) => r.imagePath === '/user/multi.img')
    const anchor = records.find((r) => r.isPartitionAnchor)
    assert.equal(Boolean(anchor), true)
    const parts = records.filter((r) => isImagePartitionLocationId(r.id))
    assert.equal(parts.length, 2)

    const key = parseImagePartitionLocationId(parts[0]!.id)!
    assert.equal(key.partition, 1)
    assert.equal(filesLocationPathRoot(parts[0]!.id), `/media/${key.imageKey}:part1`)

    const root1 = parseFilesAbsolutePath(filesLocationPathRoot(parts[0]!.id))
    const root2 = parseFilesAbsolutePath(filesLocationPathRoot(parts[1]!.id))
    assert.equal(Boolean(root1 && root2), true)
    assert.notEqual(root1!.locationId, root2!.locationId)

    const v1 = getImageVolume(root1!.locationId)
    const v2 = getImageVolume(root2!.locationId)
    await v1.writeFile('only-one.txt', new TextEncoder().encode('partition 1'))
    assert.equal((await v2.list('')).some((e) => e.name === 'only-one.txt'), false)
    assert.equal(
      new TextDecoder().decode(await v1.readFile('only-one.txt')),
      'partition 1',
    )
    assert.equal((await v1.list('')).some((e) => e.name === 'only-one.txt'), true)
  } finally {
    await closeImageMountsByPath('/user/multi.img')
  }
}

async function testPartitionIdHelpers(): Promise<void> {
  const id = makeImagePartitionLocationId('disk', 2)
  assert.equal(id, 'image:disk:part2')
  assert.equal(isImagePartitionLocationId(id), true)
  assert.equal(isImagePartitionLocationId('image:disk'), false)
  assert.equal(parseImagePartitionLocationId(id)?.partition, 2)
  assert.equal(getCachedImageMount(id)?.label, undefined)
}

async function main(): Promise<void> {
  await testPartitionDiscoveryAndIsolation()
  await testPartitionIdHelpers()
  console.log('files-image-partition-mount.test.ts ok')
}

await main()