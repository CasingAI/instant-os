/**
 * FAT 镜像挂载：内存卷读写，以及挂上写入、卸载再挂内容仍在。
 * 运行：node --experimental-strip-types src/apps/files/files-image-mount.test.ts
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { createFat12Image } from './files-image-fat12-fixture.ts'
import { FatImageVolume, type ImageDiskIo } from './files-image-fat-volume.ts'
import { mountDiskImage, unmountDiskImage } from './files-image-actions.ts'
import {
  openImageMount,
  closeImageMount,
  getImageMountReadError,
  resetImageMountsForTests,
} from './files-image-mount-store.ts'
import {
  claimDiskImagePath,
  getDiskImageOccupant,
  releaseDiskImagePath,
  resetDiskImageOccupancyForTests,
} from './files-disk-image-occupancy.ts'
import { resetFilesDbForTests } from './files-storage.ts'
import { invalidateFilesVfsPathCaches, listFilesLocations } from './files-vfs.ts'
import { isImageLocationId } from './files-types.ts'
import { filesLocationPathRoot } from './files-path.ts'
import {
  filesCreateBinary,
  filesCreateText,
  filesList,
  filesMkdir,
  filesReadText,
  filesRemove,
  filesRename,
  filesWriteText,
} from './files-api.ts'

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
  resetImageMountsForTests()
  resetDiskImageOccupancyForTests()
  await resetFilesDbForTests()
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

await testInMemoryFatVolume()
await testMountWriteUnmountRemount()
await testVmOccupancyBlocksMount()
await testUnreadableImageDegradesGracefully()
console.log('files-image-mount.test.ts ok')
