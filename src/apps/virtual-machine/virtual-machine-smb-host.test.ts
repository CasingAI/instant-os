/**
 * virtual-machine-smb-host 纯函数单测：op → VFS 分派、路径穿越拒绝、
 * 共享根未配置 denied、写零填充（空洞扩展/setEof）、懒条目补 stat。
 * 直接 node --experimental-strip-types 跑，注入内存假 VFS。
 */

import assert from 'node:assert/strict'

import { INSTANT_VM_MESSAGE_TYPE, type InstantVmSmbFsRequestMessage } from './virtual-machine-protocol.ts'
import { createSmbFsHandler, smbTargetPath, type SmbHostFs, type SmbHostFsEntry } from './virtual-machine-smb-host.ts'

// ---------------------------------------------------------------------------
// 内存假 VFS
// ---------------------------------------------------------------------------

type Node_ = { isDir: boolean; content: Uint8Array; createdAt: number; updatedAt: number }

class FakeFs implements SmbHostFs {
  nodes = new Map<string, Node_>([['/share', { isDir: true, content: new Uint8Array(0), createdAt: 1, updatedAt: 1 }]])

  private entry(path: string): SmbHostFsEntry | undefined {
    const node = this.nodes.get(path)
    if (!node) {
      return undefined
    }
    return {
      path,
      name: path.split('/').pop() ?? '',
      kind: node.isDir ? 'folder' : 'file',
      byteSize: node.content.byteLength,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    }
  }

  async stat(path: string) {
    return this.entry(path)
  }

  async list(dirPath: string) {
    const prefix = `${dirPath}/`
    const out: SmbHostFsEntry[] = []
    for (const path of this.nodes.keys()) {
      if (path.startsWith(prefix) && !path.slice(prefix.length).includes('/')) {
        const entry = this.entry(path)!
        // 模拟挂载卷的懒条目：list 不 stat，大小/时间为 0；stat 才是真值。
        if (entry.name === 'lazy.bin') {
          out.push({ ...entry, byteSize: 0, updatedAt: 0 })
        } else {
          out.push(entry)
        }
      }
    }
    return out
  }

  async readBlobRange(path: string, offset: number, length: number): Promise<Blob> {
    const node = this.nodes.get(path)!
    return new Blob([node.content.subarray(offset, offset + length).slice()])
  }

  async writeBytesRange(path: string, offset: number, bytes: ArrayBuffer | Uint8Array) {
    const node = this.nodes.get(path)!
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    const size = Math.max(node.content.byteLength, offset + data.byteLength)
    const next = new Uint8Array(size)
    next.set(node.content)
    next.set(data, offset)
    node.content = next
    return this.entry(path)
  }

  async writeBinary(path: string, bytes: ArrayBuffer) {
    const node = this.nodes.get(path)!
    node.content = new Uint8Array(bytes)
    return this.entry(path)
  }

  async createBinary(path: string, bytes: ArrayBuffer) {
    this.nodes.set(path, { isDir: false, content: new Uint8Array(bytes), createdAt: 2, updatedAt: 2 })
    return this.entry(path)
  }

  async mkdir(path: string) {
    this.nodes.set(path, { isDir: true, content: new Uint8Array(0), createdAt: 2, updatedAt: 2 })
    return this.entry(path)
  }

  async remove(path: string) {
    this.nodes.delete(path)
  }

  async rename(path: string, nextName: string) {
    const node = this.nodes.get(path)!
    const parent = path.slice(0, path.lastIndexOf('/'))
    this.nodes.delete(path)
    this.nodes.set(`${parent}/${nextName}`, node)
    return this.entry(`${parent}/${nextName}`)
  }

  async move(sourcePath: string, destDirPath: string) {
    const node = this.nodes.get(sourcePath)!
    const leaf = sourcePath.split('/').pop()!
    this.nodes.delete(sourcePath)
    this.nodes.set(`${destDirPath}/${leaf}`, node)
    return this.entry(`${destDirPath}/${leaf}`)
  }
}

let id = 0
function req(op: string, fields: Record<string, unknown> = {}): InstantVmSmbFsRequestMessage {
  id += 1
  return {
    type: INSTANT_VM_MESSAGE_TYPE.smbFsRequest,
    requestId: `t-${id}`,
    op: op as InstantVmSmbFsRequestMessage['op'],
    path: '',
    ...fields,
  } as InstantVmSmbFsRequestMessage
}

// --- 路径安全 -----------------------------------------------------------------

assert.deepEqual(smbTargetPath('/share', 'a/b.txt'), { ok: true, path: '/share/a/b.txt' })
assert.deepEqual(smbTargetPath('/share/', ''), { ok: true, path: '/share' })
assert.equal(smbTargetPath('/share', '../escape').ok, false)
assert.equal(smbTargetPath('/share', 'a/../../escape').ok, false)
assert.equal(smbTargetPath('/share', 'a\\..\\escape').ok, false)
assert.equal(smbTargetPath('/share', 'C:/windows').ok, false)
assert.equal(smbTargetPath('/share', './x').ok, false)

// --- 主流程 ---------------------------------------------------------------------

async function main(): Promise<void> {
  const fs = new FakeFs()
  let root: string | undefined = '/share'
  const handler = createSmbFsHandler(() => root, fs)

  // 根未配置 → denied。
  root = undefined
  assert.equal((await handler(req('stat', { path: 'x' }))).error, 'denied')
  root = '/share'

  // 路径穿越 → invalid。
  assert.equal((await handler(req('stat', { path: '../secret' }))).error, 'invalid')

  // stat 未找到 → ok + entry null（服务端据此前提报 NO_SUCH_FILE）。
  const missing = await handler(req('stat', { path: 'missing.txt' }))
  assert.equal(missing.ok, true)
  assert.equal(missing.entry, null)

  // mkdir / create / write / read 全链。
  assert.equal((await handler(req('mkdir', { path: 'docs' }))).ok, true)
  assert.equal((await handler(req('mkdir', { path: 'docs' }))).error, 'exists')
  assert.equal((await handler(req('create', { path: 'docs/a.txt' }))).ok, true)
  assert.equal((await handler(req('create', { path: 'docs/a.txt' }))).error, 'exists')
  const body = new TextEncoder().encode('smb-host-body')
  assert.equal(
    (await handler(req('write', { path: 'docs/a.txt', offset: 0, data: body.slice().buffer }))).ok,
    true,
  )
  const read = await handler(req('read', { path: 'docs/a.txt', offset: 0, length: 100 }))
  assert.equal(read.ok, true)
  assert.deepEqual([...new Uint8Array(read.data!)], [...body])

  // 空洞扩展：offset > EOF 先补零。
  assert.equal(
    (await handler(req('write', { path: 'docs/a.txt', offset: 100, data: Uint8Array.of(7).slice().buffer }))).ok,
    true,
  )
  const gap = fs.nodes.get('/share/docs/a.txt')!.content
  assert.equal(gap.byteLength, 101)
  assert.equal(gap[100], 7)
  assert.equal(gap[50], 0)

  // setEof：伸长补零、缩短截断。
  assert.equal((await handler(req('setEof', { path: 'docs/a.txt', length: 200 }))).ok, true)
  assert.equal(fs.nodes.get('/share/docs/a.txt')!.content.byteLength, 200)
  assert.equal(fs.nodes.get('/share/docs/a.txt')!.content[199], 0)
  assert.equal((await handler(req('setEof', { path: 'docs/a.txt', length: 5 }))).ok, true)
  assert.equal(fs.nodes.get('/share/docs/a.txt')!.content.byteLength, 5)
  assert.deepEqual(
    [...fs.nodes.get('/share/docs/a.txt')!.content],
    [...new TextEncoder().encode('smb-h')],
  )

  // 懒条目补 stat：byteSize=0 的文件列举后拿到真值。
  fs.nodes.set('/share/docs/lazy.bin', {
    isDir: false,
    content: new Uint8Array(9),
    createdAt: 0,
    updatedAt: 0,
  })
  const list = await handler(req('list', { path: 'docs' }))
  assert.equal(list.ok, true)
  const lazy = list.entries!.find((entry) => entry.name === 'lazy.bin')!
  // 假 VFS 的 stat 返回真值（byteSize 9）——handler 应补 stat 后带真值回来。
  assert.equal(lazy.size, 9)
  const names = list.entries!.map((entry) => entry.name).sort()
  assert.deepEqual(names, ['a.txt', 'lazy.bin'])

  // rename / move / remove。
  assert.equal((await handler(req('rename', { path: 'docs/a.txt', path2: 'b.txt' }))).ok, true)
  assert.ok(fs.nodes.has('/share/docs/b.txt'))
  assert.equal((await handler(req('rename', { path: 'docs/b.txt', path2: '../evil' }))).error, 'invalid')
  assert.equal((await handler(req('move', { path: 'docs/b.txt', path2: '' }))).ok, true)
  assert.ok(fs.nodes.has('/share/b.txt'))
  assert.equal((await handler(req('remove', { path: 'docs' }))).error, 'not-empty')
  assert.equal((await handler(req('remove', { path: 'docs/lazy.bin' }))).ok, true)
  assert.equal((await handler(req('remove', { path: 'docs' }))).ok, true)
  assert.equal((await handler(req('remove', { path: 'docs' }))).error, 'not-found')

  // 目录当文件写 → not-dir。
  assert.equal((await handler(req('mkdir', { path: 'dir2' }))).ok, true)
  assert.equal(
    (await handler(req('write', { path: 'dir2', offset: 0, data: new ArrayBuffer(1) }))).error,
    'not-dir',
  )

  console.log('virtual-machine-smb-host.test.ts ok')
}

await main()
