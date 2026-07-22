/**
 * revisionId 元数据对比：相同 / 不等 / 缺省回退 / 增删。
 *
 * 运行：node --experimental-strip-types src/apps/github-desktop/github-revision-diff.test.ts
 */
import assert from 'node:assert/strict'
import {
  diffRevisionSnapshot,
  fileIndexHasAnyRevisionId,
} from './github-revision-diff.ts'
import {
  reconcileFileIndexRevisionIds,
  type GithubFileIndexEntry,
  type GithubRevisionSnapshotEntry,
} from './github-sync-meta.ts'

function entry(
  hash: string,
  byteSize = 10,
  revisionId?: string,
): GithubFileIndexEntry {
  const item: GithubFileIndexEntry = { hash, byteSize }
  if (revisionId !== undefined) item.revisionId = revisionId
  return item
}

function snap(
  path: string,
  contentRevisionId: string | undefined,
  byteSize = 10,
): GithubRevisionSnapshotEntry {
  return {
    path,
    absolutePath: `/repo/github/o/r/${path}`,
    byteSize,
    contentRevisionId,
  }
}

const root = '/repo/github/o/r'

{
  const changes = diffRevisionSnapshot(
    { 'a.ts': entry('h1', 10, 'r1'), 'b.ts': entry('h2', 10, 'r2') },
    [snap('a.ts', 'r1'), snap('b.ts', 'r2')],
    root,
  )
  assert.equal(changes.length, 0)
}

{
  const changes = diffRevisionSnapshot(
    { 'a.ts': entry('h1', 10, 'r1') },
    [snap('a.ts', 'r2')],
    root,
  )
  assert.deepEqual(changes, [
    {
      path: 'a.ts',
      kind: 'modified',
      absolutePath: '/repo/github/o/r/a.ts',
      needsHashCheck: false,
      byteSize: 10,
    },
  ])
}

{
  const changes = diffRevisionSnapshot(
    { 'a.ts': entry('h1', 10) },
    [snap('a.ts', 'r1')],
    root,
  )
  assert.equal(changes.length, 1)
  assert.equal(changes[0]!.needsHashCheck, true)
  assert.equal(changes[0]!.kind, 'modified')
}

{
  const changes = diffRevisionSnapshot(
    { 'a.ts': entry('h1', 10, 'r1') },
    [snap('a.ts', undefined)],
    root,
  )
  assert.equal(changes[0]!.needsHashCheck, true)
}

{
  const changes = diffRevisionSnapshot({}, [snap('new.ts', 'rn', 20)], root)
  assert.deepEqual(changes, [
    {
      path: 'new.ts',
      kind: 'added',
      absolutePath: '/repo/github/o/r/new.ts',
      needsHashCheck: false,
      byteSize: 20,
    },
  ])
}

{
  const changes = diffRevisionSnapshot(
    { 'gone.ts': entry('hg', 10, 'rg') },
    [],
    root,
  )
  assert.deepEqual(changes, [
    {
      path: 'gone.ts',
      kind: 'deleted',
      absolutePath: '/repo/github/o/r/gone.ts',
      needsHashCheck: false,
    },
  ])
}

{
  assert.equal(fileIndexHasAnyRevisionId({ a: entry('h') }), false)
  assert.equal(fileIndexHasAnyRevisionId({ a: entry('h', 10, 'r') }), true)
}

{
  const next = reconcileFileIndexRevisionIds(
    { 'a.ts': entry('h1', 10, 'old'), 'b.ts': entry('h2', 20) },
    [snap('a.ts', 'new', 11), snap('b.ts', 'rb', 20)],
    new Set(['a.ts']),
  )
  assert.equal(next['a.ts']!.revisionId, 'new')
  assert.equal(next['a.ts']!.byteSize, 11)
  assert.equal(next['b.ts']!.revisionId, undefined)
}

console.log('github-revision-diff.test.ts: ok')
