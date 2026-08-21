/**
 * 运行：node --experimental-strip-types src/page-host/page-nav.test.ts
 */
import assert from 'node:assert/strict'
import {
  resetNavDedupState,
  resolveNavIntent,
  shouldCreateTab,
  shouldNavigateSameTab,
} from './page-nav.ts'

resetNavDedupState()

{
  const intent = resolveNavIntent({
    kind: 'LOCATION',
    method: 'open',
    url: 'https://example.com/a',
    target: '_blank',
  })
  assert.equal(intent.action, 'newTab')
  assert.equal(shouldCreateTab(intent), true)
}

resetNavDedupState()

{
  const intent = resolveNavIntent(
    {
      kind: 'LOCATION',
      method: 'open',
      url: 'https://example.com/b',
      target: '_top',
    },
    { currentUrl: 'https://example.com/a' },
  )
  assert.equal(intent.action, 'sameTab')
  assert.equal(shouldNavigateSameTab(intent), true)
}

resetNavDedupState()

{
  const intent = resolveNavIntent(
    {
      kind: 'LOCATION',
      method: 'open',
      url: 'https://example.com/a',
      target: '_top',
    },
    { currentUrl: 'https://example.com/a' },
  )
  assert.equal(intent.action, 'ignore')
}

resetNavDedupState()

{
  const intent = resolveNavIntent({
    kind: 'CLICK',
    href: 'https://example.com/c',
    target: '_blank',
  })
  assert.equal(shouldCreateTab(intent), true)
}

resetNavDedupState()

{
  const event = {
    kind: 'LOCATION' as const,
    method: 'assign',
    url: 'https://example.com/d',
  }
  const first = resolveNavIntent(event)
  const second = resolveNavIntent(event)
  assert.equal(first.action, 'sameTab')
  assert.equal(second.action, 'ignore')
}

resetNavDedupState()

{
  const intent = resolveNavIntent({
    kind: 'CLICK',
    href: 'https://example.com/file.pdf',
    download: true,
  })
  assert.equal(intent.action, 'download')
  if (intent.action === 'download') {
    assert.equal(intent.url, 'https://example.com/file.pdf')
    assert.equal(intent.filename, undefined)
  }
  assert.equal(shouldCreateTab(intent), false)
  assert.equal(shouldNavigateSameTab(intent), false)
}

resetNavDedupState()

{
  const intent = resolveNavIntent({
    kind: 'CLICK',
    href: 'https://example.com/file.pdf',
    target: '_blank',
    download: 'report.pdf',
  })
  assert.equal(intent.action, 'download')
  if (intent.action === 'download') {
    assert.equal(intent.filename, 'report.pdf')
  }
}

console.log('ok: page-nav resolveNavIntent')
