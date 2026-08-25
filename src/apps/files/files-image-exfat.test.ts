/**
 * exFAT 镜像卷：内存卷读写、预置文件互读、范围读写、流式写、目录扩容、
 * 空间回收，以及经挂载层（FAT 探测失败 → exFAT 兜底）的 files-api 全链路。
 * 运行：node --experimental-strip-types src/apps/files/files-image-exfat.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import {
  computeExfatNameHash,
  computeExfatSetChecksum,
  ExfatImageVolume,
  parseExfatSuperblock,
  type ImageDiskIo,
} from './files-image-exfat-volume.ts'
import { createExfatImage } from './files-image-exfat-fixture.ts'
import { createFat12Image } from './files-image-fat12-fixture.ts'
import {
  mountDiskImage,
  unmountDiskImage,
  resetImageMountRestoreForTests,
} from './files-image-actions.ts'
import {
  getImageMountReadError,
  resetImageMountsForTests,
} from './files-image-mount-store.ts'
import { resetDiskImageOccupancyForTests } from './files-disk-image-occupancy.ts'
import { resetPersistedImageMountsForTests } from './files-image-mount-persist.ts'
import { resetFilesDbForTests } from './files-storage.ts'
import { invalidateFilesVfsPathCaches } from './files-vfs.ts'
import { filesLocationPathRoot } from './files-path.ts'
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

async function resetFiles(): Promise<void> {
  await resetImageMountsForTests()
  resetDiskImageOccupancyForTests()
  resetPersistedImageMountsForTests()
  resetImageMountRestoreForTests()
  await resetFilesDbForTests()
  invalidateFilesVfsPathCaches()
}

async function testInMemoryExfatVolume(): Promise<void> {
  const bytes = createExfatImage()
  const volume = new ExfatImageVolume(memoryDisk(bytes))
  await volume.prepare()
  await volume.mkdir('notes')
  await volume.writeFile('notes/hello.txt', new TextEncoder().encode('hello exfat'))
  await volume.writeFile('notes/hello.txt', new TextEncoder().encode('hi'))
  await volume.rename('notes/hello.txt', 'notes/hi.txt')
  await volume.writeFile('notes/gone.txt', new TextEncoder().encode('temp'))
  await volume.remove('notes/gone.txt')
  await volume.flush()

  const remounted = new ExfatImageVolume(memoryDisk(bytes))
  await remounted.prepare()
  const listed = await remounted.list('notes')
  assert.equal(listed.some((entry) => entry.name.toLowerCase() === 'hi.txt'), true)
  assert.equal(listed.some((entry) => entry.name.toLowerCase() === 'gone.txt'), false)
  const text = new TextDecoder().decode(await remounted.readFile('notes/hi.txt'))
  assert.equal(text, 'hi')
  const stat = await remounted.stat('notes')
  assert.equal(stat?.kind, 'folder')
}

async function testExfatReadsFixtureFiles(): Promise<void> {
  const longName = `一份很长的文件名-${'长'.repeat(40)}.txt`
  const chained = new Uint8Array(9000)
  for (let i = 0; i < chained.byteLength; i += 1) chained[i] = i & 0xff
  const contiguous = new Uint8Array(5000)
  contiguous.fill(0x7e)
  const bytes = createExfatImage({
    label: 'TESTVOL',
    files: [
      { name: 'readme.md', data: new TextEncoder().encode('# exfat fixture') },
      { name: longName, data: new TextEncoder().encode('long name content') },
      { name: 'chained.bin', data: chained },
      { name: 'contiguous.bin', data: contiguous, noFatChain: true },
      { name: 'empty.txt' },
    ],
  })
  const volume = new ExfatImageVolume(memoryDisk(bytes))
  await volume.prepare()
  const root = await volume.list('')
  assert.equal(root.some((entry) => entry.name === 'readme.md'), true)
  assert.equal(root.some((entry) => entry.name === longName), true)
  assert.equal(root.some((entry) => entry.name === 'chained.bin'), true)
  assert.equal(root.some((entry) => entry.name === 'contiguous.bin'), true)
  assert.equal(root.find((entry) => entry.name === 'chained.bin')?.byteSize, 9000)
  assert.equal(root.find((entry) => entry.name === 'empty.txt')?.byteSize, 0)
  assert.equal(new TextDecoder().decode(await volume.readFile('readme.md')), '# exfat fixture')
  assert.equal(
    new TextDecoder().decode(await volume.readFile(longName)),
    'long name content',
  )
  assert.deepEqual(await volume.readFile('chained.bin'), chained)
  assert.deepEqual(await volume.readFile('contiguous.bin'), contiguous)
  assert.deepEqual(await volume.readFileRange('chained.bin', 4096, 512), chained.subarray(4096, 4608))
  assert.deepEqual(await volume.readFileRange('contiguous.bin', 100, 4096), contiguous.subarray(100, 4196))
  assert.equal(await volume.readFile('empty.txt').then((data) => data.byteLength), 0)
}

async function testExfatRangeWrite(): Promise<void> {
  const bytes = createExfatImage()
  const volume = new ExfatImageVolume(memoryDisk(bytes))
  await volume.prepare()
  const content = new Uint8Array(12000)
  for (let i = 0; i < content.byteLength; i += 1) content[i] = i & 0xff
  await volume.writeFile('data.bin', content)

  const patch = new Uint8Array(256)
  patch.fill(0xab)
  await volume.writeFileRange('data.bin', 5000, patch)
  const patched = await volume.readFile('data.bin')
  assert.equal(patched.byteLength, 12000)
  assert.deepEqual(patched.subarray(5000, 5256), patch)
  assert.equal(patched[4999], 4999 & 0xff)
  assert.equal(patched[5256], 5256 & 0xff)

  // 追加扩展：超过旧文件末尾
  const appended = new Uint8Array(2000)
  appended.fill(0xcd)
  await volume.writeFileRange('data.bin', 12000, appended)
  const grown = await volume.readFile('data.bin')
  assert.equal(grown.byteLength, 14000)
  assert.deepEqual(grown.subarray(12000), appended)
  await volume.flush()

  const remounted = new ExfatImageVolume(memoryDisk(bytes))
  await remounted.prepare()
  const reread = await remounted.readFile('data.bin')
  assert.equal(reread.byteLength, 14000)
  assert.deepEqual(reread.subarray(5000, 5256), patch)
  assert.deepEqual(reread.subarray(12000), appended)
}

async function testExfatStreamWriteAndAbort(): Promise<void> {
  const bytes = createExfatImage()
  const volume = new ExfatImageVolume(memoryDisk(bytes))
  await volume.prepare()

  const writer = await volume.streamWriteFile('stream.bin', {
    isNew: true,
    expectedSize: 9000,
  })
  for (let i = 0; i < 9; i += 1) {
    const chunk = new Uint8Array(1000)
    chunk.fill(i)
    await writer.write(chunk)
  }
  const entry = await writer.close()
  assert.equal(entry.byteSize, 9000)
  const data = await volume.readFile('stream.bin')
  assert.equal(data.byteLength, 9000)
  assert.equal(data[0], 0)
  assert.equal(data[8999], 8)

  // abort 新文件：条目应被撤销
  const doomed = await volume.streamWriteFile('doomed.bin', { isNew: true })
  await doomed.write(new Uint8Array(100).fill(1))
  await doomed.abort()
  assert.equal((await volume.list('')).some((item) => item.name === 'doomed.bin'), false)

  // abort 覆盖已有文件：文件保留但为空（与 FAT 卷语义一致）
  const overwrite = await volume.streamWriteFile('stream.bin', { isNew: false })
  await overwrite.write(new TextEncoder().encode('xx'))
  await overwrite.abort()
  const afterAbort = await volume.stat('stream.bin')
  assert.equal(afterAbort?.byteSize, 0)
  await volume.flush()
}

async function testExfatDirectoryGrowth(): Promise<void> {
  const bytes = createExfatImage()
  const volume = new ExfatImageVolume(memoryDisk(bytes))
  await volume.prepare()
  // 每个集合 2+3 槽（40 字符名）= 160B；40 个 > 单簇 4KB，根目录必须扩容
  const names: string[] = []
  for (let i = 0; i < 40; i += 1) {
    const name = `file-${String(i).padStart(3, '0')}-${'x'.repeat(30)}.txt`
    names.push(name)
    await volume.writeFile(name, new TextEncoder().encode(`content-${i}`))
  }
  const listed = await volume.list('')
  assert.equal(listed.length, names.length)
  await volume.flush()

  const remounted = new ExfatImageVolume(memoryDisk(bytes))
  await remounted.prepare()
  const reread = await remounted.list('')
  assert.equal(reread.length, names.length)
  for (let i = 0; i < names.length; i += 1) {
    assert.equal(reread.some((item) => item.name === names[i]), true, `缺少 ${names[i]}`)
  }
  assert.equal(new TextDecoder().decode(await remounted.readFile(names[7]!)), 'content-7')
}

async function testExfatSpaceReclamation(): Promise<void> {
  const bytes = createExfatImage({ sizeBytes: 256 * 1024 }) // 64 簇左右
  const volume = new ExfatImageVolume(memoryDisk(bytes))
  await volume.prepare()
  const big = new Uint8Array(96 * 1024)
  big.fill(0x11)
  await volume.writeFile('big.bin', big)
  await volume.remove('big.bin')
  // 删除后整卷空间应可再容纳同样大小；位图 / FAT 泄漏会在这里报磁盘空间不足
  const again = new Uint8Array(96 * 1024)
  again.fill(0x22)
  await volume.writeFile('again.bin', again)
  // 覆盖写（先释放旧簇再分配）
  await volume.writeFile('again.bin', new Uint8Array(120 * 1024).fill(0x33))
  const finalRead = await volume.readFile('again.bin')
  assert.equal(finalRead.byteLength, 120 * 1024)
  assert.equal(finalRead[0], 0x33)
  await volume.flush()

  const remounted = new ExfatImageVolume(memoryDisk(bytes))
  await remounted.prepare()
  assert.equal((await remounted.readFile('again.bin')).byteLength, 120 * 1024)
}

async function testExfatRenameAndRemoveGuards(): Promise<void> {
  const bytes = createExfatImage()
  const volume = new ExfatImageVolume(memoryDisk(bytes))
  await volume.prepare()
  await volume.mkdir('a')
  await volume.mkdir('b')
  await volume.writeFile('a/f.txt', new TextEncoder().encode('move me'))
  await volume.rename('a/f.txt', 'b/g.txt')
  assert.equal((await volume.list('a')).length, 0)
  assert.equal(new TextDecoder().decode(await volume.readFile('b/g.txt')), 'move me')
  // 同目录重命名（变长名字，槽数变化）
  await volume.rename('b/g.txt', 'b/a-much-longer-name.txt')
  assert.equal(
    new TextDecoder().decode(await volume.readFile('b/a-much-longer-name.txt')),
    'move me',
  )
  // 目录移入自身应拒绝
  await assert.rejects(() => volume.rename('a', 'a/child'))
  // 非空目录删除应拒绝
  await volume.mkdir('a/nested')
  await volume.remove('a/nested')
  await assert.rejects(() => volume.remove('b'))
  await volume.remove('b/a-much-longer-name.txt')
  await volume.remove('b')
  await volume.flush()

  const remounted = new ExfatImageVolume(memoryDisk(bytes))
  await remounted.prepare()
  assert.equal((await remounted.list('')).some((item) => item.name === 'b'), false)
  assert.equal((await remounted.list('a')).length, 0)
}

async function testExfatWritesValidStructures(): Promise<void> {
  const bytes = createExfatImage()
  const volume = new ExfatImageVolume(memoryDisk(bytes))
  await volume.prepare()
  await volume.writeFile('check.bin', new TextEncoder().encode('payload'))
  await volume.flush()

  // 直接从磁盘字节复核：名字哈希与集合校验和按规范写入
  const sb = parseExfatSuperblock(bytes.subarray(0, 512))!
  const rootOffset = sb.clusterHeapStart
  const root = bytes.subarray(rootOffset, rootOffset + sb.clusterSize)
  assert.equal(root[0], 0x81) // 位图项在最前
  const fileSlotBase = 32 // 位图占第 0 槽，文件集合从第 1 槽开始
  assert.equal(root[fileSlotBase], 0x85)
  const secondaryCount = root[fileSlotBase + 1]!
  const set = root.subarray(fileSlotBase, (fileSlotBase + 1 + secondaryCount) * 32)
  const storedChecksum = set[2]! | (set[3]! << 8)
  const withoutChecksum = set.slice()
  withoutChecksum[2] = 0
  withoutChecksum[3] = 0
  assert.equal(computeExfatSetChecksum(withoutChecksum), storedChecksum)
  const streamBase = fileSlotBase + 32
  const nameLen = root[streamBase + 3]!
  const storedHash = root[streamBase + 4]! | (root[streamBase + 5]! << 8)
  let name = ''
  for (let i = 0; i < nameLen; i += 1) {
    const entry = (fileSlotBase + 64) + Math.floor(i / 15) * 32
    name += String.fromCharCode(root[entry + 2 + (i % 15) * 2]! | (root[entry + 3 + (i % 15) * 2]! << 8))
  }
  assert.equal(name, 'check.bin')
  assert.equal(computeExfatNameHash(name), storedHash)
}

async function testMountExfatThroughFilesApi(): Promise<void> {
  await resetFiles()
  const image = createExfatImage()
  await filesCreateBinary(
    '/user/exfat.img',
    image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength),
  )
  const mounted = await mountDiskImage('/user/exfat.img')
  const root = filesLocationPathRoot(mounted.id)
  await filesMkdir(`${root}/docs`)
  await filesCreateText(`${root}/docs/note.txt`, 'from files app')
  await filesWriteText(`${root}/docs/note.txt`, 'rewritten')
  await filesRename(`${root}/docs/note.txt`, 'memo.txt')
  await filesCreateText(`${root}/docs/gone.txt`, 'temp')
  await filesRemove(`${root}/docs/gone.txt`)
  await unmountDiskImage(mounted.id)

  const remounted = await mountDiskImage('/user/exfat.img')
  const remountRoot = filesLocationPathRoot(remounted.id)
  const docs = await filesList(`${remountRoot}/docs`)
  assert.equal(docs.some((item) => item.name.toLowerCase() === 'memo.txt'), true)
  assert.equal(docs.some((item) => item.name.toLowerCase() === 'gone.txt'), false)
  assert.equal(await filesReadText(`${remountRoot}/docs/memo.txt`), 'rewritten')

  const rangeBlob = await filesReadBlobRange(`${remountRoot}/docs/memo.txt`, 0, 3)
  assert.equal(new TextDecoder().decode(await rangeBlob.arrayBuffer()), 'rew')
  const patch = new TextEncoder().encode('RE')
  await filesWriteBytesRange(
    `${remountRoot}/docs/memo.txt`,
    0,
    patch.buffer.slice(patch.byteOffset, patch.byteOffset + patch.byteLength),
  )
  assert.equal(await filesReadText(`${remountRoot}/docs/memo.txt`), 'REwritten')
  await unmountDiskImage(remounted.id)
}

async function testMountPartitionedExfatImage(): Promise<void> {
  await resetFiles()
  const image = createExfatImage({ partitioned: true, label: 'PTEXFAT' })
  await filesCreateBinary(
    '/user/exfat-part.img',
    image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength),
  )
  const mounted = await mountDiskImage('/user/exfat-part.img')
  assert.equal(typeof getImageMountReadError(mounted.id), 'undefined')
  const root = filesLocationPathRoot(mounted.id)
  await filesCreateText(`${root}/part.txt`, 'partitioned exfat')
  await unmountDiskImage(mounted.id)

  const remounted = await mountDiskImage('/user/exfat-part.img')
  assert.equal(
    await filesReadText(`${filesLocationPathRoot(remounted.id)}/part.txt`),
    'partitioned exfat',
  )
  await unmountDiskImage(remounted.id)
}

async function testMountOrderKeepsFatAndBlankBehavior(): Promise<void> {
  await resetFiles()
  // FAT 镜像仍走 FAT 卷（探测顺序回归）
  const fatImage = createFat12Image()
  await filesCreateBinary(
    '/user/fat.img',
    fatImage.buffer.slice(fatImage.byteOffset, fatImage.byteOffset + fatImage.byteLength),
  )
  const fatMounted = await mountDiskImage('/user/fat.img')
  assert.equal(typeof getImageMountReadError(fatMounted.id), 'undefined')
  await filesCreateText(`${filesLocationPathRoot(fatMounted.id)}/ok.txt`, 'fat still works')
  await unmountDiskImage(fatMounted.id)

  // 空白镜像：仍然优雅降级为 unreadableReason
  const blank = new Uint8Array(64 * 1024)
  await filesCreateBinary(
    '/user/blank.img',
    blank.buffer.slice(blank.byteOffset, blank.byteOffset + blank.byteLength),
  )
  const blankMounted = await mountDiskImage('/user/blank.img')
  assert.equal(
    typeof blankMounted.unreadableReason === 'string' && blankMounted.unreadableReason.length > 0,
    true,
  )
  await unmountDiskImage(blankMounted.id)
}

async function main(): Promise<void> {
  await testInMemoryExfatVolume()
  await testExfatReadsFixtureFiles()
  await testExfatRangeWrite()
  await testExfatStreamWriteAndAbort()
  await testExfatDirectoryGrowth()
  await testExfatSpaceReclamation()
  await testExfatRenameAndRemoveGuards()
  await testExfatWritesValidStructures()
  await testMountExfatThroughFilesApi()
  await testMountPartitionedExfatImage()
  await testMountOrderKeepsFatAndBlankBehavior()
  console.log('files-image-exfat.test.ts ok')
}

await main()
