import { isReadableVfsAbsolutePath } from '../files/files-path.ts'
import type { MonacoProblem } from '../../monaco/monaco-markers.ts'
import { buildInstantShellSystemPromptSection } from '../../terminal/instant-shell/instant-shell-prompt.ts'
import type { VscodeTab } from './vscode-tabs.ts'
import { VSCODE_AI_SYSTEM_REMINDER_PREAMBLE } from './vscode-ai-system-reminder.ts'
import type {
  VscodeAgentTerminalSnapshot,
  VscodeAiTerminalKind,
} from './vscode-terminal-sessions.ts'

export type VscodeAiEditorSnapshot = {
  activePath: string | undefined
  cursorLine: number
  cursorColumn: number
  selectionText: string | undefined
}

export type VscodeAiContextInput = {
  workspaceFolder: string | undefined
  tabs: readonly VscodeTab[]
  activeTabId: string | undefined
  editor: VscodeAiEditorSnapshot
  problems: readonly MonacoProblem[]
  /** 本对话当前模式绑定的 AI 终端状态（关闭后为 closed，尚未创建过为 none） */
  aiTerminal?: VscodeAgentTerminalSnapshot
  /** 与 aiTerminal 配套，决定上下文文案用 Ask / Plan / Agent */
  aiTerminalKind?: VscodeAiTerminalKind
}

function normalizeRoot(path: string | undefined): string | undefined {
  if (!path) return undefined
  const trimmed = path.trim().replace(/\/+$/, '') || '/'
  return trimmed
}

/** AI 读取工具：允许访问虚拟文件系统内任意卷，写入仍限工作区 */
export function isPathAllowedForAiRead(path: string): boolean {
  return isReadableVfsAbsolutePath(path)
}

export function isPathAllowedForWrite(path: string, input: VscodeAiContextInput): boolean {
  const workspace = normalizeRoot(input.workspaceFolder)
  const normalized = path.replace(/\/+$/, '') || '/'
  if (workspace) {
    return normalized === workspace || normalized.startsWith(`${workspace}/`)
  }
  for (const tab of input.tabs) {
    const tabPath = tab.path.replace(/\/+$/, '') || '/'
    if (normalized === tabPath || normalized.startsWith(`${tabPath}/`)) {
      return true
    }
    const slash = tabPath.lastIndexOf('/')
    if (slash > 0) {
      const parent = tabPath.slice(0, slash)
      if (normalized === parent || normalized.startsWith(`${parent}/`)) {
        return true
      }
    }
  }
  return false
}

function aiTerminalLabel(kind: VscodeAiTerminalKind | undefined): string {
  if (kind === 'plan') return 'Plan'
  if (kind === 'ask') return 'Ask'
  return 'Agent'
}

export function buildVscodeAiContextSection(input: VscodeAiContextInput): string {
  const workspace = input.workspaceFolder ?? '（未打开工作区文件夹）'
  const activeTab = input.activeTabId
    ? input.tabs.find((tab) => tab.id === input.activeTabId)
    : undefined
  const openPaths = input.tabs
    .filter((tab) => !tab.binaryPrompt)
    .map((tab) => {
      const dirty = tab.text !== tab.savedText ? ' *' : ''
      return `- ${tab.path}${dirty}${tab.id === input.activeTabId ? ' （当前）' : ''}`
    })
  const lines = [
    `工作区文件夹：${workspace}`,
    `当前活动文件：${activeTab?.path ?? '无'}`,
    `光标：第 ${input.editor.cursorLine} 行，第 ${input.editor.cursorColumn} 列`,
  ]
  if (input.editor.selectionText?.trim()) {
    const preview = input.editor.selectionText.trim().slice(0, 400)
    lines.push(`当前选区：\n\`\`\`\n${preview}\n\`\`\``)
  }
  lines.push('已打开文件：')
  lines.push(openPaths.length > 0 ? openPaths.join('\n') : '（无）')
  const problemCount = input.problems.length
  if (problemCount > 0) {
    const errors = input.problems.filter((p) => p.severity === 'error').length
    const warnings = input.problems.filter((p) => p.severity === 'warning').length
    lines.push(`Problems：${errors} 个错误，${warnings} 个警告（共 ${problemCount} 条）`)
  }
  const aiTerm = input.aiTerminal
  if (aiTerm) {
    const label = aiTerminalLabel(input.aiTerminalKind)
    if (aiTerm.status === 'alive' && aiTerm.sessionId) {
      if (aiTerm.recovering) {
        lines.push(
          `${label} 终端：session=${aiTerm.sessionId} 会话存在，正在恢复；cwd=${aiTerm.cwd ?? '（未知）'}（同对话复用；勿假设已关闭会话的 cwd/内存仍在）`,
        )
      } else {
        lines.push(
          `${label} 终端：session=${aiTerm.sessionId} cwd=${aiTerm.cwd ?? '（未知）'}（同对话复用；勿假设已关闭会话的 cwd/内存仍在）`,
        )
      }
    } else if (aiTerm.status === 'closed') {
      lines.push(`${label} 终端：已关闭。下次 run_in_terminal 会自动新开（结果里 kind=rebuilt）`)
    } else {
      lines.push(`${label} 终端：尚未创建。首次 run_in_terminal 会自动新开`)
    }
  }
  return lines.join('\n')
}

export function buildVscodeAiSystemPrompt(mode: import('./vscode-ai-mode.ts').VscodeAiMode): string {
  const modeLine =
    mode === 'ask'
      ? '当前模式：Ask（只读问答）。用只读终端调研并回答；细节约束见本轮 <system-reminder>。'
      : mode === 'plan'
        ? '当前模式：Plan（只读规划）。调研后用 write_plan 将计划写入工作区 .vscode/plans/；细节约束见本轮 <system-reminder>。'
        : mode === 'edit'
          ? '当前模式：Edit。读取工作区并通过 propose_file_edit 提交提案；细节约束见本轮 <system-reminder>。'
          : '当前模式：Agent。读写与副作用走受控终端；细节约束见本轮 <system-reminder>。需要打开应用、文件、URL 或操纵窗口时，在终端脚本里使用 globalThis.instant（见下方壳层 API）。'

  const instantShellSection =
    mode === 'agent' ? `\n\n${buildInstantShellSystemPromptSection()}` : ''

  const envLines =
    mode === 'ask' || mode === 'plan'
      ? [
          '- 路径均为 Instant OS VFS 绝对路径（如 /user/...、/mount/...）；可读任意卷内路径，写入仅限当前工作区',
          '- 没有真实 shell、管道或网络下载；终端是 InstantREPL（QuickJS），只读模式下写操作会被拒绝',
          mode === 'plan'
            ? '- Plan：run_in_terminal 只读调研；唯一落盘出口是 write_plan（.vscode/plans/*.md）'
            : '- Ask 只有 run_in_terminal；用终端脚本读取（如 fs.readFileSync / fs.readdirSync），不要尝试写入',
          '- /system 与 /models 等只读卷不可写入',
          '- 回答用简洁中文 Markdown；引用路径时用反引号',
          '- 不要编造未执行的工具结果',
        ]
      : mode === 'edit'
        ? [
            '- 路径均为 Instant OS VFS 绝对路径（如 /user/...、/mount/...）；可读任意卷内路径，写入仅限当前工作区',
            '- 没有真实 shell、管道或网络下载',
            '- /system 与 /models 等只读卷不可写入',
            '- 回答用简洁中文 Markdown；引用路径时用反引号',
            '- 不要编造未执行的工具结果',
          ]
        : [
            '- 路径均为 Instant OS VFS 绝对路径（如 /user/...、/mount/...）；可读任意卷内路径，写入仅限当前工作区',
            '- 没有真实 shell、管道或网络下载；终端是 InstantREPL（QuickJS），受控模式下会记录可回滚的文件系统变更',
            '- Agent 只有终端相关工具；读写与副作用都走终端脚本（如 fs.readFileSync / fs.writeFileSync / fs.unlinkSync）；可读任意卷，写入仅限工作区',
            '- /system 与 /models 等只读卷不可写入',
            '- 回答用简洁中文 Markdown；引用路径时用反引号',
            '- 修改前先在终端里读确认现状',
            '- 不要编造未执行的工具结果',
          ]

  return `你是 Virtual Studio Code Desktop 内置的 AI 编程助手，帮助用户理解、修改 Instant OS 虚拟文件系统中的项目代码。

${modeLine}

环境说明：
${envLines.join('\n')}

${VSCODE_AI_SYSTEM_REMINDER_PREAMBLE}${instantShellSection}`
}
