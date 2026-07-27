import { createAgent } from '../../ai/create-agent.ts'
import { defineTool } from '../../ai/agent-tool.ts'
import type { AgentTextDeltaEvent, AgentToolCallEvent } from '../../ai/run-agent.ts'
import { buildSnapshotContext, type ChromoPageSnapshot } from './chromo-page-snapshot.ts'
import { formatChromoEvalValue } from './chromo-eval-format.ts'

const CHROMO_AGENT_MAX_STEPS = 12

const CHROMO_AGENT_SYSTEM_PROMPT = `你是 Chromo 浏览器里的 AI 助手，帮助用户理解和操作当前打开的网页。

每次对话都会附带【当前页面】快照（标题、正文摘录），那是从真实页面读取的，请直接基于它回答。

规则：
1. 禁止说「页面还没加载」「没有打开 Wikipedia」等——快照存在即表示页面已加载
2. 需要更多信息时，必须调用 run_javascript 工具，不要猜测
3. run_javascript 在页面 global 作用域执行，例如 document.title、document.body.innerText
4. 总结网页时，优先用快照正文；不够再执行 JS 读取

回答：简洁中文 Markdown。`

export type ChromoPageContext = {
  url: string
  title: string
}

export type ChromoAgentProgress = {
  answerText: string
  lastToolLabel?: string
}

export type AskChromoAgentOptions = {
  page: ChromoPageContext
  pageSnapshot: ChromoPageSnapshot
  evalInPage: (code: string) => Promise<unknown>
  signal?: AbortSignal
  onProgress?: (progress: ChromoAgentProgress) => void
}

function describeToolCall(event: AgentToolCallEvent): string {
  if (event.toolName === 'run_javascript') {
    const code = typeof event.arguments.code === 'string' ? event.arguments.code.trim() : ''
    const preview = code.length > 60 ? `${code.slice(0, 60)}…` : code
    return preview ? `执行 JS：${preview}` : '执行 JavaScript'
  }
  return event.toolName
}

function buildChromoTools(evalInPage: (code: string) => Promise<unknown>) {
  return [
    defineTool({
      name: 'run_javascript',
      description:
        '在当前已加载网页的全局作用域执行 JavaScript 代码，并返回可序列化的结果。用于读取 DOM、页面状态或触发简单操作。',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: '要执行的 JavaScript 代码（表达式或语句，有返回值更佳）',
          },
        },
        required: ['code'],
      },
      execute: async ({ code }) => {
        const trimmed = code.trim()
        if (!trimmed) {
          throw new Error('code 不能为空')
        }
        const value = await evalInPage(trimmed)
        return formatChromoEvalValue(value)
      },
    }),
  ]
}

export async function askChromoAgent(
  question: string,
  options: AskChromoAgentOptions,
): Promise<string> {
  const trimmed = question.trim()
  if (!trimmed) {
    throw new Error('请输入问题')
  }

  let answerText = ''
  let lastToolLabel: string | undefined

  const agent = createAgent({
    prompt: CHROMO_AGENT_SYSTEM_PROMPT,
    tools: buildChromoTools(options.evalInPage),
    maxSteps: CHROMO_AGENT_MAX_STEPS,
    usageContext: { actor: 'chromo', behavior: 'agent', behaviorLabel: '网页助手' },
    signal: options.signal,
    onToolCall: (event: AgentToolCallEvent) => {
      lastToolLabel = describeToolCall(event)
      options.onProgress?.({ answerText, lastToolLabel })
    },
    onTextDelta: (event: AgentTextDeltaEvent) => {
      answerText = event.accumulated
      options.onProgress?.({ answerText, lastToolLabel })
    },
  })

  const pageContext = buildSnapshotContext(options.pageSnapshot, options.page)

  const result = await agent.ask(`${trimmed}\n\n${pageContext}`)
  const text = result.text.trim()
  if (!text) {
    throw new Error('AI 未返回任何内容')
  }
  return text
}
