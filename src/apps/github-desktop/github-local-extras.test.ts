/**
 * 分支名校验与 tip 未推送判定。
 *
 * 运行：node --experimental-strip-types src/apps/github-desktop/github-local-extras.test.ts
 */
import assert from 'node:assert/strict'
import { validateGithubBranchName } from './github-branch.ts'
import { isTipUnpushedSha } from './github-local-history.ts'
import type { GithubLocalCommit } from './github-sync-meta.ts'

{
  assert.equal(validateGithubBranchName(''), '请输入分支名')
  assert.equal(validateGithubBranchName('feature/foo'), undefined)
  assert.equal(validateGithubBranchName('bad name'), '分支名不能包含空格')
  assert.ok(validateGithubBranchName('..oops'))
  assert.ok(validateGithubBranchName('ends.'))
}

{
  const tip: GithubLocalCommit = {
    sha: 'local-abc',
    message: 'm',
    author: 'a',
    committedAt: 1,
    branch: 'main',
  }
  assert.equal(isTipUnpushedSha('local-abc', tip), true)
  assert.equal(isTipUnpushedSha('local-other', tip), false)
  assert.equal(isTipUnpushedSha('local-abc', undefined), false)
}

console.log('github-local-extras.test.ts: ok')
