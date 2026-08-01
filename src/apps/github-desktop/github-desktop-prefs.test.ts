/**
 * github-desktop-prefs：Co-authored-by 组装 / 解析。
 *
 * 运行：node --experimental-strip-types src/apps/github-desktop/github-desktop-prefs.test.ts
 */
import assert from 'node:assert/strict'
import {
  buildGithubCommitMessage,
  formatCoAuthorNames,
  formatCoAuthorTrailer,
  INSTANT_AGENT_COAUTHOR,
  parseCoAuthorTrailers,
  withInstantAgentCoAuthor,
} from './github-desktop-prefs.ts'

{
  const trailer = formatCoAuthorTrailer(INSTANT_AGENT_COAUTHOR)
  assert.equal(
    trailer,
    'Co-authored-by: Instant Agent <instantagent@casing-ai.com>',
  )
}

{
  const message = buildGithubCommitMessage(
    'fix: oops',
    'details here',
    [INSTANT_AGENT_COAUTHOR],
  )
  assert.equal(
    message,
    [
      'fix: oops',
      '',
      'details here',
      '',
      'Co-authored-by: Instant Agent <instantagent@casing-ai.com>',
    ].join('\n'),
  )
  const parsed = parseCoAuthorTrailers(message)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0]?.name, 'Instant Agent')
  assert.equal(parsed[0]?.email, 'instantagent@casing-ai.com')
}

{
  const message = [
    'title',
    '',
    'Co-authored-by: Instant Agent <instantagent@casing-ai.com>',
    'Co-authored-by: Instant Agent <instantagent@casing-ai.com>',
    'Co-authored-by: Other <other@example.com>',
    'Not a trailer',
  ].join('\n')
  const parsed = parseCoAuthorTrailers(message)
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0]?.name, 'Instant Agent')
  assert.equal(parsed[1]?.name, 'Other')
  assert.equal(formatCoAuthorNames(parsed), 'Instant Agent、Other')
}

{
  assert.deepEqual(parseCoAuthorTrailers('no trailers'), [])
  assert.equal(formatCoAuthorNames([]), '')
}

{
  const withTrailer = withInstantAgentCoAuthor('fix: oops')
  assert.equal(
    withTrailer,
    [
      'fix: oops',
      '',
      'Co-authored-by: Instant Agent <instantagent@casing-ai.com>',
    ].join('\n'),
  )
  assert.equal(withInstantAgentCoAuthor('fix: oops', false), 'fix: oops')
  assert.equal(withInstantAgentCoAuthor(withTrailer), withTrailer)
  assert.equal(withInstantAgentCoAuthor('  '), '')
}

console.log('github-desktop-prefs.test.ts: ok')
