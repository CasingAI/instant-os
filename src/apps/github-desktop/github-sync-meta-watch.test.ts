/**
 * github-sync-meta 仓库变更订阅。
 *
 * 运行：node --experimental-strip-types src/apps/github-desktop/github-sync-meta-watch.test.ts
 */
import assert from 'node:assert/strict'
import {
  notifyGithubRepoMetaChanged,
  subscribeGithubRepoMeta,
  type GithubRepoMetaChange,
} from './github-sync-meta.ts'

{
  const seen: GithubRepoMetaChange[] = []
  const unsub = subscribeGithubRepoMeta((change) => {
    seen.push(change)
  })
  notifyGithubRepoMetaChanged({ owner: 'acme', repo: 'demo', kind: 'updated' })
  notifyGithubRepoMetaChanged({ owner: 'acme', repo: 'demo', kind: 'deleted' })
  assert.equal(seen.length, 2)
  assert.deepEqual(seen[0], { owner: 'acme', repo: 'demo', kind: 'updated' })
  assert.deepEqual(seen[1], { owner: 'acme', repo: 'demo', kind: 'deleted' })
  unsub()
  notifyGithubRepoMetaChanged({ owner: 'acme', repo: 'demo', kind: 'updated' })
  assert.equal(seen.length, 2)
}

{
  let secondCalled = false
  const unsubBoom = subscribeGithubRepoMeta(() => {
    throw new Error('listener boom')
  })
  const unsubOk = subscribeGithubRepoMeta(() => {
    secondCalled = true
  })
  // 某个 listener 抛错不应阻断其它订阅者
  const originalError = console.error
  console.error = () => undefined
  try {
    assert.doesNotThrow(() =>
      notifyGithubRepoMetaChanged({ owner: 'acme', repo: 'other', kind: 'updated' }),
    )
  } finally {
    console.error = originalError
  }
  assert.equal(secondCalled, true)
  unsubBoom()
  unsubOk()
}

console.log('github-sync-meta-watch.test.ts: ok')
