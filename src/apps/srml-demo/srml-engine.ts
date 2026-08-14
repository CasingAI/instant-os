/**
 * SRML 执行引擎（分支版）。
 *
 * 核心演示「Fork」：一次请求携带多个 <|begin_of_prompt_N|> 块，模型在一次回复里
 * 为每个 prompt 输出一个 <|begin_of_task_N|> 块（thinking 打包在 DSL 里）。
 *
 * 分支管理（针对 Fork 的会话模型）：
 * - 一次「无目标」请求（新任务组）→ 模型输出的每个 task 各自创建一个分支
 *   （分支 id = task id，分支只携带自己的 prompt 与模型原始片段）。
 * - 针对某分支继续 → 上下文只包含该分支的历史（冷前缀 followUp），
 *   本轮模型输出追加到该分支，其他分支完全不出现在上下文中。
 * - 分支可被丢弃：标记后不再出现在可选目标、不再进入任何上下文。
 */
import type { SrmlAgent } from './srml-agent.ts'
import {
  type SrmlBlock,
  type SrmlPartialState,
  type SrmlPromptBlock,
  type SrmlTaskBlock,
  SrmlParseError,
  serializeBlocks,
} from './srml-dsl.ts'
import { parseSrmlDocument, parseSrmlStreamChunk, sliceTaskRaw } from './srml-parse.ts'

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

/** 单个分支某一轮的记录：本分支该轮的 prompt 与模型输出（task 切片 / 整段） */
export type SrmlBranchTurn = {
  prompts: SrmlPromptBlock[]
  raw: string
  tasks: SrmlTaskBlock[]
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
      /** 第几次生成（解析失败重试后 >1） */
      attempt: number
      branchId?: number
    }
  | { type: 'branch-created'; branch: SrmlBranchSummary }
  | { type: 'branch-discarded'; branchId: number }
  | { type: 'retry-parse'; message: string; attempt: number }
  | { type: 'error'; message: string }
  | { type: 'done'; summary: string; llmCalls: number }

export type SrmlEngineOptions = {
  agent: SrmlAgent
  onEvent: (event: SrmlEngineEvent) => void
  /** 最大 LLM 生成轮次（防死循环） */
  maxAttempts?: number
}

export type SrmlRunOptions = {
  /** 目标分支 id；省略表示新任务组（不带历史），输出的每个 task 创建新分支 */
  branchId?: number
}

function summarize(text: string, max = 26): string {
  const firstLine = text.split('\n')[0].trim()
  if (firstLine.length <= max) return firstLine
  return `${firstLine.slice(0, max)}…`
}

export class SrmlEngine {
  private readonly agent: SrmlAgent
  private readonly onEvent: (event: SrmlEngineEvent) => void
  private readonly maxAttempts: number
  private branches: SrmlBranch[] = []
  private llmCalls = 0
  private turn = 0
  private aborted = false
  private abortController: AbortController | null = null

  constructor(options: SrmlEngineOptions) {
    this.agent = options.agent
    this.onEvent = options.onEvent
    this.maxAttempts = options.maxAttempts ?? 3
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
      turns.push({ role: 'assistant', content: turn.raw })
    }
    return turns
  }

  /** 把本轮解析结果登记进分支结构 */
  private attachTurns(
    prompts: SrmlPromptBlock[],
    raw: string,
    tasks: SrmlTaskBlock[],
    branchId: number | undefined,
  ): void {
    if (branchId !== undefined) {
      const branch = this.findBranch(branchId)
      if (!branch) return
      branch.turns.push({ prompts, raw, tasks })
      return
    }
    // 新任务组：每个 task 各自成为一个分支
    tasks.forEach((task, index) => {
      const prompt = prompts[index]
      const existing = this.branches.find((branch) => branch.id === task.id)
      if (existing) {
        // 极端容错：task 编号撞已有分支，挂到该分支尾部
        existing.turns.push({
          prompts: prompt ? [prompt] : prompts,
          raw: sliceTaskRaw(raw, task.id),
          tasks: [task],
        })
        return
      }
      const branch: SrmlBranch = {
        id: task.id,
        label: `分支 ${task.id}`,
        summary: prompt ? summarize(prompt.content) : '',
        turns: [
          {
            prompts: prompt ? [prompt] : [],
            raw: sliceTaskRaw(raw, task.id),
            tasks: [task],
          },
        ],
        discarded: false,
      }
      this.branches.push(branch)
      this.onEvent({
        type: 'branch-created',
        branch: { id: branch.id, label: branch.label, summary: branch.summary, discarded: false },
      })
    })
  }

  /**
   * 提交一批 prompt。
   * - 无 branchId：新任务组，不带任何历史；每个输出 task 创建独立分支。
   * - 有 branchId：只携带该分支的历史（其他分支不进上下文），本轮追加到该分支。
   */
  async run(prompts: SrmlPromptBlock[], options?: SrmlRunOptions): Promise<void> {
    this.llmCalls = 0
    this.aborted = false
    this.abortController = new AbortController()
    const signal = this.abortController.signal
    this.turn += 1

    const branchId = options?.branchId
    if (branchId !== undefined && !this.findBranch(branchId)) {
      this.onEvent({ type: 'error', message: `目标分支 ${branchId} 不存在或已丢弃` })
      this.onEvent({ type: 'done', summary: '目标分支不可用，未发送请求', llmCalls: this.llmCalls })
      return
    }

    const requestText = serializeBlocks(prompts)
    const followUp = branchId !== undefined ? this.buildFollowUp(branchId) : []
    this.onEvent({ type: 'exchange-start', prompts, requestText, turn: this.turn, branchId })

    // 重试时在用户消息末尾追加失败反馈
    let userText = requestText

    try {
      for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
        if (this.aborted) break

        const raw = await this.agent.exchange(userText, {
          signal,
          followUp,
          onStream: (_delta, accumulated) => {
            const stream = parseSrmlStreamChunk(accumulated)
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
          this.onEvent({
            type: 'plan',
            raw,
            blocks: parsed.blocks,
            warnings: parsed.warnings.map((warning) => warning.message),
            attempt,
            branchId,
          })
          const tasks = parsed.blocks.filter((block): block is SrmlTaskBlock => block.kind === 'task')
          this.attachTurns(prompts, raw, tasks, branchId)
          const scope = branchId !== undefined ? `分支 ${branchId}` : `${tasks.length} 个新分支`
          this.onEvent({
            type: 'done',
            summary: `第 ${this.turn} 轮（${scope}）· 解析出 ${tasks.length} 个任务，共 ${parsed.blocks.length} 个块。`,
            llmCalls: this.llmCalls,
          })
          return
        } catch (error) {
          const message = error instanceof SrmlParseError ? error.message : String(error)
          this.onEvent({ type: 'retry-parse', message, attempt })
          this.onEvent({ type: 'error', message: `解析失败：${message}` })
          userText =
            `${requestText}\n\n[SRML 反馈] 你的上一次输出无法解析：${message}\n` +
            `请严格按 <|begin_of_task_N|> 块输出，每个 prompt 对应一个 task，` +
            `<begin_of_thought>/<begin_of_response> 必须成对闭合，不要输出标签以外的任何文字。`
        }
      }

      this.onEvent({
        type: 'done',
        summary: `连续 ${this.maxAttempts} 次输出均无法解析，已停止。`,
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
