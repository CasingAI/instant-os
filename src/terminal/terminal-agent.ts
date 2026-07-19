import { createAgent } from '../ai/create-agent.ts'
import type {
  AgentTextDeltaEvent,
  AgentToolCallEvent,
} from '../ai/run-agent.ts'
import { createTerminalFsTools } from './terminal-fs-tools.ts'
import { createTerminalLiveOutputTools } from './terminal-live-tools.ts'
import {
  buildTerminalScreenHistoryMessage,
  formatTerminalScreenHistory,
  type TerminalScreenHistoryLine,
} from './terminal-screen-history.ts'
import type { TerminalUpsertBlockOptions } from './terminal-types.ts'

const TERMINAL_MAX_STEPS = 20

function buildSystemPrompt(cwd: string): string {
  return `你是 Instant OS 的虚拟文件系统终端助手。

用户会输入类 Unix 指令或自然语言。你必须用工具完成操作，再汇报结果。简洁、可扫读，不要聊天腔。

当前工作目录（cwd）：${cwd}
相对路径一律相对此 cwd 解析。工具参数里的 path 也可直接传相对路径。

若消息中带有「终端屏幕历史」，那是窗口里已显示的内容，可用来理解指代与延续操作；不要复述整段历史，以当前命令为准。

能力边界：
- 可操作虚拟文件系统。「/」是命名空间根（虚拟）：下列出 /user、/system、/models、/mount/…；不可在 / 下直接创建文件
- 可操作各卷内路径（/user、/system、/models、/mount/…）
- localStorage：可 list / get；set 与 remove 会弹确认。账户与 API Key 键禁止读写删除；不要尝试清空账户。挂载/卸载本机文件夹请用户用本地命令 mount / umount，你不要试图代劳
- 删除文件/文件夹：调用 remove，会弹确认；用户取消时如实汇报「用户取消」
- 清屏：调用 clear_screen。用户输入 cls、clear、清屏，或其它明显等价说法时，直接调用工具执行，不要只口头建议「请用 clear」
- 原则：本地命令表是有限快路径；认不出的指令或变体（如 Windows 的 cls）一律靠工具完成意图，不要假设存在别名
- 没有真实进程、管道、重定向、chmod、环境变量、网络下载
- /system 与 /models 只读；写操作失败时如实说明
- 不要编造未执行的结果；不确定先用 list_dir / stat_path 核对
- 用户取消确认时如实汇报「用户取消」
- 你无法真正切换 cwd；若用户要 cd，请说明请用本地 cd 命令（如 cd /user），并可用 list_dir 预览目标

输出格式（优先 Markdown）：
- 目录列表、卷列表、多列对比：用 GFM 表格（| 列 |），经 upsert_output_block 写出（key 如 listing / volumes）
- 进度条、分步状态：用 upsert_output_block 原地刷新（固定 key 如 progress）；任务一结束立刻 remove_output_block 去掉该进度块，再输出最终结果表/摘要，不要把 100% 进度条留在屏幕上
- 单行成功/失败：纯文本即可（如「已创建 /user/a」）
- 需要强调的短说明可用 **粗体**；避免大段标题气泡
- 清屏成功后不要再输出说明文字
- 不要解释你调用了哪些工具，除非用户追问`
}

const TOOL_LABELS: Record<string, string> = {
  list_volumes: '列出卷',
  list_dir: '列出目录',
  stat_path: '查看路径',
  read_text: '读取文件',
  write_text: '写入文件',
  create_text: '新建文件',
  mkdir: '创建目录',
  rename: '重命名',
  remove: '删除',
  copy: '复制',
  move: '移动',
  storage_list_keys: '列出存储键',
  storage_get_key: '读取存储键',
  storage_set_key: '写入存储键',
  storage_remove_key: '删除存储键',
  clear_screen: '清屏',
  upsert_output_block: '更新输出',
  remove_output_block: '移除输出',
}

export type TerminalAgentProgress = {
  statusLabel?: string
  text: string
  toolCallCount: number
}

export type AskTerminalAgentOptions = {
  cwd: string
  usageActor: string
  thinkingEnabled?: boolean
  /** 调用前屏幕上已显示的行（含刚写入的当前输入） */
  screenLines?: readonly TerminalScreenHistoryLine[]
  signal?: AbortSignal
  upsertBlock?: (options: TerminalUpsertBlockOptions) => void
  removeBlock?: (key: string) => void
  clearScreen?: () => void
  onProgress?: (progress: TerminalAgentProgress) => void
}

export type TerminalAgentResult = {
  text: string
  toolCallCount: number
  /** 本轮已执行清屏：会话侧勿再贴最终汇报，以免弄脏刚清空的屏幕 */
  clearedScreen?: boolean
}

export async function askTerminalAgent(
  input: string,
  options: AskTerminalAgentOptions,
): Promise<TerminalAgentResult> {
  const question = input.trim()
  if (!question) {
    throw new Error('空命令')
  }

  let text = ''
  let toolCallCount = 0
  let cwdSnapshot = options.cwd
  let usedLiveBlocks = false
  let clearedScreen = false

  const emit = (statusLabel?: string) => {
    options.onProgress?.({
      statusLabel,
      text,
      toolCallCount,
    })
  }

  const upsertBlock = (block: TerminalUpsertBlockOptions) => {
    usedLiveBlocks = true
    options.upsertBlock?.(block)
  }

  const clearScreen = () => {
    clearedScreen = true
    options.clearScreen?.()
  }

  const removeBlock = (key: string) => {
    options.removeBlock?.(key)
  }

  const tools = [
    ...createTerminalFsTools(() => cwdSnapshot),
    ...createTerminalLiveOutputTools({ upsertBlock, removeBlock, clearScreen }),
  ]

  const agent = createAgent({
    prompt: buildSystemPrompt(cwdSnapshot),
    tools,
    maxSteps: TERMINAL_MAX_STEPS,
    config: { thinkingEnabled: options.thinkingEnabled ?? false },
    signal: options.signal,
    usageContext: {
      actor: options.usageActor,
      behavior: 'command',
      behaviorLabel: '终端命令',
    },
    onToolCall: (event: AgentToolCallEvent) => {
      toolCallCount += 1
      const label = TOOL_LABELS[event.toolName] ?? event.toolName
      emit(label)
    },
    onTextDelta: (event: AgentTextDeltaEvent) => {
      text += event.delta
      emit('输出中…')
    },
  })

  const historySource = [...(options.screenLines ?? [])]
  const lastHistory = historySource[historySource.length - 1]
  if (lastHistory?.kind === 'input' && lastHistory.text.trim() === question) {
    historySource.pop()
  }

  const historyText = formatTerminalScreenHistory(historySource)
  const historyMessages = historyText
    ? [
        {
          role: 'user' as const,
          content: buildTerminalScreenHistoryMessage(historyText),
        },
        {
          role: 'assistant' as const,
          content: '已阅读屏幕历史，请给出当前命令。',
        },
      ]
    : undefined

  const result = await agent.ask(question, { messages: historyMessages })
  const finalText = (result.text.trim() || text).trim()
  if (!finalText && toolCallCount === 0) {
    throw new Error('终端未返回任何内容')
  }

  if (clearedScreen) {
    return {
      text: '',
      toolCallCount,
      clearedScreen: true,
    }
  }

  // 已用 live block 展示主要内容时，允许最终汇报为空
  if (!finalText && usedLiveBlocks) {
    return {
      text: '',
      toolCallCount,
    }
  }

  return {
    text: finalText || '(完成，无输出)',
    toolCallCount,
  }
}
