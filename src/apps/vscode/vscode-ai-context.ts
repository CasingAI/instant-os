import type { MonacoProblem } from '../../monaco/monaco-markers.ts'
import type { VscodeTab } from './vscode-tabs.ts'
import type { VscodeAgentTerminalSnapshot } from './vscode-terminal-sessions.ts'

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
  /** 本对话绑定的 Agent 终端状态（关闭后为 closed，尚未创建过为 none） */
  agentTerminal?: VscodeAgentTerminalSnapshot
}

function normalizeRoot(path: string | undefined): string | undefined {
  if (!path) return undefined
  const trimmed = path.trim().replace(/\/+$/, '') || '/'
  return trimmed
}

export function collectAllowedReadRoots(input: VscodeAiContextInput): string[] {
  const roots = new Set<string>()
  const workspace = normalizeRoot(input.workspaceFolder)
  if (workspace) {
    roots.add(workspace)
  }
  for (const tab of input.tabs) {
    if (tab.binaryPrompt) continue
    const path = tab.path.replace(/\/+$/, '') || '/'
    roots.add(path)
    const slash = path.lastIndexOf('/')
    if (slash > 0) {
      roots.add(path.slice(0, slash))
    }
  }
  return [...roots]
}

export function isPathAllowedForRead(path: string, allowedRoots: readonly string[]): boolean {
  const normalized = path.replace(/\/+$/, '') || '/'
  for (const root of allowedRoots) {
    const r = root.replace(/\/+$/, '') || '/'
    if (normalized === r || normalized.startsWith(`${r}/`)) {
      return true
    }
  }
  return false
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
  const agentTerm = input.agentTerminal
  if (agentTerm) {
    if (agentTerm.status === 'alive' && agentTerm.sessionId) {
      if (agentTerm.recovering) {
        lines.push(
          `Agent 终端：session=${agentTerm.sessionId} 会话存在，正在恢复；cwd=${agentTerm.cwd ?? '（未知）'}（同对话复用；勿假设已关闭会话的 cwd/内存仍在）`,
        )
      } else {
        lines.push(
          `Agent 终端：session=${agentTerm.sessionId} cwd=${agentTerm.cwd ?? '（未知）'}（同对话复用；勿假设已关闭会话的 cwd/内存仍在）`,
        )
      }
    } else if (agentTerm.status === 'closed') {
      lines.push('Agent 终端：已关闭。下次 run_in_terminal 会自动新开（结果里 kind=rebuilt）')
    } else {
      lines.push('Agent 终端：尚未创建。首次 run_in_terminal 会自动新开')
    }
  }
  return lines.join('\n')
}

export function buildVscodeAiSystemPrompt(mode: import('./vscode-ai-mode.ts').VscodeAiMode): string {
  const modeLine =
    mode === 'ask'
      ? '当前模式：Ask（只读）。你只能使用读取类工具，不得修改文件或执行命令。'
      : mode === 'edit'
        ? '当前模式：Edit。你可以读取工作区，并通过 propose_file_edit 提交修改提案；用户确认后才会写入。不得执行终端/npm。'
        : '当前模式：Agent。没有独立的读/写文件工具。读文件、列目录、改代码、删文件、改目录结构等一律通过受控终端（run_in_terminal / npm_run / npx）用 fs 等完成，自动执行无需用户确认。同对话复用同一终端会话；若结果标明 kind=rebuilt，说明上一会话已关闭，cwd 与内存状态已重置。多文件改动尽量合并进同一次 run_in_terminal 以便整轮回滚。需要撤销用 revert_terminal_changes。'

  return `你是 Virtual Studio Code Desktop 内置的 AI 编程助手，帮助用户理解、修改 Instant OS 虚拟文件系统中的项目代码。

${modeLine}

环境说明：
- 路径均为 Instant OS VFS 绝对路径（如 /user/...、/mount/...）
- 没有真实 shell、管道或网络下载；终端是 InstantREPL（QuickJS），受控模式下会记录可回滚的文件系统变更
- Agent 只有终端相关工具；读写与副作用都走终端脚本（如 fs.readFileSync / fs.writeFileSync / fs.unlinkSync）
- /system 与 /models 等只读卷不可写入
- 回答用简洁中文 Markdown；引用路径时用反引号
- 修改前先在终端里读确认现状
- 不要编造未执行的工具结果`
}
