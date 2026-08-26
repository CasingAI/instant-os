/**
 * exFAT 镜像卷：内存卷读写、预置文件互读、范围读写、流式写、目录扩容、
 * 空间回收，以及经挂载层（FAT 探测失败 → exFAT 兜底）的 files-api 全链路。
 * 另覆盖：双 FAT 镜像写与 ActiveFat 读取、坏 FAT 被写修复、极端簇大小
 * （512B 簇长链 / 256KB 簇）、超大卷 VBR 解析、NoFatChain 目录连续扩容
 * 与被迫转 FAT 链、DOS 时间戳边界、磁盘工具 exFAT 信息展示。
 * 运行：node --experimental-strip-types src/apps/files/files-image-exfat.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import {
  computeExfatNameHash,
  computeExfatSetChecksum,
  ExfatImageVolume,
  parseExfatDirectory,
  parseExfatSuperblock,
  serializeExfatFileSet,
  type ExfatSuperblock,
  type ImageDiskIo,
} from './files-image-exfat-volume.ts'
import { createExfatImage } from './files-image-exfat-fixture.ts'
import { createFat12Image } from './files-image-fat12-fixture.ts'
import { loadDiskTree } from '../disk-utility/disk-utility-data.ts'
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

const CLUSTER_FIRST = 2
const CLUSTER_EOC = 0xffffffff

function w16le(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff
  data[offset + 1] = (value >>> 8) & 0xff
}

function w32le(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff
  data[offset + 1] = (value >>> 8) & 0xff
  data[offset + 2] = (value >>> 16) & 0xff
  data[offset + 3] = (value >>> 24) & 0xff
}

function w64le(data: Uint8Array, offset: number, value: number): void {
  w32le(data, offset, value % 0x100000000)
  w32le(data, offset + 4, Math.floor(value / 0x100000000))
}

/** 根目录簇的完整字节（superfloppy：簇堆起始即根目录） */
function rootDirData(bytes: Uint8Array, sb: ExfatSuperblock): Uint8Array {
  return bytes.subarray(sb.clusterHeapStart, sb.clusterHeapStart + sb.clusterSize)
}

/** 沿 FAT 链从首簇走到 EOC，返回全部簇号；链断裂或过长抛错 */
function walkFatChain(bytes: Uint8Array, sb: ExfatSuperblock, first: number): number[] {
  const out: number[] = []
  let clu = first
  for (let steps = 0; steps < 100000; steps += 1) {
    out.push(clu)
    const offset = sb.fatStart + clu * 4
    const value =
      (bytes[offset]! |
        (bytes[offset + 1]! << 8) |
        (bytes[offset + 2]! << 16) |
        (bytes[offset + 3]! << 24)) >>>
      0
    if (value === CLUSTER_EOC) return out
    if (value < CLUSTER_FIRST) throw new Error(`FAT 链断裂：簇 ${clu} → ${value}`)
    clu = value
  }
  throw new Error('FAT 链过长')
}

/** 往目录里塞 count 个定长（36 字符，5 槽 160B）文件，足够撑爆单个 4KB 簇；withData=false 建空文件不占数据簇 */
async function fillDirectory(
  volume: ExfatImageVolume,
  dir: string,
  count: number,
  withData = true,
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const name = `f-${String(i).padStart(3, '0')}-${'x'.repeat(26)}.txt`
    const content = withData ? new TextEncoder().encode(`content-${i}`) : new Uint8Array(0)
    await volume.writeFile(`${dir}/${name}`, content)
  }
}

async function testExfatDualFatMirrorAndActiveFat(): Promise<void> {
  const bytes = createExfatImage({ numberOfFats: 2, label: 'DUAL' })
  const volume = new ExfatImageVolume(memoryDisk(bytes))
  await volume.prepare()
  await volume.writeFile('dual.txt', new TextEncoder().encode('dual fat'))
  await volume.flush()

  // 两份 FAT 字节级一致，新文件链写入时镜像到两份
  const sb = parseExfatSuperblock(bytes.subarray(0, 512))!
  const fat0 = bytes.subarray(sb.fatStart, sb.fatStart + sb.fatLength)
  const fat1 = bytes.subarray(sb.fatStart + sb.fatLength, sb.fatStart + 2 * sb.fatLength)
  assert.deepEqual(Array.from(fat0), Array.from(fat1))
  const root = parseExfatDirectory(rootDirData(bytes, sb))
  const node = root.nodes.find((item) => item.name === 'dual.txt')
  assert.ok(node)
  assert.equal(walkFatChain(bytes, sb, node.firstCluster).length, 1)

  // ActiveFat 位翻成 1：读取切到第二份 FAT，重挂载仍可读
  bytes[106] |= 0x01
  const swapped = new ExfatImageVolume(memoryDisk(bytes))
  await swapped.prepare()
  assert.equal(new TextDecoder().decode(await swapped.readFile('dual.txt')), 'dual fat')
}

async function testExfatActiveFat1ReadsViaSecondFatAndMirrorsWrites(): Promise<void> {
  // 双 FAT、ActiveFat=1，且首份 FAT 整区清零——读取必须完全依赖第二份 FAT
  const preset = new Uint8Array(9000)
  for (let i = 0; i < preset.byteLength; i += 1) preset[i] = i & 0xff
  const bytes = createExfatImage({
    numberOfFats: 2,
    activeFat: 1,
    corruptInactiveFat: true,
    files: [{ name: 'preset.bin', data: preset }],
  })
  const sb = parseExfatSuperblock(bytes.subarray(0, 512))!
  const fat0 = bytes.subarray(sb.fatStart, sb.fatStart + sb.fatLength)
  const fat1 = bytes.subarray(sb.fatStart + sb.fatLength, sb.fatStart + 2 * sb.fatLength)
  assert.equal(fat0.every((byte) => byte === 0), true, '前提：FAT0 已清零')

  const volume = new ExfatImageVolume(memoryDisk(bytes))
  await volume.prepare()
  // 9000B = 3 簇链：FAT0 全零时只有 FAT1 能解析出这条链
  assert.deepEqual(await volume.readFile('preset.bin'), preset)
  await volume.writeFile('fresh.bin', new TextEncoder().encode('made now'))
  await volume.flush()

  // 新表项镜像到两份 FAT（同一簇号、同一值）；既有陈旧副本不被整体重建
  const root = parseExfatDirectory(rootDirData(bytes, sb))
  const entryOf = (region: Uint8Array, cluster: number): number =>
    (region[cluster * 4]! |
      (region[cluster * 4 + 1]! << 8) |
      (region[cluster * 4 + 2]! << 16) |
      (region[cluster * 4 + 3]! << 24)) >>>
    0
  const freshNode = root.nodes.find((item) => item.name === 'fresh.bin')
  assert.ok(freshNode)
  assert.equal(entryOf(fat0, freshNode.firstCluster), CLUSTER_EOC)
  assert.equal(entryOf(fat1, freshNode.firstCluster), CLUSTER_EOC)
  const presetNode = root.nodes.find((item) => item.name === 'preset.bin')
  assert.ok(presetNode)
  assert.equal(entryOf(fat0, presetNode.firstCluster), 0, '陈旧副本的既有链保持原样（ActiveFat 语义）')
  assert.equal(
    entryOf(fat1, presetNode.firstCluster),
    presetNode.firstCluster + 1,
    '活动副本的既有链完好',
  )

  // ActiveFat 翻回 0：fresh.bin 的表项已镜像进 FAT0，仍可读
  bytes[106] &= 0xfe
  const swapped = new ExfatImageVolume(memoryDisk(bytes))
  await swapped.prepare()
  assert.equal(new TextDecoder().decode(await swapped.readFile('fresh.bin')), 'made now')
}

async function testExfatTinyClustersLongChain(): Promise<void> {
  // 512B 簇（shift=0）：1MB 文件 = 2048 簇长链，FAT 表跨 16+ 扇区
  const bytes = createExfatImage({ sectorsPerClusterShift: 0 })
  const volume = new ExfatImageVolume(memoryDisk(bytes))
  await volume.prepare()
  const content = new Uint8Array(1024 * 1024)
  for (let i = 0; i < content.byteLength; i += 1) content[i] = (i * 7) & 0xff
  await volume.writeFile('big.bin', content)
  const patch = new Uint8Array(300).fill(0x5a)
  await volume.writeFileRange('big.bin', 500 * 1024, patch)
  await volume.flush()

  const sb = parseExfatSuperblock(bytes.subarray(0, 512))!
  assert.equal(sb.clusterSize, 512)
  const root = parseExfatDirectory(rootDirData(bytes, sb))
  const node = root.nodes.find((item) => item.name === 'big.bin')
  assert.ok(node)
  const chain = walkFatChain(bytes, sb, node.firstCluster)
  assert.equal(chain.length, 2048) // 1MB / 512B
  assert.equal(chain.length === new Set(chain).size, true) // 无环

  const remounted = new ExfatImageVolume(memoryDisk(bytes))
  await remounted.prepare()
  const reread = await remounted.readFile('big.bin')
  assert.equal(reread.byteLength, content.byteLength)
  assert.deepEqual(reread.subarray(500 * 1024, 500 * 1024 + 300), patch)
  assert.equal(reread[500 * 1024 - 1], content[500 * 1024 - 1])
}

async function testExfatHugeClusters(): Promise<void> {
  // 256KB 簇（shift=9）：几何与单簇读写冒烟
  const bytes = createExfatImage({ sectorsPerClusterShift: 9, sizeBytes: 4 * 1024 * 1024 })
  const volume = new ExfatImageVolume(memoryDisk(bytes))
  await volume.prepare()
  const sb = parseExfatSuperblock(bytes.subarray(0, 512))!
  assert.equal(sb.clusterSize, 256 * 1024)
  await volume.writeFile('note.txt', new TextEncoder().encode('huge cluster vol'))
  await volume.flush()

  const remounted = new ExfatImageVolume(memoryDisk(bytes))
  await remounted.prepare()
  assert.equal(
    new TextDecoder().decode(await remounted.readFile('note.txt')),
    'huge cluster vol',
  )
}

async function testExfatHugeVolumeSuperblockParse(): Promise<void> {
  // TB 级卷的 VBR 解析：u32 簇数 + u64 卷长在 JS 数值范围内不溢出
  const boot = new Uint8Array(512)
  boot.set([0x45, 0x58, 0x46, 0x41, 0x54, 0x20, 0x20, 0x20], 3) // 'EXFAT   '
  boot[108] = 9 // 512B 扇区
  boot[109] = 9 // 256KB 簇
  boot[110] = 1
  const fatOffset = 24
  const fatLength = 131072 // 512MB FAT（容纳 16.7M 簇的表项）
  const heapOffset = fatOffset + fatLength
  const clusterCount = 16777216
  const sectorsPerCluster = 512
  const volumeSectors = heapOffset + clusterCount * sectorsPerCluster + 1024
  w32le(boot, 80, fatOffset)
  w32le(boot, 84, fatLength)
  w32le(boot, 88, heapOffset)
  w32le(boot, 92, clusterCount)
  w32le(boot, 96, CLUSTER_FIRST)
  w64le(boot, 72, volumeSectors)
  w32le(boot, 100, 0x1234abcd)
  boot[510] = 0x55
  boot[511] = 0xaa

  const sb = parseExfatSuperblock(boot)!
  assert.equal(sb.clusterSize, 256 * 1024)
  assert.equal(sb.clusterCount, clusterCount)
  assert.equal(sb.fatStart, fatOffset * 512)
  assert.equal(sb.fatLength, fatLength * 512)
  assert.equal(sb.clusterHeapStart, heapOffset * 512)
  assert.equal(sb.volumeLength, volumeSectors * 512)
  assert.equal(sb.rootCluster, CLUSTER_FIRST)
  assert.equal(sb.numberOfFats, 1)
  assert.equal(sb.activeFat, 0)

  // 非法几何拒绝
  boot[110] = 3
  assert.equal(parseExfatSuperblock(boot), undefined) // FAT 份数越界
  boot[110] = 1
  boot[109] = 17
  assert.equal(parseExfatSuperblock(boot), undefined) // 簇移位越界
  boot[109] = 9
  boot[108] = 8
  assert.equal(parseExfatSuperblock(boot), undefined) // 扇区移位越界
}

async function testExfatNoFatChainDirectoryContiguousGrowth(): Promise<void> {
  // 目录后有空闲簇、且空文件不占数据簇：NoFatChain 目录物理连续扩展并保持 NoFatChain
  const bytes = createExfatImage({ directories: [{ name: 'docs' }] })
  const volume = new ExfatImageVolume(memoryDisk(bytes))
  await volume.prepare()
  await fillDirectory(volume, 'docs', 30, false)
  await volume.flush()

  const sb = parseExfatSuperblock(bytes.subarray(0, 512))!
  const root = parseExfatDirectory(rootDirData(bytes, sb))
  const node = root.nodes.find((item) => item.name === 'docs')
  assert.ok(node)
  assert.equal(node.noFatChain, true) // 连续扩展成功，保持 NoFatChain
  const expectedClusters = Math.ceil(node.dataLength / sb.clusterSize)
  assert.equal(expectedClusters, 2)
  // NoFatChain 目录不走 FAT 链：各簇的 FAT 表项是 EOC smear，读取按算术连续
  const entryOf = (cluster: number): number => {
    const offset = sb.fatStart + cluster * 4
    return (
      (bytes[offset]! |
        (bytes[offset + 1]! << 8) |
        (bytes[offset + 2]! << 16) |
        (bytes[offset + 3]! << 24)) >>>
      0
    )
  }
  assert.equal(entryOf(node.firstCluster), CLUSTER_EOC)
  for (let i = 1; i < expectedClusters; i += 1) {
    assert.equal(entryOf(node.firstCluster + i), CLUSTER_EOC)
  }

  const remounted = new ExfatImageVolume(memoryDisk(bytes))
  await remounted.prepare()
  const listed = await remounted.list('docs')
  assert.equal(listed.length, 30)
}

async function testExfatNoFatChainDirectoryForcedChainConversion(): Promise<void> {
  // 目录 1 簇后紧跟占位文件（blockNextCluster）：无法连续扩展，整条转 FAT 链
  const bytes = createExfatImage({
    directories: [{ name: 'docs', clusterCount: 1, blockNextCluster: true }],
  })
  const volume = new ExfatImageVolume(memoryDisk(bytes))
  await volume.prepare()
  await fillDirectory(volume, 'docs', 30)
  await volume.flush()

  const sb = parseExfatSuperblock(bytes.subarray(0, 512))!
  const root = parseExfatDirectory(rootDirData(bytes, sb))
  const node = root.nodes.find((item) => item.name === 'docs')
  assert.ok(node)
  assert.equal(node.noFatChain, false) // 已转 FAT 链
  const expectedClusters = Math.ceil(node.dataLength / sb.clusterSize)
  assert.equal(expectedClusters, 2)
  const chain = walkFatChain(bytes, sb, node.firstCluster)
  assert.equal(chain.length, expectedClusters)
  // 转链后集合校验和仍有效（原地补丁会重算）
  const set = rootDirData(bytes, sb).slice(node.slot * 32, (node.slot + node.slotCount) * 32)
  const withoutChecksum = set.slice()
  withoutChecksum[2] = 0
  withoutChecksum[3] = 0
  assert.equal(computeExfatSetChecksum(withoutChecksum), set[2]! | (set[3]! << 8))

  const remounted = new ExfatImageVolume(memoryDisk(bytes))
  await remounted.prepare()
  const listed = await remounted.list('docs')
  assert.equal(listed.length, 30)
  assert.equal(
    new TextDecoder().decode(await remounted.readFile(`docs/f-029-${'x'.repeat(26)}.txt`)),
    'content-29',
  )
}

async function testExfatTimestampBoundaries(): Promise<void> {
  const MIN = Date.UTC(1980, 0, 1)
  const MAX = Date.UTC(2107, 11, 31, 23, 59, 58)
  const cases: { createdAt: number; expected: number }[] = [
    { createdAt: MIN, expected: MIN },
    { createdAt: MAX, expected: MAX },
    { createdAt: Date.UTC(1979, 11, 31, 0, 0, 0), expected: MIN }, // 下溢钳到 1980
    { createdAt: Date.UTC(2108, 0, 1), expected: MAX }, // 上溢钳到 2107 上限
    {
      createdAt: Date.UTC(2026, 7, 25, 12, 34, 56, 780), // 十分之一秒精度往返
      expected: Date.UTC(2026, 7, 25, 12, 34, 56, 780),
    },
  ]
  for (const c of cases) {
    const set = serializeExfatFileSet({
      name: 't',
      attributes: 0x20,
      firstCluster: 0,
      dataLength: 0,
      noFatChain: false,
      createdAt: c.createdAt,
      updatedAt: c.createdAt,
      accessedAt: 0,
    })
    const parsed = parseExfatDirectory(set)
    const node = parsed.nodes[0]!
    assert.equal(node.createdAt, c.expected)
    assert.equal(node.updatedAt, c.expected)
    assert.equal(node.accessedAt, MIN) // 0 被钳到最小值，访问时间无百分秒
  }
}

async function testExfatDiskUtilitySurfacing(): Promise<void> {
  await resetFiles()
  const image = createExfatImage({
    label: 'LBLVOL',
    files: [{ name: 'a.txt', data: new TextEncoder().encode('hello') }],
  })
  await filesCreateBinary(
    '/user/exfat.img',
    image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength),
  )
  await mountDiskImage('/user/exfat.img')
  const tree = await loadDiskTree()
  const imageContainer = tree.children?.find((child) => child.id === 'container:image')
  assert.ok(imageContainer, '磁盘镜像容器应出现在系统磁盘树下')
  const node = imageContainer.children?.find((child) => child.kind !== 'container')
  assert.ok(node, '镜像节点应存在')
  const info = node.fat
  assert.ok(info && info.variant === 'exFAT')
  const sb = parseExfatSuperblock(image.subarray(0, 512))!
  assert.equal(info.label, 'LBLVOL')
  assert.equal(info.clusterSizeBytes, sb.clusterSize)
  assert.equal(info.totalClusters, sb.clusterCount)
  assert.equal(info.serialNumber, '0x1234ABCD')
  assert.equal(info.capacityBytes, sb.volumeLength)
  assert.ok(info.freeClusters !== undefined && info.freeClusters >= 1)
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
  await testExfatDualFatMirrorAndActiveFat()
  await testExfatActiveFat1ReadsViaSecondFatAndMirrorsWrites()
  await testExfatTinyClustersLongChain()
  await testExfatHugeClusters()
  await testExfatHugeVolumeSuperblockParse()
  await testExfatNoFatChainDirectoryContiguousGrowth()
  await testExfatNoFatChainDirectoryForcedChainConversion()
  await testExfatTimestampBoundaries()
  await testExfatDiskUtilitySurfacing()
  console.log('files-image-exfat.test.ts ok')
}

await main()
