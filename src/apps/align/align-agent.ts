/**
 * 歌词对齐 2 的 LLM 调用封装：
 * - G2P：一次性无工具调用，歌词 → IPA 音素序列
 * - Chat：对话手动修正 LRC（仍无终端，返回改后的完整 LRC）
 */

import type OpenAI from 'openai'
import {
  askVscodeAiAgent,
  type VscodeAiAgentProgress,
  type VscodeAiAgentResult,
} from '../vscode/vscode-ai-agent.ts'
import type { VscodeAiContextInput } from '../vscode/vscode-ai-context.ts'
import { resolveVscodeAiModelKey } from '../vscode/vscode-ai-models.ts'
import type { VscodeAiRunCommandHost } from '../vscode/vscode-ai-run-command.ts'
import type { VscodeAiToolsHost } from '../vscode/vscode-ai-tools.ts'
import { extractLrcFromAnswer } from '../stems/phoneme-align-workspace.ts'
import {
  buildG2pSystemPrompt,
  buildG2pUserMessage,
  flattenG2pLines,
  parseG2pResult,
  pickVocabHint,
} from './align-g2p.ts'
import type { G2pLine, G2pUnit } from './align-types.ts'

// ---------------------------------------------------------------------------
// 无终端 stub（G2P / Chat 都不走 run_in_terminal）
// ---------------------------------------------------------------------------

function buildEmptyContext(): VscodeAiContextInput {
  return {
    workspaceFolder: undefined,
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
    aiTerminal: { status: 'none' },
  }
}

function buildStubToolsHost(): VscodeAiToolsHost {
  const runCommandHost: VscodeAiRunCommandHost = {
    workspaceFolder: undefined,
    npmLastChanges: { current: undefined },
    lastChangeSource: { current: undefined },
    turnChangeSessions: { current: [] },
    ensureAgentTerminal: async () => {
      throw new Error('歌词对齐 2 不使用终端')
    },
    getAgentTerminalHandle: () => undefined,
    getAgentTerminalSnapshot: () => ({ status: 'none' }),
    getFsMode: () => 'controlled',
  }
  return {
    getContext: buildEmptyContext,
    runCommandHost,
  }
}

// ---------------------------------------------------------------------------
// vocab 缓存（与 phoneme-app 同口径）
// ---------------------------------------------------------------------------

let cachedVocabSymbols: string[] | undefined

async function loadVocabSymbols(): Promise<string[]> {
  if (cachedVocabSymbols) return cachedVocabSymbols
  const response = await fetch('/assets/phoneme/vocab.json')
  const json: Record<string, number> = await response.json()
  cachedVocabSymbols = Object.keys(json)
  return cachedVocabSymbols
}

// ---------------------------------------------------------------------------
// G2P
// ---------------------------------------------------------------------------

export type RunG2pAgentOptions = {
  lyrics: string
  modelKey?: string
  signal?: AbortSignal
  onProgress?: (progress: VscodeAiAgentProgress) => void
  /** 测试注入：跳过 fetch vocab */
  vocabSymbols?: string[]
}

export type G2pAgentResult = {
  lines: G2pLine[]
  units: G2pUnit[]
  agent: VscodeAiAgentResult
}

/** 一次性 G2P：无工具、严格 JSON，失败抛错 */
export async function runG2pAgent(options: RunG2pAgentOptions): Promise<G2pAgentResult> {
  const vocab = options.vocabSymbols ?? (await loadVocabSymbols())
  const vocabHint = pickVocabHint(vocab, 160)
  const context = buildEmptyContext()
  const toolsHost = buildStubToolsHost()

  const agent = await askVscodeAiAgent({
    mode: 'agent',
    userMessage: buildG2pUserMessage(options.lyrics),
    context,
    toolsHost,
    signal: options.signal,
    modelKey: options.modelKey ?? resolveVscodeAiModelKey(),
    onProgress: options.onProgress,
    createTools: () => [],
    maxStepsOverride: 1,
    buildSystemPrompt: () => buildG2pSystemPrompt(vocabHint),
    usageContext: {
      actor: 'align',
      behavior: 'g2p',
      actorLabel: '歌词对齐 2',
      behaviorLabel: '歌词转音素',
    },
  })

  const lines = parseG2pResult(agent.text, options.lyrics)
  return { lines, units: flattenG2pLines(lines), agent }
}

// ---------------------------------------------------------------------------
// Chat 修正
// ---------------------------------------------------------------------------

export type RunAlignChatOptions = {
  /** 当前增强 LRC */
  lrc: string
  userMessage: string
  history?: OpenAI.Chat.ChatCompletionMessageParam[]
  modelKey?: string
  signal?: AbortSignal
  onProgress?: (progress: VscodeAiAgentProgress) => void
}

export type AlignChatResult = VscodeAiAgentResult & {
  /** 若 Agent 返回了可解析的 LRC，则为修正后正文 */
  revisedLrc?: string
}

function buildChatSystemPrompt(lrc: string): string {
  return `你是歌词对齐助手。用户可能让你修正时间戳、合并行、微调偏移等。

当前对齐结果（增强 LRC）：
\`\`\`lrc
${lrc}
\`\`\`

规则：
- 回答用简洁中文 Markdown
- 若修改了 LRC：在回复末尾用 \`\`\`lrc 代码块贴出**完整**修改后的 LRC（不要只贴改动行）
- 若只是回答问题、不改 LRC：不要贴代码块
- 歌词文字保持原文逐字不变；时间戳格式 [mm:ss.xx] 行级、<mm:ss.xx> 逐字；时间戳须单调递增`
}

/** 对话修正轮：无终端；若回复含 LRC 代码块则提取 */
export async function runAlignChatAgent(
  options: RunAlignChatOptions,
): Promise<AlignChatResult> {
  const context = buildEmptyContext()
  const toolsHost = buildStubToolsHost()

  const agent = await askVscodeAiAgent({
    mode: 'agent',
    userMessage: options.userMessage,
    history: options.history,
    context,
    toolsHost,
    signal: options.signal,
    modelKey: options.modelKey ?? resolveVscodeAiModelKey(),
    onProgress: options.onProgress,
    createTools: () => [],
    maxStepsOverride: 4,
    buildSystemPrompt: () => buildChatSystemPrompt(options.lrc),
    usageContext: {
      actor: 'align',
      behavior: 'lyrics-chat',
      actorLabel: '歌词对齐 2',
      behaviorLabel: '歌词对话',
    },
  })

  const extracted = extractLrcFromAnswer(agent.text).trim()
  // 只有看起来真是 LRC（含时间戳）才采纳
  const revisedLrc =
    extracted && (extracted.includes('[') || extracted.includes('<')) && extracted !== options.lrc.trim()
      ? extracted
      : undefined

  return { ...agent, revisedLrc }
}
