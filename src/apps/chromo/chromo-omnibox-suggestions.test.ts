/**
 * 运行：node --experimental-strip-types src/apps/chromo/chromo-omnibox-suggestions.test.ts
 */
import assert from 'node:assert/strict'
import { rankChromoOmniboxSuggestions } from './chromo-omnibox-suggestions.ts'
import type { ChromoBookmark } from './chromo-bookmarks.ts'
import type { ChromoHistoryVisit } from './chromo-history.ts'

function visit(url: string, title: string, visitedAt: number): ChromoHistoryVisit {
  return { url, title, visitedAt }
}

function bookmark(url: string, title: string): ChromoBookmark {
  return { url, title }
}

function testEmptyQuery(): void {
  const results = rankChromoOmniboxSuggestions('   ', {
    history: [visit('https://www.example.com/', 'Example', 1)],
    bookmarks: [bookmark('https://github.com/', 'GitHub')],
  })
  assert.equal(results.length, 0)
  console.log('ok: empty query')
}

function testSearchTitleHostAndUrl(): void {
  const now = Date.now()
  const results = rankChromoOmniboxSuggestions('git', {
    history: [
      visit('https://www.example.com/', 'Example', now),
      visit('https://gitlab.com/', 'GitLab', now - 1000),
    ],
    bookmarks: [bookmark('https://github.com/', 'GitHub')],
  })
  assert.ok(results.some((item) => item.url === 'https://github.com/'))
  assert.ok(results.some((item) => item.url === 'https://gitlab.com/'))
  assert.equal(results.some((item) => item.url === 'https://www.example.com/'), false)
  console.log('ok: search title host and url')
}

function testBookmarkRanksAboveOlderHistory(): void {
  const now = Date.now()
  const results = rankChromoOmniboxSuggestions('wiki', {
    history: [visit('https://en.wikipedia.org/', 'Wikipedia', now - 86_400_000 * 40)],
    bookmarks: [bookmark('https://zh.wikipedia.org/', 'Wikipedia')],
  })
  assert.equal(results[0]?.url, 'https://zh.wikipedia.org/')
  assert.equal(results[0]?.source, 'bookmark')
  console.log('ok: bookmark ranks above older history')
}

function testDedupAndLimit(): void {
  const now = Date.now()
  const history = Array.from({ length: 12 }, (_, index) =>
    visit(`https://www.example.com/p${index}`, `Page ${index}`, now - index * 1000),
  )
  const results = rankChromoOmniboxSuggestions('example', {
    history: [
      visit('https://github.com/', 'GitHub', now),
      ...history,
    ],
    bookmarks: [bookmark('https://www.example.com/p0', 'Page 0')],
  })
  assert.equal(results.length, 8)
  assert.equal(results.filter((item) => item.url === 'https://www.example.com/p0').length, 1)
  assert.equal(results.some((item) => item.url === 'https://github.com/'), false)
  console.log('ok: dedup and limit')
}

testEmptyQuery()
testSearchTitleHostAndUrl()
testBookmarkRanksAboveOlderHistory()
testDedupAndLimit()
console.log('chromo-omnibox-suggestions tests passed')
