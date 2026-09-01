/**
 * 磁盘镜像 FAT 错误扫描：只读报告、孤儿簇、占用与取消路径。
 * 运行：node --experimental-strip-types src/apps/disk-utility/disk-utility-scan.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { createFat12Image } from '../files/files-image-fat12-fixture.ts'
import { createExfatImage } from '../files/files-image-exfat-fixture.ts'
import {
  createFat32Image,
  createFat32NearlyFullWideFatImage,
} from '../files/files-image-fat32-fixture.ts'
import { filesCreateBinary, filesReadBlob } from '../files/files-api.ts'
import {
  resetFilesDbForTests,
} from '../files/files-storage.ts'
import { invalidateFilesVfsPathCaches } from '../files/files-vfs.ts'
import { resetImageMountsForTests } from '../files/files-image-mount-store.ts'
import { resetImageMountRestoreForTests } from '../files/files-image-actions.ts'
import { resetPersistedImageMountsForTests } from '../files/files-image-mount-persist.ts'
import {
  claimDiskImagePath,
  releaseDiskImagePath,
  resetDiskImageOccupancyForTests,
} from '../files/files-disk-image-occupancy.ts'
import { eraseDiskBuffer } from './disk-utility-format.ts'
import {
  DISK_SCAN_ITEM_ORDER,
  diskScanResultText,
  initialDiskScanItems,
  isDiskScanClean,
  runDiskImageScan,
  scanItemsForReport,
  type DiskScanReport,
} from './disk-utility-scan.ts'

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

function addFat12File(image: Uint8Array, slot: number, cluster: number, size: number): void {
  const offset = 3 * 512 + slot * 32
  image.set(new TextEncoder().encode(`FILE${slot}   TXT`.slice(0, 11).padEnd(11, ' ')), offset)
  image[offset + 11] = 0x20
  image[offset + 26] = cluster & 0xff
  image[offset + 27] = (cluster >>> 8) & 0xff
  image[offset + 28] = size & 0xff
  image[offset + 29] = (size >>> 8) & 0xff
  image[offset + 30] = (size >>> 16) & 0xff
  image[offset + 31] = (size >>> 24) & 0xff
}

async function testFat12FileChainScan(): Promise<void> {
  await resetFiles()
  const image = createFat12Image()
  addFat12File(image, 0, 2, 512)
  setFat12Entry(image, 2, 0xfff)
  setFat12Entry(image, 2, 0xfff, 1)
  const path = await putImage('fat12-file.img', image)
  const report = await runDiskImageScan({ path })
  assert.equal(report.status, 'clean')
  assert.equal(report.fileCount, 1)
  assert.equal(report.reachableClusters, 1)
}

async function testCrossLinkedClusters(): Promise<void> {
  await resetFiles()
  const image = createFat12Image()
  addFat12File(image, 0, 2, 512)
  addFat12File(image, 1, 2, 512)
  setFat12Entry(image, 2, 0xfff)
  const report = await runDiskImageScan({ path: await putImage('cross-linked.img', image) })
  assert.equal(report.status, 'issues')
  assert.equal(report.issues.some((issue) => issue.code === 'cross-linked-cluster'), true)
}

async function testOrphanLoopAndInvalidLink(): Promise<void> {
  await resetFiles()
  const loopImage = createFat12Image()
  setFat12Entry(loopImage, 5, 6)
  setFat12Entry(loopImage, 6, 5)
  const loopReport = await runDiskImageScan({ path: await putImage('orphan-loop.img', loopImage) })
  assert.equal(loopReport.issues.some((issue) => issue.code === 'orphan-chain-loop'), true)

  await resetFiles()
  const invalidImage = createFat12Image()
  setFat12Entry(invalidImage, 5, 200)
  const invalidReport = await runDiskImageScan({ path: await putImage('orphan-invalid.img', invalidImage) })
  assert.equal(invalidReport.issues.some((issue) => issue.code === 'orphan-invalid-cluster-link'), true)
}

async function testFatCopiesDiffer(): Promise<void> {
  await resetFiles()
  const image = createFat12Image()
  setFat12Entry(image, 5, 0xfff, 1)
  const report = await runDiskImageScan({ path: await putImage('fat-copies-differ.img', image) })
  assert.equal(report.status, 'issues')
  assert.equal(report.issues.some((issue) => issue.code === 'fat-copies-differ'), true)
}

async function testFat12CleanScan(): Promise<void> {
  await resetFiles()
  const image = createFat12Image()
  const before = image.slice()
  const path = await putImage('fat12-clean.img', image)
  const items = initialDiskScanItems()
  const report = await runDiskImageScan({
    path,
    onItemUpdate: (id, state) => {
      items[id] = state
    },
  })
  assert.equal(report.status, 'clean')
  assert.equal(report.fsType, 'FAT12')
  assert.equal(report.totalClusters! > 0, true)
  assert.equal(isDiskScanClean(report), true)
  for (const id of DISK_SCAN_ITEM_ORDER) assert.equal(items[id].status, 'done')
  assert.match(diskScanResultText(report), /FAT12/)
  const after = new Uint8Array(await (await filesReadBlob(path)).arrayBuffer())
  assert.deepEqual(after, before)
}

async function testFat16CleanScan(): Promise<void> {
  await resetFiles()
  const bytes = new Uint8Array(8 * 1024 * 1024)
  eraseDiskBuffer(bytes, { scheme: 'superfloppy', variant: 'FAT16', label: 'FAT16TEST' })
  const path = await putImage('fat16-clean.img', bytes)
  const report = await runDiskImageScan({ path })
  assert.equal(report.fsType, 'FAT16')
  assert.equal(report.status, 'clean')
}

async function testFat32CleanScan(): Promise<void> {
  await resetFiles()
  const path = await putImage('fat32-clean.img', createFat32Image(64 * 1024 * 1024))
  const report = await runDiskImageScan({ path })
  assert.equal(report.fsType, 'FAT32')
  assert.equal(report.status, 'clean')
}

async function testWideFatOrphanSummary(): Promise<void> {
  await resetFiles()
  const image = createFat32NearlyFullWideFatImage({ fatSectors: 800, freeClusters: 8 })
  const before = image.slice()
  const path = await putImage('wide-fat.img', image)
  const report = await runDiskImageScan({ path })
  assert.equal(report.fsType, 'FAT32')
  assert.equal(report.status, 'issues')
  assert.equal(report.freeClusters, 8)
  assert.equal(report.orphanClusters, (report.allocatedClusters ?? 0) - (report.reachableClusters ?? 0))
  assert.equal(report.orphanBytes, (report.orphanClusters ?? 0) * (report.clusterBytes ?? 0))
  const after = new Uint8Array(await (await filesReadBlob(path)).arrayBuffer())
  assert.deepEqual(after, before)
}

async function testOrphanClustersReport(): Promise<void> {
  await resetFiles()
  const bytes = createFat12Image()
  const fatOffset = 512
  const orphanCluster = 5
  const pairOffset = Math.floor((orphanCluster * 3) / 2)
  bytes[fatOffset + pairOffset] = 0xff
  bytes[fatOffset + pairOffset + 1] = (bytes[fatOffset + pairOffset + 1]! & 0xf0) | 0x0f
  const path = await putImage('orphan.img', bytes)
  const report = await runDiskImageScan({ path })
  assert.equal(report.status, 'issues')
  assert.equal(report.issues.some((issue) => issue.code === 'orphan-clusters'), true)
}

async function testExfatUnsupported(): Promise<void> {
  await resetFiles()
  const bytes = createExfatImage({ sizeBytes: 2 * 1024 * 1024, partitioned: true })
  const path = await putImage('exfat.img', bytes)
  const report = await runDiskImageScan({
    path,
    partition: {
      index: 1,
      startBytes: 2048 * 512,
      sizeBytes: 2 * 1024 * 1024,
      typeByte: 0x07,
      typeLabel: 'NTFS/HPFS/exFAT',
      active: false,
    },
  })
  assert.equal(report.status, 'unsupported')
  assert.equal(report.fsType, 'exFAT')
  assert.equal(report.issues.some((issue) => issue.code === 'exfat-unsupported'), true)
}

async function testBlankImageFails(): Promise<void> {
  await resetFiles()
  const path = await putImage('blank.img', new Uint8Array(64 * 1024))
  const report = await runDiskImageScan({ path })
  assert.equal(report.status, 'failed')
  assert.equal(report.issues.some((issue) => issue.code === 'invalid-boot'), true)
}

async function testOccupancyPolicies(): Promise<void> {
  await resetFiles()
  const path = await putImage('occupied.img', createFat12Image())

  claimDiskImagePath(path, { kind: 'files-mount', id: 'image:test' })
  assert.equal((await runDiskImageScan({ path })).status, 'clean')
  releaseDiskImagePath(path, { kind: 'files-mount', id: 'image:test' })

  claimDiskImagePath(path, { kind: 'vm', id: 'vm-test' })
  await assert.rejects(
    () => runDiskImageScan({ path }),
    /虚拟机正在把这份镜像当硬盘使用/,
  )
  releaseDiskImagePath(path, { kind: 'vm', id: 'vm-test' })

  claimDiskImagePath(path, { kind: 'writer-app', id: 'writer-test', label: '写入工具' })
  await assert.rejects(
    () => runDiskImageScan({ path }),
    /正在被「写入工具」使用/,
  )
  releaseDiskImagePath(path, { kind: 'writer-app', id: 'writer-test', label: '写入工具' })
  assert.equal((await runDiskImageScan({ path })).status, 'clean')
}

async function testAbort(): Promise<void> {
  await resetFiles()
  const path = await putImage('abort.img', createFat32Image())
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(() => runDiskImageScan({ path, signal: controller.signal }), /aborted/)
}

function testScanItemsForReport(): void {
  const report: DiskScanReport = {
    path: '/x.img',
    target: '镜像',
    status: 'clean',
    totalBytes: 1024,
    issues: [],
    durationMs: 0,
  }
  const items = scanItemsForReport(report)
  assert.equal(items['read-boot'].status, 'done')
  assert.equal(items.summarize.status, 'done')
}

await testFat12CleanScan()
await testFat12FileChainScan()
await testCrossLinkedClusters()
await testOrphanLoopAndInvalidLink()
await testFatCopiesDiffer()
await testFat16CleanScan()
await testFat32CleanScan()
await testWideFatOrphanSummary()
await testOrphanClustersReport()
await testExfatUnsupported()
await testBlankImageFails()
await testOccupancyPolicies()
await testAbort()
testScanItemsForReport()
console.log('disk-utility-scan.test.ts ok')
