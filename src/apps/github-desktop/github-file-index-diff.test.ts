/**
 * fileIndex diff 正确性：相同 / 增 / 删 / 改 hash。
 *
 * 运行：node --experimental-strip-types src/apps/github-desktop/github-file-index-diff.test.ts
 */
import assert from 'node:assert/strict'
import { diffFileIndexes } from './github-file-index-diff.ts'
import type { GithubFileIndexEntry } from './github-sync-meta.ts'

function entry(hash: string, byteSize = 10): GithubFileIndexEntry {
  return { hash, byteSize }
}

{
  const ops = diffFileIndexes(
    { 'a.ts': entry('h1'), 'b.ts': entry('h2') },
    { 'a.ts': entry('h1'), 'b.ts': entry('h2') },
  )
  assert.equal(ops.length, 0)
}

{
  const ops = diffFileIndexes({}, { 'new.ts': entry('hn', 20) })
  assert.deepEqual(ops, [
    { kind: 'upsert', path: 'new.ts', hash: 'hn', byteSize: 20 },
  ])
}

{
  const ops = diffFileIndexes({ 'gone.ts': entry('hg') }, {})
  assert.deepEqual(ops, [{ kind: 'remove', path: 'gone.ts' }])
}

{
  const ops = diffFileIndexes(
    { 'same.ts': entry('hs'), 'edit.ts': entry('old') },
    { 'same.ts': entry('hs'), 'edit.ts': entry('new', 99) },
  )
  assert.deepEqual(ops, [
    { kind: 'upsert', path: 'edit.ts', hash: 'new', byteSize: 99 },
  ])
}

{
  const ops = diffFileIndexes(
    { 'a.ts': entry('a1'), 'b.ts': entry('b1') },
    { 'b.ts': entry('b2'), 'c.ts': entry('c1') },
  )
  assert.deepEqual(
    ops.map((op) => op.kind + ':' + op.path),
    ['remove:a.ts', 'upsert:b.ts', 'upsert:c.ts'],
  )
}

console.log('github-file-index-diff.test.ts: ok')
