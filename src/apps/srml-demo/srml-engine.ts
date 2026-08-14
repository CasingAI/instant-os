/**
 * SRML 执行引擎（分支版 + 工具调用 agentic loop）。
 *
 * 核心演示「Fork」：一次请求携带多个 <|begin_of_prompt_N|> 块，模型在一次回复里
 * 为每个 prompt 输出一个 <|begin_of_task_N|> 块（thinking 打包在 DSL 里）。
 *
 * 工具调用（每回合多步 agentic loop）：
 * - 模型输出 <|begin_of_tool_call|>（名称/参数，可带 expect 预判标签）→ 引擎并行执行工具
 *   → 回填 <|begin_of_tool_result|>（作为 user 消息）→ 模型继续，
 *   直到本步没有新的工具调用（以 <begin_of_response> 收尾）或达到步数上限。
 * - expect 契约：写了 <|begin_of_expect|> 预判相符 → 乐观成立（一次请求，结果内联替换、不回填）；
 *   预判不符 → 切断 tool_call 后内容 + 回填真实结果 + 修正轮；
 *   无 expect → 不构成预测，按普通路径回填真实结果（若乐观继续则切断其后内容）。
 * - expect 永不进入模型上下文：进上下文时一律就地替换为真实 <|begin_of_tool_result|> 块。
 *
 * 分支管理（针对 Fork 的会话模型）：
 * - 一次「无目标」请求（新任务组）→ 模型输出的每个 task 各自创建一个分支
 *   （分支 id = task id，分支只携带自己的 prompt 与模型原始片段，含多步工具历史）。
 * - 针对某分支继续 → 上下文只包含该分支的历史（冷前缀 followUp），
 *   本轮模型输出追加到该分支，其他分支完全不出现在上下文中。
 * - 分支可被丢弃：标记后不再出现在可选目标、不再进入任何上下文。
 */
import type { SrmlAgent } from './srml-agent.ts'
import {
  type SrmlBlock,
  type SrmlPartialState,
  type SrmlPromptBlock,
  type SrmlSegment,
  type SrmlStreamParseResult,
  type SrmlTaskBlock,
  type SrmlToolResultBlock,
  SrmlParseError,
  serializeBlocks,
  serializeToolResults,
} from './srml-dsl.ts'
import { parseSrmlDocument, parseSrmlStreamChunk, sliceTaskRaw } from './srml-parse.ts'
import { findTool } from './srml-tools.ts'

export type SrmlChatTurn = {
  role: 'user' | 'assistant'
  content: string
}

export type SrmlBranchSummary = {
  id: number
  label: string
  /** 首个 prompt 摘要（展示用） */
  summary: string
  discarded: boolean
}

/** expect 预判核对结果（语义记录，供 UI / done 汇总） */
export type SrmlPredictionVerification = {
  taskId: number
  name: string
  /** true = 预判成立；false = 预判不符，其后内容已作废 */
  ok: boolean
  error?: string
}

/** 一步中最终收集到的一次工具执行（按 taskId → segIndex 排序） */
export type ExecutedToolCall = {
  taskId: number
  segIndex: number
  name: string
  arguments: string
  /** 模型预判值（tool_call 内 <|begin_of_expect|> 标签内容），无则 undefined */
  expected?: unknown
  result: string
  ms: number
}

/** 分支单轮中的一步：模型一次输出的原始文本 + 解析结果 + 触发的工具结果 */
export type SrmlBranchStep = {
  raw: string
  tasks: SrmlTaskBlock[]
  toolResults: SrmlToolResultBlock[]
  verifications: SrmlPredictionVerification[]
  /** 本步全部工具真实执行结果（供进上下文时把 expect 就地替换为 tool_result） */
  executions: ExecutedToolCall[]
}

/** 单个分支某一轮的记录：本分支该轮的 prompt 与多步模型输出链 */
export type SrmlBranchTurn = {
  prompts: SrmlPromptBlock[]
  steps: SrmlBranchStep[]
}

type SrmlBranch = SrmlBranchSummary & {
  turns: SrmlBranchTurn[]
}

export type SrmlEngineEvent =
  | {
      type: 'exchange-start'
      prompts: SrmlPromptBlock[]
      requestText: string
      turn: number
      branchId?: number
    }
  | {
      type: 'stream'
      text: string
      blocks: SrmlBlock[]
      partial: SrmlPartialState | null
      warnings: string[]
    }
  | {
      type: 'plan'
      raw: string
      blocks: SrmlBlock[]
      warnings: string[]
      /** 第几步（本回合内） */
      step: number
      /** 第几次生成（解析失败重试后 >1） */
      attempt: number
      branchId?: number
    }
  | {
      type: 'tool-executing'
      taskId: number
      name: string
      arguments: string
    }
  | {
      type: 'tool-result'
      taskId: number
      name: string
      arguments: string
      result: string
      /** 执行耗时毫秒 */
      ms: number
    }
  | {
      type: 'prediction-checked'
      taskId: number
      name: string
      ok: boolean
      error?: string
    }
  | { type: 'branch-created'; branch: SrmlBranchSummary }
  | { type: 'branch-discarded'; branchId: number }
  | { type: 'retry-parse'; message: string; attempt: number }
  | { type: 'error'; message: string }
  | { type: 'done'; summary: string; llmCalls: number }

export type SrmlEngineOptions = {
  agent: SrmlAgent
  onEvent: (event: SrmlEngineEvent) => void
  /** 最大 LLM 生成轮次（防死循环，单步内重试次数） */
  maxAttempts?: number
  /** 最大工具调用步数（一次回合内 exchange 次数） */
  maxSteps?: number
}

export type SrmlRunOptions = {
  /** 目标分支 id；省略表示新任务组（不带历史），输出的每个 task 创建新分支 */
  branchId?: number
  /** 覆盖本次回合的步数上限 */
  maxSteps?: number
}

function summarize(text: string, max = 26): string {
  const firstLine = text.split('\n')[0].trim()
  if (firstLine.length <= max) return firstLine
  return `${firstLine.slice(0, max)}…`
}

/** 解析工具调用的 arguments 文本（JSON），失败返回空对象 */
function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * 宽松相等：number 与数字字符串互通；数字用相对容差比较（浮点误差，
 * 如 (128+256+64)*1.08 在 JS 里是 483.84000000000003）；其余按 JSON 序列化严格比较。
 */
function looseEqual(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return a === b
  if (typeof a === 'number' && typeof b === 'string' && b.trim() !== '' && Number.isFinite(Number(b))) {
    return looseEqual(a, Number(b))
  }
  if (typeof b === 'number' && typeof a === 'string' && a.trim() !== '' && Number.isFinite(Number(a))) {
    return looseEqual(Number(a), b)
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
  }
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * strict-shape 子集比对（expect 与真实反馈）：
 * - 对象/对象：expect 的每个键在真实反馈中存在且递归相等（真实反馈多余的字段忽略）；
 * - 标量/标量：looseEqual（数字与数字字符串互通、浮点容差）；
 * - 数组/数组：严格 JSON 相等；
 * - 形状不匹配（对象对标量等）→ false。
 */
function compareShape(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual) || Array.isArray(expected)) {
    return JSON.stringify(actual) === JSON.stringify(expected)
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false
    const expectedObj = expected as Record<string, unknown>
    const actualObj = actual as Record<string, unknown>
    return Object.keys(expectedObj).every((key) => compareShape(actualObj[key], expectedObj[key]))
  }
  if (expected === null) return actual === null
  return looseEqual(actual, expected)
}

/** 核对 expect 预判与真实反馈是否相符；相符返回 undefined，否则返回诊断文本（仅 UI 展示） */
function matchExpected(resultText: string, expected: unknown): string | undefined {
  let actual: unknown
  try {
    actual = JSON.parse(resultText)
  } catch {
    actual = resultText
  }
  if (!compareShape(actual, expected)) {
    return `预判值不符：预期 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`
  }
  return undefined
}

/**
 * 把模型原始输出中的 expect 标签就地替换为真实 <|begin_of_tool_result|> 块（进上下文前）。
 * expect 永不进入模型上下文：无论预判相符与否，模型只看到真实结果。
 */
function replaceExpectWithResults(raw: string, executions: ExecutedToolCall[]): string {
  let text = raw
  for (const execution of executions) {
    const expectPattern = /<\|?\/?\s*begin_of_expect\s*\|?>[\s\S]*?<\|?\/?\s*end_of_expect\s*\|?>/i
    const match = expectPattern.exec(text)
    if (!match) continue
    let resultJson: unknown = execution.result
    try {
      resultJson = JSON.parse(execution.result)
    } catch {
      // 非合法 JSON 时保持字符串兜底
    }
    const block = JSON.stringify({ name: execution.name, result: resultJson })
    const replacement = `<|begin_of_tool_result|>\n${block}\n<|end_of_tool_result|>`
    text = text.slice(0, match.index) + replacement + text.slice(match.index + match[0].length)
  }
  return text
}

/** 流式触发的工具调用（每步一个容器；key = `${taskId}#${segIndex}`，task id 全局唯一） */
type ToolCallMeta = {
  taskId: number
  segIndex: number
  name: string
  arguments: string
  /** 模型预判值（tool_call 内 <|begin_of_expect|> 标签内容），无则 undefined */
  expected?: unknown
}

type StepToolCalls = {
  /** 永远不 reject（AbortError 也会被捕获为 { ok: false }），避免孤儿 rejection */
  pending: Map<string, Promise<{ ok: true; result: string; ms: number } | { ok: false; error: unknown }>>
  meta: Map<string, ToolCallMeta>
}

/** 把任务 raw 切片切断在第 ordinal 个 tool_call 块结束处（其后的乐观内容作废） */
function cutTaskSlice(slice: string, segments: SrmlSegment[], cutSegIndex: number): string {
  let ordinal = -1
  for (let i = 0; i <= cutSegIndex; i += 1) {
    if (segments[i]?.kind === 'tool-call') ordinal += 1
  }
  if (ordinal < 0) return slice
  const pattern = /<\|?\/?\s*end_of_tool_call\s*\|?>/gi
  let match: RegExpExecArray | null
  let seen = 0
  let end = -1
  while ((match = pattern.exec(slice)) !== null) {
    if (seen === ordinal) {
      end = match.index + match[0].length
      break
    }
    seen += 1
  }
  if (end === -1) return slice
  return slice.slice(0, end).trimEnd()
}

/** 有作废发生时，把原始输出重建为只含有效部分的上下文版本（UI 仍保留完整原文） */
function buildCutRaw(raw: string, tasks: SrmlTaskBlock[], cutTasks: Map<number, number>): string {
  const parts: string[] = []
  for (const task of tasks) {
    const slice = sliceTaskRaw(raw, task.id)
    if (!slice) return raw // 任务无法切片（缺 begin 标签）→ 保守保留全文
    const cutIndex = cutTasks.get(task.id)
    parts.push(cutIndex !== undefined ? cutTaskSlice(slice, task.segments, cutIndex) : slice)
  }
  return parts.join('\n\n')
}

export class SrmlEngine {
  private readonly agent: SrmlAgent
  private readonly onEvent: (event: SrmlEngineEvent) => void
  private readonly maxAttempts: number
  private readonly maxSteps: number
  private branches: SrmlBranch[] = []
  private llmCalls = 0
  private turn = 0
  private aborted = false
  private abortController: AbortController | null = null

  constructor(options: SrmlEngineOptions) {
    this.agent = options.agent
    this.onEvent = options.onEvent
    this.maxAttempts = options.maxAttempts ?? 3
    this.maxSteps = options.maxSteps ?? 5
  }

  /** 清空全部分支与统计（新建会话） */
  reset(): void {
    this.abort()
    this.branches = []
    this.llmCalls = 0
    this.turn = 0
  }

  abort(): void {
    this.aborted = true
    this.abortController?.abort()
  }

  /** 活动（未丢弃）分支列表，供 UI 作为「发送到」目标 */
  getBranches(): SrmlBranchSummary[] {
    return this.branches
      .filter((branch) => !branch.discarded)
      .map(({ id, label, summary, discarded }) => ({ id, label, summary, discarded }))
  }

  /** 丢弃一个分支：不再出现在可选目标，也不进入任何后续上下文 */
  discardBranch(branchId: number): void {
    const branch = this.branches.find((item) => item.id === branchId)
    if (!branch || branch.discarded) return
    branch.discarded = true
    this.onEvent({ type: 'branch-discarded', branchId })
  }

  private findBranch(branchId: number): SrmlBranch | undefined {
    return this.branches.find((branch) => branch.id === branchId && !branch.discarded)
  }

  private buildFollowUp(branchId: number): SrmlChatTurn[] {
    const branch = this.findBranch(branchId)
    if (!branch) return []
    const turns: SrmlChatTurn[] = []
    for (const turn of branch.turns) {
      turns.push({ role: 'user', content: serializeBlocks(turn.prompts) })
      for (const step of turn.steps) {
        // expect 永不进入模型上下文：进上下文时就地替换为真实 tool_result
        turns.push({ role: 'assistant', content: replaceExpectWithResults(step.raw, step.executions) })
        if (step.toolResults.length > 0) {
          turns.push({ role: 'user', content: serializeToolResults(step.toolResults) })
        }
      }
    }
    return turns
  }

  /** 把本轮多步解析结果登记进分支结构 */
  private attachTurns(
    prompts: SrmlPromptBlock[],
    steps: SrmlBranchStep[],
    branchId: number | undefined,
  ): void {
    if (steps.length === 0) return
    if (branchId !== undefined) {
      const branch = this.findBranch(branchId)
      if (!branch) return
      branch.turns.push({ prompts, steps })
      return
    }
    // 新任务组：每个 task 各自成为一个分支
    const firstTasks = steps[0].tasks
    firstTasks.forEach((task, index) => {
      const prompt = prompts[index]
      const existing = this.branches.find((branch) => branch.id === task.id)
      // 把多步输出按 task 切片，工具结果与核对记录也只保留本 task 的
      const branchSteps: SrmlBranchStep[] = steps.map((step) => ({
        raw: sliceTaskRaw(step.raw, task.id),
        tasks: step.tasks.filter((item) => item.id === task.id),
        toolResults: step.toolResults.filter((result) => result.taskId === task.id),
        verifications: step.verifications.filter((verification) => verification.taskId === task.id),
        executions: step.executions.filter((execution) => execution.taskId === task.id),
      }))
      if (existing) {
        // 极端容错：task 编号撞已有分支，挂到该分支尾部
        existing.turns.push({ prompts: prompt ? [prompt] : prompts, steps: branchSteps })
        return
      }
      const branch: SrmlBranch = {
        id: task.id,
        label: `分支 ${task.id}`,
        summary: prompt ? summarize(prompt.content) : '',
        turns: [{ prompts: prompt ? [prompt] : [], steps: branchSteps }],
        discarded: false,
      }
      this.branches.push(branch)
      this.onEvent({
        type: 'branch-created',
        branch: { id: branch.id, label: branch.label, summary: branch.summary, discarded: false },
      })
    })
  }

  /** 触发一次工具执行（流式并行：tool_call 闭合即触发，fire-and-forget；key = taskId#segIndex 去重） */
  private triggerToolCall(
    calls: StepToolCalls,
    taskId: number,
    segIndex: number,
    segment: Extract<SrmlSegment, { kind: 'tool-call' }>,
    signal: AbortSignal,
  ): void {
    if (!segment.name) return
    const key = `${taskId}#${segIndex}`
    if (calls.pending.has(key)) return
    const name = segment.name
    const argumentsText = segment.arguments
    this.onEvent({ type: 'tool-executing', taskId, name, arguments: argumentsText })
    const start = Date.now()
    const promise = (async () => {
      try {
        const result = await this.runTool(name, argumentsText, signal)
        this.onEvent({
          type: 'tool-result',
          taskId,
          name,
          arguments: argumentsText,
          result,
          ms: Date.now() - start,
        })
        return { ok: true as const, result, ms: Date.now() - start }
      } catch (error) {
        // AbortError 等异常向上携带，由 executeTools 统一判定中止
        return { ok: false as const, error }
      }
    })()
    calls.pending.set(key, promise)
    calls.meta.set(key, {
      taskId,
      segIndex,
      name,
      arguments: argumentsText,
      ...(segment.expected !== undefined ? { expected: segment.expected } : {}),
    })
  }

  /** 执行单个工具（错误转 JSON 文本；AbortError 重新抛出） */
  private async runTool(name: string, argumentsText: string, signal: AbortSignal): Promise<string> {
    const tool = findTool(name)
    if (!tool) return JSON.stringify({ error: `未知工具：${name}` })
    try {
      return await tool.execute(parseArgs(argumentsText), signal)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      return JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
    }
  }

  /** 流式回调里收集已闭合的 tool-call 段并触发执行（与模型生成并行） */
  private collectClosedToolCalls(
    stream: SrmlStreamParseResult,
    signal: AbortSignal,
    calls: StepToolCalls,
  ): void {
    for (const block of stream.blocks) {
      if (block.kind !== 'task') continue
      for (let index = 0; index < block.segments.length; index += 1) {
        const segment = block.segments[index]
        if (segment.kind === 'tool-call') this.triggerToolCall(calls, block.id, index, segment, signal)
      }
    }
    if (stream.partial?.open === 'task') {
      for (let index = 0; index < stream.partial.segments.length; index += 1) {
        const segment = stream.partial.segments[index]
        if (segment.kind === 'tool-call') this.triggerToolCall(calls, stream.partial.id, index, segment, signal)
      }
    }
  }

  /** 收集一步中全部工具执行结果（补齐流式未触发的，等待全部完成），按 taskId → segIndex 排序 */
  private async executeTools(
    tasks: SrmlTaskBlock[],
    calls: StepToolCalls,
    signal: AbortSignal,
  ): Promise<ExecutedToolCall[]> {
    // 补齐最终解析才出现的 tool-call（例如未闭合、被文档收尾自动补全的）
    for (const task of tasks) {
      for (let index = 0; index < task.segments.length; index += 1) {
        const segment = task.segments[index]
        if (segment.kind === 'tool-call') this.triggerToolCall(calls, task.id, index, segment, signal)
      }
    }
    if (calls.pending.size === 0) return []

    const outcomes = await Promise.all([...calls.pending.values()])
    const results: ExecutedToolCall[] = []
    let cursor = 0
    for (const [key] of calls.pending) {
      const meta = calls.meta.get(key)
      const outcome = outcomes[cursor]
      cursor += 1
      if (!meta || !outcome) continue
      if (outcome.ok) {
        results.push({
          ...meta,
          result: outcome.result,
          ms: outcome.ms,
        })
      } else {
        // 只有 AbortError 或意外异常会走到这里
        if (this.aborted) throw new DOMException('Aborted', 'AbortError')
        const error = outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
        results.push({ ...meta, result: JSON.stringify({ error }), ms: 0 })
      }
    }
    results.sort((a, b) => a.taskId - b.taskId || a.segIndex - b.segIndex)
    return results
  }

  /**
   * 核对 expect 预判：
   * - 有 expect 且相符 → 预判成立（prediction-checked ok，不回填，模型没等它）；
   * - 有 expect 但不符 → 作废该 task 此 tool-call 之后的内容，回填真实结果，触发修正轮；
   * - 无 expect → 不构成预测：回填真实结果；若 tool-call 后还有内容（模型乐观继续）则一并作废。
   */
  private verifyPredictions(
    executions: ExecutedToolCall[],
    raw: string,
    tasks: SrmlTaskBlock[],
  ): { refills: SrmlToolResultBlock[]; verifications: SrmlPredictionVerification[]; cutRaw: string | null } {
    const refills: SrmlToolResultBlock[] = []
    const verifications: SrmlPredictionVerification[] = []
    const cutTasks = new Map<number, number>()
    for (const execution of executions) {
      if (execution.expected !== undefined) {
        const mismatch = matchExpected(execution.result, execution.expected)
        if (!mismatch) {
          verifications.push({ taskId: execution.taskId, name: execution.name, ok: true })
          this.onEvent({ type: 'prediction-checked', taskId: execution.taskId, name: execution.name, ok: true })
        } else {
          verifications.push({ taskId: execution.taskId, name: execution.name, ok: false, error: mismatch })
          this.onEvent({
            type: 'prediction-checked',
            taskId: execution.taskId,
            name: execution.name,
            ok: false,
            error: mismatch,
          })
          refills.push({
            kind: 'tool-result',
            taskId: execution.taskId,
            name: execution.name,
            result: execution.result,
          })
          if (!cutTasks.has(execution.taskId)) cutTasks.set(execution.taskId, execution.segIndex)
        }
      } else {
        refills.push({
          kind: 'tool-result',
          taskId: execution.taskId,
          name: execution.name,
          result: execution.result,
        })
        // 无 expect：不构成预测。tool-call 后还有内容（模型乐观继续）→ 作废；
        // 仅当 tool-call 是本 task 最后一段（模型在等回填）才不必切断。
        const task = tasks.find((item) => item.id === execution.taskId)
        const hasFollowing = task?.segments.some((_, index) => index > execution.segIndex) ?? false
        if (hasFollowing && !cutTasks.has(execution.taskId)) {
          cutTasks.set(execution.taskId, execution.segIndex)
        }
      }
    }
    const cutRaw = cutTasks.size > 0 ? buildCutRaw(raw, tasks, cutTasks) : null
    return { refills, verifications, cutRaw }
  }

  /**
   * 单步 exchange + 解析，解析失败时追加反馈重试（最多 maxAttempts 次）。
   * 流式输出期间闭合的 tool-call 会立即触发执行（与生成并行），结果由返回的 calls 汇总。
   * 全部失败抛出错误，由 run 统一收尾。
   */
  private async generateStep(
    userText: string,
    followUp: SrmlChatTurn[],
    signal: AbortSignal,
  ): Promise<{ raw: string; blocks: SrmlBlock[]; warnings: string[]; attempt: number; calls: StepToolCalls }> {
    const calls: StepToolCalls = { pending: new Map(), meta: new Map() }
    let attemptText = userText
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      if (this.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }
      const raw = await this.agent.exchange(attemptText, {
        signal,
        followUp,
        onStream: (_delta, accumulated) => {
          const stream = parseSrmlStreamChunk(accumulated)
          this.collectClosedToolCalls(stream, signal, calls)
          this.onEvent({
            type: 'stream',
            text: accumulated,
            blocks: stream.blocks,
            partial: stream.partial,
            warnings: stream.warnings.map((warning) => warning.message),
          })
        },
      })
      this.llmCalls += 1
      try {
        const parsed = parseSrmlDocument(raw)
        return {
          raw,
          blocks: parsed.blocks,
          warnings: parsed.warnings.map((warning) => warning.message),
          attempt,
          calls,
        }
      } catch (error) {
        const message = error instanceof SrmlParseError ? error.message : String(error)
        this.onEvent({ type: 'retry-parse', message, attempt })
        this.onEvent({ type: 'error', message: `解析失败：${message}` })
        attemptText =
          `${userText}\n\n[SRML 反馈] 你的上一次输出无法解析：${message}\n` +
          `请严格按 <|begin_of_task_N|> 块输出，每个 prompt 对应一个 task，` +
          `<begin_of_thought>/<begin_of_response> 必须成对闭合，不要输出标签以外的任何文字。`
      }
    }
    throw new Error(`连续 ${this.maxAttempts} 次输出均无法解析，已停止`)
  }

  /**
   * 提交一批 prompt。
   * - 无 branchId：新任务组，不带任何历史；每个输出 task 创建独立分支。
   * - 有 branchId：只携带该分支的历史（其他分支不进上下文），本轮追加到该分支。
   * 回合内循环：模型输出含工具调用 → 执行 → 回填结果 → 继续，直到无工具调用或达到步数上限。
   */
  async run(prompts: SrmlPromptBlock[], options?: SrmlRunOptions): Promise<void> {
    this.llmCalls = 0
    this.aborted = false
    this.abortController = new AbortController()
    const signal = this.abortController.signal
    this.turn += 1

    const branchId = options?.branchId
    const maxSteps = options?.maxSteps ?? this.maxSteps
    if (branchId !== undefined && !this.findBranch(branchId)) {
      this.onEvent({ type: 'error', message: `目标分支 ${branchId} 不存在或已丢弃` })
      this.onEvent({ type: 'done', summary: '目标分支不可用，未发送请求', llmCalls: this.llmCalls })
      return
    }

    const requestText = serializeBlocks(prompts)
    const baseFollowUp = branchId !== undefined ? this.buildFollowUp(branchId) : []
    this.onEvent({ type: 'exchange-start', prompts, requestText, turn: this.turn, branchId })

    const steps: SrmlBranchStep[] = []
    const stepTurns: SrmlChatTurn[] = []
    let userText = requestText

    try {
      for (let step = 1; step <= maxSteps; step += 1) {
        if (this.aborted) break

        const { raw, blocks, warnings, attempt, calls } = await this.generateStep(
          userText,
          [...baseFollowUp, ...stepTurns],
          signal,
        )
        this.onEvent({
          type: 'plan',
          raw,
          blocks,
          warnings,
          step,
          attempt,
          branchId,
        })
        const tasks = blocks.filter((block): block is SrmlTaskBlock => block.kind === 'task')
        const executions = await this.executeTools(tasks, calls, signal)
        const { refills, verifications, cutRaw } = this.verifyPredictions(executions, raw, tasks)
        const stepRaw = cutRaw ?? raw

        steps.push({ raw: stepRaw, tasks, toolResults: refills, verifications, executions })
        stepTurns.push(
          { role: 'user', content: userText },
          { role: 'assistant', content: replaceExpectWithResults(stepRaw, executions) },
        )

        if (refills.length === 0) {
          // 没有需要回填的工具结果（模型直接回复，或全部 expect 预判成立）→ 回合结束
          this.attachTurns(prompts, steps, branchId)
          const scope = branchId !== undefined ? `分支 ${branchId}` : `${steps[0].tasks.length} 个新分支`
          const optimistic = steps.reduce(
            (sum, stepItem) => sum + stepItem.verifications.filter((item) => item.ok).length,
            0,
          )
          const toolCount = steps.reduce(
            (sum, stepItem) =>
              sum + stepItem.toolResults.length + stepItem.verifications.filter((item) => item.ok).length,
            0,
          )
          this.onEvent({
            type: 'done',
            summary:
              `第 ${this.turn} 轮（${scope}）· 共 ${steps.length} 步，解析出 ${tasks.length} 个任务，` +
              (toolCount > 0
                ? `调用工具 ${toolCount} 次${optimistic > 0 ? `，其中 ${optimistic} 次为 expect 预判成立，未消耗额外请求` : ''}。`
                : ''),
            llmCalls: this.llmCalls,
          })
          return
        }

        const toolText = serializeToolResults(refills)
        stepTurns.push({ role: 'user', content: toolText })
        userText = toolText
      }

      // 达到步数上限仍未收敛
      this.attachTurns(prompts, steps, branchId)
      this.onEvent({
        type: 'error',
        message: `连续 ${maxSteps} 步都在调用工具（模型没有给出最终回复），已停止。`,
      })
      this.onEvent({
        type: 'done',
        summary: `达到工具调用步数上限（${maxSteps} 步），已停止防死循环。`,
        llmCalls: this.llmCalls,
      })
    } catch (error) {
      if (this.aborted) {
        this.onEvent({ type: 'done', summary: '已中止', llmCalls: this.llmCalls })
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.onEvent({ type: 'error', message })
      this.onEvent({ type: 'done', summary: `执行中断：${message}`, llmCalls: this.llmCalls })
    }
  }
}
