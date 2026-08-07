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
import { filesList } from './files-api.ts'
import { createQuickJsInstance } from '../../quickjs/quickjs-instance.ts'

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
  async getFileHandle(name: string): Promise<MockFileHandle> {
    const child = this.children.get(name)
    if (child?.kind === 'file') return child
    throw new Error(`not a file: ${name}`)
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

async function main(): Promise<void> {
  await testReaddirOnMount()
  await testCacheInvalidatedAfterRemoveMount()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
