/**
 * 对话调试转储文本单测。
 * 运行：node --experimental-strip-types src/apps/vscode/vscode-ai-conversation-dump.test.ts
 */
import assert from 'node:assert/strict'
import type { VscodeAiInvestigation } from './vscode-ai-agent.ts'
import type { VscodeAiChatMessage } from './vscode-ai-chat-storage.ts'
import {
  buildVscodeAiConversationDump,
  formatDumpInvestigationSummary,
} from './vscode-ai-conversation-dump.ts'

function msg(
  role: 'user' | 'assistant',
  content: string,
  extras: Partial<VscodeAiChatMessage> = {},
): VscodeAiChatMessage {
  return {
    id: `test-${role}-${content.length}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: Date.now(),
    ...extras,
  } as VscodeAiChatMessage
}

const investigation: VscodeAiInvestigation = {
  activities: [
    {
      id: 'act-1',
      label: 'delegate_subagent',
      detail: '探索 · 3 个文件',
      content: '查找 fetch 相关调用',
      result: 'run_id: subagent-x · tools=2',
      done: true,
      subagentRunId: 'subagent-x',
    },
  ],
  timeline: [],
  reasoningText: '先定位入口文件',
  reasoningDurationMs: 6500,
  toolCallCount: 3,
  durationMs: 90_000,
}

const messages = [
  msg('user', '帮我搜索一下 fetch 的调用', {
    systemReminder: '<system-reminder>工作区：demo</system-reminder>',
  }),
  msg('assistant', '已找到 2 处调用。', { investigation }),
  msg('assistant', '', { isError: true, incomplete: true }),
]

const dump = buildVscodeAiConversationDump(messages, {
  sessionId: 'sess-1',
  title: 'Agent 对话',
})

assert.ok(dump.startsWith('Agent 对话\n会话 ID: sess-1\n对话调试转储 · 共 3 条消息'))
assert.ok(dump.includes('── [1] 用户 ──'))
assert.ok(dump.includes('System Reminder：'))
assert.ok(dump.includes('工作区：demo'))
assert.ok(dump.includes('正文：\n帮我搜索一下 fetch 的调用'))
assert.ok(dump.includes('── [2] 助手 ──'))
assert.ok(dump.includes('调查：思考 6.5 秒 · 调用 3 个工具 · 用时 1 分 30 秒'))
assert.ok(dump.includes('工具调用：'))
assert.ok(dump.includes('  - delegate_subagent · 探索 · 3 个文件 [runId: subagent-x]'))
assert.ok(dump.includes('    输入：查找 fetch 相关调用'))
assert.ok(dump.includes('    输出：run_id: subagent-x · tools=2'))
assert.ok(dump.includes('思考：\n先定位入口文件'))
assert.ok(dump.includes('── [3] 助手（出错，未完整结束） ──'))
assert.ok(dump.includes('（无正文）'))

assert.equal(
  formatDumpInvestigationSummary(investigation),
  '思考 6.5 秒 · 调用 3 个工具 · 用时 1 分 30 秒',
)
assert.equal(
  formatDumpInvestigationSummary({
    ...investigation,
    reasoningDurationMs: 0,
    toolCallCount: 0,
  }),
  '未调用工具 · 用时 1 分 30 秒',
)

console.log('vscode-ai-conversation-dump.test.ts: ok')
