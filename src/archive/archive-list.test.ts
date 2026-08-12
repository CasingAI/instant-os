/**
 * archive-list 纯函数测试：zip / tar / tar.gz 列目录元数据。
 *
 * 运行：node --experimental-strip-types src/archive/archive-list.test.ts
 */
import assert from 'node:assert/strict'
import { gzipSync } from 'fflate'
import { tarBytes, zipBytes } from './archive-codec.ts'
import { listArchiveEntries, listTarEntries, listZipEntries } from './archive-list.ts'

const encoder = new TextEncoder()
function text(value: string): Uint8Array {
  return encoder.encode(value)
}

// 1. zip 列目录：文件 / 目录 / 大小 / 时间戳
{
  const zipped = zipBytes({
    'a.txt': text('hello'),
    'dir/b.bin': new Uint8Array([0, 1, 2, 3, 4]),
    '中文.txt': text('中文'),
  })
  const entries = listZipEntries(zipped)
  const byName = new Map(entries.map((entry) => [entry.path, entry]))

  assert.equal(entries.length, 3)
  const a = byName.get('a.txt')
  assert.ok(a && !a.isDirectory)
  assert.equal(a.originalSize, 5)
  assert.ok(a.compressedSize > 0)
  assert.equal(a.compressionMethod, 'deflate')
  assert.ok(a.mtime !== undefined)
  const b = byName.get('dir/b.bin')
  assert.ok(b && !b.isDirectory)
  assert.equal(b.originalSize, 5)
  const cn = byName.get('中文.txt')
  assert.ok(cn, '中文条目应存在')
  assert.equal(cn.originalSize, 6)
  console.log('zip 列目录: ok')
}

// 2. tar 列目录（tarBytes 不写目录条目，只列文件；名称与大小正确）
{
  const tar = tarBytes({
    'pkg/a.txt': text('x'),
    'pkg/sub/b.bin': new Uint8Array([1, 2, 3]),
  })
  const entries = listTarEntries(tar)
  assert.equal(entries.length, 2)
  const a = entries.find((entry) => entry.path === 'pkg/a.txt')
  assert.ok(a && !a.isDirectory)
  assert.equal(a.originalSize, 1)
  const b = entries.find((entry) => entry.path === 'pkg/sub/b.bin')
  assert.ok(b && !b.isDirectory)
  assert.equal(b.originalSize, 3)
  console.log('tar 列目录: ok')
}

// 3. tar.gz 与 gzip-file 列目录
{
  const gz = gzipSync(tarBytes({ 'pkg/index.js': text('export default 1') }))
  const listing = listArchiveEntries(gz, 'auto')
  assert.equal(listing.format, 'gzip-tar')
  assert.equal(listing.entries.length, 1)
  assert.equal(listing.entries[0]!.path, 'pkg/index.js')

  const raw = gzipSync(text('plain gzip file'))
  const single = listArchiveEntries(raw, 'auto')
  assert.equal(single.format, 'gzip-file')
  assert.equal(single.entries.length, 1)
  assert.equal(single.entries[0]!.originalSize, 15)
  assert.equal(single.entries[0]!.compressionMethod, 'gzip')
  console.log('tar.gz / gzip-file 列目录: ok')
}

// 4. 空 zip 与无效输入
{
  const empty = zipBytes({})
  assert.equal(listZipEntries(empty).length, 0)
  assert.throws(() => listZipEntries(text('not a zip at all')))
  console.log('空 zip / 无效输入: ok')
}

console.log('archive-list.test.ts: ok')
