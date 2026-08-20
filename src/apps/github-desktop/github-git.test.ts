/**
 * github-repo-paths / github-git fsMode 门禁 / 客侧展平。
 *
 * 运行：node --experimental-strip-types src/apps/github-desktop/github-git.test.ts
 */
import assert from 'node:assert/strict'
import {
  assertGithubGitMutationAllowed,
  flattenGithubGitResultForGuest,
  GITHUB_GIT_READONLY_MUTATION_MESSAGE,
  githubGitCommit,
  githubGitFetch,
} from './github-git.ts'
import { parseGithubRepoPath, GITHUB_USER_ROOT } from './github-repo-paths.ts'

{
  const hit = parseGithubRepoPath(`${GITHUB_USER_ROOT}/acme/demo`)
  assert.ok(hit)
  assert.equal(hit.owner, 'acme')
  assert.equal(hit.repo, 'demo')
  assert.equal(hit.repoRoot, `${GITHUB_USER_ROOT}/acme/demo`)
}

{
  const hit = parseGithubRepoPath(`${GITHUB_USER_ROOT}/acme/demo/src/index.ts`)
  assert.ok(hit)
  assert.equal(hit.owner, 'acme')
  assert.equal(hit.repo, 'demo')
}

{
  assert.equal(parseGithubRepoPath('/user/projects'), undefined)
  assert.equal(parseGithubRepoPath(GITHUB_USER_ROOT), undefined)
  assert.equal(parseGithubRepoPath(`${GITHUB_USER_ROOT}/.objects/ab`), undefined)
  assert.equal(parseGithubRepoPath(`${GITHUB_USER_ROOT}/onlyowner`), undefined)
}

{
  assert.doesNotThrow(() => assertGithubGitMutationAllowed('controlled'))
  assert.doesNotThrow(() => assertGithubGitMutationAllowed('normal'))
  assert.throws(
    () => assertGithubGitMutationAllowed('readonly'),
    (error: unknown) =>
      error instanceof Error && error.message === GITHUB_GIT_READONLY_MUTATION_MESSAGE,
  )
}

{
  const readonlyCtx = {
    cwd: `${GITHUB_USER_ROOT}/acme/demo`,
    fsMode: 'readonly' as const,
  }
  await assert.rejects(
    () => githubGitFetch(readonlyCtx),
    (error: unknown) =>
      error instanceof Error && error.message === GITHUB_GIT_READONLY_MUTATION_MESSAGE,
  )
  await assert.rejects(
    () => githubGitCommit(readonlyCtx, { message: 'x', all: true }),
    (error: unknown) =>
      error instanceof Error && error.message === GITHUB_GIT_READONLY_MUTATION_MESSAGE,
  )
}

{
  const guest = flattenGithubGitResultForGuest({
    summary: '仓库 acme/demo\n工作区干净',
    data: {
      owner: 'acme',
      repo: 'demo',
      branch: 'main',
      head: 'abc123',
      clean: true,
      hasUnpushedCommits: false,
      changes: [],
    },
    changeSet: {
      sessionId: 's1',
      createdAt: 1,
      sealedAt: 2,
      changes: [{ path: '/dev/github/acme/demo/a.ts', kind: 'modified' }],
    },
  })
  assert.equal(guest.summary, '仓库 acme/demo\n工作区干净')
  assert.equal(guest.owner, 'acme')
  assert.equal(guest.repo, 'demo')
  assert.equal(guest.branch, 'main')
  assert.equal(guest.head, 'abc123')
  assert.equal(guest.clean, true)
  assert.equal(guest.hasUnpushedCommits, false)
  assert.deepEqual(guest.changes, [])
  assert.equal('changeSet' in guest, false)
}

console.log('ok: github-git path parse + readonly mutation gate + guest flatten')
