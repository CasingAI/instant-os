/**
 * 挂载卷按偏移写：小文件 keepExistingData，大文件流式改写；无 move 重命名走流式拷。
 * 运行：node --experimental-strip-types src/apps/files/files-location-mount-range.test.ts
 */
import 'fake-indexeddb/auto'
import './files-mount-test-window.ts'
import assert from 'node:assert/strict'
import { addMount, removeMount } from './files-mount-store.ts'
import {
  openMountRangeWriter,
  MOUNT_RANGE_COMMIT_CHUNK_BYTES,
  setMountRangeRewriteMinBytesForTests,
} from './files-location-mount.ts'
import {
  filesReadBlobRange,
  filesRename,
  filesWriteBytesRange,
} from './files-api.ts'

class MockWritableFileStream {
  file: MockFileHandle
  bytes: Uint8Array
  pos = 0
  closed = false

  constructor(file: MockFileHandle, keepExistingData: boolean) {
    this.file = file
    this.bytes = keepExistingData ? file.bytes.slice() : new Uint8Array(0)
  }

  async seek(offset: number): Promise<void> {
    this.pos = offset
  }

  async write(data: string | BufferSource): Promise<void> {
    if (this.closed) throw new Error('stream closed')
    const chunk =
      typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data as ArrayBuffer)
    const end = this.pos + chunk.byteLength
    if (this.bytes.byteLength < end) {
      const next = new Uint8Array(end)
      next.set(this.bytes)
      this.bytes = next
    }
    this.bytes.set(chunk, this.pos)
    this.pos = end
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.file.bytes = this.bytes
  }

  async abort(): Promise<void> {
    this.closed = true
  }
}

class MockFileHandle {
  kind = 'file' as const
  name: string
  bytes: Uint8Array

  constructor(name: string, bytes: Uint8Array) {
    this.name = name
    this.bytes = bytes
  }

  async getFile(): Promise<File> {
    return new File([this.bytes], this.name)
  }

  async createWritable(options?: { keepExistingData?: boolean }): Promise<MockWritableFileStream> {
    return new MockWritableFileStream(this, options?.keepExistingData === true)
  }
}

class MockDirHandle {
  kind = 'directory' as const
  name: string
  children: Map<string, MockDirHandle | MockFileHandle>

  constructor(
    name: string,
    children: Map<string, MockDirHandle | MockFileHandle> = new Map(),
  ) {
    this.name = name
    this.children = children
  }

  async getDirectoryHandle(name: string): Promise<MockDirHandle> {
    const child = this.children.get(name)
    if (child?.kind === 'directory') return child
    throw new Error(`not a directory: ${name}`)
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MockFileHandle> {
    const child = this.children.get(name)
    if (child?.kind === 'file') return child
    if (options?.create) {
      const created = new MockFileHandle(name, new Uint8Array(0))
      this.children.set(name, created)
      return created
    }
    throw new Error(`not a file: ${name}`)
  }

  async removeEntry(name: string): Promise<void> {
    this.children.delete(name)
  }

  async *entries(): AsyncGenerator<[string, MockDirHandle | MockFileHandle]> {
    for (const [name, handle] of this.children) yield [name, handle]
  }

  async queryPermission(): Promise<PermissionState> {
    return 'granted'
  }

  async requestPermission(): Promise<PermissionState> {
    return 'granted'
  }
}

function patterned(length: number): Uint8Array {
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i++) out[i] = i % 251
  return out
}

async function withMount<T>(run: (rootPath: string, root: MockDirHandle) => Promise<T>): Promise<T> {
  const root = new MockDirHandle(
    'range-vol',
    new Map([['disk.img', new MockFileHandle('disk.img', patterned(64))]]),
  )
  const record = await addMount(root as unknown as FileSystemDirectoryHandle)
  const rootPath = `/mount/${record.id.slice('mount:'.length)}`
  try {
    return await run(rootPath, root)
  } finally {
    setMountRangeRewriteMinBytesForTests(undefined)
    await removeMount(record.id)
  }
}

async function testSmallFileKeepExistingData(): Promise<void> {
  await withMount(async (rootPath) => {
    await filesWriteBytesRange(`${rootPath}/disk.img`, 10, new Uint8Array([9, 8, 7]))
    const mid = new Uint8Array(
      await (await filesReadBlobRange(`${rootPath}/disk.img`, 8, 6)).arrayBuffer(),
    )
    assert.deepEqual([...mid], [8, 9, 9, 8, 7, 13])
  })
  console.log('ok: mount small range write keeps surrounding bytes')
}

async function testLargeFileStreamRewrite(): Promise<void> {
  await withMount(async (rootPath, root) => {
    const handle = await root.getFileHandle('disk.img')
    handle.bytes = patterned(128)
    setMountRangeRewriteMinBytesForTests(32)
    await filesWriteBytesRange(`${rootPath}/disk.img`, 40, new Uint8Array([1, 2, 3, 4]))
    const file = await root.getFileHandle('disk.img')
    assert.equal(file.bytes.byteLength, 128)
    assert.deepEqual([...file.bytes.subarray(0, 4)], [...patterned(128).subarray(0, 4)])
    assert.deepEqual([...file.bytes.subarray(40, 44)], [1, 2, 3, 4])
    assert.deepEqual([...file.bytes.subarray(44, 48)], [...patterned(128).subarray(44, 48)])
    for (const name of root.children.keys()) {
      assert.equal(name.startsWith('disk.img.__instant-rw__'), false, '临时文件应被清掉')
    }
  })
  console.log('ok: mount large range write stream-rewrites without leftover temp')
}

async function testRenameWithoutMoveStreams(): Promise<void> {
  await withMount(async (rootPath, root) => {
    await filesRename(`${rootPath}/disk.img`, 'renamed.img')
    assert.equal(root.children.has('disk.img'), false)
    const renamed = root.children.get('renamed.img')
    assert.ok(renamed && renamed.kind === 'file')
    if (renamed.kind === 'file') {
      assert.deepEqual([...renamed.bytes], [...patterned(64)])
    }
  })
  console.log('ok: mount rename without move copies by stream')
}

async function testMountRangeWriterCommitsSequentially(): Promise<void> {
  await withMount(async (rootPath, root) => {
    const handle = await root.getFileHandle('disk.img')
    handle.bytes = patterned(64)
    const writer = await openMountRangeWriter(`${rootPath}/disk.img`)
    assert.ok(writer)
    await writer!.writeAt(0, new Uint8Array([1, 2, 3]))
    await writer!.writeAt(20, new Uint8Array([7, 7, 7, 7]))
    await writer!.writeAt(60, new Uint8Array([9, 9, 9, 9]))
    // close 前不得改动正文（镜像运行中的读仍看旧内容由覆盖层负责）
    assert.deepEqual([...(await root.getFileHandle('disk.img')).bytes], [...patterned(64)])
    await writer!.close()
    const expected = patterned(64)
    expected.set([1, 2, 3], 0)
    expected.set([7, 7, 7, 7], 20)
    expected.set([9, 9, 9, 9], 60)
    assert.deepEqual([...(await root.getFileHandle('disk.img')).bytes], [...expected])
  })
  console.log('ok: mount range writer commits whole file sequentially')
}

async function testMountRangeWriterCrossesChunkBoundary(): Promise<void> {
  await withMount(async (rootPath, root) => {
    const total = MOUNT_RANGE_COMMIT_CHUNK_BYTES + 4096
    const handle = await root.getFileHandle('disk.img')
    handle.bytes = patterned(total)
    const writer = await openMountRangeWriter(`${rootPath}/disk.img`)
    assert.ok(writer)
    const atBoundary = MOUNT_RANGE_COMMIT_CHUNK_BYTES - 2
    await writer!.writeAt(10, new Uint8Array([1, 1]))
    await writer!.writeAt(atBoundary, new Uint8Array([2, 2, 2, 2]))
    await writer!.writeAt(total - 3, new Uint8Array([3, 3, 3]))
    await writer!.close()
    const expected = patterned(total)
    expected.set([1, 1], 10)
    expected.set([2, 2, 2, 2], atBoundary)
    expected.set([3, 3, 3], total - 3)
    assert.deepEqual([...(await root.getFileHandle('disk.img')).bytes], [...expected])
  })
  console.log('ok: mount range writer writes across commit chunk boundary')
}

/** 乱序写（新写偏移低于已记录段，客机 FAT 表/目录项跳写的常态）：close 后正文各区间内容正确。 */
async function testMountRangeWriterOutOfOrderWrites(): Promise<void> {
  await withMount(async (rootPath, root) => {
    const mib = 1024 * 1024
    const total = mib + 8192
    const handle = await root.getFileHandle('disk.img')
    handle.bytes = patterned(total)
    const writer = await openMountRangeWriter(`${rootPath}/disk.img`)
    assert.ok(writer)
    // 先写高偏移 [1MB, 1MB+4KB)，再写更低偏移 [512B, 512B+512B)，
    // 最后重叠写回第一段的中部 [1MB+2KB, 1MB+4KB)
    await writer!.writeAt(mib, new Uint8Array(4096).fill(0xaa))
    await writer!.writeAt(512, new Uint8Array(512).fill(0xbb))
    await writer!.writeAt(mib + 2048, new Uint8Array(2048).fill(0xcc))
    await writer!.close()
    const bytes = (await root.getFileHandle('disk.img')).bytes
    assert.deepEqual([...bytes.subarray(512, 512 + 512)], [...new Uint8Array(512).fill(0xbb)])
    assert.deepEqual([...bytes.subarray(mib, mib + 2048)], [...new Uint8Array(2048).fill(0xaa)])
    assert.deepEqual(
      [...bytes.subarray(mib + 2048, mib + 4096)],
      [...new Uint8Array(2048).fill(0xcc)],
    )
    assert.deepEqual([...bytes.subarray(0, 4)], [...patterned(total).subarray(0, 4)])
    assert.deepEqual(
      [...bytes.subarray(total - 4)],
      [...patterned(total).subarray(total - 4)],
    )
  })
  console.log('ok: mount range writer commits out-of-order writes in order')
}

async function run(): Promise<void> {
  await testSmallFileKeepExistingData()
  await testLargeFileStreamRewrite()
  await testRenameWithoutMoveStreams()
  await testMountRangeWriterCommitsSequentially()
  await testMountRangeWriterCrossesChunkBoundary()
  await testMountRangeWriterOutOfOrderWrites()
  console.log('files-location-mount-range: all passed')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
