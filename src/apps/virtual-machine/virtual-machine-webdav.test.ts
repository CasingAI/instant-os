import assert from 'node:assert/strict'
import {
  buildPropfindMultistatus,
  createWebdavHandler,
  parseWebdavRange,
  webdavTargetPath,
  type WebdavFs,
  type WebdavFsEntry,
} from './virtual-machine-webdav.ts'

// ---------------------------------------------------------------------------
// 路径映射
// ---------------------------------------------------------------------------

const ROOT = '/user/Shared'
assert.deepEqual(webdavTargetPath('http://instant-vm-files.local/', ROOT), {
  ok: true,
  path: '/user/Shared',
  segments: [],
})
assert.deepEqual(webdavTargetPath('http://instant-vm-files.local/docs/a%20b.txt', ROOT), {
  ok: true,
  path: '/user/Shared/docs/a b.txt',
  segments: ['docs', 'a b.txt'],
})
// 中文名 percent-decode
assert.equal(
  webdavTargetPath('http://instant-vm-files.local/%E4%B8%AD%E6%96%87.txt', ROOT).ok === true
    ? (webdavTargetPath('http://instant-vm-files.local/%E4%B8%AD%E6%96%87.txt', ROOT) as { path: string }).path
    : '',
  '/user/Shared/中文.txt',
)
// 穿越：URL 解析器已把点段（含 %2E%2E 形态）归一化掉，/x/../etc 与
// /%2E%2E/etc 到达映射层时都已是 /etc——映射永远从共享根出发，天然封顶。
// 段级 '..'/'%2F' 检查是纵深防御（防双重编码与字面量绕过）。
assert.equal(
  webdavTargetPath('http://instant-vm-files.local/%2E%2E/etc', ROOT).ok === true
    ? (webdavTargetPath('http://instant-vm-files.local/%2E%2E/etc', ROOT) as { path: string }).path
    : '',
  '/user/Shared/etc',
)
assert.equal(
  webdavTargetPath('http://instant-vm-files.local/a%2Fb', ROOT).ok,
  false,
)

// ---------------------------------------------------------------------------
// Range 头
// ---------------------------------------------------------------------------

assert.deepEqual(parseWebdavRange('bytes=0-99'), { offset: 0, length: 100 })
assert.deepEqual(parseWebdavRange('bytes=100-'), { offset: 100, length: Number.MAX_SAFE_INTEGER })
assert.equal(parseWebdavRange('bytes=abc'), undefined)
assert.equal(parseWebdavRange(undefined), undefined)

// ---------------------------------------------------------------------------
// 207 XML 生成
// ---------------------------------------------------------------------------

const entry: WebdavFsEntry = {
  path: '/user/Shared/a.txt',
  name: 'a.txt',
  kind: 'file',
  byteSize: 3,
  createdAt: 0,
  updatedAt: 0,
  writable: true,
}
const xml = buildPropfindMultistatus([{ href: '/a.txt', entry }])
assert.ok(xml.includes('<D:multistatus xmlns:D="DAV:">'))
assert.ok(xml.includes('<D:href>/a.txt</D:href>'))
assert.ok(xml.includes('<D:getcontentlength>3</D:getcontentlength>'))
assert.ok(xml.includes('Thu, 01 Jan 1970 00:00:00 GMT'))

// ---------------------------------------------------------------------------
// 方法路由（假 fs）
// ---------------------------------------------------------------------------

function makeFs(): WebdavFs & { calls: string[] } {
  const files = new Map<string, { kind: 'file' | 'folder'; byteSize: number; content?: ArrayBuffer }>([
    [ROOT, { kind: 'folder', byteSize: 0 }],
    [`${ROOT}/hello.txt`, { kind: 'file', byteSize: 5, content: new TextEncoder().encode('hello').buffer as ArrayBuffer }],
  ])
  const calls: string[] = []
  const entryOf = (path: string): WebdavFsEntry | undefined => {
    const item = files.get(path)
    if (!item) return undefined
    return {
      path,
      name: path.slice(path.lastIndexOf('/') + 1),
      kind: item.kind,
      byteSize: item.byteSize,
      createdAt: 0,
      updatedAt: 0,
      writable: true,
    }
  }
  return {
    calls,
    async stat(path) {
      calls.push(`stat:${path}`)
      return entryOf(path)
    },
    async list(dirPath) {
      calls.push(`list:${dirPath}`)
      return [...files.keys()]
        .filter((path) => path.startsWith(`${dirPath}/`) && !path.slice(dirPath.length + 1).includes('/'))
        .map((path) => entryOf(path)!)
    },
    async readBlob(path) {
      calls.push(`read:${path}`)
      const item = files.get(path)
      return new Blob([item?.content ?? new ArrayBuffer(0)])
    },
    async readBlobRange(path, offset, length) {
      calls.push(`readRange:${path}:${offset}:${length}`)
      const item = files.get(path)
      return new Blob([(item?.content ?? new ArrayBuffer(0)).slice(offset, offset + length)])
    },
    async writeBinary(path, bytes) {
      calls.push(`write:${path}:${bytes.byteLength}`)
      const item = files.get(path)
      files.set(path, { kind: 'file', byteSize: bytes.byteLength, content: bytes })
      void item
    },
    async createBinary(path, bytes) {
      calls.push(`create:${path}:${bytes.byteLength}`)
      if (files.has(path)) throw new Error('exists')
      files.set(path, { kind: 'file', byteSize: bytes.byteLength, content: bytes })
    },
    async mkdir(path) {
      calls.push(`mkdir:${path}`)
      if (files.has(path)) throw new Error('exists')
      files.set(path, { kind: 'folder', byteSize: 0 })
    },
    async remove(path) {
      calls.push(`remove:${path}`)
      files.delete(path)
    },
    async rename(path, nextName) {
      calls.push(`rename:${path}:${nextName}`)
      const item = files.get(path)
      if (!item) throw new Error('missing')
      files.delete(path)
      const parent = path.slice(0, path.lastIndexOf('/'))
      files.set(`${parent}/${nextName}`, item)
      return entryOf(`${parent}/${nextName}`)!
    },
    async move(sourcePath, destDirPath) {
      calls.push(`move:${sourcePath}:${destDirPath}`)
      const item = files.get(sourcePath)
      if (!item) throw new Error('missing')
      const name = sourcePath.slice(sourcePath.lastIndexOf('/') + 1)
      files.delete(sourcePath)
      files.set(`${destDirPath}/${name}`, item)
      return entryOf(`${destDirPath}/${name}`)!
    },
    async copy(sourcePath, destDirPath) {
      calls.push(`copy:${sourcePath}:${destDirPath}`)
      const item = files.get(sourcePath)
      if (!item) throw new Error('missing')
      let name = sourcePath.slice(sourcePath.lastIndexOf('/') + 1)
      if (files.has(`${destDirPath}/${name}`)) {
        name = `${name} 2`
      }
      files.set(`${destDirPath}/${name}`, item)
      return entryOf(`${destDirPath}/${name}`)!
    },
  }
}

const handler = createWebdavHandler(ROOT, makeFs())
function request(method: string, path: string, extra?: Partial<{ headers: Record<string, string>; body: ArrayBuffer }>) {
  return handler({
    method,
    url: `http://instant-vm-files.local${path}`,
    headers: extra?.headers ?? {},
    body: extra?.body,
  })
}

// OPTIONS
const options = await request('OPTIONS', '/')
assert.equal(options.status, 200)
assert.equal(options.headers.DAV, '1')
assert.ok(options.headers.Allow.includes('PROPFIND'))

// PROPFIND Depth 1：目录 + 子项
const propfind = await request('PROPFIND', '/', { headers: { Depth: '1' } })
assert.equal(propfind.status, 207)
const propfindXml = new TextDecoder().decode(propfind.body)
assert.ok(propfindXml.includes('<D:href>/</D:href>'))
assert.ok(propfindXml.includes('<D:href>/hello.txt</D:href>'))

// PROPFIND Depth 0：只有自身
const propfindSelf = await request('PROPFIND', '/', { headers: { Depth: '0' } })
assert.equal(new TextDecoder().decode(propfindSelf.body).includes('/hello.txt'), false)

// GET 整文件 / Range / 404
const get = await request('GET', '/hello.txt')
assert.equal(get.status, 200)
assert.equal(new TextDecoder().decode(get.body), 'hello')
const getRange = await request('GET', '/hello.txt', { headers: { Range: 'bytes=1-3' } })
assert.equal(getRange.status, 206)
assert.equal(getRange.headers['Content-Range'], 'bytes 1-3/5')
assert.equal(new TextDecoder().decode(getRange.body), 'ell')
assert.equal((await request('GET', '/missing.txt')).status, 404)

// PUT 新建 201 / 覆盖 204 / 父目录缺失 409
const putCreate = await request('PUT', '/new.txt', {
  body: new TextEncoder().encode('data').buffer as ArrayBuffer,
})
assert.equal(putCreate.status, 201)
const putOverwrite = await request('PUT', '/new.txt', {
  body: new TextEncoder().encode('more data').buffer as ArrayBuffer,
})
assert.equal(putOverwrite.status, 204)
assert.equal((await request('PUT', '/no-such-dir/x.txt', { body: new ArrayBuffer(1) })).status, 409)

// MKCOL：201 / 已存在 405 / 父缺失 409
assert.equal((await request('MKCOL', '/docs')).status, 201)
assert.equal((await request('MKCOL', '/docs')).status, 405)
assert.equal((await request('MKCOL', '/x/y')).status, 409)

// DELETE：204 / 根 403 / 缺失 404
assert.equal((await request('DELETE', '/new.txt')).status, 204)
assert.equal((await request('DELETE', '/')).status, 403)
assert.equal((await request('DELETE', '/new.txt')).status, 404)

// MOVE 同目录 → rename；先 COPY 建立目标后，Overwrite F + 目标存在 → 412
const move = await request('MOVE', '/hello.txt', {
  headers: { Destination: 'http://instant-vm-files.local/hello2.txt' },
})
assert.equal(move.status, 201)
assert.equal((await request('GET', '/hello2.txt')).status, 200)
const copy = await request('COPY', '/hello2.txt', {
  headers: { Destination: 'http://instant-vm-files.local/docs/hello2.txt' },
})
assert.equal(copy.status, 201)
assert.equal((await request('GET', '/docs/hello2.txt')).status, 200)
assert.equal(
  (
    await request('MOVE', '/hello2.txt', {
      headers: { Destination: 'http://instant-vm-files.local/docs/hello2.txt', Overwrite: 'F' },
    })
  ).status,
  412,
)

// 桩与未知方法
const lock = await request('LOCK', '/hello2.txt')
assert.equal(lock.status, 200)
assert.ok(lock.headers['Lock-Token'].startsWith('<opaquelocktoken:'))
const unlock = await request('UNLOCK', '/hello2.txt')
assert.equal(unlock.status, 204)
assert.equal((await request('TELEPORT', '/hello2.txt')).status, 501)

console.log('virtual-machine-webdav.test.ts ok')
