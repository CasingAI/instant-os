import type OpenAI from 'openai'
import { buildInstantShellSystemPromptSection } from '../../terminal/instant-shell/instant-shell-prompt.ts'
import {
  askVscodeAiAgent,
  type VscodeAiAgentProgress,
  type VscodeAiAgentResult,
} from '../vscode/vscode-ai-agent.ts'
import type { VscodeAiContextInput } from '../vscode/vscode-ai-context.ts'
import type { VscodeAiRunCommandHost } from '../vscode/vscode-ai-run-command.ts'
import type { VscodeAiToolsHost } from '../vscode/vscode-ai-tools.ts'
import { VSCODE_AI_SYSTEM_REMINDER_PREAMBLE } from '../vscode/vscode-ai-system-reminder.ts'
import type { ProdudeTerminalHostApi } from './produde-terminal-host.tsx'
import { createProdudeAiTools } from './produde-tools.ts'
import type { VscodeAiImageAttachment } from '../vscode/vscode-ai-attachments.ts'
import type { ProdudeLiveProgress, ProdudeMessage } from './produde-types.ts'
import { PRODUDE_DEFAULT_WORKSPACE } from './produde-types.ts'

export function buildProdudeSystemPrompt(): string {
  return `你是 ProDude——Instant OS 里以对话为中心的编程助手，帮助用户理解与修改虚拟文件系统中的项目。

可用 run_in_terminal 读写工作区、执行脚本与副作用。改完后在回复里说明改了什么；没有撤销/确认流程。回答用简洁中文 Markdown。

环境说明：
- 默认工作区是用户目录 ${PRODUDE_DEFAULT_WORKSPACE}；路径均为 Instant OS VFS 绝对路径（如 /user/...、/mount/...）
- 没有真实 shell、管道或网络下载；终端是 InstantREPL（QuickJS）
- 读写与副作用走终端脚本（如 fs.readFileSync / fs.writeFileSync）；搜索用 instant.grep
- os.tmpdir() 可写大文本
- 只有 run_in_terminal 工具；修改前先读确认现状；不要编造未执行的工具结果

${VSCODE_AI_SYSTEM_REMINDER_PREAMBLE}

${buildInstantShellSystemPromptSection()}`
}

export function buildProdudeContext(
  workspaceFolder: string,
  terminalApi: ProdudeTerminalHostApi | null,
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

export function buildProdudeChatHistory(
  messages: readonly ProdudeMessage[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const history: OpenAI.Chat.ChatCompletionMessageParam[] = []
  for (const message of messages) {
    if (message.isError) continue
    const content = message.content.trim()
    if (!content) continue
    history.push({ role: message.role, content })
  }
  return history
}

export function liveProgressFromAgent(
  progress: VscodeAiAgentProgress,
): ProdudeLiveProgress {
  return {
    timeline: progress.timeline,
    answerText: progress.answerText,
  }
}

export type RunProdudeAgentOptions = {
  userMessage: string
  workspaceFolder: string
  chatSessionId: string
  chatTitle: string
  modelKey: string | undefined
  history?: OpenAI.Chat.ChatCompletionMessageParam[]
  signal?: AbortSignal
  terminalApi: ProdudeTerminalHostApi
  runCommandHost: VscodeAiRunCommandHost
  imageAttachments?: readonly VscodeAiImageAttachment[]
  onProgress?: (progress: VscodeAiAgentProgress) => void
}

export async function runProdudeAgent(
  options: RunProdudeAgentOptions,
): Promise<VscodeAiAgentResult> {
  const toolsHost: VscodeAiToolsHost = {
    getContext: () =>
      buildProdudeContext(options.workspaceFolder, options.terminalApi, options.chatSessionId),
    runCommandHost: options.runCommandHost,
    chatSessionId: options.chatSessionId,
    ensureAiTerminal: (terminalKind, ownerId, title) =>
      options.terminalApi.ensureAiTerminal(terminalKind, ownerId, title),
    getAiTerminalHandle: (terminalKind, ownerId) =>
      options.terminalApi.getAiTerminalHandle(terminalKind, ownerId),
    getAiTerminalSnapshot: (terminalKind, ownerId) =>
      options.terminalApi.getAiTerminalSnapshot(terminalKind, ownerId),
    closeAiTerminal: (terminalKind, ownerId) =>
      options.terminalApi.closeAiTerminal(terminalKind, ownerId),
  }

  return askVscodeAiAgent({
    mode: 'agent',
    userMessage: options.userMessage,
    context: buildProdudeContext(
      options.workspaceFolder,
      options.terminalApi,
      options.chatSessionId,
    ),
    toolsHost,
    history: options.history,
    signal: options.signal,
    modelKey: options.modelKey,
    imageAttachments: options.imageAttachments,
    onProgress: options.onProgress,
    createTools: (_mode, host) => createProdudeAiTools(host),
    buildSystemPrompt: () => buildProdudeSystemPrompt(),
    usageContext: {
      actor: 'produde',
      behavior: 'chat',
      actorLabel: 'ProDude',
      behaviorLabel: '对话',
    },
  })
}

export function createProdudeRunCommandHost(input: {
  workspaceFolder: string
  chatSessionId: string
  chatTitle: string
  terminalApi: ProdudeTerminalHostApi
  npmLastChanges: { current: import('../../terminal/terminal-changeset.ts').TerminalChangeSet | undefined }
  lastChangeSource: {
    current: import('../vscode/vscode-ai-run-command.ts').VscodeAiLastChangeSource | undefined
  }
  turnChangeSessions: {
    current: import('../../terminal/terminal-changeset.ts').TerminalChangeSet[]
  }
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
