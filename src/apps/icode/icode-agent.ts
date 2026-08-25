/**
 * iCode 编辑代理化（第三期）：iCode 聊天的编辑引擎整体复用 vscode AI 那套 agent 框架。
 *
 * - 模型经工具循环操作受控 InstantREPL 终端，按路径读写当前应用的草稿文件夹树；
 *   写入硬限草稿树（QuickJS 权限 fsWriteRoots = 草稿根），读取放开。
 * - 能力请求是独立工具（request_capability），不再织进输出格式禁令。
 * - 一轮里多次写操作可整轮回滚（revert_terminal_changes）。
 * - AI 用量经 usageContext 接线（漏接只会静默不出现在「AI 用量」面板，因此是硬要求）。
 * - 终端只是 iCode 开发面基础设施：不进版本树，生成应用运行时本身不带终端。
 */
import type OpenAI from 'openai'
import { osNowMs } from '../../os/os-clock.ts'
import type { GeneratedAppId } from '../../os/types.ts'
import type { AppCapabilityTag } from '../appstore/app-capability-tags.ts'
import { defineTool, type AgentTool } from '../../ai/agent-tool.ts'
import { buildInstantShellSystemPromptSection } from '../../terminal/instant-shell/instant-shell-prompt.ts'
import {
  askVscodeAiAgent,
  buildVscodeAiInvestigationFromTimeline,
  type VscodeAiAgentProgress,
  type VscodeAiAgentResult,
} from '../vscode/vscode-ai-agent.ts'
import type { VscodeAiContextInput } from '../vscode/vscode-ai-context.ts'
import {
  getVscodeAiLastChangeSet,
  revertVscodeAiLastChanges,
  type VscodeAiRunCommandHost,
} from '../vscode/vscode-ai-run-command.ts'
import { maybeSpillToolOutput } from '../vscode/vscode-ai-output-spill.ts'
import { runVscodeAiTerminalLine } from '../vscode/vscode-ai-run-command.ts'
import type { VscodeAiToolsHost } from '../vscode/vscode-ai-tools.ts'
import { VSCODE_AI_SYSTEM_REMINDER_PREAMBLE } from '../vscode/vscode-ai-system-reminder.ts'
import { formatTerminalChangeSummary } from '../../terminal/terminal-changeset.ts'
import type { ProdudeTerminalHostApi } from '../produde/produde-terminal-host.tsx'

export type IcodeCapabilityTag = '3d' | 'ai' | 'files' | 'terminal'

export const ICODE_CAPABILITY_TAG_VALUES: readonly IcodeCapabilityTag[] = [
  '3d',
  'ai',
  'files',
  'terminal',
]

export const ICODE_CAPABILITY_TAG_LABELS: Record<IcodeCapabilityTag, string> = {
  '3d': '3D 能力',
  ai: '运行时 AI 能力',
  files: '文件访问能力',
  terminal: '终端能力',
}

export function buildIcodeAgentSystemPrompt(input: {
  appName: string
  draftRoot: string
  fileManifest: readonly string[]
  grantedCapabilities: readonly IcodeCapabilityTag[]
}): string {
  const granted =
    input.grantedCapabilities.length > 0
      ? input.grantedCapabilities.map((tag) => ICODE_CAPABILITY_TAG_LABELS[tag]).join('、')
      : '（暂无）'
  const manifest =
    input.fileManifest.length > 0
      ? input.fileManifest.map((path) => `- ${path}`).join('\n')
      : '- （空）'
  return `你是 iCode——Instant OS 里生成应用的开发面代理，帮助用户开发当前应用「${input.appName}」。

工作区就是该应用的草稿文件夹树：${input.draftRoot}
- 只能在这一棵树里写文件（写入被硬限制在草稿根；正式版只读，越界写会 EACCES）
- 读取放开：可读 VFS 其它路径作参考（单用户本地系统），但别翻无关目录浪费步骤
- 版本模型：草稿（Draft）之外是只读正式版；桌面只跑当前最大正式号；发布是用户动作，你不要触碰
- 聊天与用户数据在版本树之外；不要往草稿写聊天或运行时数据文件

当前草稿文件清单：
${manifest}

已授予的能力：${granted}
- 需要未授予的能力时调用 request_capability 工具发起请求，等待结果再继续；被拒绝就给出不依赖该能力的替代说明
- 未授权状态下你仍可正常产出代码；门禁在运行时能力桥，不在提示词

编辑约定：
- 用 run_in_terminal 的 fs.readFileSync / fs.writeFileSync 按路径读改文件；搜索用 instant.grep
${
  input.fileManifest.includes('main.tsx')
    ? '- 这是 TSX 工程：入口 main.tsx；用系统提供的 preact（import { render } from "preact"；hooks 从 "preact/hooks"），裸名只支持 preact / preact/hooks / preact/jsx-runtime；样式用普通 CSS 邻居文件'
    : '- 入口是 index.html；样式、脚本、图片放邻居文件，页内相对引用即可解析'
}
- 改完即预览：宿主监听草稿树文件变更刷新；转译/类型诊断的报错你能读到，可自行修正
- 每轮可 get_terminal_changes 查看改动，revert_terminal_changes 整轮回滚
- 不要编造未执行的工具结果；回复用简洁中文说明改了什么

${VSCODE_AI_SYSTEM_REMINDER_PREAMBLE}

${buildInstantShellSystemPromptSection()}`
}

export function buildIcodeAgentContext(
  draftRoot: string,
  terminalApi: ProdudeTerminalHostApi | null,
  chatSessionId: string,
): VscodeAiContextInput {
  return {
    workspaceFolder: draftRoot,
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

/** 能力请求独立工具（2.3）：未授予能力 → 弹确认；拒绝则模型收到明确反馈继续干活或收尾 */
function createRequestCapabilityTool(input: {
  grantedTags: readonly IcodeCapabilityTag[]
  requestCapability: (tag: IcodeCapabilityTag, reason: string) => Promise<boolean>
}): AgentTool {
  return defineTool({
    name: 'request_capability',
    description:
      '应用需要尚未授予的系统能力（3D / 运行时 AI / 文件访问 / 终端）时调用，向用户发起授予请求。授予后可继续产出依赖该能力的代码；拒绝则改用不依赖该能力的方案或说明。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['tag', 'reason'],
      properties: {
        tag: {
          type: 'string',
          enum: [...ICODE_CAPABILITY_TAG_VALUES],
          description: '能力标识：3d | ai | files | terminal',
        },
        reason: {
          type: 'string',
          description: '为什么需要这个能力（一句话，展示给用户）',
        },
      },
    },
    execute: async (args) => {
      const tag = ICODE_CAPABILITY_TAG_VALUES.find((item) => item === args.tag)
      const reason = typeof args.reason === 'string' ? args.reason.trim() : ''
      if (!tag) return '无效的能力标识；可用：3d / ai / files / terminal'
      if (input.grantedTags.includes(tag)) {
        return `${ICODE_CAPABILITY_TAG_LABELS[tag]}已授予，无需重复请求。`
      }
      const granted = await input.requestCapability(tag, reason)
      return granted
        ? `用户已授予${ICODE_CAPABILITY_TAG_LABELS[tag]}。可以继续产出使用该能力的代码。`
        : `用户拒绝了${ICODE_CAPABILITY_TAG_LABELS[tag]}。请给出不依赖该能力的替代实现或说明。`
    },
  })
}

export function createIcodeAiTools(input: {
  host: VscodeAiToolsHost
  grantedTags: readonly IcodeCapabilityTag[]
  requestCapability: (tag: IcodeCapabilityTag, reason: string) => Promise<boolean>
}): AgentTool[] {
  const { host } = input
  return [
    defineTool({
      name: 'run_in_terminal',
      description:
        '在本对话绑定的受控终端执行一段 JavaScript（自动执行，无需确认）。工作区是当前应用的草稿树；写入被硬限制在草稿根，正式版只读。读/写/删/建文件用 fs；搜索文本用 globalThis.instant.grep(...)；大文本可写 os.tmpdir()；输出超过约 16K 自动 spill 到 tmp 并预览开头。必须传 description（短句说明本步意图，供界面展示）。',
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
        const command = typeof args.command === 'string' ? args.command : ''
        const fullText = await runVscodeAiTerminalLine(host.runCommandHost, command)
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
    createRequestCapabilityTool(input),
    defineTool({
      name: 'get_terminal_changes',
      description: '查看最近一次受控终端执行产生的草稿树文件变更清单',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      execute: async () => {
        const changeSet = getVscodeAiLastChangeSet(host.runCommandHost)
        if (!changeSet || changeSet.changes.length === 0) {
          return '无可查看的变更'
        }
        const lines = [
          formatTerminalChangeSummary(changeSet),
          `session: ${changeSet.sessionId}`,
          ...changeSet.changes.map((entry) => {
            const from = entry.fromPath ? ` ← ${entry.fromPath}` : ''
            return `${entry.kind}\t${entry.path}${from}`
          }),
        ]
        return lines.join('\n')
      },
    }),
    defineTool({
      name: 'revert_terminal_changes',
      description: '整轮回滚最近一次受控终端执行对草稿树的文件改动（自动执行）',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      execute: async () => revertVscodeAiLastChanges(host.runCommandHost),
    }),
  ]
}

export type RunIcodeAgentOptions = {
  appId: GeneratedAppId
  appName: string
  draftRoot: string
  fileManifest: readonly string[]
  grantedCapabilities: readonly IcodeCapabilityTag[]
  chatSessionId: string
  chatTitle: string
  userMessage: string
  modelKey: string | undefined
  history?: OpenAI.Chat.ChatCompletionMessageParam[]
  signal?: AbortSignal
  terminalApi: ProdudeTerminalHostApi
  runCommandHost: VscodeAiRunCommandHost
  requestCapability: (tag: IcodeCapabilityTag, reason: string) => Promise<boolean>
  onProgress?: (progress: VscodeAiAgentProgress) => void
}

export async function runIcodeAgent(options: RunIcodeAgentOptions): Promise<VscodeAiAgentResult> {
  const toolsHost: VscodeAiToolsHost = {
    getContext: () =>
      buildIcodeAgentContext(options.draftRoot, options.terminalApi, options.chatSessionId),
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
    context: buildIcodeAgentContext(
      options.draftRoot,
      options.terminalApi,
      options.chatSessionId,
    ),
    toolsHost,
    history: options.history,
    signal: options.signal,
    modelKey: options.modelKey,
    onProgress: options.onProgress,
    createTools: (_mode, host) =>
      createIcodeAiTools({
        host,
        grantedTags: options.grantedCapabilities,
        requestCapability: options.requestCapability,
      }),
    buildSystemPrompt: () =>
      buildIcodeAgentSystemPrompt({
        appName: options.appName,
        draftRoot: options.draftRoot,
        fileManifest: options.fileManifest,
        grantedCapabilities: options.grantedCapabilities,
      }),
    // 用量接线（2.5，验收项）：换引擎后「AI 用量」面板必须仍能看到消耗
    usageContext: {
      actor: 'icode',
      behavior: 'chat',
      actorLabel: 'iCode',
      behaviorLabel: '编辑',
    },
  })
}

/** 一轮结束：把活动时间线裁剪为可持久化的 investigation（挂在助手消息上） */
export function persistIcodeInvestigation(
  timeline: VscodeAiAgentProgress['timeline'],
): ReturnType<typeof buildVscodeAiInvestigationFromTimeline> {
  return buildVscodeAiInvestigationFromTimeline(timeline)
}

export function icodeChatSessionId(appId: GeneratedAppId): string {
  return `icode-${appId}`
}

export function icodeChatTitle(appName: string): string {
  return appName.slice(0, 24) || 'iCode'
}

export function createIcodeRunCommandHost(input: {
  draftRoot: string
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
    workspaceFolder: input.draftRoot,
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

/** 能力标签桥接：AppCapabilityTag ↔ icode 可授予能力 */
export function toIcodeCapabilityTags(tags: readonly AppCapabilityTag[]): IcodeCapabilityTag[] {
  return ICODE_CAPABILITY_TAG_VALUES.filter((tag) => tags.includes(tag as AppCapabilityTag))
}

export function newIcodeMessageId(role: 'user' | 'assistant'): string {
  return `${role}-${osNowMs()}-${Math.random().toString(36).slice(2, 8)}`
}
