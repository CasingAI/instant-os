/**
 * 词表族 modelId 匹配单测。
 * 运行：node --experimental-strip-types src/ai/model-tokenizer.test.ts
 */
import assert from 'node:assert/strict'
import {
  normalizeModelId,
  resolveTokenizerFamily,
  resolveTokenizerFamilyCandidates,
  type TokenizerFamily,
} from './model-tokenizer-resolve.ts'

type Case = { modelId: string; family: TokenizerFamily | undefined }

const MATCH_CASES: Case[] = [
  // A. deepseek-v4
  { modelId: 'deepseek-v4-flash', family: 'deepseek-v4' },
  { modelId: 'deepseek-v4-pro', family: 'deepseek-v4' },
  { modelId: 'deepseek-chat', family: 'deepseek-v4' },
  { modelId: 'deepseek-reasoner', family: 'deepseek-v4' },
  { modelId: 'deepseek/deepseek-v4-flash', family: 'deepseek-v4' },
  { modelId: 'deepseek/deepseek-v4-pro', family: 'deepseek-v4' },
  { modelId: 'deepseek/deepseek-chat', family: 'deepseek-v4' },

  // B. deepseek-v3
  { modelId: 'deepseek-v3', family: 'deepseek-v3' },
  { modelId: 'deepseek-v3.1', family: 'deepseek-v3' },
  { modelId: 'deepseek-v3.1-terminus', family: 'deepseek-v3' },
  { modelId: 'deepseek-v3.2', family: 'deepseek-v3' },
  { modelId: 'deepseek-v3.2-exp', family: 'deepseek-v3' },
  { modelId: 'deepseek-chat-v3-0324', family: 'deepseek-v3' },
  { modelId: 'deepseek-chat-v3.1', family: 'deepseek-v3' },
  { modelId: 'deepseek-r1', family: 'deepseek-v3' },
  { modelId: 'deepseek-r1-0528', family: 'deepseek-v3' },
  { modelId: 'deepseek/deepseek-v3.1-terminus', family: 'deepseek-v3' },
  { modelId: 'deepseek/deepseek-v3.2', family: 'deepseek-v3' },
  { modelId: 'deepseek/deepseek-v3.2-exp', family: 'deepseek-v3' },
  { modelId: 'deepseek/deepseek-chat-v3-0324', family: 'deepseek-v3' },
  { modelId: 'deepseek/deepseek-chat-v3.1', family: 'deepseek-v3' },
  { modelId: 'deepseek/deepseek-r1', family: 'deepseek-v3' },
  { modelId: 'deepseek/deepseek-r1-0528', family: 'deepseek-v3' },

  // C. mimo-v2.5
  { modelId: 'mimo-v2.5', family: 'mimo-v2.5' },
  { modelId: 'mimo-v2.5-pro', family: 'mimo-v2.5' },
  { modelId: 'mimo-v2.5-pro-ultraspeed', family: 'mimo-v2.5' },
  { modelId: 'mimo-v2.5-asr', family: 'mimo-v2.5' },
  { modelId: 'mimo-v2.5-tts', family: 'mimo-v2.5' },
  { modelId: 'mimo-v2-5', family: 'mimo-v2.5' },
  { modelId: 'mimo-v2-5-pro', family: 'mimo-v2.5' },
  { modelId: 'xiaomi/mimo-v2.5', family: 'mimo-v2.5' },
  { modelId: 'xiaomi/mimo-v2.5-pro', family: 'mimo-v2.5' },

  // D. mimo-v2-flash
  { modelId: 'mimo-v2-flash', family: 'mimo-v2-flash' },
  { modelId: 'mimo-v2-pro', family: 'mimo-v2-flash' },
  { modelId: 'mimo-v2-omni', family: 'mimo-v2-flash' },

  // E. kimi
  { modelId: 'kimi-k2', family: 'kimi' },
  { modelId: 'kimi-k2-0905', family: 'kimi' },
  { modelId: 'kimi-k2-thinking', family: 'kimi' },
  { modelId: 'kimi-k2.5', family: 'kimi' },
  { modelId: 'kimi-k2.6', family: 'kimi' },
  { modelId: 'kimi-k2.7-code', family: 'kimi' },
  { modelId: 'kimi-k3', family: 'kimi' },
  { modelId: 'kimi-latest', family: 'kimi' },
  { modelId: 'moonshot-v1-8k', family: 'kimi' },
  { modelId: 'moonshot-v1-32k', family: 'kimi' },
  { modelId: 'moonshot-v1-128k', family: 'kimi' },
  { modelId: 'moonshotai/kimi-k2', family: 'kimi' },
  { modelId: 'moonshotai/kimi-k2-0905', family: 'kimi' },
  { modelId: 'moonshotai/kimi-k2-thinking', family: 'kimi' },
  { modelId: 'moonshotai/kimi-k2.5', family: 'kimi' },
  { modelId: 'moonshotai/kimi-k2.6', family: 'kimi' },
  { modelId: 'moonshotai/kimi-k2.7-code', family: 'kimi' },
  { modelId: 'moonshotai/kimi-k3', family: 'kimi' },

  // E2. Doubao Seed / Ark route（回退 deepseek-v3）
  { modelId: 'doubao-seed-2.0-code', family: 'deepseek-v3' },
  { modelId: 'doubao-seed-2.0-pro', family: 'deepseek-v3' },
  { modelId: 'ark-code-latest', family: 'deepseek-v3' },

  // F. glm-5
  { modelId: 'glm-5.2', family: 'glm-5' },
  { modelId: 'glm-5.2[1m]', family: 'glm-5' },
  { modelId: 'GLM-5.2', family: 'glm-5' },
  { modelId: 'GLM-5.2[1m]', family: 'glm-5' },
  { modelId: 'glm-5.1', family: 'glm-5' },
  { modelId: 'glm-5', family: 'glm-5' },
  { modelId: 'glm-5-turbo', family: 'glm-5' },
  { modelId: 'glm-5v-turbo', family: 'glm-5' },
  { modelId: 'z-ai/glm-5.2', family: 'glm-5' },
  { modelId: 'z-ai/glm-5.1', family: 'glm-5' },
  { modelId: 'z-ai/glm-5', family: 'glm-5' },
  { modelId: 'z-ai/glm-5-turbo', family: 'glm-5' },
  { modelId: 'z-ai/glm-5v-turbo', family: 'glm-5' },

  // G. glm-4
  { modelId: 'glm-4.7', family: 'glm-4' },
  { modelId: 'glm-4.7-flash', family: 'glm-4' },
  { modelId: 'glm-4.7-flashx', family: 'glm-4' },
  { modelId: 'glm-4.6', family: 'glm-4' },
  { modelId: 'glm-4.6v', family: 'glm-4' },
  { modelId: 'glm-4.6v-flash', family: 'glm-4' },
  { modelId: 'glm-4.6v-flashx', family: 'glm-4' },
  { modelId: 'glm-4.5', family: 'glm-4' },
  { modelId: 'glm-4.5-air', family: 'glm-4' },
  { modelId: 'glm-4.5-airx', family: 'glm-4' },
  { modelId: 'glm-4.5-x', family: 'glm-4' },
  { modelId: 'glm-4.5-flash', family: 'glm-4' },
  { modelId: 'glm-4.5v', family: 'glm-4' },
  { modelId: 'glm-4-32b-0414-128k', family: 'glm-4' },
  { modelId: 'glm-4-long', family: 'glm-4' },
  { modelId: 'glm-4-flashx-250414', family: 'glm-4' },
  { modelId: 'glm-4-flash-250414', family: 'glm-4' },
  { modelId: 'glm-4.1v-thinking-flash', family: 'glm-4' },
  { modelId: 'glm-4.1v-thinking-flashx', family: 'glm-4' },
  { modelId: 'glm-4v-flash', family: 'glm-4' },
  { modelId: 'z-ai/glm-4.7', family: 'glm-4' },
  { modelId: 'z-ai/glm-4.7-flash', family: 'glm-4' },
  { modelId: 'z-ai/glm-4.6', family: 'glm-4' },
  { modelId: 'z-ai/glm-4.6v', family: 'glm-4' },
  { modelId: 'z-ai/glm-4.5', family: 'glm-4' },
  { modelId: 'z-ai/glm-4.5-air', family: 'glm-4' },
  { modelId: 'z-ai/glm-4.5v', family: 'glm-4' },

  // H. qwen3
  { modelId: 'qwen3-0.6b', family: 'qwen3' },
  { modelId: 'qwen3-1.7b', family: 'qwen3' },
  { modelId: 'qwen3-4b', family: 'qwen3' },
  { modelId: 'qwen3-8b', family: 'qwen3' },
  { modelId: 'qwen3-14b', family: 'qwen3' },
  { modelId: 'qwen3-32b', family: 'qwen3' },
  { modelId: 'qwen3-30b-a3b', family: 'qwen3' },
  { modelId: 'qwen3-30b-a3b-instruct-2507', family: 'qwen3' },
  { modelId: 'qwen3-30b-a3b-thinking-2507', family: 'qwen3' },
  { modelId: 'qwen3-235b-a22b', family: 'qwen3' },
  { modelId: 'qwen3-235b-a22b-2507', family: 'qwen3' },
  { modelId: 'qwen3-235b-a22b-instruct-2507', family: 'qwen3' },
  { modelId: 'qwen3-235b-a22b-thinking-2507', family: 'qwen3' },
  { modelId: 'qwen3-coder', family: 'qwen3' },
  { modelId: 'qwen3-coder-flash', family: 'qwen3' },
  { modelId: 'qwen3-coder-plus', family: 'qwen3' },
  { modelId: 'qwen3-coder-next', family: 'qwen3' },
  { modelId: 'qwen3-coder-30b-a3b-instruct', family: 'qwen3' },
  { modelId: 'qwen3-max', family: 'qwen3' },
  { modelId: 'qwen3-max-thinking', family: 'qwen3' },
  { modelId: 'qwen3-max-preview', family: 'qwen3' },
  { modelId: 'qwen3-next-80b-a3b-instruct', family: 'qwen3' },
  { modelId: 'qwen3-next-80b-a3b-thinking', family: 'qwen3' },
  { modelId: 'qwen3-vl-8b-instruct', family: 'qwen3' },
  { modelId: 'qwen3-vl-8b-thinking', family: 'qwen3' },
  { modelId: 'qwen3-vl-32b-instruct', family: 'qwen3' },
  { modelId: 'qwen3-vl-30b-a3b-instruct', family: 'qwen3' },
  { modelId: 'qwen3-vl-30b-a3b-thinking', family: 'qwen3' },
  { modelId: 'qwen3-vl-235b-a22b-instruct', family: 'qwen3' },
  { modelId: 'qwen3-vl-235b-a22b-thinking', family: 'qwen3' },
  { modelId: 'qwen3.5-9b', family: 'qwen3' },
  { modelId: 'qwen3.5-27b', family: 'qwen3' },
  { modelId: 'qwen3.5-35b-a3b', family: 'qwen3' },
  { modelId: 'qwen3.5-122b-a10b', family: 'qwen3' },
  { modelId: 'qwen3.5-397b-a17b', family: 'qwen3' },
  { modelId: 'qwen3.5-flash-02-23', family: 'qwen3' },
  { modelId: 'qwen3.5-plus-02-15', family: 'qwen3' },
  { modelId: 'qwen3.5-plus-20260420', family: 'qwen3' },
  { modelId: 'qwen3.6-27b', family: 'qwen3' },
  { modelId: 'qwen3.6-35b-a3b', family: 'qwen3' },
  { modelId: 'qwen3.6-flash', family: 'qwen3' },
  { modelId: 'qwen3.6-plus', family: 'qwen3' },
  { modelId: 'qwen3.6-max-preview', family: 'qwen3' },
  { modelId: 'qwen3.7-max', family: 'qwen3' },
  { modelId: 'qwen3.7-plus', family: 'qwen3' },
  { modelId: 'qwen/qwen3-8b', family: 'qwen3' },
  { modelId: 'qwen/qwen3-14b', family: 'qwen3' },
  { modelId: 'qwen/qwen3-32b', family: 'qwen3' },
  { modelId: 'qwen/qwen3-30b-a3b', family: 'qwen3' },
  { modelId: 'qwen/qwen3-235b-a22b', family: 'qwen3' },
  { modelId: 'qwen/qwen3-235b-a22b-2507', family: 'qwen3' },
  { modelId: 'qwen/qwen3-235b-a22b-thinking-2507', family: 'qwen3' },
  { modelId: 'qwen/qwen3-30b-a3b-instruct-2507', family: 'qwen3' },
  { modelId: 'qwen/qwen3-30b-a3b-thinking-2507', family: 'qwen3' },
  { modelId: 'qwen/qwen3-coder', family: 'qwen3' },
  { modelId: 'qwen/qwen3-coder-flash', family: 'qwen3' },
  { modelId: 'qwen/qwen3-coder-plus', family: 'qwen3' },
  { modelId: 'qwen/qwen3-coder-next', family: 'qwen3' },
  { modelId: 'qwen/qwen3-coder-30b-a3b-instruct', family: 'qwen3' },
  { modelId: 'qwen/qwen3-max', family: 'qwen3' },
  { modelId: 'qwen/qwen3-max-thinking', family: 'qwen3' },
  { modelId: 'qwen/qwen3-next-80b-a3b-instruct', family: 'qwen3' },
  { modelId: 'qwen/qwen3-next-80b-a3b-thinking', family: 'qwen3' },
  { modelId: 'qwen/qwen3-vl-8b-instruct', family: 'qwen3' },
  { modelId: 'qwen/qwen3-vl-8b-thinking', family: 'qwen3' },
  { modelId: 'qwen/qwen3-vl-32b-instruct', family: 'qwen3' },
  { modelId: 'qwen/qwen3-vl-30b-a3b-instruct', family: 'qwen3' },
  { modelId: 'qwen/qwen3-vl-30b-a3b-thinking', family: 'qwen3' },
  { modelId: 'qwen/qwen3-vl-235b-a22b-instruct', family: 'qwen3' },
  { modelId: 'qwen/qwen3-vl-235b-a22b-thinking', family: 'qwen3' },
  { modelId: 'qwen/qwen3.5-9b', family: 'qwen3' },
  { modelId: 'qwen/qwen3.5-27b', family: 'qwen3' },
  { modelId: 'qwen/qwen3.5-35b-a3b', family: 'qwen3' },
  { modelId: 'qwen/qwen3.5-122b-a10b', family: 'qwen3' },
  { modelId: 'qwen/qwen3.5-397b-a17b', family: 'qwen3' },
  { modelId: 'qwen/qwen3.5-flash-02-23', family: 'qwen3' },
  { modelId: 'qwen/qwen3.5-plus-02-15', family: 'qwen3' },
  { modelId: 'qwen/qwen3.5-plus-20260420', family: 'qwen3' },
  { modelId: 'qwen/qwen3.6-27b', family: 'qwen3' },
  { modelId: 'qwen/qwen3.6-35b-a3b', family: 'qwen3' },
  { modelId: 'qwen/qwen3.6-flash', family: 'qwen3' },
  { modelId: 'qwen/qwen3.6-plus', family: 'qwen3' },
  { modelId: 'qwen/qwen3.6-max-preview', family: 'qwen3' },
  { modelId: 'qwen/qwen3.7-max', family: 'qwen3' },
  { modelId: 'qwen/qwen3.7-plus', family: 'qwen3' },

  // I. qwen2.5
  { modelId: 'qwen2.5-7b-instruct', family: 'qwen2.5' },
  { modelId: 'qwen2.5-72b-instruct', family: 'qwen2.5' },
  { modelId: 'qwen2.5-coder-32b-instruct', family: 'qwen2.5' },
  { modelId: 'qwen2.5-vl-72b-instruct', family: 'qwen2.5' },
  { modelId: 'qwen-2.5-7b-instruct', family: 'qwen2.5' },
  { modelId: 'qwen-2.5-72b-instruct', family: 'qwen2.5' },
  { modelId: 'qwen-2.5-coder-32b-instruct', family: 'qwen2.5' },
  { modelId: 'qwen/qwen-2.5-7b-instruct', family: 'qwen2.5' },
  { modelId: 'qwen/qwen-2.5-72b-instruct', family: 'qwen2.5' },
  { modelId: 'qwen/qwen-2.5-coder-32b-instruct', family: 'qwen2.5' },
  { modelId: 'qwen/qwen2.5-vl-72b-instruct', family: 'qwen2.5' },
  { modelId: 'qwen-plus', family: 'qwen2.5' },
  { modelId: 'qwen-plus-2025-07-28', family: 'qwen2.5' },
  { modelId: 'qwen/qwen-plus', family: 'qwen2.5' },
  { modelId: 'qwen/qwen-plus-2025-07-28', family: 'qwen2.5' },
  { modelId: 'qwen/qwen-plus-2025-07-28:thinking', family: 'qwen2.5' },

  // J. minimax
  { modelId: 'minimax-m1', family: 'minimax-m2' },
  { modelId: 'minimax-m2', family: 'minimax-m2' },
  { modelId: 'minimax-m2-her', family: 'minimax-m2' },
  { modelId: 'minimax-m2.1', family: 'minimax-m2' },
  { modelId: 'minimax-m2.5', family: 'minimax-m2' },
  { modelId: 'minimax-m2.7', family: 'minimax-m2' },
  { modelId: 'minimax-m3', family: 'minimax-m3' },
  { modelId: 'minimax-01', family: 'minimax-m2' },
  { modelId: 'MiniMax-M2.5', family: 'minimax-m2' },
  { modelId: 'MiniMax-M3', family: 'minimax-m3' },
  { modelId: 'minimax/minimax-m1', family: 'minimax-m2' },
  { modelId: 'minimax/minimax-m2', family: 'minimax-m2' },
  { modelId: 'minimax/minimax-m2-her', family: 'minimax-m2' },
  { modelId: 'minimax/minimax-m2.1', family: 'minimax-m2' },
  { modelId: 'minimax/minimax-m2.5', family: 'minimax-m2' },
  { modelId: 'minimax/minimax-m2.7', family: 'minimax-m2' },
  { modelId: 'minimax/minimax-m3', family: 'minimax-m3' },
  { modelId: 'minimax/minimax-01', family: 'minimax-m2' },
]

const NO_MATCH_CASES = [
  'deepseek-r1-distill-llama-70b',
  'deepseek/deepseek-r1-distill-llama-70b',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4o',
  'gpt-4o-mini',
  'claude-opus-4',
  'claude-sonnet-4',
  'claude-3-5-sonnet',
  'gemini-2.5-pro',
]

function testNormalizeModelId() {
  assert.equal(normalizeModelId('z-ai/glm-5.2'), 'glm-5.2')
  assert.equal(normalizeModelId('glm-5.2[1m]'), 'glm-5.2')
  assert.equal(normalizeModelId('GLM-5.2'), 'glm-5.2')
  assert.equal(normalizeModelId('qwen/qwen-plus-2025-07-28:thinking'), 'qwen-plus-2025-07-28')
}

function testResolveTokenizerFamily() {
  for (const { modelId, family } of MATCH_CASES) {
    const resolved = resolveTokenizerFamily(modelId)
    assert.equal(
      resolved,
      family,
      `resolveTokenizerFamily(${JSON.stringify(modelId)}) expected ${family}, got ${resolved}`,
    )
    const candidates = resolveTokenizerFamilyCandidates(modelId)
    assert.ok(
      candidates.includes(family!),
      `resolveTokenizerFamilyCandidates(${JSON.stringify(modelId)}) should include ${family}, got ${candidates.join(',')}`,
    )
  }

  for (const modelId of NO_MATCH_CASES) {
    assert.equal(
      resolveTokenizerFamily(modelId),
      undefined,
      `resolveTokenizerFamily(${JSON.stringify(modelId)}) should be undefined`,
    )
  }
}

testNormalizeModelId()
testResolveTokenizerFamily()
console.log(`model-tokenizer: ${MATCH_CASES.length} match + ${NO_MATCH_CASES.length} no-match cases passed`)
