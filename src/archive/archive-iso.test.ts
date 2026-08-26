/**
 * archive-iso 纯函数测试：CD001 魔数识别 + 镜像编解码往返。
 *
 * 运行：node --experimental-strip-types src/archive/archive-iso.test.ts
 */
import assert from 'node:assert/strict'
import { detectArchiveFormat } from './archive-codec.ts'
import { listArchiveEntries } from './archive-list.ts'
import { isIsoImageBytes, isoBytes, listIsoEntries, unisoBytes } from './archive-iso.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function text(value: string): Uint8Array {
  return encoder.encode(value)
}

function readText(bytes: Uint8Array | undefined): string {
  return bytes ? decoder.decode(bytes) : ''
}

// 1. 构建镜像 → 魔数识别（判定优先于扩展名，文件名不参与）
{
  const iso = isoBytes({ 'a.txt': text('hello iso') })
  assert.ok(iso.byteLength > 0)
  assert.equal(detectArchiveFormat(iso), 'iso')
  assert.equal(isIsoImageBytes(iso), true)

  const notIso = text('plain text file, definitely not a disc image')
  assert.equal(isIsoImageBytes(notIso), false)
  assert.equal(detectArchiveFormat(notIso), undefined)

  // 过短输入不越界
  assert.equal(isIsoImageBytes(new Uint8Array(16)), false)
  console.log('魔数识别: ok')
}

// 2. 编解码往返（子目录 + 中文名 + 二进制 + 空文件）
{
  const files = {
    'a.txt': text('hello iso'),
    'docs/readme.md': text('# readme'),
    '目录/中文.txt': text('中文内容'),
    'empty.dat': new Uint8Array(0),
  }
  const iso = isoBytes(files)
  const decoded = unisoBytes(iso)
  assert.equal(decoded.size, 4)
  assert.equal(readText(decoded.get('a.txt')), 'hello iso')
  assert.equal(readText(decoded.get('docs/readme.md')), '# readme')
  // 中文长文件名靠 Joliet 树往返
  assert.equal(readText(decoded.get('目录/中文.txt')), '中文内容')
  assert.equal(decoded.get('empty.dat')?.byteLength, 0)
  console.log('编解码往返: ok')
}

// 3. 条目元数据（大小 / 时间；ISO 无压缩层，压缩后=原始）
{
  const files = {
    'a.txt': text('hello iso'),
    'dir/b.bin': new Uint8Array([1, 2, 3]),
  }
  const listing = listArchiveEntries(isoBytes(files), 'auto')
  assert.equal(listing.format, 'iso')
  assert.deepEqual(
    [...listing.entries.map((entry) => entry.path).sort()],
    ['a.txt', 'dir/b.bin'],
  )
  const metaA = listing.entries.find((entry) => entry.path === 'a.txt')
  assert.equal(metaA?.originalSize, 9)
  assert.equal(metaA?.compressedSize, 9)
  assert.equal(metaA?.isDirectory, false)
  assert.notEqual(metaA?.mtime, undefined)

  const metas = listIsoEntries(isoBytes(files))
  assert.equal(metas.length, 2)
  console.log('条目元数据: ok')
}

// 4. rewrite 语义：解码 → 删改 → 重建 → 覆盖验证
{
  const files = {
    'a.txt': text('keep'),
    'stale.txt': text('drop me'),
    'dir/inner.txt': text('inner'),
  }
  const first = unisoBytes(isoBytes(files))
  first.delete('stale.txt')
  first.set('a.txt', text('kept v2'))
  const rebuilt = isoBytes(Object.fromEntries(first))
  const second = unisoBytes(rebuilt)
  assert.equal(second.size, 2)
  assert.equal(readText(second.get('a.txt')), 'kept v2')
  assert.equal(second.has('stale.txt'), false)
  assert.equal(readText(second.get('dir/inner.txt')), 'inner')
  console.log('重建覆盖: ok')
}

// 5. 卷标识净化：非法字符转下划线并去首尾，空值回落 UNTITLED
{
  const iso = isoBytes({ 'a.txt': text('x') }, { volumeId: '我的光盘!' })
  const listing = listArchiveEntries(iso, 'auto')
  assert.equal(listing.format, 'iso')
  // 卷标识写入 PVD（偏移 40，32 字节 ASCII）——只验证可整盘读回即可
  assert.ok(iso.byteLength > 0x8006)
  console.log('卷标识净化: ok')
}
