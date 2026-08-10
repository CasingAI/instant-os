import type OpenAI from 'openai'
import { defineTool } from '../../ai/agent-tool.ts'
import type { TerminalChangeSet } from '../../terminal/terminal-changeset.ts'
import { filesReadText } from '../files/files-api.ts'
import { joinFilesAbsolutePath } from '../files/files-path.ts'
import {
  askVscodeAiAgent,
  type VscodeAiAgentProgress,
  type VscodeAiAgentResult,
} from '../vscode/vscode-ai-agent.ts'
import type { VscodeAiContextInput } from '../vscode/vscode-ai-context.ts'
import { resolveVscodeAiModelKey } from '../vscode/vscode-ai-models.ts'
import { maybeSpillToolOutput } from '../vscode/vscode-ai-output-spill.ts'
import {
  runVscodeAiTerminalLine,
  type VscodeAiLastChangeSource,
  type VscodeAiRunCommandHost,
} from '../vscode/vscode-ai-run-command.ts'
import { VSCODE_AI_SYSTEM_REMINDER_PREAMBLE } from '../vscode/vscode-ai-system-reminder.ts'
import type { VscodeAiToolsHost } from '../vscode/vscode-ai-tools.ts'
import { PHONEME_ALIGN_LRC_FILE } from './phoneme-align-workspace.ts'
import type { PhonemeTerminalHostApi } from './phoneme-terminal-host.tsx'
import type { AlignedPhone } from './phoneme-types.ts'

/**
 * 歌词对齐 Agent（终端工作流 + 多轮对话）：
 * App 把「歌词 + 音素」两个素材预先写进终端会话 tmpdir 下的工作区，
 * Agent 通过 run_in_terminal（持久 InstantREPL）读素材、按行追加写 aligned.lrc、
 * 并随时读回自己已写的内容自查——回到模型熟悉的「终端 + 文件」操作模式。
 * 同一对话跨轮复用同一终端会话（globalThis / tmpdir / 工作区文件保留），
 * 对齐是一轮「任务」，之后可继续自由对话并让 Agent 直接改 aligned.lrc。
 */

// ---------------------------------------------------------------------------
// 系统提示词
// ---------------------------------------------------------------------------

/** 对齐轮系统提示词：工作区文件、REPL 环境语义、逐段流程、对齐规则 */
export function buildPhonemeAlignSystemPrompt(input: {
  workspaceDir: string
  lineCount: number
}): string {
  const { workspaceDir, lineCount } = input
  return `你是歌词时间戳对齐引擎。本次对齐的工作区（终端会话的 os.tmpdir() 下）已就绪：${workspaceDir}

工作区文件：
- lyrics.txt：歌词原文，每行一句，共 ${lineCount} 行。可能有错别字/缺行/重复行，无时间戳；保持逐字原样，绝不改写。
- phones.tsv：音素识别结果，每行一个音素，制表符分隔 4 列：开始秒\t结束秒\t拼音\t原始IPA（按时间升序）。拼音是主要参考；原始IPA仅供参考。
- aligned.lrc：输出文件，已存在且为空。你必须把增强 LRC 逐行追加写入它。

环境说明（重要）：
- 终端是持久 JavaScript REPL（InstantREPL/QuickJS），不是真实 shell：没有管道/重定向/heredoc；读写文件用 fs API（fs.readFileSync / fs.appendFileSync / fs.writeFileSync / fs.statSync 等）
- 每次工具调用都是独立作用域，顶层 const/let 不会保留；跨调用共享的数据必须挂到 globalThis（第一步解析的音素数组挂 globalThis.PHONES）
- 路径一律用绝对路径；工作区就是 os.tmpdir()/phoneme-align，大文本可写 tmp
- 不要 console.log 大段内容，只打印行数/音素数等摘要；工具结果超过约 16000 字符会自动 spill 到文件

流程（一次只处理一小段，绝不一次性对齐整首歌）：
1. 第一步：读 lyrics.txt 与 phones.tsv，解析音素数组并挂到 globalThis.PHONES（每条 {s, e, py, ipa}），打印「歌词 N 行 · 音素 M 个」摘要
2. 按歌词行把音素切成若干段：每段 4-6 行歌词，音素按行数占比切区间（段界可前后多取 ±2 个音素作上下文）
3. 逐段处理（一次只做一段）：从 globalThis.PHONES 取该段音素 → 为段内每行歌词生成增强 LRC 行 → 用 fs.appendFileSync(aligned.lrc 绝对路径, 这些行) 只追加这一小段
4. 全部段写完：fs.readFileSync 读回 aligned.lrc 通读自查（行数、时间戳格式、歌词逐字一致），发现问题就地修复
5. 完成：只输出一句简短总结（如「全部 N 行已写入 aligned.lrc」），不要重贴任何 LRC

对齐规则（拼音序列可能不完整/有重复/有缺失——wav2vec2 识别有噪声，不是精确的音节序列）：
- 利用歌词作为"参考答案"：已知目标字符序列，从拼音碎片中找到对应的时间段
- 一句话的行级开始时间 ≈ 该句第一个字对应音素段的 s 属性；行级结束时间 ≈ 该句最后一个字对应音素段的 e 属性
- 每个字的逐字时间戳 ≈ 该字对应拼音音素段的 s 属性（秒转 mm:ss.xx 格式）
- 标点符号（逗号、句号等）附在前一个字的后面，不单独给时间戳
- 歌词文字保持原文逐字不变，绝不改写、不纠错、不增删
- 句与句之间通常有空隙（换气/伴奏），行级起点落在句首音素上即可
- 歌词与拼音序列对不上的地方（缺行/错字/重复）：按音素序列的实际进度就近对齐，不得虚构时间
- 识别不到的句子按前后句节奏匀一个连续的时间

输出格式（写入 aligned.lrc 的每一行）：
- 增强 LRC 格式：[mm:ss.xx]<mm:ss.xx>字<mm:ss.xx>字... 一行一句
- [mm:ss.xx] 为行级时间戳，<mm:ss.xx>字 为逐字时间戳（注意是尖括号，不是方括号）
- 每个汉字/英文单词都要有独立的 <mm:ss.xx> 时间戳，取自该字对应拼音音素的 s 属性

${VSCODE_AI_SYSTEM_REMINDER_PREAMBLE}`
}

/** 对话轮系统提示词：自由对话 + 可直接修改 aligned.lrc */
export function buildPhonemeChatSystemPrompt(workspaceDir: string): string {
  return `你是歌词对齐助手，可以自由对话，也可以直接操作对齐结果。本次对话的工作区（终端会话的 os.tmpdir() 下）：${workspaceDir}

工作区文件：
- lyrics.txt：歌词原文（每行一句；尚未对齐时可能为空）
- phones.tsv：音素表（开始秒\\t结束秒\\t拼音\\t原始IPA；尚未识别/对齐时可能为空）
- aligned.lrc：增强 LRC 输出文件（尚未对齐时为空）。用户让你修改/修正时间戳、歌词行时，直接编辑它。

环境说明（重要）：
- 终端是持久 JavaScript REPL（InstantREPL/QuickJS），不是真实 shell：没有管道/重定向/heredoc；读写文件用 fs API（fs.readFileSync / fs.appendFileSync / fs.writeFileSync / fs.statSync 等）
- 每次工具调用都是独立作用域，顶层 const/let 不会保留；跨调用共享的数据必须挂到 globalThis
- 路径一律用绝对路径；大文本可写 os.tmpdir()（即工作区目录）
- 不要 console.log 大段内容；工具结果超过约 16000 字符会自动 spill 到文件

增强 LRC 格式（对齐/修改 aligned.lrc 时遵守）：
- [mm:ss.xx]<mm:ss.xx>字<mm:ss.xx>字... 一行一句；[ ] 为行级时间戳，< > 为逐字时间戳（尖括号）
- 每个汉字/英文单词都有独立 <mm:ss.xx>；标点附在前一个字后面；歌词文字保持原文逐字不变，绝不改写、不纠错、不增删；时间戳不得虚构

修改 aligned.lrc 后应 fs.readFileSync 读回自查（行数、格式、歌词逐字一致）。回答用简洁中文 Markdown；不要重贴整首 LRC，只说明改了什么或回答用户问题。

${VSCODE_AI_SYSTEM_REMINDER_PREAMBLE}`
}

// ---------------------------------------------------------------------------
// 上下文 / 工具 / 宿主
// ---------------------------------------------------------------------------

export function buildPhonemeAlignContext(
  workspaceFolder: string,
  terminalApi: PhonemeTerminalHostApi | null,
  chatSessionId: string,
): VscodeAiContextInput {
  return {
    workspaceFolder,
    tabs: [],
    activeTabId: undefined,
    editor: {
      activePath: undefined,
      cursorLine: 1,
      cursorColumn: 1,
      selectionText: undefined,
    },
    problems: [],
    aiTerminalKind: 'agent',
    aiTerminal: terminalApi?.getAiTerminalSnapshot('agent', chatSessionId) ?? { status: 'none' },
  }
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

const RUN_TERMINAL_DESCRIPTION =
  '在本对话绑定的受控终端执行一段 JavaScript（自动执行，无需确认）。同对话复用同一终端；若用户已关闭该终端会自动新开并在结果中标明 rebuilt。读/写/删/建文件用 fs（fs.readFileSync / fs.appendFileSync / fs.writeFileSync 等）；搜索文本用 globalThis.instant.grep(...)。大文本可写 os.tmpdir()；工具返回超过约 16000 字符（16K）时会自动 spill 到 tmp 并预览开头。必须传 description（短句说明本步意图，供界面展示）。'

/** 歌词对齐 Agent 只挂 run_in_terminal（与 ProDude 同款的可写终端工具） */
export function createPhonemeAlignTools(host: VscodeAiToolsHost) {
  return [
    defineTool({
      name: 'run_in_terminal',
      description: RUN_TERMINAL_DESCRIPTION,
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['command', 'description'],
        properties: {
          command: { type: 'string' },
          description: {
            type: 'string',
            description: '短句说明本步意图（约 40 字内，中文动宾），供界面展示，不参与执行',
          },
        },
      },
      execute: async (args) => {
        const fullText = await runVscodeAiTerminalLine(
          host.runCommandHost,
          asString(args.command),
        )
        const tmpDir = host.runCommandHost.getAgentTerminalHandle()?.getTmpDir()
        if (!tmpDir) return fullText
        return maybeSpillToolOutput(fullText, {
          tmpDir,
          runTerminalLine: (cmd) => runVscodeAiTerminalLine(host.runCommandHost, cmd),
          notifyTerminal: (message) => {
            host.runCommandHost.getAgentTerminalHandle()?.appendInfo(message)
          },
        })
      },
    }),
  ]
}

/** 歌词对齐的 runCommandHost（镜像 ProDude：绑 terminalApi 的 agent 会话） */
export function createPhonemeRunCommandHost(input: {
  workspaceFolder: string
  chatSessionId: string
  chatTitle: string
  terminalApi: PhonemeTerminalHostApi
  npmLastChanges: { current: TerminalChangeSet | undefined }
  lastChangeSource: { current: VscodeAiLastChangeSource | undefined }
  turnChangeSessions: { current: TerminalChangeSet[] }
}): VscodeAiRunCommandHost {
  return {
    workspaceFolder: input.workspaceFolder,
    npmLastChanges: input.npmLastChanges,
    lastChangeSource: input.lastChangeSource,
    turnChangeSessions: input.turnChangeSessions,
    ensureAgentTerminal: () =>
      input.terminalApi.ensureAiTerminal('agent', input.chatSessionId, input.chatTitle),
    getAgentTerminalHandle: () =>
      input.terminalApi.getAiTerminalHandle('agent', input.chatSessionId),
    getAgentTerminalSnapshot: () =>
      input.terminalApi.getAiTerminalSnapshot('agent', input.chatSessionId),
    getFsMode: () => {
      const handle = input.terminalApi.getAiTerminalHandle('agent', input.chatSessionId)
      return handle?.getFsMode() ?? 'controlled'
    },
  }
}

// ---------------------------------------------------------------------------
// 轮次执行
// ---------------------------------------------------------------------------

/** 一轮对话/对齐的公共选项（workspaceDir 指向 App 已备好的工作区） */
export type PhonemeAgentTurnOptions = {
  /** 本轮用户消息（对齐轮为「工作区已就绪…请对齐」指令；聊天轮为用户原文） */
  userMessage: string
  /** 上一轮续聊历史（wireMessages 等）；首轮可缺省 */
  history?: OpenAI.Chat.ChatCompletionMessageParam[]
  /** 工作区目录（App 已写好 lyrics.txt / phones.tsv / aligned.lrc） */
  workspaceDir: string
  /** 隐藏挂载的 Agent 终端宿主 */
  terminalApi: PhonemeTerminalHostApi
  /** 本对话的终端 ownerId（跨轮不变，保证复用同一终端会话） */
  chatSessionId: string
  /** 终端会话标题 */
  chatTitle: string
  /** 终端与上下文的工作区根 */
  workspaceFolder: string
  signal?: AbortSignal
  onProgress?: (progress: VscodeAiAgentProgress) => void
  /** 显式模型键（composer 里自选自定义模型）；缺省走用户偏好 */
  modelKey?: string
}

export type PhonemeAlignAgentResult = VscodeAiAgentResult & {
  /** 本轮结束后工作区 aligned.lrc 的当前内容（可能被 Agent 写入/修改） */
  alignedLrc?: string
}

async function runPhonemeAgentTurn(options: {
  turn: PhonemeAgentTurnOptions
  systemPrompt: string
  maxStepsOverride?: number
  behavior: string
  behaviorLabel: string
}): Promise<PhonemeAlignAgentResult> {
  const { workspaceDir, ...turn } = options.turn
  const context = buildPhonemeAlignContext(
    turn.workspaceFolder,
    turn.terminalApi,
    turn.chatSessionId,
  )
  const toolsHost: VscodeAiToolsHost = {
    getContext: () => context,
    runCommandHost: createPhonemeRunCommandHost({
      workspaceFolder: turn.workspaceFolder,
      chatSessionId: turn.chatSessionId,
      chatTitle: turn.chatTitle,
      terminalApi: turn.terminalApi,
      npmLastChanges: { current: undefined },
      lastChangeSource: { current: undefined },
      turnChangeSessions: { current: [] },
    }),
    chatSessionId: turn.chatSessionId,
    ensureAiTerminal: (kind, ownerId, title) =>
      turn.terminalApi.ensureAiTerminal(kind, ownerId, title),
    getAiTerminalHandle: (kind, ownerId) =>
      turn.terminalApi.getAiTerminalHandle(kind, ownerId),
    getAiTerminalSnapshot: (kind, ownerId) =>
      turn.terminalApi.getAiTerminalSnapshot(kind, ownerId),
    closeAiTerminal: (kind, ownerId) => turn.terminalApi.closeAiTerminal(kind, ownerId),
  }

  const result = await askVscodeAiAgent({
    mode: 'agent',
    userMessage: turn.userMessage,
    history: turn.history,
    context,
    toolsHost,
    signal: turn.signal,
    modelKey: turn.modelKey ?? resolveVscodeAiModelKey(),
    onProgress: turn.onProgress,
    createTools: (_mode, host) => createPhonemeAlignTools(host),
    maxStepsOverride: options.maxStepsOverride,
    buildSystemPrompt: () => options.systemPrompt,
    usageContext: {
      actor: 'phoneme',
      behavior: options.behavior,
      actorLabel: '歌词对齐',
      behaviorLabel: options.behaviorLabel,
    },
  })

  // 读回工作区文件：对齐轮 = 完整结果；聊天轮 = 检测 Agent 是否改动了 LRC
  let alignedLrc: string | undefined
  try {
    const text = await filesReadText(
      joinFilesAbsolutePath(workspaceDir, PHONEME_ALIGN_LRC_FILE),
    )
    const trimmed = text.trim()
    if (trimmed) alignedLrc = trimmed
  } catch {
    // 文件不存在或读失败：保持 undefined
  }

  return {
    ...result,
    alignedLrc,
  }
}

// ---------------------------------------------------------------------------
// 对齐轮 / 聊天轮
// ---------------------------------------------------------------------------

export type RunPhonemeAlignAgentOptions = Omit<PhonemeAgentTurnOptions, 'userMessage'> & {
  /** 歌词原文（多行，可能有错别字/缺行） */
  lyrics: string
  /** 音素识别结果（含时间戳） */
  phoneList: AlignedPhone[]
}

/** 对齐轮：任务专用提示词 + 大步数，逐段把增强 LRC 写入工作区 */
export async function runPhonemeAlignAgent(
  options: RunPhonemeAlignAgentOptions,
): Promise<PhonemeAlignAgentResult> {
  const lines = options.lyrics
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const workspaceDir = options.workspaceDir

  const userMessage =
    lines.length === 0
      ? '没有可对齐的歌词行。'
      : `工作区已就绪：${workspaceDir}\n- lyrics.txt：${lines.length} 行歌词\n- phones.tsv：音素表（开始秒/结束秒/拼音/IPA）\n- aligned.lrc：输出文件（已存在为空）\n\n请按系统提示的流程：逐段读取素材，把增强 LRC 逐行追加写入 aligned.lrc，最后读回自查。`

  return runPhonemeAgentTurn({
    turn: {
      ...options,
      userMessage,
    },
    systemPrompt: buildPhonemeAlignSystemPrompt({ workspaceDir, lineCount: lines.length }),
    // 每段约 3 轮（读/写/查）+ 初始化与收尾 + 重试余量
    maxStepsOverride: Math.min(60, 12 + Math.ceil(lines.length / 4) * 3),
    behavior: 'lyrics-align',
    behaviorLabel: '歌词时间戳对齐',
  })
}

/** 聊天轮：自由对话（可用终端修改 aligned.lrc），步数用默认上限 */
export async function runPhonemeChatAgent(
  options: PhonemeAgentTurnOptions,
): Promise<PhonemeAlignAgentResult> {
  return runPhonemeAgentTurn({
    turn: options,
    systemPrompt: buildPhonemeChatSystemPrompt(options.workspaceDir),
    behavior: 'lyrics-chat',
    behaviorLabel: '歌词对话',
  })
}
