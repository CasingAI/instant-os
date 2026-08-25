/**
 * FAT 镜像挂载：内存卷读写，以及挂上写入、卸载再挂内容仍在。
 * 运行：node --experimental-strip-types src/apps/files/files-image-mount.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { createFat12Image } from './files-image-fat12-fixture.ts'
import { FatImageVolume, SectorCache, adaptFatClusterLayout, adaptFatFileNode, type ImageDiskIo } from './files-image-fat-volume.ts'
import { mountDiskImage, unmountDiskImage, restorePersistedImageMounts, resetImageMountRestoreForTests } from './files-image-actions.ts'
import {
  openImageMount,
  closeImageMount,
  getImageMountReadError,
  listImageMounts,
  resetImageMountsForTests,
} from './files-image-mount-store.ts'
import {
  claimDiskImagePath,
  getDiskImageOccupant,
  releaseDiskImagePath,
  resetDiskImageOccupancyForTests,
} from './files-disk-image-occupancy.ts'
import { resetPersistedImageMountsForTests } from './files-image-mount-persist.ts'
import { resetFilesDbForTests } from './files-storage.ts'
import { invalidateFilesVfsPathCaches, listFilesLocations } from './files-vfs.ts'
import { isImageLocationId } from './files-types.ts'
import { filesLocationPathRoot } from './files-path.ts'
import { openImageStreamWrite } from './files-location-image.ts'
import {
  filesCreateBinary,
  filesCreateText,
  filesList,
  filesMkdir,
  filesReadBlobRange,
  filesReadText,
  filesRemove,
  filesRename,
  filesWriteBytesRange,
  filesWriteText,
} from './files-api.ts'

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

function tracingDisk(bytes: Uint8Array): {
  io: ImageDiskIo
  writes: { offset: number; length: number }[]
  flushCount: { value: number }
  writtenBytes(): number
  clear(): void
} {
  const writes: { offset: number; length: number }[] = []
  const flushCount = { value: 0 }
  return {
    writes,
    flushCount,
    writtenBytes() {
      return writes.reduce((sum, item) => sum + item.length, 0)
    },
    clear() {
      writes.length = 0
      flushCount.value = 0
    },
    io: {
      size: bytes.byteLength,
      async read(offset, length) {
        return bytes.slice(offset, offset + length)
      },
      async write(offset, data) {
        writes.push({ offset, length: data.byteLength })
        bytes.set(data, offset)
      },
      async flush() {
        flushCount.value += 1
      },
    },
  }
}

async function testInMemoryFatVolume(): Promise<void> {
  const bytes = createFat12Image()
  const volume = new FatImageVolume(memoryDisk(bytes))
  await volume.prepare()
  await volume.mkdir('notes')
  await volume.writeFile('notes/hello.txt', new TextEncoder().encode('hello fat'))
  await volume.writeFile('notes/hello.txt', new TextEncoder().encode('hi'))
  await volume.rename('notes/hello.txt', 'notes/hi.txt')
  await volume.writeFile('notes/gone.txt', new TextEncoder().encode('temp'))
  await volume.remove('notes/gone.txt')
  await volume.flush()

  const remounted = new FatImageVolume(memoryDisk(bytes))
  await remounted.prepare()
  const listed = await remounted.list('notes')
  assert.equal(listed.some((entry) => entry.name.toLowerCase() === 'hi.txt'), true)
  assert.equal(listed.some((entry) => entry.name.toLowerCase() === 'gone.txt'), false)
  const text = new TextDecoder().decode(await remounted.readFile('notes/hi.txt'))
  assert.equal(text, 'hi')
}

async function resetFiles(): Promise<void> {
  await resetImageMountsForTests()
  resetDiskImageOccupancyForTests()
  resetPersistedImageMountsForTests()
  resetImageMountRestoreForTests()
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()
}

async function simulateRestart(): Promise<void> {
  await resetImageMountsForTests()
  resetDiskImageOccupancyForTests()
  resetImageMountRestoreForTests()
  invalidateFilesVfsPathCaches()
}

async function testMountWriteUnmountRemount(): Promise<void> {
  await resetFiles()
  const image = createFat12Image()
  await filesCreateBinary(
    '/user/disk.img',
    image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength),
  )
  const mounted = await mountDiskImage('/user/disk.img')
  assert.equal(isImageLocationId(mounted.id), true)
  assert.equal(getDiskImageOccupant('/user/disk.img')?.kind, 'files-mount')
  assert.throws(() => claimDiskImagePath('/user/disk.img', { kind: 'vm', id: 'vm-1' }))
  const root = filesLocationPathRoot(mounted.id)
  await filesMkdir(`${root}/docs`)
  await filesCreateText(`${root}/docs/note.txt`, 'from files app')
  await filesWriteText(`${root}/docs/note.txt`, 'rewritten')
  await filesRename(`${root}/docs/note.txt`, 'memo.txt')
  await filesCreateText(`${root}/docs/gone.txt`, 'temp')
  await filesRemove(`${root}/docs/gone.txt`)
  await unmountDiskImage(mounted.id)
  assert.equal(getDiskImageOccupant('/user/disk.img'), undefined)

  const locationsAfter = await listFilesLocations()
  assert.equal(locationsAfter.some((item) => item.id === mounted.id), false)

  const remounted = await mountDiskImage('/user/disk.img')
  const remountRoot = filesLocationPathRoot(remounted.id)
  const docs = await filesList(`${remountRoot}/docs`)
  assert.equal(docs.some((item) => item.name.toLowerCase() === 'memo.txt'), true)
  assert.equal(docs.some((item) => item.name.toLowerCase() === 'gone.txt'), false)
  const text = await filesReadText(`${remountRoot}/docs/memo.txt`)
  assert.equal(text, 'rewritten')
  await unmountDiskImage(remounted.id)
}

async function testVmOccupancyBlocksMount(): Promise<void> {
  await resetFiles()
  const image = createFat12Image()
  await filesCreateBinary(
    '/user/disk.img',
    image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength),
  )
  const vm = { kind: 'vm' as const, id: 'vm-1' }
  claimDiskImagePath('/user/disk.img', vm)
  await assert.rejects(() => mountDiskImage('/user/disk.img'))
  releaseDiskImagePath('/user/disk.img', vm)
  const mounted = await mountDiskImage('/user/disk.img')
  await unmountDiskImage(mounted.id)
}

async function testUnreadableImageDegradesGracefully(): Promise<void> {
  await resetFiles()
  const blankImage = new Uint8Array(64 * 1024)
  await filesCreateBinary(
    '/user/blank.img',
    blankImage.buffer.slice(blankImage.byteOffset, blankImage.byteOffset + blankImage.byteLength),
  )

  const mounted = await mountDiskImage('/user/blank.img')
  assert.equal(isImageLocationId(mounted.id), true)
  assert.equal(typeof mounted.unreadableReason === 'string' && mounted.unreadableReason.length > 0, true)

  // 占用保持，VM 被拒
  assert.equal(getDiskImageOccupant('/user/blank.img')?.kind, 'files-mount')
  assert.throws(() => claimDiskImagePath('/user/blank.img', { kind: 'vm', id: 'vm-1' }))

  // getImageMountReadError 返回原因
  assert.equal(typeof getImageMountReadError(mounted.id) === 'string', true)

  // 列目录失败，错误信息含原因
  const root = filesLocationPathRoot(mounted.id)
  await assert.rejects(() => filesList(`${root}/`), (err: Error) => {
    assert.equal(typeof getImageMountReadError(mounted.id) === 'string', true)
    return true
  })

  // 卸载后占用释放
  await unmountDiskImage(mounted.id)
  assert.equal(getDiskImageOccupant('/user/blank.img'), undefined)

  // 位置列表中不再包含该 id
  const locationsAfter = await listFilesLocations()
  assert.equal(locationsAfter.some((item) => item.id === mounted.id), false)

  // VM 现在可以正常 claim
  const vm = { kind: 'vm' as const, id: 'vm-1' }
  claimDiskImagePath('/user/blank.img', vm)
  releaseDiskImagePath('/user/blank.img', vm)
}

async function testRemembersMountAcrossRestart(): Promise<void> {
  await resetFiles()
  const image = createFat12Image()
  await filesCreateBinary(
    '/user/disk.img',
    image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength),
  )
  const mounted = await mountDiskImage('/user/disk.img')
  const root = filesLocationPathRoot(mounted.id)
  await filesCreateText(`${root}/keep.txt`, 'stays')

  await simulateRestart()
  assert.equal(listImageMounts().length, 0)

  await restorePersistedImageMounts()
  const remounted = listImageMounts()
  assert.equal(remounted.length, 1)
  assert.equal(remounted[0]?.id, mounted.id)
  assert.equal(remounted[0]?.imagePath, '/user/disk.img')
  const text = await filesReadText(`${root}/keep.txt`)
  assert.equal(text, 'stays')
}

async function testManualUnmountDoesNotRestore(): Promise<void> {
  await resetFiles()
  const image = createFat12Image()
  await filesCreateBinary(
    '/user/disk.img',
    image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength),
  )
  const mounted = await mountDiskImage('/user/disk.img')
  await unmountDiskImage(mounted.id)

  await simulateRestart()
  await restorePersistedImageMounts()
  assert.equal(listImageMounts().length, 0)
  const locations = await listFilesLocations()
  assert.equal(locations.some((item) => item.id === mounted.id), false)
}

async function testRangeReadWriteOnlyTouchesHitClusters(): Promise<void> {
  await resetFiles()
  const image = createFat12Image()
  await filesCreateBinary('/user/disk.img', image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength))
  const mounted = await mountDiskImage('/user/disk.img')
  const root = filesLocationPathRoot(mounted.id)

  const content = new Uint8Array(2048)
  for (let i = 0; i < content.byteLength; i += 1) {
    content[i] = i & 0xff
  }
  await filesCreateBinary(`${root}/data.bin`, content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength))

  const rangeBlob = await filesReadBlobRange(`${root}/data.bin`, 512, 256)
  const rangeBytes = new Uint8Array(await rangeBlob.arrayBuffer())
  assert.equal(rangeBytes.byteLength, 256)
  for (let i = 0; i < 256; i += 1) {
    assert.equal(rangeBytes[i], (512 + i) & 0xff)
  }

  const patch = new Uint8Array(256)
  patch.fill(0xab)
  await filesWriteBytesRange(`${root}/data.bin`, 512, patch.buffer.slice(patch.byteOffset, patch.byteOffset + patch.byteLength))

  const patchedBlob = await filesReadBlobRange(`${root}/data.bin`, 512, 256)
  const patchedBytes = new Uint8Array(await patchedBlob.arrayBuffer())
  assert.deepEqual(patchedBytes, patch)

  const beforePatchBlob = await filesReadBlobRange(`${root}/data.bin`, 0, 512)
  const beforePatchBytes = new Uint8Array(await beforePatchBlob.arrayBuffer())
  assert.equal(beforePatchBytes.byteLength, 512)
  for (let i = 0; i < 512; i += 1) {
    assert.equal(beforePatchBytes[i], i & 0xff)
  }

  const appended = new Uint8Array(256)
  appended.fill(0xcd)
  await filesWriteBytesRange(`${root}/data.bin`, 2048, appended.buffer.slice(appended.byteOffset, appended.byteOffset + appended.byteLength))
  const tailBlob = await filesReadBlobRange(`${root}/data.bin`, 2048, 256)
  const tailBytes = new Uint8Array(await tailBlob.arrayBuffer())
  assert.deepEqual(tailBytes, appended)

  await unmountDiskImage(mounted.id)
}

async function testStreamWriteAppendsByChunk(): Promise<void> {
  await resetFiles()
  const image = createFat12Image()
  await filesCreateBinary('/user/disk.img', image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength))
  const mounted = await mountDiskImage('/user/disk.img')
  const root = filesLocationPathRoot(mounted.id)

  const writer = await openImageStreamWrite({ locationId: mounted.id, parentId: undefined, name: 'stream.bin', isNew: true })
  const chunks: Uint8Array[] = []
  for (let i = 0; i < 8; i += 1) {
    const chunk = new Uint8Array(256)
    chunk.fill(i)
    chunks.push(chunk)
    await writer.write(chunk)
  }
  await writer.close()

  const total = 8 * 256
  const blob = await filesReadBlobRange(`${root}/stream.bin`, 0, total)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  assert.equal(bytes.byteLength, total)
  for (let i = 0; i < 8; i += 1) {
    for (let j = 0; j < 256; j += 1) {
      assert.equal(bytes[i * 256 + j], i)
    }
  }

  await unmountDiskImage(mounted.id)
}

async function testUnmountFlushesDirtySectors(): Promise<void> {
  await resetFiles()
  const image = createFat12Image()
  await filesCreateBinary('/user/disk.img', image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength))
  const mounted = await mountDiskImage('/user/disk.img')
  const root = filesLocationPathRoot(mounted.id)
  await filesCreateText(`${root}/flush.txt`, 'before-unmount')

  await unmountDiskImage(mounted.id)
  const remounted = await mountDiskImage('/user/disk.img')
  const remountRoot = filesLocationPathRoot(remounted.id)
  const text = await filesReadText(`${remountRoot}/flush.txt`)
  assert.equal(text, 'before-unmount')
  await unmountDiskImage(remounted.id)
}

async function testWriteBehindFlushesOnDemand(): Promise<void> {
  const tracer = tracingDisk(createFat12Image())
  const volume = new FatImageVolume(tracer.io)
  await volume.prepare()
  tracer.clear()
  await volume.writeFile('behind.bin', new Uint8Array(512).fill(1))
  assert.equal(tracer.writes.length, 0)
  assert.equal(tracer.flushCount.value, 0)
  await volume.flush()
  assert.ok(tracer.writes.length > 0)
  assert.equal(tracer.flushCount.value, 1)
  await volume.close()
}

async function testRangeWriteOnlyDirtiesHitSectors(): Promise<void> {
  const tracer = tracingDisk(createFat12Image())
  const volume = new FatImageVolume(tracer.io)
  await volume.prepare()
  const content = new Uint8Array(16 * 1024)
  for (let i = 0; i < content.byteLength; i += 1) {
    content[i] = i & 0xff
  }
  await volume.writeFile('span.bin', content)
  await volume.flush()
  tracer.clear()

  const patch = new Uint8Array(256)
  patch.fill(0x5a)
  await volume.writeFileRange('span.bin', 4096, patch)
  assert.equal(tracer.writes.length, 0)
  await volume.flush()

  const flushed = tracer.writtenBytes()
  assert.ok(flushed > 0)
  assert.ok(flushed < content.byteLength / 4)

  const got = await volume.readFileRange('span.bin', 4096, 256)
  assert.deepEqual(got, patch)
  const prefix = await volume.readFileRange('span.bin', 0, 256)
  for (let i = 0; i < 256; i += 1) {
    assert.equal(prefix[i], i & 0xff)
  }
  await volume.close()
}

async function testBlankImageRangeIoAcceptance(): Promise<void> {
  const imageBytes = 1024 * 1024
  const fileBytes = 256 * 1024
  const tracer = tracingDisk(createFat12Image(imageBytes))
  const volume = new FatImageVolume(tracer.io)
  await volume.prepare()

  const content = new Uint8Array(fileBytes)
  for (let i = 0; i < content.byteLength; i += 1) {
    content[i] = (i * 13) & 0xff
  }
  const seqStarted = performance.now()
  await volume.writeFile('bench.bin', content)
  await volume.flush()
  const seqMs = Math.max(1, performance.now() - seqStarted)
  tracer.clear()

  const patch = new Uint8Array(4096)
  patch.fill(0xa5)
  const rangeCount = 16
  const rangeStarted = performance.now()
  for (let i = 0; i < rangeCount; i += 1) {
    const offset = i * 8192
    await volume.writeFileRange('bench.bin', offset, patch)
  }
  await volume.flush()
  const rangeMs = Math.max(1, performance.now() - rangeStarted)
  const rangeWritten = tracer.writtenBytes()
  const rangeIops = (rangeCount / rangeMs) * 1000

  const readCount = 64
  const readStarted = performance.now()
  for (let i = 0; i < readCount; i += 1) {
    const offset = (i * 4096) % (fileBytes - 4096)
    const got = await volume.readFileRange('bench.bin', offset, 4096)
    assert.equal(got.byteLength, 4096)
    if (offset < rangeCount * 8192 && offset % 8192 === 0) {
      assert.equal(got[0], 0xa5)
    }
  }
  const readMs = Math.max(1, performance.now() - readStarted)
  const readIops = (readCount / readMs) * 1000

  const overheadStarted = performance.now()
  await volume.writeFileRange('bench.bin', 128 * 1024, patch.subarray(0, 4096))
  await volume.flush()
  const overheadMs = Math.max(1, performance.now() - overheadStarted)

  console.log(
    [
      `blank FAT range-io seq-write ${fileBytes}B in ${seqMs.toFixed(1)}ms`,
      `range-write ${rangeCount}×4K → ${rangeWritten}B to image, ${rangeIops.toFixed(0)} IOPS`,
      `random-read ${readCount}×4K → ${readIops.toFixed(0)} IOPS`,
      `small-patch overhead ${overheadMs.toFixed(1)}ms`,
    ].join('; '),
  )

  assert.ok(rangeWritten < fileBytes / 2, `局部修改回刷了 ${rangeWritten} 字节，仍接近整份重写`)
  assert.ok(rangeIops >= 50, `局部修改仅 ${rangeIops.toFixed(0)} IOPS`)
  assert.ok(readIops >= 100, `随机 4K 仅 ${readIops.toFixed(0)} IOPS`)
  assert.ok(overheadMs < 200, `小改开销 ${overheadMs.toFixed(1)}ms`)
  await volume.close()
}

async function testFlushFailureKeepsDirtySectors(): Promise<void> {
  const bytes = createFat12Image()
  let failNext = true
  const io: ImageDiskIo = {
    size: bytes.byteLength,
    async read(offset, length) {
      return bytes.slice(offset, offset + length)
    },
    async write(offset, data) {
      if (failNext) {
        failNext = false
        throw new Error('second-write-fails')
      }
      bytes.set(data, offset)
    },
  }
  const volume = new FatImageVolume(io)
  await volume.prepare()
  await volume.writeFile('keep.bin', new Uint8Array(512).fill(7))
  await assert.rejects(() => volume.flush(), /second-write-fails/)
  assert.equal(volume.hasUnflushedSectors(), true)
  await volume.flush()
  assert.equal(volume.hasUnflushedSectors(), false)
  const remounted = new FatImageVolume(memoryDisk(bytes))
  await remounted.prepare()
  const got = await remounted.readFile('keep.bin')
  assert.deepEqual(got, new Uint8Array(512).fill(7))
  await remounted.close()
}

async function testStreamWriteOverwritesWithoutOldTail(): Promise<void> {
  const volume = new FatImageVolume(memoryDisk(createFat12Image()))
  await volume.prepare()
  await volume.writeFile('cover.bin', new Uint8Array(2048).fill(1))
  const writer = await volume.streamWriteFile('cover.bin', { isNew: false })
  await writer.write(new Uint8Array(16).fill(2))
  await writer.close()
  const got = await volume.readFile('cover.bin')
  assert.equal(got.byteLength, 16)
  assert.deepEqual(got, new Uint8Array(16).fill(2))
  await volume.close()
}

async function testStreamWriteOverwriteAbortLeavesEmpty(): Promise<void> {
  const volume = new FatImageVolume(memoryDisk(createFat12Image()))
  await volume.prepare()
  await volume.writeFile('cover.bin', new Uint8Array(2048).fill(1))
  const writer = await volume.streamWriteFile('cover.bin', { isNew: false })
  await writer.write(new Uint8Array(16).fill(2))
  await writer.abort()
  const got = await volume.readFile('cover.bin')
  assert.equal(got.byteLength, 0)
  await volume.close()
}

async function testStreamWriteSerializesWithList(): Promise<void> {
  const volume = new FatImageVolume(memoryDisk(createFat12Image()))
  await volume.prepare()
  const writer = await volume.streamWriteFile('mix.bin', { isNew: true })
  const tasks: Promise<unknown>[] = []
  for (let i = 0; i < 8; i += 1) {
    tasks.push(writer.write(new Uint8Array(256).fill(i)))
    tasks.push(volume.list(''))
  }
  await Promise.all(tasks)
  await writer.close()
  const got = await volume.readFile('mix.bin')
  assert.equal(got.byteLength, 8 * 256)
  for (let i = 0; i < 8; i += 1) {
    assert.equal(got[i * 256], i)
  }
  await volume.close()
}

async function testSectorCacheEvictsCleanKeepsDirty(): Promise<void> {
  const image = new Uint8Array(32 * 1024)
  const io = memoryDisk(image)
  const cache = new SectorCache(image.byteLength, 4 * 512)
  for (let i = 0; i < 24; i += 1) {
    await cache.fill(io, i * 512, 512)
    cache.read(i * 512, 512)
  }
  assert.ok(cache.residentSectorCount <= 4)

  await cache.fill(io, 0, 512)
  cache.write(0, new Uint8Array(512).fill(9))
  for (let i = 1; i < 24; i += 1) {
    await cache.fill(io, i * 512, 512)
  }
  assert.equal(cache.hasSector(0), true)
  assert.equal(cache.dirtySectorCount, 1)
}

async function testFatInternalsAdapterRejectsBadShape(): Promise<void> {
  assert.throws(() => adaptFatFileNode({} as never), /形状不符合预期/)
  assert.throws(() => adaptFatClusterLayout({} as never), /缺少簇内容偏移/)
}

async function testSectorCacheAllDirtyEvictionIsBounded(): Promise<void> {
  const image = new Uint8Array(64 * 1024)
  const io = memoryDisk(image)
  const cache = new SectorCache(image.byteLength, 4 * 512)
  // 全脏：写入远超常驻上限的脏扇区，驱逐应直接返回——既不丢弃脏数据，也不空转扫描
  for (let i = 0; i < 64; i += 1) {
    cache.write(i * 512, new Uint8Array(512).fill(i))
  }
  assert.equal(cache.residentSectorCount, 64)
  assert.equal(cache.dirtySectorCount, 64)

  // 回刷后驱逐恢复工作：常驻降回上限
  await cache.flush(io)
  assert.equal(cache.dirtySectorCount, 0)
  assert.ok(cache.residentSectorCount <= 4)

  // 再补干净扇区：常驻保持在上限内
  for (let i = 0; i < 16; i += 1) {
    await cache.fill(io, i * 512, 512)
  }
  assert.ok(cache.residentSectorCount <= 4)
}

async function testStreamPreallocBackpressure(): Promise<void> {
  const maxResident = 16 * 1024
  const watermark = 4 * 1024
  const cluster = 512
  const image = createFat12Image(512 * 1024)
  const tracer = tracingDisk(image)
  const volume = new FatImageVolume(tracer.io, {
    maxResidentBytes: maxResident,
    inlineFlushDirtyBytes: watermark,
  })
  await volume.prepare()
  tracer.clear()

  const total = 64 * 1024
  const writer = await volume.streamWriteFile('prealloc.bin', { isNew: true, expectedSize: total })
  // 打开（预分配）完成时底层已有镜像写，不必等到 close；脏数据与常驻被压回水位/上限
  assert.ok(tracer.writes.length > 0, '预分配阶段没有触发任务内落盘')
  assert.ok(volume.unflushedBytes <= watermark + 2 * cluster)
  assert.ok(volume.residentSectorCount <= maxResident / cluster + watermark / cluster + 8)

  const chunkCount = total / 4096
  for (let i = 0; i < chunkCount; i += 1) {
    const chunk = new Uint8Array(4096)
    chunk.fill(i)
    await writer.write(chunk)
    assert.ok(volume.unflushedBytes <= watermark + 2 * cluster, `第 ${i} 块写入后脏数据失控`)
  }
  await writer.close()
  await volume.flush()

  // 内容读回用默认缓存的重新挂载卷：顺带验证中途落盘的内容确实持久化
  // （原卷常驻上限小于文件，读路径本就不支持整读超过缓存的文件，与回压无关）
  const remounted = new FatImageVolume(memoryDisk(image))
  await remounted.prepare()
  const got = await remounted.readFile('prealloc.bin')
  assert.equal(got.byteLength, total)
  for (let i = 0; i < chunkCount; i += 1) {
    assert.equal(got[i * 4096], i)
  }
  await remounted.close()
}

async function testLargeWriteFileStreamsBehindBackpressure(): Promise<void> {
  const maxResident = 16 * 1024
  const watermark = 4 * 1024
  const cluster = 512
  const image = createFat12Image(512 * 1024)
  const tracer = tracingDisk(image)
  const volume = new FatImageVolume(tracer.io, {
    maxResidentBytes: maxResident,
    inlineFlushDirtyBytes: watermark,
  })
  await volume.prepare()
  tracer.clear()

  const content = new Uint8Array(48 * 1024)
  for (let i = 0; i < content.byteLength; i += 1) {
    content[i] = i & 0xff
  }
  await volume.writeFile('bulk.bin', content)
  // 整包写中途应有底层写，且不等显式 flush
  assert.ok(tracer.writes.length > 0, '大整包写未走流式回压')
  assert.ok(volume.unflushedBytes <= watermark + 2 * cluster)
  await volume.flush()

  const verify = async (expected: Uint8Array): Promise<void> => {
    const remounted = new FatImageVolume(memoryDisk(image))
    await remounted.prepare()
    const got = await remounted.readFile('bulk.bin')
    assert.equal(got.byteLength, expected.byteLength)
    assert.deepEqual(got, expected)
    await remounted.close()
  }
  await verify(content)

  // 覆盖写同样走流式回压，旧尾内容不残留
  const second = new Uint8Array(32 * 1024).fill(7)
  tracer.clear()
  await volume.writeFile('bulk.bin', second)
  assert.ok(tracer.writes.length > 0)
  await volume.flush()
  await verify(second)
}

async function testInlineFlushFailureKeepsDirty(): Promise<void> {
  const bytes = createFat12Image(256 * 1024)
  let failuresLeft = 1
  const io: ImageDiskIo = {
    size: bytes.byteLength,
    async read(offset, length) {
      return bytes.slice(offset, offset + length)
    },
    async write(offset, data) {
      if (failuresLeft > 0) {
        failuresLeft -= 1
        throw new Error('inline-write-fails')
      }
      bytes.set(data, offset)
    },
  }
  const volume = new FatImageVolume(io, {
    maxResidentBytes: 16 * 1024,
    inlineFlushDirtyBytes: 4 * 1024,
  })
  await volume.prepare()
  // 预分配到水位触发任务内落盘，IO 失败应向上抛出且脏标记保留
  await assert.rejects(
    () => volume.streamWriteFile('fail.bin', { isNew: true, expectedSize: 32 * 1024 }),
    /inline-write-fails/,
  )
  assert.equal(volume.hasUnflushedSectors(), true)
  await volume.flush()
  assert.equal(volume.hasUnflushedSectors(), false)
  await volume.close()
}

async function testTinyResidentPreallocSurvivesMetadataEviction(): Promise<void> {
  // 常驻 4KB（8 扇区）连元数据区都放不下：FAT/目录与数据簇互相挤。
  // 256KB 文件（512 簇）的 FAT 链跨 2 个扇区，写循环走到第二段就会撞上
  // 被挤出的 FAT 扇区——必须靠钉住 + 单簇重试走完，不得整段重跑
  // （旧病：重跑满 80 次报「扇区预取次数过多」，或重跑重拼 pending 写坏内容）。
  const image = createFat12Image(512 * 1024)
  const tracer = tracingDisk(image)
  const volume = new FatImageVolume(tracer.io, {
    maxResidentBytes: 4 * 1024,
    inlineFlushDirtyBytes: 2 * 1024,
  })
  await volume.prepare()
  tracer.clear()

  const total = 256 * 1024
  const writer = await volume.streamWriteFile('tiny.bin', { isNew: true, expectedSize: total })
  const chunkCount = total / 4096
  for (let i = 0; i < chunkCount; i += 1) {
    const chunk = new Uint8Array(4096)
    chunk.fill(i & 0xff)
    await writer.write(chunk)
    assert.ok(volume.unflushedBytes <= 2 * 1024 + 2 * 512, `第 ${i} 块写入后脏数据失控`)
  }
  await writer.close()
  await volume.flush()

  // 用默认缓存的重新挂载卷读回：中途落盘的内容确实持久化且顺序正确
  const remounted = new FatImageVolume(memoryDisk(image))
  await remounted.prepare()
  const got = await remounted.readFile('tiny.bin')
  assert.equal(got.byteLength, total)
  for (let i = 0; i < chunkCount; i += 1) {
    assert.equal(got[i * 4096], i & 0xff)
  }
  await remounted.close()
  await volume.close()
}

async function testBootSectorStaysPinnedUnderPressure(): Promise<void> {
  // 写入远超常驻上限后，数据区之前的元数据（至少引导扇区）仍钉在缓存里不被挤出
  const image = createFat12Image(512 * 1024)
  const volume = new FatImageVolume(memoryDisk(image), {
    maxResidentBytes: 4 * 1024,
    inlineFlushDirtyBytes: 2 * 1024,
  })
  await volume.prepare()
  const writer = await volume.streamWriteFile('pin.bin', { isNew: true, expectedSize: 64 * 1024 })
  await writer.write(new Uint8Array(64 * 1024).fill(5))
  await writer.close()
  await volume.flush()
  assert.equal(volume.hasResidentSector(0), true)
  assert.ok(volume.residentSectorCount <= 9, '常驻未回落，驱逐没发生')
  await volume.close()
}

await testInMemoryFatVolume()
await testMountWriteUnmountRemount()
await testVmOccupancyBlocksMount()
await testUnreadableImageDegradesGracefully()
await testRemembersMountAcrossRestart()
await testManualUnmountDoesNotRestore()
await testRangeReadWriteOnlyTouchesHitClusters()
await testStreamWriteAppendsByChunk()
await testUnmountFlushesDirtySectors()
await testWriteBehindFlushesOnDemand()
await testRangeWriteOnlyDirtiesHitSectors()
await testBlankImageRangeIoAcceptance()
await testFlushFailureKeepsDirtySectors()
await testStreamWriteOverwritesWithoutOldTail()
await testStreamWriteOverwriteAbortLeavesEmpty()
await testStreamWriteSerializesWithList()
await testSectorCacheEvictsCleanKeepsDirty()
await testSectorCacheAllDirtyEvictionIsBounded()
await testStreamPreallocBackpressure()
await testLargeWriteFileStreamsBehindBackpressure()
await testInlineFlushFailureKeepsDirty()
await testTinyResidentPreallocSurvivesMetadataEviction()
await testBootSectorStaysPinnedUnderPressure()
await testFatInternalsAdapterRejectsBadShape()
console.log('files-image-mount.test.ts ok')
