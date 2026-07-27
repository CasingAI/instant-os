import type OpenAI from 'openai'
import { createAgent } from '../../ai/create-agent.ts'
import { defineTool, type AgentToolStructuredResult } from '../../ai/agent-tool.ts'
import type { AgentTextDeltaEvent, AgentToolCallEvent } from '../../ai/run-agent.ts'
import { listEnabledModels, listEnabledModelsForCapability } from '../../ai/ai-providers.ts'
import { mergeOpenAiConfig, readDefaultModelFriendlyName } from '../../ai/openai-config.ts'
import { loadAccountSettings } from '../../os/account-settings-storage.ts'
import { buildSnapshotContext, type ChromoPageSnapshot } from './chromo-page-snapshot.ts'
import { formatChromoEvalValue } from './chromo-eval-format.ts'
import type { ChromoScreenshotOptions, ChromoScreenshotResult } from './chromo-bridge.ts'

const CHROMO_AGENT_MAX_STEPS = 12

const CHROMO_AGENT_SYSTEM_PROMPT = `你是 Chromo 浏览器里的 AI 助手，帮助用户理解和操作当前打开的网页。

每次对话都会附带【当前页面】快照（标题、正文摘录），那是从真实页面读取的，请直接基于它回答。

规则：
1. 禁止说「页面还没加载」「没有打开 Wikipedia」等——快照存在即表示页面已加载
2. 需要更多信息时，调用 run_javascript 读取 DOM / 文本；需要看布局、图片、验证码、canvas 内容时，调用 take_screenshot
3. run_javascript 在页面 global 作用域执行，例如 document.title、document.body.innerText
4. take_screenshot 会截取当前网页可视区域；用户明确要求「截图/截屏」时必须先调用此工具
5. 总结网页时，优先用快照正文；不够再执行 JS 或截图
6. 截图始终可用并会在用户侧栏展示。若当前模型不支持视觉能力、你看不到截图像素，必须明确告知用户是**当前模型**不具备图像识别能力（禁止说「环境未启用」「系统不支持」「当前环境没有图像识别」）；可结合正文摘录补充说明

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
  screenshotInPage: (options?: ChromoScreenshotOptions) => Promise<ChromoScreenshotResult>
  /** 侧栏已预截的图（用户明确要求截图时），直接注入 vision 上下文 */
  initialScreenshot?: ChromoScreenshotResult
  signal?: AbortSignal
  onProgress?: (progress: ChromoAgentProgress) => void
  /** 每次 take_screenshot 成功后回调，供 UI 展示缩略图 */
  onScreenshot?: (shot: ChromoScreenshotResult) => void
}

function chromoAgentHasVisionModel(): boolean {
  const settings = loadAccountSettings()
  if (!settings) {
    return false
  }
  if (listEnabledModelsForCapability(settings.providers, 'vision').length > 0) {
    return true
  }
  // 文本首选模型也可能带 vision（未单独配置「图像识别」槽位）
  return listEnabledModels(settings.providers).some((item) =>
    item.capabilities.includes('vision'),
  )
}

/** 当前 AI 助手所用模型是否具备视觉（图像识别）能力 */
export function chromoAgentSupportsVision(): boolean {
  return chromoAgentHasVisionModel()
}

/** 当前 AI 助手所用模型不支持视觉时的用户可见报错（归因于模型能力，非环境） */
export function formatChromoModelNoVisionMessage(): string {
  const modelName = readDefaultModelFriendlyName('text')
  return `当前模型「${modelName}」不支持视觉（图像识别）能力，无法根据截图分析页面内容。请在钥匙串中换用支持图像识别的模型。`
}

function resolveChromoAgentConfig() {
  return mergeOpenAiConfig(undefined, chromoAgentHasVisionModel() ? 'vision' : 'text')
}

function describeToolCall(event: AgentToolCallEvent): string {
  if (event.toolName === 'run_javascript') {
    const code = typeof event.arguments.code === 'string' ? event.arguments.code.trim() : ''
    const preview = code.length > 60 ? `${code.slice(0, 60)}…` : code
    return preview ? `执行 JS：${preview}` : '执行 JavaScript'
  }
  if (event.toolName === 'take_screenshot') {
    return '截取页面截图…'
  }
  return event.toolName
}

function buildScreenshotFollowUp(shot: ChromoScreenshotResult): OpenAI.Chat.ChatCompletionMessageParam {
  return {
    role: 'user',
    content: [
      {
        type: 'text',
        text: `以下是当前网页可视区域截图（${shot.mime}，${shot.width}×${shot.height}）。请结合截图回答用户问题。`,
      },
      {
        type: 'image_url',
        image_url: { url: shot.dataUrl },
      },
    ],
  }
}

function buildChromoTools(
  evalInPage: (code: string) => Promise<unknown>,
  screenshotInPage: (options?: ChromoScreenshotOptions) => Promise<ChromoScreenshotResult>,
  onScreenshot?: (shot: ChromoScreenshotResult) => void,
) {
  const visionReady = chromoAgentHasVisionModel()

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
    defineTool({
      name: 'take_screenshot',
      description:
        '截取当前网页可视区域（viewport）为 JPEG 图片并供你视觉分析。用于验证码、图片选择题、布局、图表、canvas 内容等 innerText 无法表达的信息。',
      parameters: {
        type: 'object',
        properties: {
          fullPage: {
            type: 'boolean',
            description: 'true 时截取整页滚动高度，默认 false（仅可视区域）',
          },
          quality: {
            type: 'number',
            description: 'JPEG 质量 0–1，默认 0.72',
          },
        },
      },
      execute: async ({ fullPage, quality }) => {
        const options: ChromoScreenshotOptions = {
          format: 'jpeg',
          quality: typeof quality === 'number' ? quality : 0.72,
        }
        if (fullPage !== undefined) {
          options.fullPage = Boolean(fullPage)
        }

        const shot = await screenshotInPage(options)
        onScreenshot?.(shot)

        const meta = {
          ok: true,
          mime: shot.mime,
          width: shot.width,
          height: shot.height,
          encoding: shot.encoding,
        }

        if (!visionReady) {
          const message = formatChromoModelNoVisionMessage()
          return {
            content: JSON.stringify({
              ...meta,
              error: 'MODEL_NO_VISION',
              message,
              screenshotShownToUser: true,
              note: `截图已在用户侧栏展示。你必须把 message 字段原文转告用户：这是当前模型的能力限制，禁止说是环境或系统未启用图像识别。`,
            }),
          }
        }

        const summary: AgentToolStructuredResult = {
          content: JSON.stringify({
            ...meta,
            visionForModel: true,
            note: '截图已作为紧随其后的用户消息附带给模型，请直接分析图像内容。',
          }),
          appendMessages: [buildScreenshotFollowUp(shot)],
        }
        return summary
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
    tools: buildChromoTools(options.evalInPage, options.screenshotInPage, options.onScreenshot),
    maxSteps: CHROMO_AGENT_MAX_STEPS,
    config: resolveChromoAgentConfig(),
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
  const userContent = `${trimmed}\n\n${pageContext}`

  const result =
    options.initialScreenshot && chromoAgentHasVisionModel()
      ? await agent.run({
          messages: [
            { role: 'user', content: userContent },
            buildScreenshotFollowUp(options.initialScreenshot),
          ],
        })
      : await agent.ask(userContent)
  const text = result.text.trim()
  if (!text) {
    throw new Error('AI 未返回任何内容')
  }
  return text
}
