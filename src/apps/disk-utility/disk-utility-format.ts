/**
 * 磁盘镜像抹掉 / 分区：用 libmount 的 mkfsvfat + fdisk 生成扇区，
 * 再按偏移写入镜像文件。不整盘填零，只覆盖元数据区（引导扇区、FAT、根目录）。
 */
import { fdisk, mkfsvfat, type DiskSectors } from 'libmount'
import { filesReadBlobRange, filesWriteBytesRange } from '../files/files-api.ts'
import {
  getDiskImageOccupant,
  normalizeDiskImagePath,
} from '../files/files-disk-image-occupancy.ts'
import { mountDiskImage } from '../files/files-image-actions.ts'
import { closeImageMount, getImageMountByPath } from '../files/files-image-mount-store.ts'

export type FatVariant = 'FAT12' | 'FAT16' | 'FAT32'
export type DiskScheme = 'mbr' | 'superfloppy'

export const SECTOR_SIZE = 512
const ZERO_CHUNK = 64 * 1024
const RANGE_CHUNK = 1024 * 1024

export type EraseDiskOptions = {
  scheme: DiskScheme
  variant: FatVariant | 'auto'
  label: string
}

export type PartitionDiskOptions = {
  count: number
  labels: string[]
  variant: FatVariant | 'auto'
}

export type FormatPartitionOptions = {
  variant: FatVariant | 'auto'
  label: string
}

export function recommendFatVariant(sizeBytes: number): FatVariant {
  if (sizeBytes <= 4 * 1024 * 1024) return 'FAT12'
  if (sizeBytes < 512 * 1024 * 1024) return 'FAT16'
  return 'FAT32'
}

export function encodeFatLabel(raw: string): Uint8Array {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9_!#$%&'()@^`{}~\- ]/g, '')
    .slice(0, 11)
  const out = new Uint8Array(11).fill(0x20)
  if (!cleaned) return out
  out.set(new TextEncoder().encode(cleaned).subarray(0, 11))
  return out
}

function fatTypeByte(type: string): number {
  if (type === 'FAT12') return 0x01
  if (type === 'FAT16') return 0x0e
  return 0x0c
}

function mkfsOptions(
  variant: FatVariant | 'auto',
  label: string,
  hiddenSectors: number,
): { type?: string; label?: Uint8Array; hiddSec: number } {
  const encoded = encodeFatLabel(label)
  const hasLabel = encoded.some((byte) => byte !== 0x20)
  return {
    type: variant === 'auto' ? undefined : variant,
    label: hasLabel ? encoded : undefined,
    hiddSec: hiddenSectors,
  }
}

function makeFat(capacityBytes: number, variant: FatVariant | 'auto', label: string, hiddenSectors: number) {
  const result = mkfsvfat(capacityBytes, mkfsOptions(variant, label, hiddenSectors))
  if (!result) {
    const wanted = variant === 'auto' ? recommendFatVariant(capacityBytes) : variant
    throw new Error(`无法以 ${wanted} 格式化此容量（${capacityBytes} 字节）`)
  }
  return result
}

function alignmentSectors(totalSectors: number): number {
  if (totalSectors >= 2048 * 3) return 2048
  return 1
}

export function layoutEqualPartitions(
  totalSectors: number,
  count: number,
): Array<{ start: number; size: number }> {
  const clamped = Math.min(4, Math.max(1, Math.floor(count)))
  const align = alignmentSectors(totalSectors)
  const first = Math.min(align, Math.max(1, totalSectors - clamped * 32))
  const usable = totalSectors - first
  if (usable < clamped) {
    throw new Error('镜像太小，无法按该数量分区')
  }
  const nominal = Math.floor(usable / clamped)
  const alignedSize = align > 1 ? Math.max(align, Math.floor(nominal / align) * align) : nominal
  const parts: Array<{ start: number; size: number }> = []
  let start = first
  for (let i = 0; i < clamped; i += 1) {
    const remaining = totalSectors - start
    const isLast = i === clamped - 1
    const size = isLast ? remaining : Math.min(alignedSize, remaining)
    if (size <= 0) {
      throw new Error('分区后空间不足')
    }
    parts.push({ start, size })
    start += size
  }
  return parts
}

export function applyDiskSectorsToBuffer(
  buffer: Uint8Array,
  sectors: DiskSectors,
  volumeByteOffset: number,
): void {
  const sectorSize = sectors.bytsPerSec
  for (const region of sectors.zeroRegions) {
    const start = volumeByteOffset + region.i * sectorSize
    const length = region.count * sectorSize
    buffer.fill(0, start, start + length)
  }
  for (const sector of sectors.dataSectors) {
    const start = volumeByteOffset + sector.i * sectorSize
    buffer.set(sector.data, start)
  }
}

async function writeRange(path: string, offset: number, data: Uint8Array): Promise<void> {
  let cursor = 0
  while (cursor < data.byteLength) {
    const take = Math.min(RANGE_CHUNK, data.byteLength - cursor)
    await filesWriteBytesRange(path, offset + cursor, data.subarray(cursor, cursor + take))
    cursor += take
  }
}

async function applyDiskSectors(
  path: string,
  sectors: DiskSectors,
  volumeByteOffset: number,
): Promise<void> {
  const sectorSize = sectors.bytsPerSec
  const zeros = new Uint8Array(ZERO_CHUNK)
  for (const region of sectors.zeroRegions) {
    let remaining = region.count * sectorSize
    let offset = volumeByteOffset + region.i * sectorSize
    while (remaining > 0) {
      const take = Math.min(remaining, ZERO_CHUNK)
      await writeRange(path, offset, take === ZERO_CHUNK ? zeros : zeros.subarray(0, take))
      offset += take
      remaining -= take
    }
  }
  for (const sector of sectors.dataSectors) {
    await writeRange(path, volumeByteOffset + sector.i * sectorSize, sector.data)
  }
}

export function planEraseDisk(diskSizeBytes: number, options: EraseDiskOptions): {
  steps: Array<{ offset: number; sectors: DiskSectors }>
  fatType: string
} {
  const totalSectors = Math.floor(diskSizeBytes / SECTOR_SIZE)
  if (totalSectors < 32) {
    throw new Error('镜像太小，无法格式化')
  }
  const diskBytes = totalSectors * SECTOR_SIZE

  if (options.scheme === 'superfloppy') {
    const fat = makeFat(diskBytes, options.variant, options.label, 0)
    return { steps: [{ offset: 0, sectors: fat.sectors }], fatType: fat.type }
  }

  const parts = layoutEqualPartitions(totalSectors, 1)
  const part = parts[0]!
  const fat = makeFat(part.size * SECTOR_SIZE, options.variant, options.label, part.start)
  const table = fdisk([
    {
      active: true,
      type: fatTypeByte(fat.type),
      relativeSectors: part.start,
      totalSectors: part.size,
    },
  ])
  return {
    steps: [
      { offset: 0, sectors: table },
      { offset: part.start * SECTOR_SIZE, sectors: fat.sectors },
    ],
    fatType: fat.type,
  }
}

export function planPartitionDisk(diskSizeBytes: number, options: PartitionDiskOptions): {
  steps: Array<{ offset: number; sectors: DiskSectors }>
} {
  const totalSectors = Math.floor(diskSizeBytes / SECTOR_SIZE)
  const parts = layoutEqualPartitions(totalSectors, options.count)
  const steps: Array<{ offset: number; sectors: DiskSectors }> = []
  const tableParts: Array<{
    active: boolean
    type: number
    relativeSectors: number
    totalSectors: number
  }> = []

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!
    const label = options.labels[i] ?? ''
    const fat = makeFat(part.size * SECTOR_SIZE, options.variant, label, part.start)
    tableParts.push({
      active: i === 0,
      type: fatTypeByte(fat.type),
      relativeSectors: part.start,
      totalSectors: part.size,
    })
    steps.push({ offset: part.start * SECTOR_SIZE, sectors: fat.sectors })
  }

  steps.unshift({ offset: 0, sectors: fdisk(tableParts) })
  return { steps }
}

function applyStepsToBuffer(
  buffer: Uint8Array,
  steps: Array<{ offset: number; sectors: DiskSectors }>,
): void {
  for (const step of steps) {
    applyDiskSectorsToBuffer(buffer, step.sectors, step.offset)
  }
}

export function eraseDiskBuffer(buffer: Uint8Array, options: EraseDiskOptions): string {
  const { steps, fatType } = planEraseDisk(buffer.byteLength, options)
  applyStepsToBuffer(buffer, steps)
  return fatType
}

export function partitionDiskBuffer(buffer: Uint8Array, options: PartitionDiskOptions): void {
  const { steps } = planPartitionDisk(buffer.byteLength, options)
  applyStepsToBuffer(buffer, steps)
}

export function formatPartitionBuffer(
  buffer: Uint8Array,
  partition: { index: number; startBytes: number; sizeBytes: number },
  options: FormatPartitionOptions,
): string {
  const hidden = Math.floor(partition.startBytes / SECTOR_SIZE)
  const fat = makeFat(partition.sizeBytes, options.variant, options.label, hidden)
  applyDiskSectorsToBuffer(buffer, fat.sectors, partition.startBytes)
  const slot = partition.index - 1
  if (slot >= 0 && slot < 4 && buffer.byteLength >= 512) {
    buffer[446 + slot * 16 + 4] = fatTypeByte(fat.type)
  }
  return fat.type
}

async function applySteps(
  path: string,
  steps: Array<{ offset: number; sectors: DiskSectors }>,
): Promise<void> {
  for (const step of steps) {
    await applyDiskSectors(path, step.sectors, step.offset)
  }
}

/**
 * 镜像正被文件挂载时先推出再写，写完再挂上；虚拟机占用则拒绝。
 */
export async function withExclusiveImageAccess<T>(
  imagePath: string,
  work: () => Promise<T>,
): Promise<T> {
  const path = normalizeDiskImagePath(imagePath)
  const occupant = getDiskImageOccupant(path)
  if (occupant?.kind === 'vm') {
    throw new Error(`无法修改 ${path}：虚拟机正在把这份镜像当硬盘使用。请先关机或从虚拟机里去掉这块盘。`)
  }
  const mounted = occupant?.kind === 'files-mount' ? getImageMountByPath(path) : undefined
  if (mounted) {
    await closeImageMount(mounted.id)
  }
  let workError: unknown
  let result: T | undefined
  try {
    result = await work()
  } catch (error) {
    workError = error
  }
  if (mounted) {
    try {
      await mountDiskImage(path)
    } catch (error) {
      if (workError === undefined) workError = error
    }
  }
  if (workError !== undefined) throw workError
  return result as T
}

export async function eraseDiskImageFile(
  path: string,
  diskSizeBytes: number,
  options: EraseDiskOptions,
): Promise<void> {
  const { steps } = planEraseDisk(diskSizeBytes, options)
  await applySteps(path, steps)
}

export async function partitionDiskImageFile(
  path: string,
  diskSizeBytes: number,
  options: PartitionDiskOptions,
): Promise<void> {
  const { steps } = planPartitionDisk(diskSizeBytes, options)
  await applySteps(path, steps)
}

export async function formatPartitionInImageFile(
  path: string,
  partition: { index: number; startBytes: number; sizeBytes: number },
  options: FormatPartitionOptions,
): Promise<void> {
  const hidden = Math.floor(partition.startBytes / SECTOR_SIZE)
  const fat = makeFat(partition.sizeBytes, options.variant, options.label, hidden)
  await applyDiskSectors(path, fat.sectors, partition.startBytes)
  const slot = partition.index - 1
  if (slot < 0 || slot > 3) return
  const blob = await filesReadBlobRange(path, 0, SECTOR_SIZE)
  const mbr = new Uint8Array(await blob.arrayBuffer())
  if (mbr.byteLength < SECTOR_SIZE) return
  mbr[446 + slot * 16 + 4] = fatTypeByte(fat.type)
  await filesWriteBytesRange(path, 0, mbr)
}
