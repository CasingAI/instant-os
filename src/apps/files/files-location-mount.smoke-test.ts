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
import { createMockMountRoot } from './files-mount-test-fsa.ts'

const mockRoot = createMockMountRoot()

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
