/**
 * Sub Agent delegate / followup 单测。
 * 运行：node --experimental-strip-types src/ai/subagent/subagent-tools.test.ts
 */
import assert from 'node:assert/strict'
import type OpenAI from 'openai'
import {
  createDelegateSubAgentTool,
  formatSubAgentToolResult,
} from './subagent-delegate-tool.ts'
import { createFollowUpSubAgentTool } from './subagent-followup-tool.ts'
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

{
  const text = formatSubAgentToolResult({
    agentId: 'explore',
    description: 'scan files',
    access: 'readonly',
    runId: 'subagent-explore-1',
    text: 'found 3 files',
    toolCallCount: 2,
  })
  assert.match(text, /run_id=subagent-explore-1/)
  assert.match(text, /found 3 files/)
  assert.match(text, /access=readonly/)
}

{
  const tool = createDelegateSubAgentTool({
    config: baseConfig(),
    getToolsForAccess: () => [],
    runSubAgentFn: async ({ taskPrompt, history }) => {
      assert.equal(taskPrompt, 'list src')
      assert.equal(history, undefined)
      return { text: 'ok summary', toolCallCount: 1 }
    },
  })
  assert.ok(tool)
  const result = await tool!.execute({
    agent_id: 'explore',
    description: 'list src',
    prompt: 'list src',
  })
  assert.match(String(result), /run_id=subagent-explore-/)
  assert.match(String(result), /ok summary/)
}

{
  const tool = createDelegateSubAgentTool({
    config: baseConfig({ enabled: false }),
    getToolsForAccess: () => [],
    runSubAgentFn: async () => ({ text: 'x', toolCallCount: 0 }),
  })
  assert.equal(tool, undefined)
}

{
  const history: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'user', content: 'first task' },
    { role: 'assistant', content: 'first answer' },
  ]
  let sawHistory: OpenAI.Chat.ChatCompletionMessageParam[] | undefined
  const tool = createFollowUpSubAgentTool({
    config: baseConfig(),
    getSession: (runId) => {
      if (runId !== 'run-abc') return undefined
      return {
        agentId: 'explore',
        description: 'list src',
        status: 'done',
        history,
        modelKey: 'entry:model-a',
      }
    },
    runSubAgentFn: async ({ taskPrompt, history: h }) => {
      assert.equal(taskPrompt, 'go deeper')
      sawHistory = h
      return { text: 'deeper answer', toolCallCount: 3 }
    },
  })
  assert.ok(tool)
  const result = await tool!.execute({
    run_id: 'run-abc',
    message: 'go deeper',
  })
  assert.equal(sawHistory, history)
  assert.match(String(result), /run_id=run-abc/)
  assert.match(String(result), /deeper answer/)
}

{
  const tool = createFollowUpSubAgentTool({
    config: baseConfig(),
    getSession: () => undefined,
    runSubAgentFn: async () => ({ text: 'x', toolCallCount: 0 }),
  })
  assert.ok(tool)
  const result = await tool!.execute({ run_id: 'missing', message: 'hi' })
  assert.match(String(result), /未知的 Sub Agent 线程/)
}

{
  const tool = createFollowUpSubAgentTool({
    config: baseConfig(),
    getSession: () => ({
      agentId: 'explore',
      description: 'x',
      status: 'running',
      history: [{ role: 'user', content: 'a' }],
      modelKey: undefined,
    }),
    runSubAgentFn: async () => ({ text: 'x', toolCallCount: 0 }),
  })
  assert.ok(tool)
  const result = await tool!.execute({ run_id: 'busy', message: 'hi' })
  assert.match(String(result), /仍在运行中/)
}

{
  const tool = createFollowUpSubAgentTool({
    config: baseConfig(),
    getSession: () => ({
      agentId: 'explore',
      description: 'x',
      status: 'done',
      history: [],
      modelKey: undefined,
    }),
    runSubAgentFn: async () => ({ text: 'x', toolCallCount: 0 }),
  })
  assert.ok(tool)
  const result = await tool!.execute({ run_id: 'empty', message: 'hi' })
  assert.match(String(result), /缺少对话历史/)
}

{
  const tool = createFollowUpSubAgentTool({
    config: baseConfig(),
    getSession: () => ({
      agentId: 'explore',
      description: 'x',
      status: 'done',
      history: [{ role: 'user', content: 'a' }],
      modelKey: undefined,
    }),
    runSubAgentFn: async () => ({ text: 'x', toolCallCount: 0 }),
  })
  assert.ok(tool)
  assert.match(String(await tool!.execute({ run_id: '', message: 'hi' })), /缺少 run_id/)
  assert.match(String(await tool!.execute({ run_id: 'r', message: '' })), /message 不能为空/)
}

console.log('subagent-tools.test.ts: ok')
