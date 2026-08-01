/**
 * rebase 纯函数：冲突求交、本地链接到新 tip fileIndex。
 *
 * 运行：node --experimental-strip-types src/apps/github-desktop/github-rebase.test.ts
 */
import assert from 'node:assert/strict'
import {
  applyLocalCommitChangesToFileIndex,
  collectUnpushedChangePaths,
  findRebaseConflictPaths,
  rebaseLocalCommitChainOntoFileIndex,
} from './github-rebase.ts'
import type { GithubFileIndexEntry, GithubLocalCommit } from './github-sync-meta.ts'

function entry(hash: string, byteSize = 10): GithubFileIndexEntry {
  return { hash, byteSize }
}

function commit(partial: Partial<GithubLocalCommit> & Pick<GithubLocalCommit, 'sha'>): GithubLocalCommit {
  return {
    message: 'msg',
    author: 'a',
    committedAt: 1,
    branch: 'main',
    ...partial,
  }
}

{
  const paths = collectUnpushedChangePaths([
    commit({
      sha: 'local-1',
      changes: [
        { path: 'a.ts', kind: 'modified' },
        { path: 'b.ts', kind: 'added' },
      ],
    }),
    commit({
      sha: 'local-2',
      changes: [{ path: 'a.ts', kind: 'modified' }],
    }),
  ])
  assert.deepEqual([...paths].sort(), ['a.ts', 'b.ts'])
}

{
  assert.deepEqual(findRebaseConflictPaths(['x.ts', 'y.ts'], new Set(['a.ts'])), [])
  assert.deepEqual(
    findRebaseConflictPaths(['b.ts', 'a.ts', 'c.ts'], new Set(['a.ts', 'c.ts'])),
    ['a.ts', 'c.ts'],
  )
}

{
  const base = {
    'keep.ts': entry('k'),
    'edit.ts': entry('old'),
    'gone.ts': entry('g'),
  }
  const after = applyLocalCommitChangesToFileIndex(
    base,
    commit({
      sha: 'local-1',
      changes: [
        { path: 'edit.ts', kind: 'modified' },
        { path: 'gone.ts', kind: 'deleted' },
        { path: 'new.ts', kind: 'added' },
      ],
      fileIndexAfter: {
        'keep.ts': entry('k'),
        'edit.ts': entry('new'),
        'new.ts': entry('n', 3),
      },
    }),
  )
  assert.deepEqual(after, {
    'keep.ts': entry('k'),
    'edit.ts': entry('new'),
    'new.ts': entry('n', 3),
  })
}

{
  const remoteTip = {
    'remote-only.ts': entry('r'),
    'shared.ts': entry('s0'),
  }
  const chain = [
    commit({
      sha: 'local-1',
      committedAt: 10,
      parentSha: 'old-base',
      changes: [{ path: 'a.ts', kind: 'added' }],
      fileIndexAfter: {
        'shared.ts': entry('s0'),
        'a.ts': entry('a1'),
      },
    }),
    commit({
      sha: 'local-2',
      committedAt: 20,
      parentSha: 'local-1',
      changes: [{ path: 'a.ts', kind: 'modified' }],
      fileIndexAfter: {
        'shared.ts': entry('s0'),
        'a.ts': entry('a2'),
      },
    }),
  ]
  const { commits, tipFileIndex } = rebaseLocalCommitChainOntoFileIndex(
    remoteTip,
    chain,
    'live-tip',
  )
  assert.equal(commits[0]!.parentSha, 'live-tip')
  assert.equal(commits[1]!.parentSha, 'local-1')
  assert.equal(commits[0]!.sha, 'local-1')
  assert.equal(commits[1]!.sha, 'local-2')
  assert.deepEqual(commits[0]!.fileIndexBefore, remoteTip)
  assert.deepEqual(commits[0]!.fileIndexAfter, {
    'remote-only.ts': entry('r'),
    'shared.ts': entry('s0'),
    'a.ts': entry('a1'),
  })
  assert.deepEqual(tipFileIndex, {
    'remote-only.ts': entry('r'),
    'shared.ts': entry('s0'),
    'a.ts': entry('a2'),
  })
  assert.deepEqual(commits[1]!.fileIndexBefore, commits[0]!.fileIndexAfter)
}

console.log('github-rebase.test.ts: ok')
