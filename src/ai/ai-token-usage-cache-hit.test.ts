/**
 * 缓存命中率口径单测。
 * 运行：node --experimental-strip-types src/ai/ai-token-usage-cache-hit.test.ts
 */
import assert from 'node:assert/strict'
import {
  cacheReadPromptTokensFromUsage,
  formatCacheHitRate,
  rebuildModelCacheReadPromptTokens,
  summaryNeedsCacheReadPromptRebuild,
} from './ai-token-usage-cache-hit.ts'
import type { AiTokenUsageRecord } from './ai-token-usage-types.ts'

assert.equal(formatCacheHitRate(0, 0), '—')
assert.equal(formatCacheHitRate(800, 0), '—')
assert.equal(cacheReadPromptTokensFromUsage(0, 1000), 0)
assert.equal(cacheReadPromptTokensFromUsage(800, 1000), 1000)

const coldAndHitCached = 0 + 800
const allPrompt = 1000 + 1000
assert.equal(formatCacheHitRate(coldAndHitCached, allPrompt), '40%')
assert.equal(
  formatCacheHitRate(
    coldAndHitCached,
    cacheReadPromptTokensFromUsage(0, 1000) + cacheReadPromptTokensFromUsage(800, 1000),
  ),
  '80%',
)

const legacySummary: AiTokenUsageRecord = {
  totalPromptTokens: 2000,
  totalCompletionTokens: 50,
  totalCachedPromptTokens: 800,
  totalTokens: 2050,
  requestCount: 2,
  byActor: {},
  byDay: {},
  byModel: {
    'gpt-test': {
      model: 'gpt-test',
      promptTokens: 2000,
      completionTokens: 50,
      cachedPromptTokens: 800,
      totalTokens: 2050,
      requestCount: 2,
    } as AiTokenUsageRecord['byModel'][string],
  },
}

assert.equal(summaryNeedsCacheReadPromptRebuild(legacySummary), true)
assert.equal(
  formatCacheHitRate(
    legacySummary.byModel['gpt-test']!.cachedPromptTokens,
    legacySummary.byModel['gpt-test']!.promptTokens,
  ),
  '40%',
)

const withoutRequests = rebuildModelCacheReadPromptTokens(legacySummary, [])
assert.equal(withoutRequests.byModel['gpt-test']!.cacheReadPromptTokens, 0)
assert.equal(
  formatCacheHitRate(
    withoutRequests.byModel['gpt-test']!.cachedPromptTokens,
    withoutRequests.byModel['gpt-test']!.cacheReadPromptTokens,
  ),
  '—',
)

const withRequests = rebuildModelCacheReadPromptTokens(legacySummary, [
  { model: 'gpt-test', promptTokens: 1000, cachedPromptTokens: 0 },
  { model: 'gpt-test', promptTokens: 1000, cachedPromptTokens: 800 },
])
assert.equal(withRequests.byModel['gpt-test']!.cacheReadPromptTokens, 1000)
assert.equal(
  formatCacheHitRate(
    withRequests.byModel['gpt-test']!.cachedPromptTokens,
    withRequests.byModel['gpt-test']!.cacheReadPromptTokens,
  ),
  '80%',
)

const migrated = rebuildModelCacheReadPromptTokens(legacySummary, [
  { model: 'gpt-test', promptTokens: 1000, cachedPromptTokens: 0 },
  { model: 'gpt-test', promptTokens: 1000, cachedPromptTokens: 800 },
])
assert.equal(summaryNeedsCacheReadPromptRebuild(migrated), false)

console.log('ai-token-usage-cache-hit.test.ts: ok')
