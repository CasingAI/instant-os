import type { MonacoProblem } from '../../monaco/monaco-markers.ts'
import { buildInstantShellSystemPromptSection } from '../../terminal/instant-shell/instant-shell-prompt.ts'
import type { VscodeTab } from './vscode-tabs.ts'
import {
  VSCODE_AI_PLAN_FORMAT_HINT,
  VSCODE_AI_PLAN_MARKDOWN_SKELETON,
} from './vscode-ai-plan.ts'
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
      const tmpSuffix = aiTerm.tmpdir ? ` tmpdir=${aiTerm.tmpdir}` : ''
      if (aiTerm.recovering) {
        lines.push(
          `${label} 终端：session=${aiTerm.sessionId} 会话存在，正在恢复；cwd=${aiTerm.cwd ?? '（未知）'}${tmpSuffix}（同对话复用；勿假设已关闭会话的 cwd/内存/旧 tmpdir 仍在）`,
        )
      } else {
        lines.push(
          `${label} 终端：session=${aiTerm.sessionId} cwd=${aiTerm.cwd ?? '（未知）'}${tmpSuffix}（同对话复用；勿假设已关闭会话的 cwd/内存/旧 tmpdir 仍在）`,
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
      ? '当前模式：Ask（只读）。只能用 run_in_terminal 在只读终端中读取；写/删/建文件与 npm/npx / GitHub 写操作均不可用。可用 github_status / github_diff / github_log 只读查看。回答用简洁中文。'
      : mode === 'plan'
        ? [
            '当前模式：Plan（只读协作规划）。不得修改业务代码或运行 npm/npx / GitHub 写操作。',
            '用 run_in_terminal（只读）与 github_status / github_diff / github_log 调研；唯一写出口是 write_plan（写入工作区临时容器 /tmp/Workspace/{hash}/vscode/plans/*.md 并打开，不污染工作区 Git）。',
            '需求不清时先问 1–2 个关键问题，再写计划。信息足够后必须调用 write_plan 落盘，不要只用聊天长文替代。',
            '计划须具体可执行：选定一种方案写死，禁止 Option A/B、TBD、「视情况」。',
            VSCODE_AI_PLAN_FORMAT_HINT,
            '复杂时可用 mermaid。骨架示例：',
            VSCODE_AI_PLAN_MARKDOWN_SKELETON,
            '写完计划即可结束本轮，不要开始改业务代码。',
          ].join(' ')
        : [
            '当前模式：Agent。读写与副作用一律走受控终端（run_in_terminal / npm_run / npx）或 GitHub 工具（github_*）；调用 run_in_terminal 须带 description。多文件改动尽量合并同一次执行以便回滚。需要打开应用、文件、URL 或操纵窗口时用 globalThis.instant；需要打开/读取/操作真实网页时用 globalThis.webview（见下方壳层 API）。',
            '若用户要求按 /tmp/Workspace/.../vscode/plans/*.md 实施：先读取该计划；每完成一项 Todo，调用 update_plan 将对应 `- [ ]` 改为 `- [x]` 并传入完整文件内容，保持其余正文稳定；不要只用终端改计划文件，也不要只改代码不更新计划。',
          ].join(' ')

  const instantShellSection = `\n\n${buildInstantShellSystemPromptSection()}`

  const envLines =
    mode === 'ask' || mode === 'plan'
      ? [
          '- 路径均为 Instant OS VFS 绝对路径（如 /user/...、/mount/...）；可读任意卷内路径，写入仅限当前工作区',
          '- 没有真实 shell、管道或网络下载；终端是 InstantREPL（QuickJS），只读模式下工作区写操作会被拒绝',
          '- 无真实 git：可用 github_status / github_diff / github_log 只读查看 /dev/github/... 工作树；写操作不可用',
          '- os.tmpdir() / process.env.TMPDIR 指向 session 级临时目录（/tmp/Terminal/{id}）；只读模式下仍可写该目录',
          '- 工作区级临时容器：/tmp/Workspace/{hash}/（config.json 记录 workspace 路径；各应用有独立子目录，如 vscode/plans/）；Ask/Plan/Agent 终端均可读写该目录',
          '- 终端工具返回超过约 16000 字符（16K）时会自动 spill 到 tmp 并预览开头；完整文件可用 fs 或 instant.grep 自行检索/分段读取',
          '- 终端 rebuild / 撤销改动后勿假设旧 tmpdir 或内存变量仍有效；以 banner / 上下文中的新 session、tmpdir 为准',
          mode === 'plan'
            ? '- Plan：run_in_terminal 只读调研（搜索用 instant.grep）；唯一落盘出口是 write_plan（/tmp/Workspace/{hash}/vscode/plans/*.md）；Todos 必须用 GFM `- [ ]` 复选框'
            : '- Ask 只有 run_in_terminal；用终端脚本读取（如 fs.readFileSync / fs.readdirSync），搜索用 instant.grep；不要尝试写入工作区',
          '- /system 与 /models 等只读卷不可写入',
          '- 回答用简洁中文 Markdown；引用路径时用反引号',
          '- 不要编造未执行的工具结果',
        ]
      : [
          '- 路径均为 Instant OS VFS 绝对路径（如 /user/...、/mount/...）；可读任意卷内路径，写入仅限当前工作区',
          '- 没有真实 shell、管道或网络下载；终端是 InstantREPL（QuickJS），受控模式下会记录可回滚的文件系统变更',
          '- Agent 有终端相关工具、GitHub 工具与 update_plan；读写与副作用主要走终端脚本（如 fs.readFileSync / fs.writeFileSync / fs.unlinkSync）或 github_*；计划进度回写用 update_plan（勿用终端改 plans/*.md）',
          '- 无真实 git：GitHub 工作树在 /dev/github/{owner}/{repo}；用 github_status / github_commit / github_push 等工具（与 GitHub Desktop 同一套 API 同步）。终端只读模式下写操作会被门面拒绝',
          '- os.tmpdir() / process.env.TMPDIR 指向 session 级临时目录（/tmp/Terminal/{id} 或 npm 的 /tmp/Npm/{id}）；大文本可写该目录（不进 ChangeSet）',
          '- 终端 / npm 工具返回超过约 16000 字符（16K）时会自动 spill 到 tmp 并预览开头；完整文件可用 fs 或 instant.grep 自行检索/分段读取',
          '- 终端 rebuild / 撤销改动后勿假设旧 tmpdir 或内存变量仍有效；以 banner / 上下文中的新 session、tmpdir 为准',
          '- 搜索代码优先 await instant.grep(query, { path })，不要手写 fs 递归搜索',
          '- 需要抓取或操作真实网页时，在 run_in_terminal 里先 listUnits：有 unit 则 navigate/openTab 复用，否则 create；再 wait → snapshot（看结构与 [eN]）→ markdown / eval+__vcRef（默认离屏 960×720，勿仅为确认加载而 show；用户要看再用 show，看完可 hide；用完可 destroy）；不要臆造网页内容，不要整页 innerText',
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
