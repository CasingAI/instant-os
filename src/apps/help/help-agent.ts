import type OpenAI from 'openai'
import { createAgent } from '../../ai/create-agent.ts'
import { SOURCE_INSPECTION_TOOLS } from '../../ai/source-tools.ts'
import { getLocalStorageKeyLabel } from '../../ai/storage-key-labels.ts'
import { STORAGE_INSPECTION_TOOLS } from '../../ai/storage-tools.ts'
import { HELP_TERMINAL_REQUEST_TOOLS } from './help-terminal-tools.ts'
import type {
  AgentReasoningDeltaEvent,
  AgentTextDeltaEvent,
  AgentToolCallEvent,
} from '../../ai/run-agent.ts'

const HELP_MAX_STEPS = 50

const HELP_SYSTEM_PROMPT = `你是 Instant OS 的「帮助」应用助手，面向普通用户（小白向，不是开发者、也不是终端高级用户）。

用户会问：功能在哪、怎么用、如何设置、空间够不够、某件事为什么打不开/怎么授权等。
你在后台可以用工具查阅系统内部资料（含源码快照、README 等说明文档、localStorage 键与存储用量），但回答必须站在用户视角。

查阅习惯（很重要）：
- 资料有两类，通常都要碰：README 等说明文档讲「产品能力与设计意图」；src 下应用/设置源码讲「界面文案与真实交互」。两者互补，不要只靠一边。
- 典型流程：用关键词 grep 定位相关源码与文档片段 → 读对应应用/设置实现核对菜单、按钮与步骤 → 需要产品语境或总览时再读 README 相关段落（可用 start_line/end_line，不必整份通读）。
- 禁止两种偷懒：① 只读 README 就写操作步骤；② 完全不看 README，只在源码里猜产品语义。文档与实现冲突时，操作指引以源码为准，并可用文档补「为什么/能做什么」。
- 宽泛总览（例如「系统大概能做什么」）以 README 为主，再用源码快速核对关键能力是否仍存在。

回答原则：
1. 只讲「在哪里找、点什么、按什么顺序操作、会看到什么结果」。
2. 用菜单名、窗口名、按钮文案、桌面/程序坞位置来指路，例如「打开左上角苹果菜单 → 系统设置 → 存储空间」。
3. 不要提及源码、文件路径、函数名、模块名、TypeScript、实现结构、调用链——除非用户明确说自己在开发/改代码/看实现。
4. 不确定时继续用工具核对真实能力与界面文案，不要编造不存在的菜单或按钮。
5. 用简洁中文 Markdown：短标题、有序步骤、必要时用列表；不要大段代码块。对比用列表即可，尽量少用表格（窄气泡里表格容易挤）。每个步骤必须单独成行（用真正的换行，不要把多步写在同一行，也不要输出字面量 \\n）。段落之间空一行。
6. 语气友好、清楚，像系统自带帮助，而不是技术文档。
7. 若问题其实是开发者向的（例如「这段逻辑在哪个文件」），可简短确认后仍优先给操作指引；只有用户坚持要技术细节时，再给极少路径级信息。
8. 存储相关：可用 get_storage_usage / list_local_storage_keys / read_local_storage_key 查看占用与本地数据含义；系统空间与数据空间是两套容量，回答时要分开说。
   - 日常腾空间（清浏览器缓存、微应用数据、事件日志等）：指路「系统设置 → 存储空间」，让用户自己在设置里操作。
   - 你自己不能清理、删除、卸载或修改任何数据。
9. 账户与 API Key 内容不可读；不要尝试套取密钥，也不要在回答里复述任何疑似密钥。
10. 需要「动手改系统」的敏感操作时：
   - 挂载 / 卸载本机文件夹：优先引导用户打开「文件」应用，在侧栏点「挂载」或挂载卷旁的卸载；也可调用 request_terminal_action 打开「终端」让用户确认。
   - 删除文件/文件夹、删除非账户类 localStorage 键：调用 request_terminal_action 打开「终端」让用户确认；调用后如实告诉用户已打开终端，请在弹出的确认对话框里决定是否继续。
   - 账户与 API Key（含清空全部账户）：引导用户打开「钥匙串」自行操作；不可经终端读写、删除或清空。
   不要假装任何改动已经完成。`

const MODULE_LABELS: Record<string, string> = {
  apps: '应用',
  appstore: '应用集市',
  browser: '网页浏览器',
  mail: '邮件',
  news: '新闻',
  books: '书架',
  weather: '天气',
  calendar: '月历',
  stocks: '股票',
  translate: '翻译',
  catgpt: 'CatGPT',
  produde: 'ProDude',
  gomoku: '五子棋',
  speech: '语音实验室',
  icode: 'iCode',
  settings: '系统设置',
  help: '帮助',
  terminal: '终端',
  /** @deprecated 模拟终端已弃用，此标签保留仅为过渡，后续移除 */
  'simulated-terminal': '模拟终端',
  'virtual-machine': 'Virtual Machine',
  files: '文件',
  'system-info': '系统信息',
  'task-manager': '性能监视器',
  services: '服务',
  'event-log': '事件日志',
  keychain: '钥匙串',
  'scene3d-lab': '3D 实验室',
  'midi-demo': 'MIDI 演示',
  'model-vision': '模型识图',
  generated: '微应用',
  bridge: '外部应用连接',
  ai: 'AI 服务',
  desktop: '桌面',
  dock: '程序坞和桌面',
  window: '窗口',
  os: '系统界面',
  ui: '界面控件',
  icons: '图标',
  fonts: '字体',
  assets: '资源',
  boot: '启动',
}

function friendlyModuleLabel(pathOrPrefix: string | undefined): string | undefined {
  if (!pathOrPrefix) {
    return undefined
  }
  const parts = pathOrPrefix
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i]
    if (part && MODULE_LABELS[part]) {
      return MODULE_LABELS[part]
    }
  }
  if (parts[0] && MODULE_LABELS[parts[0]]) {
    return MODULE_LABELS[parts[0]]
  }
  return undefined
}

function describeToolCall(event: AgentToolCallEvent): { label: string; detail?: string } {
  const args = event.arguments
  if (event.toolName === 'grep_source') {
    const pattern = typeof args.pattern === 'string' ? args.pattern.trim() : ''
    const module = friendlyModuleLabel(
      typeof args.path_prefix === 'string' ? args.path_prefix : undefined,
    )
    return {
      label: module ? `正在查找「${module}」相关说明` : '正在查找相关说明',
      detail: pattern ? `关键词：${pattern.slice(0, 48)}` : undefined,
    }
  }
  if (event.toolName === 'read_source_file') {
    const path = typeof args.path === 'string' ? args.path : ''
    const isReadme =
      path === 'README.md' || path.endsWith('/README.md') || path.toLowerCase().endsWith('readme.md')
    const module = friendlyModuleLabel(path)
    const startLine = typeof args.start_line === 'number' ? Math.floor(args.start_line) : undefined
    const endLine = typeof args.end_line === 'number' ? Math.floor(args.end_line) : undefined
    const rangeDetail =
      startLine !== undefined || endLine !== undefined
        ? `第 ${startLine ?? 1}${endLine !== undefined ? `–${endLine}` : '+'} 行`
        : undefined
    return {
      label: isReadme
        ? '正在查阅产品说明'
        : module
          ? `正在查阅「${module}」说明`
          : '正在查阅操作说明',
      detail: rangeDetail,
    }
  }
  if (event.toolName === 'list_source_tree') {
    const prefix = typeof args.prefix === 'string' ? args.prefix : undefined
    const module = friendlyModuleLabel(prefix)
    return {
      label: module ? `正在浏览「${module}」相关内容` : '正在浏览系统资料目录',
    }
  }
  if (event.toolName === 'get_storage_usage') {
    return { label: '正在查看存储占用情况' }
  }
  if (event.toolName === 'list_local_storage_keys') {
    const prefix = typeof args.prefix === 'string' ? args.prefix.trim() : ''
    return {
      label: '正在浏览本机保存的数据项',
      detail: prefix ? `范围：${prefix.slice(0, 48)}` : undefined,
    }
  }
  if (event.toolName === 'read_local_storage_key') {
    const key = typeof args.key === 'string' ? args.key.trim() : ''
    return {
      label: key ? `正在查看「${getLocalStorageKeyLabel(key)}」` : '正在查看本机数据内容',
    }
  }
  if (event.toolName === 'request_terminal_action') {
    const kind = typeof args.kind === 'string' ? args.kind : ''
    const summary = typeof args.summary === 'string' ? args.summary.trim() : ''
    const kindLabel =
      kind === 'mount'
        ? '挂载文件夹'
        : kind === 'unmount'
          ? '卸载文件夹'
          : kind === 'storage.removeKey'
            ? '删除存储键'
            : kind === 'fs.remove'
              ? '删除文件'
              : '特权操作'
    return {
      label: `正在通过终端请求「${kindLabel}」`,
      detail: summary ? summary.slice(0, 64) : undefined,
    }
  }
  return { label: '正在查阅系统资料' }
}

export type HelpAgentActivity = {
  id: string
  label: string
  detail?: string
  done?: boolean
}

export type HelpTimelineItem =
  | {
      kind: 'activity'
      id: string
      label: string
      detail?: string
      done: boolean
    }
  | {
      kind: 'reasoning'
      id: string
      content: string
      done: boolean
      startedAt: number
      durationMs?: number
    }
  | {
      kind: 'text'
      id: string
      content: string
      done: boolean
    }

export type HelpAgentProgress = {
  activities: HelpAgentActivity[]
  timeline: HelpTimelineItem[]
  answerText: string
  reasoningText: string
  reasoningDurationMs?: number
  currentLabel: string
  toolCallCount: number
}

export type HelpInvestigationStep =
  | Extract<HelpTimelineItem, { kind: 'activity' }>
  | Extract<HelpTimelineItem, { kind: 'reasoning' }>

export type HelpInvestigation = {
  activities: HelpAgentActivity[]
  /** 与输出过程一致的步骤顺序（工具 / 思考穿插，不含正文） */
  timeline: HelpInvestigationStep[]
  reasoningText?: string
  reasoningDurationMs?: number
  toolCallCount: number
  durationMs: number
}

export type HelpAgentContinuation = {
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
}

export type HelpAgentResult = {
  text: string
  investigation: HelpInvestigation
  incomplete?: boolean
  continuation?: HelpAgentContinuation
}

function markOpenItemsDone(timeline: HelpTimelineItem[]): HelpTimelineItem[] {
  const now = Date.now()
  return timeline.map((item) => {
    if (item.done) {
      return item
    }
    if (item.kind === 'reasoning') {
      return {
        ...item,
        done: true,
        durationMs: Math.max(0, now - item.startedAt),
      }
    }
    return { ...item, done: true }
  })
}

function pushActivity(
  timeline: HelpTimelineItem[],
  label: string,
  detail?: string,
): HelpTimelineItem[] {
  const last = timeline[timeline.length - 1]
  if (
    last?.kind === 'activity' &&
    !last.done &&
    last.label === label &&
    last.detail === detail
  ) {
    return timeline
  }

  const next = markOpenItemsDone(timeline)
  next.push({
    kind: 'activity',
    id: `help-act-${timeline.length + 1}-${Date.now()}`,
    label,
    detail,
    done: false,
  })
  return next
}

function appendTextDelta(timeline: HelpTimelineItem[], delta: string): HelpTimelineItem[] {
  if (!delta) {
    return timeline
  }

  const last = timeline[timeline.length - 1]
  if (last?.kind === 'text' && !last.done) {
    return [
      ...timeline.slice(0, -1),
      {
        ...last,
        content: last.content + delta,
      },
    ]
  }

  const next = markOpenItemsDone(timeline)
  next.push({
    kind: 'text',
    id: `help-text-${timeline.length + 1}-${Date.now()}`,
    content: delta,
    done: false,
  })
  return next
}

function appendReasoningDelta(timeline: HelpTimelineItem[], delta: string): HelpTimelineItem[] {
  if (!delta) {
    return timeline
  }

  const last = timeline[timeline.length - 1]
  if (last?.kind === 'reasoning' && !last.done) {
    return [
      ...timeline.slice(0, -1),
      {
        ...last,
        content: last.content + delta,
      },
    ]
  }

  const next = markOpenItemsDone(timeline)
  next.push({
    kind: 'reasoning',
    id: `help-reason-${timeline.length + 1}-${Date.now()}`,
    content: delta,
    done: false,
    startedAt: Date.now(),
  })
  return next
}

function activitiesFromTimeline(timeline: HelpTimelineItem[]): HelpAgentActivity[] {
  return timeline
    .filter((item): item is Extract<HelpTimelineItem, { kind: 'activity' }> => item.kind === 'activity')
    .map((item) => ({
      id: item.id,
      label: item.label,
      detail: item.detail,
      done: item.done,
    }))
}

function latestAnswerText(timeline: HelpTimelineItem[]): string {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index]
    if (item?.kind === 'text') {
      return item.content
    }
  }
  return ''
}

function combinedReasoningText(timeline: HelpTimelineItem[]): string {
  return timeline
    .filter((item): item is Extract<HelpTimelineItem, { kind: 'reasoning' }> => item.kind === 'reasoning')
    .map((item) => item.content)
    .join('\n\n')
    .trim()
}

function totalReasoningDurationMs(timeline: HelpTimelineItem[]): number | undefined {
  let total = 0
  let hasReasoning = false
  for (const item of timeline) {
    if (item.kind !== 'reasoning') {
      continue
    }
    hasReasoning = true
    if (item.durationMs !== undefined) {
      total += item.durationMs
    } else if (!item.done) {
      total += Math.max(0, Date.now() - item.startedAt)
    }
  }
  return hasReasoning ? total : undefined
}

function investigationStepsFromTimeline(timeline: HelpTimelineItem[]): HelpInvestigationStep[] {
  return timeline
    .filter(
      (item): item is HelpInvestigationStep =>
        item.kind === 'activity' || item.kind === 'reasoning',
    )
    .map((item) => {
      if (item.kind === 'reasoning') {
        return {
          ...item,
          done: true,
          durationMs: item.durationMs ?? Math.max(0, Date.now() - item.startedAt),
        }
      }
      return { ...item, done: true }
    })
}

function messagesWithoutLeadingSystem(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  if (messages[0]?.role === 'system') {
    return messages.slice(1)
  }
  return messages
}

export type AskHelpAgentOptions = {
  thinkingEnabled?: boolean
  signal?: AbortSignal
  /** 续跑时传入上次 incomplete 的 messages（可含 system，会自动剥掉） */
  resumeMessages?: OpenAI.Chat.ChatCompletionMessageParam[]
  onProgress?: (progress: HelpAgentProgress) => void
}

export async function askHelpAgent(
  question: string | undefined,
  options?: AskHelpAgentOptions,
): Promise<HelpAgentResult> {
  const resumeMessages = options?.resumeMessages
  const isResume = Boolean(resumeMessages?.length)
  if (!isResume && !question?.trim()) {
    throw new Error('请输入问题')
  }

  let timeline: HelpTimelineItem[] = []
  let toolCallCount = 0
  const startedAt = Date.now()
  const onProgress = options?.onProgress
  const thinkingEnabled = options?.thinkingEnabled ?? true

  const emitProgress = (currentLabel: string) => {
    onProgress?.({
      activities: activitiesFromTimeline(timeline),
      timeline: timeline.map((item) => ({ ...item })),
      answerText: latestAnswerText(timeline),
      reasoningText: combinedReasoningText(timeline),
      reasoningDurationMs: totalReasoningDurationMs(timeline),
      currentLabel,
      toolCallCount,
    })
  }

  const emitActivity = (label: string, detail?: string) => {
    timeline = pushActivity(timeline, label, detail)
    emitProgress(label)
  }

  emitActivity(isResume ? '正在继续查找…' : '正在准备帮助资料…')

  const agent = createAgent({
    prompt: HELP_SYSTEM_PROMPT,
    tools: [...SOURCE_INSPECTION_TOOLS, ...STORAGE_INSPECTION_TOOLS, ...HELP_TERMINAL_REQUEST_TOOLS],
    maxSteps: HELP_MAX_STEPS,
    config: { thinkingEnabled },
    signal: options?.signal,
    usageContext: {
      actor: 'help',
      behavior: isResume ? 'continue' : 'ask',
      behaviorLabel: isResume ? '帮助续答' : '帮助问答',
    },
    onToolCall: (event: AgentToolCallEvent) => {
      toolCallCount += 1
      const described = describeToolCall(event)
      emitActivity(described.label, described.detail)
    },
    onReasoningDelta: (event: AgentReasoningDeltaEvent) => {
      timeline = appendReasoningDelta(timeline, event.delta)
      emitProgress('正在深度思考…')
    },
    onTextDelta: (event: AgentTextDeltaEvent) => {
      timeline = appendTextDelta(timeline, event.delta)
      emitProgress('正在整理回答…')
    },
  })

  const result = isResume
    ? await agent.run({
        messages: messagesWithoutLeadingSystem(resumeMessages!),
      })
    : await agent.ask(question!.trim())

  timeline = markOpenItemsDone(timeline)
  const finalized = activitiesFromTimeline(timeline).map((item) => ({
    ...item,
    done: true,
  }))
  const reasoningText = combinedReasoningText(timeline)
  const investigation: HelpInvestigation = {
    activities: finalized,
    timeline: investigationStepsFromTimeline(timeline),
    reasoningText: reasoningText || undefined,
    reasoningDurationMs: totalReasoningDurationMs(timeline),
    toolCallCount,
    durationMs: Math.max(0, Date.now() - startedAt),
  }

  if (result.incomplete) {
    const text =
      result.text.trim() ||
      '还在查找中，这一轮步数用完了。点「继续」可以接着查。'
    return {
      text,
      investigation,
      incomplete: true,
      continuation: { messages: result.messages },
    }
  }

  const text = result.text.trim()
  if (!text) {
    throw new Error('帮助助手未返回任何内容')
  }

  return {
    text,
    investigation,
  }
}
