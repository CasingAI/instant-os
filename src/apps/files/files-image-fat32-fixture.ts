/**
 * 构造可挂载的 FAT32 镜像，供测试使用。
 * 常规卷走 libmount mkfsvfat；近满宽 FAT 卷手工写引导/FAT，
 * 物理镜像只含元数据区和少量数据簇，BPB 仍声明完整簇数，
 * 以便用不到 1MB 的缓冲模拟「整张 FAT 表扫描」。
 */

import { mkfsvfat } from 'libmount'

const SECTOR = 512
const FAT32_EOC = 0x0fffffff
const FAT32_MEDIA = 0x0ffffff8

function w16(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff
  data[offset + 1] = (value >>> 8) & 0xff
}

function w32(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff
  data[offset + 1] = (value >>> 8) & 0xff
  data[offset + 2] = (value >>> 16) & 0xff
  data[offset + 3] = (value >>> 24) & 0xff
}

function applyMkfsSectors(image: Uint8Array, capacity: number): void {
  const result = mkfsvfat(capacity, { type: 'FAT32', secPerClus: 1 })
  if (!result) {
    throw new Error(`无法创建 FAT32 镜像（${capacity} 字节）`)
  }
  for (const region of result.sectors.zeroRegions) {
    const start = region.i * SECTOR
    if (start >= image.byteLength) continue
    const end = Math.min(image.byteLength, start + region.count * SECTOR)
    image.fill(0, start, end)
  }
  for (const sector of result.sectors.dataSectors) {
    const start = sector.i * SECTOR
    if (start >= image.byteLength) continue
    const take = Math.min(sector.data.byteLength, image.byteLength - start)
    image.set(sector.data.subarray(0, take), start)
  }
}

/** 最小可挂载的空 FAT32 卷（默认 2MB、每簇 1 扇区）。 */
export function createFat32Image(sizeBytes = 2 * 1024 * 1024): Uint8Array {
  if (sizeBytes % SECTOR !== 0) {
    throw new Error('镜像大小必须是扇区整数倍')
  }
  const image = new Uint8Array(sizeBytes)
  applyMkfsSectors(image, sizeBytes)
  return image
}

export type Fat32WideFatOptions = {
  /** 单张 FAT 表扇区数；默认 800（> 80×9，旧预取上限必然不够） */
  fatSectors?: number
  /** 真正空闲、可分配的数据簇数；默认 8 */
  freeClusters?: number
}

/**
 * 近满宽 FAT32：FAT 表故意拉得很长，数据区只物理存在根目录 + 少量空闲簇。
 * 其余簇在 FAT 里标成已占用，getFreeClusters 仍会扫完整张表。
 */
export function createFat32NearlyFullWideFatImage(options?: Fat32WideFatOptions): Uint8Array {
  const fatSectors = options?.fatSectors ?? 800
  const freeClusters = options?.freeClusters ?? 8
  const reserved = 32
  const numFATs = 2
  const spc = 1
  const clusterCount = fatSectors * (SECTOR / 4) - 2
  const totSec = reserved + numFATs * fatSectors + clusterCount
  const extraDataSectors = Math.max(16, freeClusters + 8)
  const physicalSectors = reserved + numFATs * fatSectors + extraDataSectors
  const image = new Uint8Array(physicalSectors * SECTOR)

  const writeBoot = (target: Uint8Array) => {
    target[0] = 0xeb
    target[1] = 0x58
    target[2] = 0x90
    target.set(new TextEncoder().encode('LIBMNTJS'), 3)
    w16(target, 11, SECTOR)
    target[13] = spc
    w16(target, 14, reserved)
    target[16] = numFATs
    w16(target, 17, 0)
    w16(target, 19, 0)
    target[21] = 0xf8
    w16(target, 22, 0)
    w16(target, 24, 63)
    w16(target, 26, 255)
    w32(target, 28, 0)
    w32(target, 32, totSec)
    w32(target, 36, fatSectors)
    w16(target, 40, 0)
    w16(target, 42, 0)
    w32(target, 44, 2)
    w16(target, 48, 1)
    w16(target, 50, 6)
    target[64] = 0x80
    target[66] = 0x29
    w32(target, 67, 0x12345678)
    target.set(new TextEncoder().encode('NO NAME    '), 71)
    target.set(new TextEncoder().encode('FAT32   '), 82)
    target[510] = 0x55
    target[511] = 0xaa
  }

  const writeFsInfo = (target: Uint8Array) => {
    w32(target, 0, 0x41615252)
    w32(target, 484, 0x61417272)
    w32(target, 488, 0xffffffff)
    w32(target, 492, 0xffffffff)
    w32(target, 508, 0xaa550000)
  }

  writeBoot(image.subarray(0, SECTOR))
  writeFsInfo(image.subarray(SECTOR, SECTOR * 2))
  image.set(image.subarray(0, SECTOR), 6 * SECTOR)
  image.set(image.subarray(SECTOR, SECTOR * 2), 7 * SECTOR)

  const lastClus = clusterCount + 1
  const firstFree = 3
  const lastFree = firstFree + freeClusters - 1
  for (let fat = 0; fat < numFATs; fat += 1) {
    const base = (reserved + fat * fatSectors) * SECTOR
    w32(image, base, FAT32_MEDIA)
    w32(image, base + 4, 0xffffffff)
    w32(image, base + 8, FAT32_EOC)
    for (let clus = 3; clus <= lastClus; clus += 1) {
      const value = clus >= firstFree && clus <= lastFree ? 0 : FAT32_EOC
      w32(image, base + clus * 4, value)
    }
  }

  return image
}
