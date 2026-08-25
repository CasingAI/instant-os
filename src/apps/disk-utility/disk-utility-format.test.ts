/**
 * 磁盘镜像抹掉 / 分区：内存缓冲上 mkfs，再用 FatImageVolume 挂载验证。
 * 运行：node --experimental-strip-types src/apps/disk-utility/disk-utility-format.test.ts
 */
import assert from 'node:assert/strict'
import { FatImageVolume, type ImageDiskIo } from '../files/files-image-fat-volume.ts'
import {
  chsGeometry,
  eraseDiskBuffer,
  formatPartitionBuffer,
  lbaToChs,
  partitionDiskBuffer,
  recommendFatVariant,
} from './disk-utility-format.ts'

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

async function assertWritableVolume(bytes: Uint8Array, label: string): Promise<void> {
  const volume = new FatImageVolume(memoryDisk(bytes))
  await volume.prepare()
  await volume.writeFile('hello.txt', new TextEncoder().encode(label))
  await volume.flush()
  const remounted = new FatImageVolume(memoryDisk(bytes))
  await remounted.prepare()
  const text = new TextDecoder().decode(await remounted.readFile('hello.txt'))
  assert.equal(text, label)
}

function readMbrSlots(bytes: Uint8Array): number {
  assert.equal(bytes[510], 0x55)
  assert.equal(bytes[511], 0xaa)
  let count = 0
  for (let slot = 0; slot < 4; slot += 1) {
    const type = bytes[446 + slot * 16 + 4] ?? 0
    if (type !== 0) count += 1
  }
  return count
}

function readMbrSlot(bytes: Uint8Array, slot: number) {
  const off = 446 + slot * 16
  return {
    active: bytes[off] === 0x80,
    startChs: [bytes[off + 1]!, bytes[off + 2]!, bytes[off + 3]!] as [number, number, number],
    type: bytes[off + 4]!,
    endChs: [bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!] as [number, number, number],
    startLba:
      bytes[off + 8]! |
      (bytes[off + 9]! << 8) |
      (bytes[off + 10]! << 16) |
      ((bytes[off + 11]! << 24) >>> 0),
    totalSectors:
      bytes[off + 12]! |
      (bytes[off + 13]! << 8) |
      (bytes[off + 14]! << 16) |
      ((bytes[off + 15]! << 24) >>> 0),
  }
}

function testRecommend(): void {
  assert.equal(recommendFatVariant(64 * 1024), 'FAT12')
  assert.equal(recommendFatVariant(8 * 1024 * 1024), 'FAT16')
  assert.equal(recommendFatVariant(512 * 1024 * 1024), 'FAT32')
}

async function testFat12Superfloppy(): Promise<void> {
  const bytes = new Uint8Array(64 * 1024)
  const type = eraseDiskBuffer(bytes, { scheme: 'superfloppy', variant: 'auto', label: 'TINY' })
  assert.equal(type, 'FAT12')
  await assertWritableVolume(bytes, 'fat12-ok')
}

async function testFat16Mbr(): Promise<void> {
  const bytes = new Uint8Array(8 * 1024 * 1024)
  const type = eraseDiskBuffer(bytes, { scheme: 'mbr', variant: 'auto', label: 'DATA' })
  assert.equal(type, 'FAT16')
  assert.equal(readMbrSlots(bytes), 1)
  await assertWritableVolume(bytes, 'fat16-ok')
}

async function testFat32Explicit(): Promise<void> {
  const bytes = new Uint8Array(16 * 1024 * 1024)
  const type = eraseDiskBuffer(bytes, { scheme: 'mbr', variant: 'FAT32', label: 'BIG' })
  assert.equal(type, 'FAT32')
  assert.equal(readMbrSlots(bytes), 1)
  await assertWritableVolume(bytes, 'fat32-ok')
}

async function testTwoPartitions(): Promise<void> {
  const bytes = new Uint8Array(8 * 1024 * 1024)
  partitionDiskBuffer(bytes, {
    count: 2,
    labels: ['ONE', 'TWO'],
    variant: 'auto',
  })
  assert.equal(readMbrSlots(bytes), 2)
  await assertWritableVolume(bytes, 'part1-ok')
}

async function testFormatExistingPartition(): Promise<void> {
  const bytes = new Uint8Array(8 * 1024 * 1024)
  eraseDiskBuffer(bytes, { scheme: 'mbr', variant: 'auto', label: 'OLD' })
  const start =
    bytes[446 + 8]! |
    (bytes[446 + 9]! << 8) |
    (bytes[446 + 10]! << 16) |
    ((bytes[446 + 11]! << 24) >>> 0)
  const count =
    bytes[446 + 12]! |
    (bytes[446 + 13]! << 8) |
    (bytes[446 + 14]! << 16) |
    ((bytes[446 + 15]! << 24) >>> 0)
  formatPartitionBuffer(
    bytes,
    { index: 1, startBytes: start * 512, sizeBytes: count * 512 },
    { variant: 'auto', label: 'NEW' },
  )
  await assertWritableVolume(bytes, 'reformat-ok')
}

function testChsGeometry(): void {
  // 1342656 sectors ≈ 655.6 MiB，对应用户截图里 DiskGenius 的几何
  assert.deepEqual(chsGeometry(1342656), { heads: 32, spt: 63 })
  // 普通小盘：16 头即可覆盖
  assert.deepEqual(chsGeometry(16384), { heads: 16, spt: 63 })
  // 2 GiB 盘需要磁头倍增到 128 才能把柱面压到 ≤1023
  assert.deepEqual(chsGeometry(4194304), { heads: 128, spt: 63 })
}

function testLbaToChs(): void {
  // 用户截图的磁盘：几何 32/63，分区起止 CHS 应为 (1,0,33) / (665,31,63)
  assert.deepEqual(lbaToChs(2048, 1342656), { c: 1, h: 0, s: 33 })
  assert.deepEqual(lbaToChs(1342655, 1342656), { c: 665, h: 31, s: 63 })
}

function testMbrChsFields(): void {
  // 8 MiB FAT16：16 头/63 扇区，分区可 CHS 表示，类型应为 0x06
  let bytes = new Uint8Array(8 * 1024 * 1024)
  eraseDiskBuffer(bytes, { scheme: 'mbr', variant: 'auto', label: 'DATA' })
  let slot = readMbrSlot(bytes, 0)
  assert.equal(slot.type, 0x06)
  assert.deepEqual(slot.startChs, [0x00, 0x21, 0x02]) // (2,0,33)
  assert.deepEqual(slot.endChs, [0x04, 0x04, 0x10]) // (16,4,4)
  assert.equal(slot.startLba, 2048)

  // 16 MiB FAT32：类型应为 CHS 型 0x0B
  bytes = new Uint8Array(16 * 1024 * 1024)
  eraseDiskBuffer(bytes, { scheme: 'mbr', variant: 'FAT32', label: 'BIG' })
  slot = readMbrSlot(bytes, 0)
  assert.equal(slot.type, 0x0b)
  assert.deepEqual(slot.startChs, [0x00, 0x21, 0x02]) // (2,0,33)
  assert.deepEqual(slot.endChs, [0x08, 0x08, 0x20]) // (32,8,8)
  assert.equal(slot.startLba, 2048)
}

function testFormatPartitionPreservesChs(): void {
  const bytes = new Uint8Array(8 * 1024 * 1024)
  eraseDiskBuffer(bytes, { scheme: 'mbr', variant: 'auto', label: 'OLD' })
  const before = readMbrSlot(bytes, 0)
  formatPartitionBuffer(
    bytes,
    { index: 1, startBytes: before.startLba * 512, sizeBytes: before.totalSectors * 512 },
    { variant: 'auto', label: 'NEW' },
  )
  const after = readMbrSlot(bytes, 0)
  assert.equal(after.type, before.type) // FAT16 CHS 型 0x06
  assert.deepEqual(after.startChs, before.startChs)
  assert.deepEqual(after.endChs, before.endChs)
  assert.equal(after.startLba, before.startLba)
  assert.equal(after.totalSectors, before.totalSectors)
  assert.equal(after.active, before.active)
}

testRecommend()
testChsGeometry()
testLbaToChs()
testMbrChsFields()
testFormatPartitionPreservesChs()
await testFat12Superfloppy()
await testFat16Mbr()
await testFat32Explicit()
await testTwoPartitions()
await testFormatExistingPartition()
console.log('disk-utility-format.test.ts ok')
