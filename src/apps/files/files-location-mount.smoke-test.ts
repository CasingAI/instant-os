/**
 * 挂载卷 smoke：fs.readdirSync 在挂载根上的行为，以及挂载移除后目录/节点缓存失效。
 * 覆盖回归：listDirectoryCache / resolveNodeCache 必须在挂载增删后失效，
 * 否则会持续返回陈旧（甚至空）的挂载内容。
 * 运行：node --experimental-strip-types src/apps/files/files-location-mount.smoke-test.ts
 */
import 'fake-indexeddb/auto'
import './files-mount-test-window.ts'
import assert from 'node:assert/strict'
import { addMount, removeMount } from './files-mount-store.ts'
import { filesList, filesOpenStreamWrite, filesReadText, filesStat } from './files-api.ts'
import { createQuickJsInstance } from '../../quickjs/quickjs-instance.ts'

/** FSA FileSystemWritableFileStream 简化 mock：close 落盘、abort 丢弃（含 truncate） */
class MockWritableFileStream {
  file: MockFileHandle
  chunks: string[] = []
  closed = false
  constructor(file: MockFileHandle) {
    this.file = file
    // FSA createWritable() 立即清空既有文件
    this.file.text = ''
  }
  async write(data: string | Uint8Array): Promise<void> {
    if (this.closed) throw new Error('stream closed')
    this.chunks.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
  }
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.file.text = this.chunks.join('')
  }
  async abort(): Promise<void> {
    // 已 truncate；abort 不恢复旧内容（与真实 FSA 一致）
    this.closed = true
  }
}

class MockFileHandle {
  kind = 'file' as const
  name: string
  text: string
  constructor(name: string, text: string) {
    this.name = name
    this.text = text
  }
  async getFile(): Promise<Blob> {
    return new Blob([this.text])
  }
  async createWritable(): Promise<MockWritableFileStream> {
    return new MockWritableFileStream(this)
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
      const created = new MockFileHandle(name, '')
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

const mockRoot = new MockDirHandle(
  'otterflow',
  new Map([
    ['package.json', new MockFileHandle('package.json', '{"name":"x"}\n')],
    [
      'src',
      new MockDirHandle(
        'src',
        new Map([['main.ts', new MockFileHandle('main.ts', 'const x = 1\n')]]),
      ),
    ],
  ]),
)

async function testReaddirOnMount(): Promise<void> {
  const record = await addMount(mockRoot)
  const rootPath = `/mount/${record.id.slice('mount:'.length)}`
  try {
    const instance = await createQuickJsInstance({
      workspaceRoot: rootPath,
      cwd: rootPath,
      fsMode: 'normal',
      timeoutMs: 10_000,
    })
    try {
      const started = await instance.eval(`
        var __mountReaddirOut = null
        var __mountReaddirErr = null
        ;(function () {
          try {
            var fs = globalThis.fs || require('fs')
            __mountReaddirOut = {
              abs: fs.readdirSync('/${rootPath.slice(1)}'),
              rel: fs.readdirSync('.'),
            }
          } catch (e) {
            __mountReaddirErr = String(e && e.message ? e.message : e)
          }
        })()
        'started'
      `)
      assert.equal(started.ok, true)
      const res = await instance.eval(
        '__mountReaddirErr ? { error: __mountReaddirErr } : __mountReaddirOut',
      )
      assert.ok(res.ok, String(res))
      assert.deepEqual(res.value, {
        abs: ['src', 'package.json'],
        rel: ['src', 'package.json'],
      })
    } finally {
      instance.destroy()
    }
  } finally {
    await removeMount(record.id)
  }
  console.log('ok: readdir on mount root')
}

async function testCacheInvalidatedAfterRemoveMount(): Promise<void> {
  const record = await addMount(mockRoot)
  const rootPath = `/mount/${record.id.slice('mount:'.length)}`

  // 先列举一次，写入 listDirectoryCache
  const before = await filesList(rootPath)
  assert.deepEqual(before.map((entry) => entry.name), ['src', 'package.json'])

  // 移除挂载 → FILES_MOUNTS_CHANGED_EVENT → VFS 路径缓存失效
  await removeMount(record.id)
  await assert.rejects(() => filesList(rootPath), /挂载已不存在/)
  console.log('ok: cache invalidated after removeMount')
}

async function testStreamWriteOnMount(): Promise<void> {
  const record = await addMount(mockRoot)
  const rootPath = `/mount/${record.id.slice('mount:'.length)}`
  try {
    // 新建 + 分块写 + close
    const dest = `${rootPath}/download.bin`
    const writer = await filesOpenStreamWrite(dest)
    await writer.write(new TextEncoder().encode('hel'))
    await writer.write(new TextEncoder().encode('lo'))
    const node = await writer.close()
    assert.equal(node.byteSize, 'hello'.length)
    assert.equal(await filesReadText(dest), 'hello')

    // abort 新建 → 文件移除
    const abortDest = `${rootPath}/abort.bin`
    const w2 = await filesOpenStreamWrite(abortDest)
    await w2.write(new TextEncoder().encode('partial'))
    await w2.abort()
    assert.equal(await filesStat(abortDest), undefined)

    // 覆盖既有文件（FSA createWritable 清空语义；close 后为新内容）
    const overwritten = await filesOpenStreamWrite(`${rootPath}/package.json`)
    await overwritten.write(new TextEncoder().encode('{"name":"y"}\n'))
    const closed = await overwritten.close()
    assert.equal(closed.byteSize, '{"name":"y"}\n'.length)
    assert.equal(await filesReadText(`${rootPath}/package.json`), '{"name":"y"}\n')
  } finally {
    await removeMount(record.id)
  }
  console.log('ok: stream write on mount (create/abort/overwrite)')
}

async function main(): Promise<void> {
  await testReaddirOnMount()
  await testCacheInvalidatedAfterRemoveMount()
  await testStreamWriteOnMount()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
