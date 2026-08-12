/**
 * archive-utility-tree 纯函数测试：目录层级构建 / 选中过滤 / 格式化。
 *
 * 运行：node --experimental-strip-types src/apps/archive-utility/archive-utility-tree.test.ts
 */
import assert from 'node:assert/strict'
import type { ArchiveEntryMeta } from '../../archive/archive-list.ts'
import {
  buildArchiveLevel,
  filterEntriesBySelection,
  formatArchiveBytes,
  formatArchiveRatio,
} from './archive-utility-tree.ts'

const encoder = new TextEncoder()

function file(path: string, originalSize = 4): ArchiveEntryMeta {
  return {
    path,
    originalSize,
    compressedSize: originalSize,
    isDirectory: false,
  }
}

function dir(path: string): ArchiveEntryMeta {
  return { path, originalSize: 0, compressedSize: 0, isDirectory: true }
}

// 1. 根层级：显式目录 + 隐式目录 + 文件，排序目录优先
{
  const entries = [file('b.txt'), file('a/x.txt'), file('a/y.txt'), dir('z'), file('c.txt')]
  const level = buildArchiveLevel(entries, [])
  assert.deepEqual(
    level.map((item) => (item.kind === 'dir' ? `d:${item.name}` : `f:${item.name}`)),
    ['d:a', 'd:z', 'f:b.txt', 'f:c.txt'],
  )
  console.log('根层级: ok')
}

// 2. 进入子目录：只显示该目录下内容
{
  const entries = [file('a/x.txt'), file('a/sub/deep.txt'), dir('a'), file('b.txt')]
  const level = buildArchiveLevel(entries, ['a'])
  assert.deepEqual(level.map((item) => item.name), ['sub', 'x.txt'])
  console.log('子目录层级: ok')
}

// 3. 选中过滤：文件自身 + 目录整棵子树
{
  const entries = new Map<string, Uint8Array>([
    ['a/x.txt', encoder.encode('x')],
    ['a/sub/deep.txt', encoder.encode('d')],
    ['b.txt', encoder.encode('b')],
  ])
  const filtered = filterEntriesBySelection(entries, new Set(['a']))
  assert.deepEqual([...filtered.keys()].sort(), ['a/sub/deep.txt', 'a/x.txt'])
  const single = filterEntriesBySelection(entries, new Set(['b.txt']))
  assert.deepEqual([...single.keys()], ['b.txt'])
  const none = filterEntriesBySelection(entries, new Set())
  assert.equal(none.size, 3)
  console.log('选中过滤: ok')
}

// 4. 格式化
{
  assert.equal(formatArchiveBytes(512), '512 B')
  assert.equal(formatArchiveBytes(1024), '1.0 KB')
  assert.equal(formatArchiveBytes(3 * 1024 * 1024), '3.0 MB')
  assert.equal(formatArchiveRatio(100, 25), '25%')
  assert.equal(formatArchiveRatio(0, 0), undefined)
  assert.equal(formatArchiveRatio(100, 0), '0%')
  console.log('格式化: ok')
}

console.log('archive-utility-tree.test.ts: ok')
