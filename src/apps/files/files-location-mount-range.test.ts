/**
 * 挂载卷按偏移写：小文件 keepExistingData，大文件流式改写；无 move 重命名走流式拷。
 * 运行：node --experimental-strip-types src/apps/files/files-location-mount-range.test.ts
 */
import 'fake-indexeddb/auto'
import './files-mount-test-window.ts'
import assert from 'node:assert/strict'
import { addMount, removeMount } from './files-mount-store.ts'
import {
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

async function run(): Promise<void> {
  await testSmallFileKeepExistingData()
  await testLargeFileStreamRewrite()
  await testRenameWithoutMoveStreams()
  console.log('files-location-mount-range: all passed')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
