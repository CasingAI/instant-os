/**
 * OpenAI usage 快照解析单测。
 * 运行：node --experimental-strip-types src/ai/openai-usage.test.ts
 */
import assert from 'node:assert/strict'
import { snapshotFromOpenAiUsage } from './openai-usage-snapshot.ts'

assert.equal(snapshotFromOpenAiUsage(undefined), undefined)
assert.equal(snapshotFromOpenAiUsage(null), undefined)
assert.equal(snapshotFromOpenAiUsage({}), undefined)

assert.deepEqual(
  snapshotFromOpenAiUsage({
    prompt_tokens: 100,
    completion_tokens: 20,
    total_tokens: 120,
  }),
  {
    promptTokens: 100,
    completionTokens: 20,
    totalTokens: 120,
    cachedPromptTokens: 0,
  },
)

assert.deepEqual(
  snapshotFromOpenAiUsage({
    prompt_tokens: 1000,
    completion_tokens: 50,
    total_tokens: 1050,
    prompt_tokens_details: { cached_tokens: 800 },
  }),
  {
    promptTokens: 1000,
    completionTokens: 50,
    totalTokens: 1050,
    cachedPromptTokens: 800,
  },
)

assert.deepEqual(
  snapshotFromOpenAiUsage({
    prompt_tokens: 400,
    completion_tokens: 10,
    total_tokens: 410,
    prompt_cache_hit_tokens: 250,
  }),
  {
    promptTokens: 400,
    completionTokens: 10,
    totalTokens: 410,
    cachedPromptTokens: 250,
  },
)

assert.deepEqual(
  snapshotFromOpenAiUsage({
    prompt_tokens: 300,
    completion_tokens: 8,
    total_tokens: 308,
    cache_read_input_tokens: 120,
  }),
  {
    promptTokens: 300,
    completionTokens: 8,
    totalTokens: 308,
    cachedPromptTokens: 120,
  },
)

assert.equal(
  snapshotFromOpenAiUsage({
    prompt_tokens: 100,
    completion_tokens: 1,
    total_tokens: 101,
    prompt_tokens_details: { cached_tokens: 999 },
  })?.cachedPromptTokens,
  100,
)

assert.equal(
  snapshotFromOpenAiUsage({
    prompt_tokens: 100,
    completion_tokens: 1,
    total_tokens: 101,
    prompt_tokens_details: { cached_tokens: 40 },
    prompt_cache_hit_tokens: 90,
  })?.cachedPromptTokens,
  40,
)

console.log('openai-usage.test.ts: ok')
