/**
 * SRML Demo 测试：标签 DSL 解析器 + 简化引擎。
 * 运行：node --experimental-strip-types src/apps/srml-demo/srml-demo.test.ts
 */
import assert from 'node:assert/strict'
import type { SrmlAgent, SrmlAgentStreamOptions } from './srml-agent.ts'
import { SrmlParseError, serializeBlocks, serializeToolResults, type SrmlPromptBlock } from './srml-dsl.ts'
import type { SrmlEngineEvent } from './srml-engine.ts'
import { SrmlEngine } from './srml-engine.ts'
import { parseSrmlDocument, parseSrmlStreamChunk, sliceTaskRaw } from './srml-parse.ts'
import { findTool } from './srml-tools.ts'
import { isTraversal, isWithinSandbox, normalizePath, SANDBOX_DIR } from './srml-workspace.ts'

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
  /** 每次 exchange 的流式分段（每项为一段增量 delta，拼接后等于对应输出文本） */
  private deltas: string[][] | null
  receivedFollowUp: { role: 'user' | 'assistant'; content: string }[] | undefined

  constructor(queue: string[], deltas?: string[][]) {
    this.queue = [...queue]
    this.deltas = deltas ? deltas.map((chunks) => [...chunks]) : null
  }

  async exchange(userText: string, streamOptions?: SrmlAgentStreamOptions): Promise<string> {
    this.receivedFollowUp = streamOptions?.followUp
    const text = this.queue.shift() ?? ''
    const chunks = this.deltas?.shift()
    if (chunks && chunks.length > 0) {
      let accumulated = ''
      for (const chunk of chunks) {
        accumulated += chunk
        streamOptions?.onStream?.(chunk, accumulated)
      }
    } else {
      streamOptions?.onStream?.('', text)
    }
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

function testSerializeToolResults(): void {
  const results = [
    { kind: 'tool-result' as const, taskId: 1, name: 'get_current_time', result: '{"now":"x"}' },
    { kind: 'tool-result' as const, taskId: 2, name: 'calculate', result: '{"result":42}' },
  ]
  const text = serializeToolResults(results)
  assert.ok(text.includes('<|begin_of_task_1|>'))
  assert.ok(text.includes('<|begin_of_task_2|>'))
  assert.ok(text.includes('begin_of_tool_result'))
  assert.ok(text.includes('"name":"get_current_time"'), 'tool_result 应为整块 JSON')
  assert.ok(text.includes('"result":{"now":"x"}'), 'result 应为嵌套 JSON 对象')
  assert.ok(!text.includes('名称:'), '不应再有名称/结果文本行')
  console.log('ok: serialize tool results grouped by task')
}

function testWorkspacePaths(): void {
  assert.equal(normalizePath('a/b/c'), 'a/b/c')
  assert.equal(normalizePath('./a//b/../c'), 'a/c')
  assert.equal(normalizePath('../../etc'), '../../etc', '越界的 .. 保留以便判定')
  assert.ok(isTraversal(normalizePath('../outside')), '越界路径应被识别')
  assert.ok(isTraversal(normalizePath('a/../../c')), '中间穿越也应被识别')
  assert.ok(!isTraversal(normalizePath('src/app.ts')), '工作区内路径不越界')
  assert.ok(isWithinSandbox(`${SANDBOX_DIR}/a.txt`))
  assert.ok(isWithinSandbox(`${SANDBOX_DIR}/sub/a.txt`))
  assert.ok(!isWithinSandbox('src/app.ts'), '沙盒外写入被拒')
  console.log('ok: workspace path sandbox rules')
}

async function testCalculateTool(): Promise<void> {
  const calc = findTool('calculate')
  assert.ok(calc)
  const result = JSON.parse(await calc.execute({ expression: '(1+2)*3' }))
  assert.equal(result.result, 9)
  const bad = JSON.parse(await calc.execute({ expression: 'process.exit()' }))
  assert.ok(bad.error, '非法表达式应报错')
  console.log('ok: calculate tool evaluates safely')
}

async function testSlowToolSleeps(): Promise<void> {
  const tool = findTool('download_file')
  assert.ok(tool)
  const start = Date.now()
  const result = JSON.parse(await tool.execute({ url: 'https://example.com/release-notes.txt' }))
  assert.ok(Date.now() - start >= 1500, '网络下载应真实耗时')
  assert.equal(result.status, 'downloaded')
  assert.ok(result.path.includes('release-notes.txt'), '默认文件名取自 URL')
  assert.ok(result.size > 0, '返回文件大小')
  const read = findTool('read_file')
  assert.ok(read)
  const content = JSON.parse(await read.execute({ path: result.path }))
  assert.ok(content.content.includes('来源'), '下载内容可读回，形成闭环')
  console.log('ok: download_file takes time and saves a readable file')
}

async function testSlowToolAborts(): Promise<void> {
  const tool = findTool('download_file')
  assert.ok(tool)
  const controller = new AbortController()
  const promise = tool.execute({ url: 'https://example.com/large.bin' }, controller.signal)
  controller.abort()
  await assert.rejects(promise, (error: unknown) => {
    return error instanceof Error && error.name === 'AbortError'
  })
  console.log('ok: download aborts on signal')
}

async function testWriteSandboxEnforcement(): Promise<void> {
  const write = findTool('write_file')
  const read = findTool('read_file')
  assert.ok(write && read)
  const traversal = await write.execute({ path: '../escape.txt', content: 'x' })
  assert.ok(JSON.parse(traversal).error, '越界写入被拒绝')
  const sandbox = await write.execute({ path: `${SANDBOX_DIR}/hello.txt`, content: 'hi' })
  assert.ok(!JSON.parse(sandbox).error, '沙盒内写入成功')
  const content = await read.execute({ path: `${SANDBOX_DIR}/hello.txt` })
  assert.ok(JSON.parse(content).content === 'hi', '写入后可读回')
  console.log('ok: write sandbox enforcement + readback')
}

async function cleanupSandbox(): Promise<void> {
  const fs = await import('node:fs')
  fs.rmSync(`${process.cwd()}/${SANDBOX_DIR}`, { recursive: true, force: true })
}

const TOOL_DOC = `<|begin_of_task_1|>
<begin_of_thought>
需要查时间
<end_of_thought>
<|begin_of_tool_call|>
{"name": "get_current_time", "arguments": {"timezone": "Asia/Shanghai"}}
<|end_of_tool_call|>
<|end_of_task|>`

const FINAL_DOC = `<|begin_of_task_1|>
<begin_of_thought>
拿到时间了
<end_of_thought>
<begin_of_response_1>
现在是北京时间 14:30。
<end_of_response_1>
<|end_of_task_1|>`

function testParseToolCall(): void {
  const parsed = parseSrmlDocument(TOOL_DOC)
  const task = parsed.blocks[0]
  if (task.kind !== 'task') return
  assert.equal(task.segments.length, 2)
  const call = task.segments[1]
  assert.equal(call.kind, 'tool-call')
  if (call.kind === 'tool-call') {
    assert.equal(call.name, 'get_current_time')
    assert.ok(call.arguments.includes('Asia/Shanghai'))
  }
  console.log('ok: parse tool call segment')
}

function testParseToolCallArgumentsAsObject(): void {
  const text = `<|begin_of_task_1|>\n<|begin_of_tool_call|>\n{"name":"write_file","arguments":{"path":"a.txt","content":"hi"}}\n<|end_of_tool_call|>\n<|end_of_task|>`
  const parsed = parseSrmlDocument(text)
  const task = parsed.blocks[0]
  if (task.kind !== 'task') return
  const call = task.segments[0]
  assert.equal(call.kind, 'tool-call')
  if (call.kind === 'tool-call') {
    assert.equal(call.name, 'write_file')
    const args = JSON.parse(call.arguments) as { path: string; content: string }
    assert.equal(args.path, 'a.txt')
    assert.equal(args.content, 'hi')
  }
  assert.equal(parsed.warnings.length, 0, '嵌套对象参数不应有 warning')
  console.log('ok: parse tool call with nested object arguments')
}

function testParseToolCallArgumentsAsString(): void {
  // OpenAI 风格：arguments 是 JSON 字符串
  const text = `<|begin_of_task_1|>\n<|begin_of_tool_call|>\n{"name":"calculate","arguments":"{\\"expression\\":\\"1+1\\"}"}\n<|end_of_tool_call|>\n<|end_of_task|>`
  const parsed = parseSrmlDocument(text)
  const task = parsed.blocks[0]
  if (task.kind !== 'task') return
  const call = task.segments[0]
  assert.equal(call.kind, 'tool-call')
  if (call.kind === 'tool-call') {
    assert.equal(call.name, 'calculate')
    const args = JSON.parse(call.arguments) as { expression: string }
    assert.equal(args.expression, '1+1', '字符串 arguments 应被规范化保留')
  }
  console.log('ok: parse tool call with OpenAI-style string arguments')
}

function testParseToolCallInvalidJson(): void {
  const text = `<|begin_of_task_1|>\n<|begin_of_tool_call|>\n{"name": "calculate", "arguments": }\n<|end_of_tool_call|>\n<|end_of_task|>`
  const parsed = parseSrmlDocument(text)
  const task = parsed.blocks[0]
  if (task.kind !== 'task') return
  const call = task.segments[0]
  assert.equal(call.kind, 'tool-call')
  if (call.kind === 'tool-call') {
    assert.equal(call.name, '', '非法 JSON → 空名称，不执行')
  }
  assert.ok(parsed.warnings.some((warning) => warning.code === 'tool-call-unparseable'))
  console.log('ok: invalid JSON tool call kept as raw text + warning')
}

function testParseToolCallMissingName(): void {
  const text = `<|begin_of_task_1|>\n<|begin_of_tool_call|>\n{"arguments": {"a": 1}}\n<|end_of_tool_call|>\n<|end_of_task|>`
  const parsed = parseSrmlDocument(text)
  const task = parsed.blocks[0]
  if (task.kind !== 'task') return
  const call = task.segments[0]
  assert.equal(call.kind, 'tool-call')
  if (call.kind === 'tool-call') {
    assert.equal(call.name, '', '缺 name 字段 → 空名称，不执行')
  }
  assert.ok(parsed.warnings.some((warning) => warning.code === 'tool-call-unparseable'))
  console.log('ok: tool call missing name field → warning + not executed')
}

function testParseToolCallUnparseable(): void {
  const text = `<|begin_of_task_1|>\n<|begin_of_tool_call|>\n随便写点东西\n<|end_of_tool_call|>\n<|end_of_task|>`
  const parsed = parseSrmlDocument(text)
  const task = parsed.blocks[0]
  if (task.kind !== 'task') return
  assert.equal(task.segments.length, 1)
  const call = task.segments[0]
  assert.equal(call.kind, 'tool-call')
  if (call.kind === 'tool-call') {
    assert.equal(call.name, '', '解析不出名称 → 空名称，引擎不执行')
  }
  assert.ok(parsed.warnings.some((warning) => warning.code === 'tool-call-unparseable'))
  console.log('ok: unparseable tool call keeps raw text + warning')
}

function testParseToolCallExpected(): void {
  const text = `<|begin_of_task_1|>\n<|begin_of_tool_call|>\n{"name":"calculate","arguments":{"expression":"1+1"}}\n<|begin_of_expect|>2<|end_of_expect|>\n<|end_of_tool_call|>\n<|end_of_task|>`
  const parsed = parseSrmlDocument(text)
  const task = parsed.blocks[0]
  if (task.kind !== 'task') return
  const call = task.segments[0]
  assert.equal(call.kind, 'tool-call')
  if (call.kind === 'tool-call') {
    assert.equal(call.name, 'calculate')
    assert.equal(call.expected, 2, 'expect 标签内容应被解析为段字段')
  }
  assert.equal(parsed.warnings.length, 0, '带 expect 标签的合法块不应有 warning')
  // 往返序列化应输出 expect 标签，且 JSON 里不再有 expected 字段
  const normalized = serializeBlocks(parsed.blocks)
  assert.ok(normalized.includes('<|begin_of_expect|>2<|end_of_expect|>'), '序列化应输出 expect 标签')
  assert.ok(!normalized.includes('"expected"'), 'JSON 不应再包含 expected 字段')
  console.log('ok: parse tool call with expect tag prediction value')
}

function testParseToolCallExpectUnclosed(): void {
  const text = `<|begin_of_task_1|>\n<|begin_of_tool_call|>\n{"name":"calculate","arguments":{"expression":"1+1"}}\n<|begin_of_expect|>2\n<|end_of_tool_call|>\n<|end_of_task|>`
  const parsed = parseSrmlDocument(text)
  const task = parsed.blocks[0]
  if (task.kind !== 'task') return
  const call = task.segments[0]
  assert.equal(call.kind, 'tool-call')
  if (call.kind === 'tool-call') {
    assert.equal(call.expected, 2, 'expect 未闭合应容错收尾并解析内容')
  }
  assert.ok(parsed.warnings.some((warning) => warning.code === 'unclosed-segment'), '未闭合 expect 应记 warning')
  console.log('ok: unclosed expect tag is tolerated with warning')
}

function testParseToolCallExpectOrphan(): void {
  const text = `<|begin_of_task_1|>\n<begin_of_thought>\n<|begin_of_expect|>2<|end_of_expect|>推理\n<end_of_thought>\n<begin_of_response_1>\n回复\n<end_of_response_1>\n<|end_of_task|>`
  const parsed = parseSrmlDocument(text)
  const task = parsed.blocks[0]
  if (task.kind !== 'task') return
  assert.equal(task.segments.length, 2, 'thought 内 expect 不应生成额外段')
  const thought = task.segments[0]
  assert.equal(thought.kind, 'thought')
  assert.ok(parsed.warnings.some((warning) => warning.code === 'orphan-tag'), 'thought 内 expect 应记 orphan-tag warning')
  console.log('ok: expect tag outside tool-call segment warns and is ignored')
}

async function testEngineToolCallLoop(): Promise<void> {
  const events: SrmlEngineEvent[] = []
  const stub = new StubAgent([TOOL_DOC, FINAL_DOC])
  const engine = new SrmlEngine({ agent: stub, onEvent: (event) => events.push(event) })
  await engine.run([{ kind: 'prompt', id: 1, content: '现在几点' }])
  const plans = events.filter((event) => event.type === 'plan')
  assert.equal(plans.length, 2, '两轮生成：工具调用轮 + 最终回复轮')
  if (plans[0]?.type === 'plan') assert.equal(plans[0].step, 1)
  if (plans[1]?.type === 'plan') assert.equal(plans[1].step, 2)
  assert.ok(events.some((event) => event.type === 'tool-executing'), '应有工具执行事件')
  assert.ok(events.some((event) => event.type === 'tool-result'), '应有工具结果事件')
  const done = events.find((event) => event.type === 'done')
  assert.ok(done && done.type === 'done' && done.llmCalls === 2)
  const toolTurns = stub.receivedFollowUp?.filter(
    (turn) => turn.role === 'user' && turn.content.includes('begin_of_tool_result'),
  )
  assert.ok(toolTurns && toolTurns.length >= 1, '第二步 user 消息应含 tool_result 回填')
  console.log('ok: engine tool-call loop executes tool then continues')
}

async function testEngineMaxSteps(): Promise<void> {
  const events: SrmlEngineEvent[] = []
  const stub = new StubAgent([TOOL_DOC, TOOL_DOC, TOOL_DOC, TOOL_DOC, TOOL_DOC])
  const engine = new SrmlEngine({ agent: stub, onEvent: (event) => events.push(event), maxSteps: 3 })
  await engine.run([{ kind: 'prompt', id: 1, content: 'x' }])
  const plans = events.filter((event) => event.type === 'plan')
  assert.equal(plans.length, 3, '步数上限 3 即停止')
  assert.ok(events.some((event) => event.type === 'error'), '达到上限应报错')
  assert.ok(events.some((event) => event.type === 'done'), '应有 done')
  console.log('ok: engine stops after maxSteps')
}

async function testEngineBranchHistoryIncludesToolResults(): Promise<void> {
  const stub = new StubAgent([TOOL_DOC, FINAL_DOC, FINAL_DOC])
  const engine = new SrmlEngine({ agent: stub, onEvent: () => {} })
  await engine.run([{ kind: 'prompt', id: 1, content: '第一轮：问时间' }])
  const branch = engine.getBranches()[0]
  assert.ok(branch && branch.id === 1)
  await engine.run([{ kind: 'prompt', id: 2, content: '第二轮' }], { branchId: 1 })
  const toolTurns = stub.receivedFollowUp?.filter((turn) => turn.content.includes('begin_of_tool_result'))
  assert.ok(toolTurns && toolTurns.length >= 1, '继续分支时历史应含第一轮工具结果')
  console.log('ok: branch history includes tool results when continuing')
}

// ---- expect 契约 ----

const EXPECT_MATCH_DOC = `<|begin_of_task_1|>
<begin_of_thought>
calculate 预判 result=2，声明 expect 后直接假设成功继续。
<end_of_thought>
<|begin_of_tool_call|>
{"name": "calculate", "arguments": {"expression": "1+1"}}
<|begin_of_expect|>{"result": 2}<|end_of_expect|>
<|end_of_tool_call|>
<begin_of_response_1>
1+1=2。
<end_of_response_1>
<|end_of_task|>`

const EXPECT_MISMATCH_DOC = `<|begin_of_task_1|>
<begin_of_thought>
calculate 预判 result=3，声明 expect 后直接假设成功继续。
<end_of_thought>
<|begin_of_tool_call|>
{"name": "calculate", "arguments": {"expression": "1+1"}}
<|begin_of_expect|>{"result": 3}<|end_of_expect|>
<|end_of_tool_call|>
<begin_of_response_1>
1+1=3。
<end_of_response_1>
<|end_of_task|>`

const EXPECT_FIX_DOC = `<|begin_of_task_1|>
<begin_of_thought>
真实结果是 2，修正输出。
<end_of_thought>
<begin_of_response_1>
1+1=2。
<end_of_response_1>
<|end_of_task|>`

const NO_EXPECT_OPTIMISTIC_DOC = `<|begin_of_task_1|>
<begin_of_thought>
写入说明文件。
<end_of_thought>
<|begin_of_tool_call|>
{"name": "write_file", "arguments": {"path": "srml-demo-workspace/noexpect.txt", "content": "x"}}
<|end_of_tool_call|>
<begin_of_response_1>
已写入 noexpect.txt。
<end_of_response_1>
<|end_of_task|>`

const NO_EXPECT_FIX_DOC = `<|begin_of_task_1|>
<begin_of_thought>
收到真实结果，写入成功，给出最终回复。
<end_of_thought>
<begin_of_response_1>
已写入 noexpect.txt。
<end_of_response_1>
<|end_of_task|>`

const NO_EXPECT_WAIT_DOC = `<|begin_of_task_1|>
<begin_of_thought>
需要查时间。
<end_of_thought>
<|begin_of_tool_call|>
{"name": "get_current_time", "arguments": {"timezone": "Asia/Shanghai"}}
<|end_of_tool_call|>
<|end_of_task|>`

const NO_EXPECT_WAIT_FINAL_DOC = `<|begin_of_task_1|>
<begin_of_thought>
拿到时间了。
<end_of_thought>
<begin_of_response_1>
现在是北京时间 14:30。
<end_of_response_1>
<|end_of_task|>`

const STREAM_DEDUP_TEXT =
  '<|begin_of_task_1|>\n<|begin_of_tool_call|>\n{"name": "calculate", "arguments": {"expression":"1+1"}}\n' +
  '<|begin_of_expect|>{"result": 2}<|end_of_expect|>\n' +
  '<|end_of_tool_call|>\n<begin_of_response_1>\n1+1=2。\n<end_of_response_1>\n<|end_of_task|>'

const FORK_MIX_DOC = `<|begin_of_task_1|>
<begin_of_thought>
write_file 声明 expect 预判后直接假设成功继续。
<end_of_thought>
<|begin_of_tool_call|>
{"name": "write_file", "arguments": {"path": "srml-demo-workspace/mixed.txt", "content": "a"}}
<|begin_of_expect|>{"status": "written"}<|end_of_expect|>
<|end_of_tool_call|>
<begin_of_response_1>
已写入 mixed.txt。
<end_of_response_1>
<|end_of_task|>

<|begin_of_task_2|>
<begin_of_thought>
需要查时间。
<end_of_thought>
<|begin_of_tool_call|>
{"name": "get_current_time", "arguments": {"timezone": "Asia/Shanghai"}}
<|end_of_tool_call|>
<|end_of_task|>`

const FORK_MIX_FINAL_DOC = `<|begin_of_task_2|>
<begin_of_thought>
拿到时间了。
<end_of_thought>
<begin_of_response_2>
现在是北京时间 14:30。
<end_of_response_2>
<|end_of_task|>`

function predictionChecks(events: SrmlEngineEvent[]): Extract<SrmlEngineEvent, { type: 'prediction-checked' }>[] {
  return events.filter((event): event is Extract<SrmlEngineEvent, { type: 'prediction-checked' }> => event.type === 'prediction-checked')
}

async function testExpectMatchOneCall(): Promise<void> {
  const events: SrmlEngineEvent[] = []
  const stub = new StubAgent([EXPECT_MATCH_DOC])
  const engine = new SrmlEngine({ agent: stub, onEvent: (event) => events.push(event) })
  await engine.run([{ kind: 'prompt', id: 1, content: '计算 1+1' }])

  const plans = events.filter((event) => event.type === 'plan')
  assert.equal(plans.length, 1, 'expect 相符不应触发修正轮')
  const checks = predictionChecks(events)
  assert.equal(checks.length, 1, '应有一次核对')
  assert.equal(checks[0]?.ok, true)
  assert.equal(checks[0]?.name, 'calculate')
  const done = events.find((event) => event.type === 'done')
  assert.ok(done && done.type === 'done' && done.llmCalls === 1, '整轮只消耗一次 LLM 调用')
  assert.ok(done && done.type === 'done' && done.summary.includes('expect 预判成立'), 'done 汇总应提及预判成立')
  console.log('ok: expect match completes in one LLM call, no refill')
}

async function testExpectMismatchCorrection(): Promise<void> {
  const events: SrmlEngineEvent[] = []
  const stub = new StubAgent([EXPECT_MISMATCH_DOC, EXPECT_FIX_DOC])
  const engine = new SrmlEngine({ agent: stub, onEvent: (event) => events.push(event) })
  await engine.run([{ kind: 'prompt', id: 1, content: '计算 1+1' }])

  const checks = predictionChecks(events)
  assert.equal(checks.length, 1)
  assert.equal(checks[0]?.ok, false, 'expect 不符 → 核对失败')
  assert.ok(checks[0]?.error?.includes('预判值不符'), 'UI 诊断携带预判不符说明')
  assert.ok(checks[0]?.error?.includes('2'), 'UI 诊断携带真实结果')

  const toolTurns = stub.receivedFollowUp?.filter(
    (turn) => turn.role === 'user' && turn.content.includes('begin_of_tool_result'),
  )
  const last = toolTurns?.at(-1)?.content ?? ''
  assert.ok(last.includes('"result":2'), '回填含真实结果 2')
  assert.ok(!last.includes('预判值不符'), '模型上下文不应出现预判不符字样')

  const done = events.find((event) => event.type === 'done')
  assert.ok(done && done.type === 'done' && done.llmCalls === 2, 'expect 不符 → 修正轮共两次 LLM 调用')
  console.log('ok: expect mismatch → cut + real result refill + correction turn')
}

async function testNoExpectPlacedOptimistic(): Promise<void> {
  const events: SrmlEngineEvent[] = []
  const stub = new StubAgent([NO_EXPECT_OPTIMISTIC_DOC, NO_EXPECT_FIX_DOC])
  const engine = new SrmlEngine({ agent: stub, onEvent: (event) => events.push(event) })
  await engine.run([{ kind: 'prompt', id: 1, content: '写一个文件' }])

  const checks = predictionChecks(events)
  assert.equal(checks.length, 0, '无 expect 不应产生核对')
  const toolTurns = stub.receivedFollowUp?.filter(
    (turn) => turn.role === 'user' && turn.content.includes('begin_of_tool_result'),
  )
  const last = toolTurns?.at(-1)?.content ?? ''
  assert.ok(last.includes('"status":"written"'), '回填真实写入结果')
  assert.ok(!last.includes('预判值不符'), '无 expect 也不应出现预判字样')

  const done = events.find((event) => event.type === 'done')
  assert.ok(done && done.type === 'done' && done.llmCalls === 2, '无 expect 乐观继续 → 切断 + 修正轮')
  console.log('ok: no expect + optimistic continuation → cut + refill real result')
}

async function testNoExpectPlainWait(): Promise<void> {
  const events: SrmlEngineEvent[] = []
  const stub = new StubAgent([NO_EXPECT_WAIT_DOC, NO_EXPECT_WAIT_FINAL_DOC])
  const engine = new SrmlEngine({ agent: stub, onEvent: (event) => events.push(event) })
  await engine.run([{ kind: 'prompt', id: 1, content: '现在几点' }])

  const plans = events.filter((event) => event.type === 'plan')
  assert.equal(plans.length, 2, '等回填 → 两步完成')
  const done = events.find((event) => event.type === 'done')
  assert.ok(done && done.type === 'done' && done.llmCalls === 2)
  console.log('ok: no expect + waiting → plain refill path')
}

async function testStreamingTriggerDedup(): Promise<void> {
  const events: SrmlEngineEvent[] = []
  const stub = new StubAgent([STREAM_DEDUP_TEXT], [
    [
      '<|begin_of_task_1|>\n<|begin_of_tool_call|>\n{"name": "calculate", "arguments": ',
      '{"expression":"1+1"}}\n<|begin_of_expect|>{"result": 2}<|end_of_expect|>\n<|end_of_tool_call|>\n',
      '<begin_of_response_1>\n1+1=2。\n<end_of_response_1>\n<|end_of_task|>',
    ],
  ])
  const engine = new SrmlEngine({ agent: stub, onEvent: (event) => events.push(event) })
  await engine.run([{ kind: 'prompt', id: 1, content: '计算 1+1' }])

  const executing = events.filter((event) => event.type === 'tool-executing')
  assert.equal(executing.length, 1, '同一 tool_call 闭合后只执行一次')
  const results = events.filter((event) => event.type === 'tool-result')
  assert.equal(results.length, 1)
  if (results[0]?.type === 'tool-result') {
    const parsed = JSON.parse(results[0].result)
    assert.equal(parsed.result, 2, 'calculate 返回真实结果')
  }
  const done = events.find((event) => event.type === 'done')
  assert.ok(done && done.type === 'done' && done.llmCalls === 1, 'expect 相符一次调用完成')
  console.log('ok: streaming closed tool-call triggers exactly once despite repeated parse')
}

async function testForkMixedExpectAndPlain(): Promise<void> {
  const events: SrmlEngineEvent[] = []
  const stub = new StubAgent([FORK_MIX_DOC, FORK_MIX_FINAL_DOC])
  const engine = new SrmlEngine({ agent: stub, onEvent: (event) => events.push(event) })
  await engine.run([
    { kind: 'prompt', id: 1, content: '任务一' },
    { kind: 'prompt', id: 2, content: '任务二' },
  ])

  const checks = predictionChecks(events)
  assert.equal(checks.length, 1, '只有 task1 的 expect 被核对')
  assert.equal(checks[0]?.taskId, 1)
  assert.equal(checks[0]?.ok, true)

  const toolTurns = stub.receivedFollowUp?.filter(
    (turn) => turn.role === 'user' && turn.content.includes('begin_of_tool_result'),
  )
  const last = toolTurns?.at(-1)?.content ?? ''
  assert.ok(last.includes('begin_of_task_2'), '回填按 task 分组只含 task2')
  assert.ok(!last.includes('begin_of_task_1'), 'expect 成立的 task1 不回填')

  const done = events.find((event) => event.type === 'done')
  assert.ok(done && done.type === 'done' && done.llmCalls === 2, 'task2 无 expect → 两步完成')
  console.log('ok: fork mixed — expect task1 no refill, plain task2 refilled')
}

async function testExpectReplacedInHistory(): Promise<void> {
  const stub = new StubAgent([EXPECT_MATCH_DOC, FINAL_DOC])
  const engine = new SrmlEngine({ agent: stub, onEvent: () => {} })
  await engine.run([{ kind: 'prompt', id: 1, content: '计算 1+1' }])
  const branch = engine.getBranches()[0]
  assert.ok(branch && branch.id === 1)
  await engine.run([{ kind: 'prompt', id: 2, content: '第二轮' }], { branchId: 1 })
  const assistantTurns = stub.receivedFollowUp?.filter((turn) => turn.role === 'assistant')
  const first = assistantTurns?.find((turn) => turn.content.includes('begin_of_tool_call'))
  assert.ok(first, '历史含工具调用轮')
  assert.ok(first.content.includes('begin_of_tool_result'), 'expect 应被替换为 tool_result')
  assert.ok(!first.content.includes('begin_of_expect'), 'expect 不应进入模型上下文')
  console.log('ok: expect replaced by tool_result in branch history')
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
  testSerializeToolResults()
  testParseToolCall()
  testParseToolCallArgumentsAsObject()
  testParseToolCallArgumentsAsString()
  testParseToolCallInvalidJson()
  testParseToolCallMissingName()
  testParseToolCallUnparseable()
  testParseToolCallExpected()
  testParseToolCallExpectUnclosed()
  testParseToolCallExpectOrphan()
  testWorkspacePaths()
  await testCalculateTool()
  await testSlowToolSleeps()
  await testSlowToolAborts()
  await testWriteSandboxEnforcement()

  await testEngineRunsExchange()
  await testEngineRetriesOnParseFailure()
  await testEngineGivesUpAfterMaxAttempts()
  await testEngineCreatesBranchesFromFirstRound()
  await testEngineBranchContinueScopesHistory()
  await testEngineDiscardBranch()
  await testEngineToolCallLoop()
  await testEngineMaxSteps()
  await testEngineBranchHistoryIncludesToolResults()

  await testExpectMatchOneCall()
  await testExpectMismatchCorrection()
  await testNoExpectPlacedOptimistic()
  await testNoExpectPlainWait()
  await testStreamingTriggerDedup()
  await testForkMixedExpectAndPlain()
  await testExpectReplacedInHistory()

  await cleanupSandbox()
  console.log('srml-demo: all passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
