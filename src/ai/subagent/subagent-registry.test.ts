/**
 * Sub Agent registry 单测。
 * 运行：node --experimental-strip-types src/ai/subagent/subagent-registry.test.ts
 */
import assert from 'node:assert/strict'
import {
  capSubAgentAccess,
  listAvailableSubAgents,
  resolveSubAgent,
  shouldExposeSubAgentDelegation,
} from './subagent-registry.ts'
import type { SubAgentHostConfig } from './subagent-types.ts'

function baseConfig(overrides: Partial<SubAgentHostConfig> = {}): SubAgentHostConfig {
  return {
    enabled: true,
    maxConcurrent: 5,
    builtinOverrides: {},
    customAgents: [],
    parentModelKey: 'entry:model-a',
    parentAccess: 'full',
    ...overrides,
  }
}

assert.equal(capSubAgentAccess('full', 'readonly'), 'readonly')
assert.equal(capSubAgentAccess('readonly', 'readonly'), 'readonly')
assert.equal(capSubAgentAccess('full', 'full'), 'full')
assert.equal(capSubAgentAccess('readonly', 'full'), 'readonly')

{
  const available = listAvailableSubAgents(baseConfig())
  assert.deepEqual(
    available.map((item) => item.id),
    ['explore', 'general'],
  )
  assert.equal(available.find((item) => item.id === 'explore')?.access, 'readonly')
  assert.equal(available.find((item) => item.id === 'general')?.access, 'full')
  assert.equal(shouldExposeSubAgentDelegation(baseConfig()), true)
}

{
  const available = listAvailableSubAgents(
    baseConfig({ parentAccess: 'readonly' }),
  )
  assert.equal(available.find((item) => item.id === 'general')?.access, 'readonly')
}

{
  const available = listAvailableSubAgents(
    baseConfig({
      builtinOverrides: {
        explore: { enabled: false },
        general: { enabled: false },
      },
    }),
  )
  assert.equal(available.length, 0)
  assert.equal(
    shouldExposeSubAgentDelegation(
      baseConfig({
        builtinOverrides: {
          explore: { enabled: false },
          general: { enabled: false },
        },
      }),
    ),
    false,
  )
}

{
  const available = listAvailableSubAgents(
    baseConfig({
      builtinOverrides: {
        explore: { enabled: false },
        general: { enabled: false },
      },
      customAgents: [
        {
          id: 'reviewer',
          description: '代码审查',
          prompt: '你是审查员',
          access: 'readonly',
          enabled: true,
        },
      ],
    }),
  )
  assert.equal(available.length, 1)
  assert.equal(available[0]?.id, 'reviewer')
  assert.equal(shouldExposeSubAgentDelegation(baseConfig({
    builtinOverrides: {
      explore: { enabled: false },
      general: { enabled: false },
    },
    customAgents: [
      {
        id: 'reviewer',
        description: '代码审查',
        prompt: '你是审查员',
        access: 'readonly',
      },
    ],
  })), true)
}

{
  // 自定义不得占用内置 id
  const available = listAvailableSubAgents(
    baseConfig({
      customAgents: [
        {
          id: 'explore',
          description: '假 explore',
          prompt: 'x',
          access: 'full',
        },
      ],
    }),
  )
  const explores = available.filter((item) => item.id === 'explore')
  assert.equal(explores.length, 1)
  assert.equal(explores[0]?.builtin, true)
  assert.equal(explores[0]?.access, 'readonly')
}

{
  assert.equal(resolveSubAgent('missing', baseConfig()), undefined)
  assert.ok(resolveSubAgent('explore', baseConfig()))
  assert.equal(
    resolveSubAgent(
      'explore',
      baseConfig({ builtinOverrides: { explore: { enabled: false } } }),
    ),
    undefined,
  )
}

{
  assert.equal(shouldExposeSubAgentDelegation(baseConfig({ enabled: false })), false)
}

console.log('subagent-registry.test.ts: ok')
