/**
 * 上下文压缩 L0–L3 与截断语义单测。
 * 运行：node --experimental-strip-types src/ai/context-compression/context-compression.test.ts
 */
import assert from 'node:assert/strict'
import {
  applyToolObservationBudget,
  createToolBudgetDedupState,
  headTail,
  hashToolContent,
  prioritizeErrorBlocks,
} from './tool-observation-budget.ts'
import {
  findKeepRecentStartIndex,
  foldCompletedToolRounds,
  omitEarlierTurns,
  pruneReasoningContent,
  sliceForCompaction,
} from './structure-fold.ts'
import type { ChatMessage } from './types.ts'
import {
  sliceApiTranscriptBeforeUserOrdinal,
  stripLeadingSystemMessages,
} from '../../apps/vscode/vscode-ai-transcript.ts'

// --- L0 head/tail ---
{
  const long = 'A'.repeat(20_000)
  const clipped = headTail(long, 100, 100)
  assert.ok(clipped.startsWith('A'.repeat(100)))
  assert.ok(clipped.endsWith('A'.repeat(100)))
  assert.ok(clipped.includes('chars omitted'))
}

{
  const text = ['ok line', 'Error: boom', 'stack1', 'stack2'].join('\n')
  const prioritized = prioritizeErrorBlocks(text)
  assert.ok(prioritized.includes('Error: boom'))
}

{
  const dedup = createToolBudgetDedupState()
  const body = 'x'.repeat(20_000)
  const first = await applyToolObservationBudget(body, { step: 0, dedup })
  assert.equal(first.changed, true)
  assert.equal(first.spilled, false)
  assert.ok(first.content.includes('chars omitted'))

  const second = await applyToolObservationBudget(body, { step: 1, dedup })
  assert.equal(second.duplicate, true)
  assert.ok(second.content.includes('[duplicate_of hash='))
  assert.equal(hashToolContent(body).length, 12)
}

// --- L1 fold ---
{
  const wire: ChatMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'u1' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'c1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
        },
      ],
    },
    { role: 'tool', tool_call_id: 'c1', content: 'file contents here' },
    { role: 'assistant', content: 'done u1' },
    { role: 'user', content: 'u2 keep' },
    { role: 'assistant', content: 'reply u2' },
  ]
  assert.equal(findKeepRecentStartIndex(wire, 1), 5)
  const folded = foldCompletedToolRounds(wire, {
    keepRecentTurns: 1,
    step: 0,
    beforeTokens: 9_000,
  })
  assert.ok(folded.events.length >= 1)
  assert.equal(folded.events[0]?.kind, 'structure_fold')
  const foldedAssistant = folded.wire.find(
    (m) => m.role === 'assistant' && typeof m.content === 'string' && m.content.includes('[folded_tools]'),
  )
  assert.ok(foldedAssistant)
  assert.ok(
    typeof foldedAssistant!.content === 'string' &&
      foldedAssistant!.content.includes('read_file'),
  )
  // keep recent intact
  assert.ok(folded.wire.some((m) => m.role === 'user' && m.content === 'u2 keep'))
}

// --- L2 reasoning prune ---
{
  const wire: ChatMessage[] = [
    {
      role: 'assistant',
      content: 'a',
      tool_calls: [
        {
          id: 'c1',
          type: 'function',
          function: { name: 'x', arguments: '{}' },
        },
      ],
    },
    { role: 'tool', tool_call_id: 'c1', content: 'ok' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'c2',
          type: 'function',
          function: { name: 'y', arguments: '{}' },
        },
      ],
    },
  ]
  ;(wire[0] as { reasoning_content?: string }).reasoning_content = 'old think'
  ;(wire[2] as { reasoning_content?: string }).reasoning_content = 'latest think'
  const pruned = pruneReasoningContent(wire, {
    requireEcho: true,
    step: 0,
    beforeTokens: 100,
  })
  assert.ok(pruned.events.length >= 1)
  const first = pruned.wire[0] as { reasoning_content?: string }
  const last = pruned.wire[2] as { reasoning_content?: string }
  assert.equal(first.reasoning_content, '')
  assert.equal(last.reasoning_content, 'latest think')
}

// --- L3 omit ---
{
  const wire: ChatMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'old1' },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'old2' },
    { role: 'assistant', content: 'a2' },
    { role: 'user', content: 'keep' },
  ]
  const omitted = omitEarlierTurns(wire, {
    keepRecentTurns: 1,
    step: 0,
    beforeTokens: 8_000,
  })
  assert.equal(omitted.needLlmCompact, true)
  assert.ok(
    omitted.wire.some(
      (m) =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        m.content.includes('[earlier_turns_omitted'),
    ),
  )
  assert.ok(omitted.wire.some((m) => m.role === 'user' && m.content === 'keep'))
}

// --- slice for compaction ---
{
  const canonical: ChatMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'a' },
    { role: 'assistant', content: 'b' },
    { role: 'user', content: 'c' },
  ]
  const sliced = sliceForCompaction(canonical, 1)
  assert.equal(sliced.from, 1)
  assert.equal(sliced.to, 3)
  assert.equal(sliced.prefix[0]?.role, 'system')
  assert.equal(sliced.recent[0]?.role, 'user')
}

// --- edit truncation helpers ---
{
  assert.deepEqual(
    stripLeadingSystemMessages([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ]),
    [{ role: 'user', content: 'u' }],
  )

  const transcript: ChatMessage[] = [
    { role: 'system', content: 's' },
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'r1' },
    {
      role: 'user',
      content: '<context-compaction id="x">summary</context-compaction>',
    },
    { role: 'user', content: 'second' },
    { role: 'assistant', content: 'r2' },
  ]
  // userOrdinal=1 → 第二个真实 user（跳过 compaction），截到其之前
  const beforeSecond = sliceApiTranscriptBeforeUserOrdinal(transcript, 1)
  assert.ok(beforeSecond.every((m) => m.role !== 'system'))
  assert.equal(
    beforeSecond.filter((m) => m.role === 'user' && 'content' in m && m.content === 'first')
      .length,
    1,
  )
  assert.ok(
    !beforeSecond.some(
      (m) => m.role === 'user' && 'content' in m && m.content === 'second',
    ),
  )
  // compaction 仍可能出现在截断前缀中（若曾写入 wire）；ordinal 计数已跳过它
  assert.equal(sliceApiTranscriptBeforeUserOrdinal(transcript, 0).length, 0)
}

console.log('context-compression.test.ts: ok')
