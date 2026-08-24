/**
 * 磁盘镜像抹掉 / 分区：内存缓冲上 mkfs，再用 FatImageVolume 挂载验证。
 * 运行：node --experimental-strip-types src/apps/disk-utility/disk-utility-format.test.ts
 */
import assert from 'node:assert/strict'
import { FatImageVolume, type ImageDiskIo } from '../files/files-image-fat-volume.ts'
import {
  eraseDiskBuffer,
  formatPartitionBuffer,
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

testRecommend()
await testFat12Superfloppy()
await testFat16Mbr()
await testFat32Explicit()
await testTwoPartitions()
await testFormatExistingPartition()
console.log('disk-utility-format.test.ts ok')
