/**
 * FAT32：近满卷全表扫描不得撞预取上限；失败/中途 abort 须清临时文件并归还簇。
 * 运行：node --experimental-strip-types src/apps/files/files-image-fat32.test.ts
 */
import assert from 'node:assert/strict'
import {
  createFat32Image,
  createFat32NearlyFullWideFatImage,
} from './files-image-fat32-fixture.ts'
import { FatImageVolume, type ImageDiskIo } from './files-image-fat-volume.ts'

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

function tracingReads(bytes: Uint8Array): {
  io: ImageDiskIo
  reads: { offset: number; length: number }[]
} {
  const reads: { offset: number; length: number }[] = []
  return {
    reads,
    io: {
      size: bytes.byteLength,
      async read(offset, length) {
        reads.push({ offset, length })
        return bytes.slice(offset, offset + length)
      },
      async write(offset, data) {
        bytes.set(data, offset)
      },
    },
  }
}

function leftoverWorkFiles(names: readonly string[]): string[] {
  return names.filter((name) => name.includes('__instant-w__'))
}

async function testFat32MountAndFsInfo(): Promise<void> {
  const volume = new FatImageVolume(memoryDisk(createFat32Image()))
  await volume.prepare()
  const info = await volume.getFsInfo()
  assert.equal(info.fsType, 'FAT32')
  assert.equal(info.totalBytes > 0, true)
  assert.equal(info.usedBytes + info.freeBytes, info.totalBytes)
  await volume.writeFile('hello.txt', new TextEncoder().encode('fat32'))
  const got = new TextDecoder().decode(await volume.readFile('hello.txt'))
  assert.equal(got, 'fat32')
  await volume.close()
}

async function testWideFatPrefetchThenDiskFull(): Promise<void> {
  const image = createFat32NearlyFullWideFatImage({ fatSectors: 800, freeClusters: 8 })
  const tracer = tracingReads(image)
  const volume = new FatImageVolume(tracer.io)
  await volume.prepare()
  const readsAfterMount = tracer.reads.length
  const info = await volume.getFsInfo()
  assert.equal(info.fsType, 'FAT32')
  assert.equal(info.freeBytes, 8 * info.clusterBytes)
  // 挂载已预填整张 FAT，全表扫描不应再补页
  assert.equal(tracer.reads.length, readsAfterMount)

  const tooBig = 32 * info.clusterBytes
  await assert.rejects(
    () => volume.streamWriteFile('overflow.bin', { isNew: true, expectedSize: tooBig }),
    (error: unknown) => {
      assert.equal(error instanceof Error, true)
      const message = error instanceof Error ? error.message : String(error)
      assert.equal(message.includes('扇区预取次数过多'), false, message)
      assert.match(message, /磁盘空间不足/)
      return true
    },
  )
  const names = (await volume.list('')).map((entry) => entry.name)
  assert.deepEqual(leftoverWorkFiles(names), [])
  assert.equal(names.some((name) => name.toLowerCase() === 'overflow.bin'), false)
  const afterFail = await volume.getFsInfo()
  assert.equal(afterFail.freeBytes, info.freeBytes)
  await volume.close()
}

async function testRepeatedDiskFullDoesNotLeakClusters(): Promise<void> {
  const image = createFat32NearlyFullWideFatImage({ fatSectors: 800, freeClusters: 4 })
  const volume = new FatImageVolume(memoryDisk(image))
  await volume.prepare()
  const before = await volume.getFsInfo()
  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(
      () => volume.streamWriteFile(`fail-${i}.bin`, { isNew: true, expectedSize: 64 * before.clusterBytes }),
      /磁盘空间不足/,
    )
  }
  const after = await volume.getFsInfo()
  assert.equal(after.freeBytes, before.freeBytes)
  const names = (await volume.list('')).map((entry) => entry.name)
  assert.deepEqual(leftoverWorkFiles(names), [])
  await volume.close()
}

async function testAbortClearsTempAndRestoresClusters(): Promise<void> {
  const volume = new FatImageVolume(memoryDisk(createFat32Image()))
  await volume.prepare()
  const empty = await volume.getFsInfo()

  const doomed = await volume.streamWriteFile('doomed.bin', {
    isNew: true,
    expectedSize: 8 * empty.clusterBytes,
  })
  await doomed.write(new Uint8Array(4 * empty.clusterBytes).fill(1))
  await doomed.abort()
  const afterNewAbort = await volume.getFsInfo()
  assert.equal(afterNewAbort.freeBytes, empty.freeBytes)
  assert.equal((await volume.list('')).some((item) => item.name.toLowerCase() === 'doomed.bin'), false)

  await volume.writeFile('keep.bin', new Uint8Array(2048).fill(7))
  const afterKeep = await volume.getFsInfo()
  const overwrite = await volume.streamWriteFile('keep.bin', { isNew: false })
  await overwrite.write(new Uint8Array(1024).fill(9))
  const during = (await volume.list('')).map((entry) => entry.name)
  assert.equal(leftoverWorkFiles(during).length > 0, true)
  await overwrite.abort()
  const names = (await volume.list('')).map((entry) => entry.name)
  assert.deepEqual(leftoverWorkFiles(names), [])
  assert.equal(names.some((name) => name.toLowerCase() === 'keep.bin'), true)
  const restored = await volume.readFile('keep.bin')
  assert.deepEqual(restored, new Uint8Array(2048).fill(7))
  const afterOverwriteAbort = await volume.getFsInfo()
  assert.equal(afterOverwriteAbort.freeBytes, afterKeep.freeBytes)
  await volume.close()
}

await testFat32MountAndFsInfo()
await testWideFatPrefetchThenDiskFull()
await testRepeatedDiskFullDoesNotLeakClusters()
await testAbortClearsTempAndRestoresClusters()
console.log('files-image-fat32.test.ts ok')
