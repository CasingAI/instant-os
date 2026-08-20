/**
 * archive-codec 纯函数测试：编解码往返 + 魔数识别。
 *
 * 运行：node --experimental-strip-types src/archive/archive-codec.test.ts
 *
 * 注：Archive Worker 的线程行为（worker 消息往返）无法在 node 里跑，
 * 这里覆盖 Worker 内部复用的全部纯函数（codec / untar / unzip / decodeGzipTar）。
 */
import assert from 'node:assert/strict'
import { gzipSync } from 'fflate'
import { decodeGzipTar } from './archive-extract.ts'
import { detectArchiveFormat, tarBytes, toExactArrayBuffer, zipBytes } from './archive-codec.ts'
import { untarBytes } from './archive-untar.ts'
import { unzipBytes } from './archive-unzip.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function text(value: string): Uint8Array {
  return encoder.encode(value)
}

function readText(bytes: Uint8Array | undefined): string {
  return bytes ? decoder.decode(bytes) : ''
}

// 1. zip 往返（含中文名与二进制）
{
  const files = {
    'a.txt': text('hello zip'),
    'dir/b.bin': new Uint8Array([0, 1, 2, 255]),
    '中文名.txt': text('中文内容'),
  }
  const zipped = zipBytes(files)
  assert.ok(zipped.byteLength > 0)
  assert.equal(detectArchiveFormat(zipped), 'zip')
  const decoded = unzipBytes(zipped, { stripRoot: false })
  assert.equal(decoded.size, 3)
  assert.equal(readText(decoded.get('a.txt')), 'hello zip')
  assert.deepEqual([...(decoded.get('dir/b.bin') ?? [])], [0, 1, 2, 255])
  assert.equal(readText(decoded.get('中文名.txt')), '中文内容')
  console.log('zip 往返: ok')
}

// 2. tar 往返（含子目录）
{
  const files = {
    'a.txt': text('hello tar'),
    'dir/b.bin': new Uint8Array([9, 8, 7]),
  }
  const tar = tarBytes(files)
  assert.equal(detectArchiveFormat(tar), 'tar')
  const decoded = untarBytes(tar)
  assert.equal(readText(decoded['a.txt']), 'hello tar')
  assert.deepEqual([...(decoded['dir/b.bin'] ?? [])], [9, 8, 7])
  console.log('tar 往返: ok')
}

// 3. tar.gz 往返（tarBytes + gzipSync → decodeGzipTar）
{
  const files = { 'pkg/index.js': text('export default 1') }
  const gz = gzipSync(tarBytes(files))
  assert.equal(detectArchiveFormat(gz), 'gzip-tar')
  const decoded = decodeGzipTar(gz)
  assert.equal(readText(decoded.get('pkg/index.js')), 'export default 1')
  console.log('tar.gz 往返: ok')
}

// 4. 魔数识别：裸 tar / 普通文本 / 空输入
{
  const tar = tarBytes({ 'x.txt': text('x') })
  assert.equal(detectArchiveFormat(tar), 'tar')
  assert.equal(detectArchiveFormat(text('plain text file content')), undefined)
  assert.equal(detectArchiveFormat(new Uint8Array(0)), undefined)
  console.log('魔数识别: ok')
}

// 5. zip stripRoot：默认剥公共根，stripRoot: false 保留
{
  const zipped = zipBytes({ 'owner-repo-sha/a.txt': text('x') })
  const stripped = unzipBytes(zipped)
  assert.equal(stripped.size, 1)
  assert.ok(stripped.has('a.txt'))
  assert.ok(!stripped.has('owner-repo-sha/a.txt'))
  const kept = unzipBytes(zipped, { stripRoot: false })
  assert.ok(kept.has('owner-repo-sha/a.txt'))
  console.log('zip stripRoot: ok')
}

// 6. 空 zip
{
  const zipped = zipBytes({})
  assert.equal(detectArchiveFormat(zipped), 'zip')
  const decoded = unzipBytes(zipped, { stripRoot: false })
  assert.equal(decoded.size, 0)
  console.log('空 zip: ok')
}

// 7. tar 长路径（prefix 拆分，>100 字符）
{
  const longPath = `${'x'.repeat(60)}/${'y'.repeat(60)}/${'z'.repeat(60)}.txt`
  const tar = tarBytes({ [longPath]: text('deep') })
  const decoded = untarBytes(tar)
  assert.equal(readText(decoded[longPath]), 'deep')
  console.log('tar 长路径: ok')
}

// 8. toExactArrayBuffer：子视图复制为独立缓冲，整缓冲原样返回
{
  const base = new Uint8Array(100)
  const view = base.subarray(10, 20)
  const exact = toExactArrayBuffer(view)
  assert.equal(exact.byteLength, 10)
  assert.notEqual(exact, base.buffer)
  assert.equal(toExactArrayBuffer(base), base.buffer)
  console.log('toExactArrayBuffer: ok')
}

console.log('archive-codec.test.ts: ok')
