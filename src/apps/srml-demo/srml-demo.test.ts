/**
 * SRML Demo 测试：标签 DSL 解析器 + 简化引擎。
 * 运行：node --experimental-strip-types src/apps/srml-demo/srml-demo.test.ts
 */
import assert from 'node:assert/strict'
import type { SrmlAgent, SrmlAgentStreamOptions } from './srml-agent.ts'
import { SrmlParseError, serializeBlocks, type SrmlPromptBlock } from './srml-dsl.ts'
import type { SrmlEngineEvent } from './srml-engine.ts'
import { SrmlEngine } from './srml-engine.ts'
import { parseSrmlDocument, parseSrmlStreamChunk, sliceTaskRaw } from './srml-parse.ts'

const DOC = `<|begin_of_task_1|>
<begin_of_thought>
思考1
<end_of_thought>
<begin_of_response_1>
回复1
<end_of_response_1>
<|end_of_task_1|>

<|begin_of_task_2|>
<begin_of_thought>
思考2
<end_of_thought>
<begin_of_response_2>
回复2
<end_of_response_2>
<begin_of_thought>
补充思考
<end_of_thought>
<begin_of_response_2>
补充回复
<end_of_response_2>
<|end_of_task_2|>`

// ---- 解析器 ----

function testParseBasicDoc(): void {
  const parsed = parseSrmlDocument(DOC)
  assert.equal(parsed.blocks.length, 2)
  const task1 = parsed.blocks[0]
  assert.ok(task1.kind === 'task' && task1.id === 1)
  if (task1.kind !== 'task') return
  assert.equal(task1.segments.length, 2)
  assert.equal(task1.segments[0].kind, 'thought')
  assert.equal(task1.segments[0].content, '思考1')
  assert.equal(task1.segments[1].kind, 'response')
  if (task1.segments[1].kind === 'response') {
    assert.equal(task1.segments[1].id, 1)
    assert.equal(task1.segments[1].content, '回复1')
  }
  const task2 = parsed.blocks[1]
  if (task2.kind !== 'task') return
  assert.equal(task2.segments.length, 4)
  assert.equal(parsed.warnings.length, 0)
  console.log('ok: parse basic document (two tasks, thought/response segments)')
}

function testParseStreamingIncremental(): void {
  const lines = [
    '<|begin_of_task_1|>',
    '<begin_of_thought>',
    '思考内容',
    '<end_of_thought>',
    '<begin_of_response_1>',
    '回复内容',
    '<end_of_response_1>',
    '<|end_of_task_1|>',
  ]
  let accumulated = ''
  for (const line of lines) {
    accumulated = accumulated ? `${accumulated}\n${line}` : line
    const result = parseSrmlStreamChunk(accumulated)
    if (line === '<|end_of_task_1|>') {
      assert.equal(result.blocks.length, 1, '任务闭合后应立即解析出完整块')
      assert.equal(result.partial, null)
    }
    if (line === '<begin_of_response_1>') {
      assert.ok(result.partial?.open === 'task', '任务应处于 partial 态')
    }
  }
  console.log('ok: streaming parse per tag line')
}

function testParseStreamPartialThought(): void {
  const result = parseSrmlStreamChunk('<|begin_of_task_3|>\n<begin_of_thought>\n正在思考')
  assert.equal(result.blocks.length, 0)
  assert.ok(result.partial?.open === 'task')
  if (result.partial?.open !== 'task') return
  assert.equal(result.partial.id, 3)
  assert.ok(result.partial.segment?.kind === 'thought')
  if (result.partial.segment?.kind === 'thought') {
    assert.equal(result.partial.segment.content, '正在思考')
  }
  console.log('ok: partial thought segment content accumulates live')
}

function testParseStreamPartialResponse(): void {
  const result = parseSrmlStreamChunk('<|begin_of_task_7|>\n<begin_of_response_7>')
  if (result.partial?.open !== 'task') return
  assert.ok(result.partial.segment?.kind === 'response')
  if (result.partial.segment?.kind === 'response') {
    assert.equal(result.partial.segment.id, 7)
  }
  console.log('ok: partial response segment')
}

function testParseAutoOpenTask(): void {
  const text = [
    '<begin_of_thought>',
    'x',
    '<end_of_thought>',
    '<begin_of_response_1>',
    'y',
    '<end_of_response_1>',
  ].join('\n')
  const parsed = parseSrmlDocument(text)
  assert.equal(parsed.blocks.length, 1)
  const task = parsed.blocks[0]
  if (task.kind !== 'task') return
  assert.equal(task.id, 1)
  assert.equal(task.segments.length, 2)
  assert.ok(parsed.warnings.some((warning) => warning.code === 'auto-open-task'))
  console.log('ok: auto-open task when thought/response without wrapper')
}

function testParseUnclosedSegment(): void {
  const text = '<|begin_of_task_1|>\n<begin_of_thought>\nx\n<|end_of_task_1|>'
  const parsed = parseSrmlDocument(text)
  const task = parsed.blocks[0]
  if (task.kind !== 'task') return
  assert.equal(task.segments.length, 1)
  assert.equal(task.segments[0].kind, 'thought')
  assert.ok(parsed.warnings.some((warning) => warning.code === 'unclosed-segment'))
  console.log('ok: task closes with open segment → auto close + warning')
}

function testParseThoughtEffort(): void {
  const text = [
    '<|begin_of_prompt_2|>',
    '<|begin_of_thought_effort_1|>',
    'low',
    '<|end_of_thought_effort_1|>',
    '你好',
    '<|end_of_prompt_2|>',
  ].join('\n')
  const parsed = parseSrmlDocument(text)
  assert.equal(parsed.blocks.length, 1)
  const prompt = parsed.blocks[0]
  if (prompt.kind !== 'prompt') return
  assert.equal(prompt.id, 2)
  assert.equal(prompt.thoughtEffort, 'low')
  assert.equal(prompt.content, '你好')
  console.log('ok: parse prompt with nested thought effort')
}

function testParseTolerantTags(): void {
  const text = [
    '<|BEGIN_OF_TASK_1|>',
    '<begin_of_thought>',
    'a',
    '<end_of_thought>',
    '<begin_of_response_1>',
    'b',
    '</end_of_response_1>',
    '<|end_of_task_1|>',
  ].join('\n')
  const parsed = parseSrmlDocument(text)
  const task = parsed.blocks[0]
  if (task.kind !== 'task') return
  assert.equal(task.segments.length, 2)
  if (task.segments[1].kind === 'response') {
    assert.equal(task.segments[1].content, 'b')
  }
  console.log('ok: tolerant to case and closing slash')
}

function testParseLooseTextWarns(): void {
  const text = '好的，开始\n<|begin_of_task_1|>\n<begin_of_thought>\na\n<end_of_thought>\n<|end_of_task_1|>'
  const parsed = parseSrmlDocument(text)
  assert.ok(parsed.warnings.some((warning) => warning.code === 'loose-text'))
  console.log('ok: loose text outside tags → warning')
}

function testParseMissingId(): void {
  const text = '<|begin_of_task|>\n<begin_of_thought>\na\n<end_of_thought>\n<|end_of_task|>'
  const parsed = parseSrmlDocument(text)
  const task = parsed.blocks[0]
  if (task.kind !== 'task') return
  assert.ok(Number.isFinite(task.id))
  assert.ok(parsed.warnings.some((warning) => warning.code === 'missing-id'))
  console.log('ok: missing tag id → auto assign + warning')
}

function testParseEndTagIgnoresId(): void {
  const text = '<|begin_of_task_1|>\n<begin_of_thought>\na\n<end_of_thought>\n<|end_of_task_9|>'
  const parsed = parseSrmlDocument(text)
  const task = parsed.blocks[0]
  if (task.kind !== 'task') return
  assert.equal(task.id, 1, 'end 标签编号被忽略，task 保持 begin 编号')
  assert.equal(task.segments.length, 1)
  assert.ok(!parsed.warnings.some((warning) => warning.code === 'id-mismatch'), '不应再产生 id-mismatch 警告')
  console.log('ok: end tag id ignored, closes by stack semantics')
}

function testParseResponseIdOptional(): void {
  const text = [
    '<|begin_of_task_2|>',
    '<begin_of_response>',
    '默认编号',
    '<end_of_response_9>',
    '<begin_of_response_3>',
    '显式编号',
    '<end_of_response>',
    '<|end_of_task|>',
  ].join('\n')
  const parsed = parseSrmlDocument(text)
  const task = parsed.blocks[0]
  if (task.kind !== 'task') return
  assert.equal(task.id, 2)
  assert.equal(task.segments.length, 2)
  if (task.segments[0].kind === 'response') {
    assert.equal(task.segments[0].id, 2, '无编号 response 默认当前任务编号')
    assert.equal(task.segments[0].content, '默认编号')
  }
  if (task.segments[1].kind === 'response') {
    assert.equal(task.segments[1].id, 3, '显式编号保留，不校验一致性')
    assert.equal(task.segments[1].content, '显式编号')
  }
  assert.ok(!parsed.warnings.some((warning) => warning.code === 'id-mismatch'))
  console.log('ok: response id optional, end response id ignored')
}

function testSliceTaskRaw(): void {
  const raw = [
    '<|begin_of_task_1|>',
    '<begin_of_thought>',
    'a',
    '<end_of_thought>',
    '<|end_of_task|>',
    '',
    '<|begin_of_task_2|>',
    'b',
    '<|end_of_task|>',
  ].join('\n')
  const slice1 = sliceTaskRaw(raw, 1)
  assert.ok(slice1.includes('<|begin_of_task_1|>'), '切片保留 begin 标签')
  assert.ok(slice1.includes('a'))
  assert.ok(!slice1.includes('begin_of_task_2'), '切片不含下一个 task')
  const slice2 = sliceTaskRaw(raw, 2)
  assert.ok(slice2.includes('<|begin_of_task_2|>'))
  assert.ok(slice2.includes('b'))
  assert.equal(sliceTaskRaw(raw, 99), '', '不存在的 task 返回空串')
  console.log('ok: sliceTaskRaw splits multi-task raw per task')
}

function testParseToleratesUnclosedTail(): void {
  const text = '<|begin_of_task_9|>\n<begin_of_thought>\na\n<end_of_thought>\n<begin_of_response_9>\nb'
  const parsed = parseSrmlDocument(text)
  assert.equal(parsed.blocks.length, 1)
  const task = parsed.blocks[0]
  if (task.kind !== 'task') return
  assert.equal(task.id, 9)
  assert.equal(task.segments.length, 2)
  assert.ok(parsed.partial, '未闭合尾部应保留为 partial')
  console.log('ok: unclosed tail is accepted as final block')
}

function testParseRejectsNoBlocks(): void {
  assert.throws(() => parseSrmlDocument('这根本就不是 DSL'), SrmlParseError)
  console.log('ok: reject output without any blocks')
}

function testSerializeRoundTrip(): void {
  const parsed = parseSrmlDocument(DOC)
  const serialized = serializeBlocks(parsed.blocks)
  const again = parseSrmlDocument(serialized)
  assert.equal(again.blocks.length, 2)
  const task2 = again.blocks[1]
  if (task2.kind !== 'task') return
  assert.equal(task2.segments.length, 4)
  console.log('ok: serialize → re-parse round trip')
}

function testSerializePrompt(): void {
  const prompt: SrmlPromptBlock = { kind: 'prompt', id: 2, content: '你好', thoughtEffort: 'low' }
  const text = serializeBlocks([prompt])
  assert.ok(text.includes('<|begin_of_prompt_2|>'))
  assert.ok(text.includes('<|begin_of_thought_effort_2|>'))
  assert.ok(text.includes('<|end_of_prompt_2|>'))
  console.log('ok: serialize prompt block with thought effort')
}

// ---- 引擎 ----

class StubAgent implements SrmlAgent {
  private queue: string[]
  receivedFollowUp: { role: 'user' | 'assistant'; content: string }[] | undefined

  constructor(queue: string[]) {
    this.queue = [...queue]
  }

  async exchange(userText: string, streamOptions?: SrmlAgentStreamOptions): Promise<string> {
    this.receivedFollowUp = streamOptions?.followUp
    const text = this.queue.shift() ?? ''
    streamOptions?.onStream?.('', text)
    return text
  }
}

async function runWithStub(queue: string[]): Promise<SrmlEngineEvent[]> {
  const events: SrmlEngineEvent[] = []
  const engine = new SrmlEngine({
    agent: new StubAgent(queue),
    onEvent: (event) => events.push(event),
  })
  await engine.run([{ kind: 'prompt', id: 1, content: '打招呼' }])
  return events
}

async function testEngineRunsExchange(): Promise<void> {
  const events = await runWithStub([DOC])
  assert.ok(events.some((event) => event.type === 'exchange-start'), '应有请求事件')
  assert.ok(events.some((event) => event.type === 'stream'), '应有流式事件')
  const plan = events.find((event) => event.type === 'plan')
  assert.ok(plan && plan.type === 'plan' && plan.blocks.length === 2, '应有 2 个任务的 plan')
  const done = events.find((event) => event.type === 'done')
  assert.ok(done && done.type === 'done' && done.llmCalls === 1, 'LLM 应只调用 1 次')
  console.log('ok: engine single exchange → stream → plan → done')
}

async function testEngineRetriesOnParseFailure(): Promise<void> {
  const events = await runWithStub(['没有标签的垃圾输出', DOC])
  assert.ok(events.some((event) => event.type === 'retry-parse'), '应发生一次解析失败重试')
  const plan = events.find((event) => event.type === 'plan')
  assert.ok(plan && plan.type === 'plan' && plan.attempt === 2, '第二次生成成功')
  const done = events.find((event) => event.type === 'done')
  assert.ok(done && done.type === 'done' && done.llmCalls === 2, 'LLM 应调用 2 次')
  console.log('ok: engine retries after unparseable output')
}

async function testEngineGivesUpAfterMaxAttempts(): Promise<void> {
  const events = await runWithStub(['垃圾', '还是垃圾', '依旧垃圾'])
  const plan = events.find((event) => event.type === 'plan')
  assert.equal(plan, undefined, '全部失败不应有 plan')
  const done = events.find((event) => event.type === 'done')
  assert.ok(done && done.type === 'done', '应有 done 事件')
  console.log('ok: engine gives up after max attempts')
}

async function testEngineCreatesBranchesFromFirstRound(): Promise<void> {
  const stub = new StubAgent([DOC])
  const events: SrmlEngineEvent[] = []
  const engine = new SrmlEngine({ agent: stub, onEvent: (event) => events.push(event) })

  await engine.run([{ kind: 'prompt', id: 1, content: '打招呼' }])
  const created = events.filter((event) => event.type === 'branch-created')
  assert.equal(created.length, 2, '第一轮 2 个 task → 2 个分支')
  const branches = engine.getBranches()
  assert.equal(branches.length, 2)
  assert.ok(branches.some((branch) => branch.id === 1), '应有分支 1')
  assert.ok(branches.some((branch) => branch.id === 2), '应有分支 2')
  console.log('ok: first round creates one branch per task')
}

async function testEngineBranchContinueScopesHistory(): Promise<void> {
  const stub = new StubAgent([DOC, DOC])
  const events: SrmlEngineEvent[] = []
  const engine = new SrmlEngine({ agent: stub, onEvent: (event) => events.push(event) })

  await engine.run([{ kind: 'prompt', id: 1, content: '第一轮' }])
  assert.equal(stub.receivedFollowUp?.length ?? 0, 0, '新任务组不带历史')

  await engine.run([{ kind: 'prompt', id: 3, content: '第二轮：只针对分支1' }], { branchId: 1 })
  assert.equal(stub.receivedFollowUp?.length, 2, '只携带分支1 的 user + assistant')
  assert.ok(stub.receivedFollowUp?.[0].content.includes('第一轮'), '分支1 的历史 prompt')
  assert.ok(stub.receivedFollowUp?.[1].content.includes('begin_of_task_1'), '分支1 的 raw 含 task_1')
  assert.ok(!stub.receivedFollowUp?.[1].content.includes('begin_of_task_2'), '不应含分支2 的 raw')

  await engine.run([{ kind: 'prompt', id: 4, content: '新任务组' }])
  assert.equal(stub.receivedFollowUp?.length ?? 0, 0, '新任务组仍不带历史')
  console.log('ok: branch continue scopes context to that branch only')
}

async function testEngineDiscardBranch(): Promise<void> {
  const stub = new StubAgent([DOC])
  const events: SrmlEngineEvent[] = []
  const engine = new SrmlEngine({ agent: stub, onEvent: (event) => events.push(event) })

  await engine.run([{ kind: 'prompt', id: 1, content: '第一轮' }])
  assert.equal(engine.getBranches().length, 2)

  engine.discardBranch(2)
  assert.ok(events.some((event) => event.type === 'branch-discarded' && event.branchId === 2))
  assert.ok(!engine.getBranches().some((branch) => branch.id === 2), '丢弃后不在活动分支列表')

  const queueBefore = stub.queue.length
  await engine.run([{ kind: 'prompt', id: 3, content: 'x' }], { branchId: 2 })
  assert.equal(stub.queue.length, queueBefore, '目标分支已丢弃不应调用 LLM')
  const done = events.filter((event) => event.type === 'done')
  assert.equal(done.length, 2)
  console.log('ok: discard branch removes it from targets and context')
}

async function main(): Promise<void> {
  testParseBasicDoc()
  testParseStreamingIncremental()
  testParseStreamPartialThought()
  testParseStreamPartialResponse()
  testParseAutoOpenTask()
  testParseUnclosedSegment()
  testParseThoughtEffort()
  testParseTolerantTags()
  testParseLooseTextWarns()
  testParseMissingId()
  testParseEndTagIgnoresId()
  testParseResponseIdOptional()
  testSliceTaskRaw()
  testParseToleratesUnclosedTail()
  testParseRejectsNoBlocks()
  testSerializeRoundTrip()
  testSerializePrompt()

  await testEngineRunsExchange()
  await testEngineRetriesOnParseFailure()
  await testEngineGivesUpAfterMaxAttempts()
  await testEngineCreatesBranchesFromFirstRound()
  await testEngineBranchContinueScopesHistory()
  await testEngineDiscardBranch()
  console.log('srml-demo: all passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
