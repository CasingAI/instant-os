/**
 * files-extract-layout 纯函数测试：顶层名统计 / 包裹前缀 / 裸 gz 判定。
 *
 * 运行：node --experimental-strip-types src/apps/files/files-extract-layout.test.ts
 */
import assert from 'node:assert/strict'
import { isBareGzipFileName, topLevelNames, wrapEntriesInFolder } from './files-extract-layout.ts'

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

// 1. 顶层名统计：GitHub 式单根 → 1 个；散装多根 → 按首见顺序；空段忽略
{
  const entries = new Map<string, Uint8Array>([
    ['project-main/README.md', text('readme')],
    ['project-main/src/index.ts', text('code')],
    ['loose.txt', text('loose')],
    ['another/', text('')],
  ])
  assert.deepEqual(topLevelNames(entries.keys()), ['project-main', 'loose.txt', 'another'])
  assert.deepEqual(topLevelNames([]), [])
  assert.deepEqual(topLevelNames(['', '/']), [])
  console.log('顶层名统计: ok')
}

// 2. 包裹前缀：所有条目加 `${folder}/`，且不改写原表
{
  const entries = new Map<string, Uint8Array>([
    ['a.txt', text('a')],
    ['dir/b.txt', text('b')],
  ])
  const wrapped = wrapEntriesInFolder(entries, 'foo')
  assert.equal(wrapped.get('foo/a.txt'), entries.get('a.txt'))
  assert.equal(wrapped.get('foo/dir/b.txt'), entries.get('dir/b.txt'))
  assert.deepEqual([...wrapped.keys()].sort(), ['foo/a.txt', 'foo/dir/b.txt'])
  assert.deepEqual([...entries.keys()].sort(), ['a.txt', 'dir/b.txt'])
  console.log('包裹前缀: ok')
}

// 3. 裸 gz 判定：.gz 为真；.tar.gz / .tgz / 其他后缀为假（大小写不敏感）
{
  assert.equal(isBareGzipFileName('notes.gz'), true)
  assert.equal(isBareGzipFileName('NOTES.GZ'), true)
  assert.equal(isBareGzipFileName('backup.tar.gz'), false)
  assert.equal(isBareGzipFileName('bundle.tgz'), false)
  assert.equal(isBareGzipFileName('image.zip'), false)
  assert.equal(isBareGzipFileName('noext'), false)
  console.log('裸 gz 判定: ok')
}
