import { defineTool, type AgentTool } from '../../ai/agent-tool.ts'
import {
  filesCreateText,
  filesList,
  filesMkdir,
  filesReadText,
  filesStat,
  filesWriteText,
} from '../files/files-api.ts'
import { osNowMs } from '../../os/os-clock.ts'
import type { VscodeAiMode } from './vscode-ai-mode.ts'
import {
  isPathAllowedForAiRead,
  isPathAllowedForWrite,
  type VscodeAiContextInput,
} from './vscode-ai-context.ts'
import { searchVfsText } from '../files/vfs-text-search.ts'
import {
  matchVscodeOpenFiles,
  type VscodeWorkspaceSearchOpenFile,
} from './vscode-workspace-search.ts'
import type { MonacoProblem } from '../../monaco/monaco-markers.ts'
import type { VscodeAiPendingEdit } from './vscode-ai-chat-storage.ts'
import type { VscodeAiRunCommandHost } from './vscode-ai-run-command.ts'
import {
  getVscodeAiLastChangeSet,
  revertVscodeAiLastChanges,
  runVscodeAiNpmScript,
  runVscodeAiNpx,
  runVscodeAiTerminalLine,
} from './vscode-ai-run-command.ts'
import { maybeSpillToolOutput } from './vscode-ai-output-spill.ts'
import { formatTerminalChangeSummary } from '../../terminal/terminal-changeset.ts'

const MAX_READ_CHARS = 48_000

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function slugifyPlanName(name: string): string {
  const raw = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return raw || 'plan'
}

async function ensureParentDirs(absolutePath: string): Promise<void> {
  const parts = absolutePath.split('/').filter(Boolean)
  let current = ''
  for (let i = 0; i < parts.length - 1; i += 1) {
    current += `/${parts[i]}`
    const existing = await filesStat(current)
    if (existing) {
      if (existing.kind !== 'folder') {
        throw new Error(`路径冲突：${current} 不是文件夹`)
      }
      continue
    }
    await filesMkdir(current)
  }
}

function formatEntryLine(entry: {
  path: string
  name: string
  kind: 'file' | 'folder' | 'symlink'
  byteSize: number
  writable: boolean
}): string {
  const kind =
    entry.kind === 'folder' ? 'dir' : entry.kind === 'symlink' ? 'link' : 'file'
  const mode = entry.writable ? 'rw' : 'ro'
  const size = entry.kind === 'folder' ? '-' : String(entry.byteSize)
  return `${kind}\t${mode}\t${size}\t${entry.name}`
}

function sliceLines(text: string, startLine?: number, endLine?: number): string {
  const lines = text.split('\n')
  const start = startLine !== undefined ? Math.max(1, Math.floor(startLine)) : 1
  const end =
    endLine !== undefined ? Math.min(lines.length, Math.floor(endLine)) : lines.length
  if (start > end) return ''
  return lines.slice(start - 1, end).join('\n')
}

export type VscodeAiToolsHost = {
  getContext: () => VscodeAiContextInput
  getProblems: () => readonly MonacoProblem[]
  getOpenFilesForSearch: () => VscodeWorkspaceSearchOpenFile[]
  onProposeEdit: (edit: VscodeAiPendingEdit) => void
  runCommandHost: VscodeAiRunCommandHost
  /** Plan 模式写完计划后打开文件 */
  openPlanFile?: (path: string) => Promise<void>
}

export function createVscodeAiTools(
  mode: VscodeAiMode,
  host: VscodeAiToolsHost,
): AgentTool[] {
  const resolveReadPath = (raw: string) => {
    const path = raw.trim()
    if (!isPathAllowedForAiRead(path)) {
      throw new Error(`路径不在虚拟文件系统可读范围内: ${path}`)
    }
    return path
  }

  const resolveWritePath = (raw: string) => {
    const path = raw.trim()
    if (!isPathAllowedForWrite(path, host.getContext())) {
      throw new Error(`路径不在允许写入范围内: ${path}`)
    }
    return path
  }

  const readTools: AgentTool[] = [
    defineTool({
      name: 'get_workspace_info',
      description: '获取工作区根路径、已打开文件、活动文件与光标/选区摘要',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      execute: async () => {
        const ctx = host.getContext()
        const lines = [
          `workspace: ${ctx.workspaceFolder ?? '（无）'}`,
          `active: ${ctx.activeTabId ? ctx.tabs.find((t) => t.id === ctx.activeTabId)?.path : '无'}`,
          `cursor: L${ctx.editor.cursorLine} C${ctx.editor.cursorColumn}`,
        ]
        for (const tab of ctx.tabs) {
          if (tab.binaryPrompt) continue
          lines.push(`open: ${tab.path}`)
        }
        return lines.join('\n')
      },
    }),
    defineTool({
      name: 'list_dir',
      description: '列出目录内容',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: { path: { type: 'string' } },
      },
      execute: async (args) => {
        const path = resolveReadPath(asString(args.path))
        const entries = await filesList(path)
        if (entries.length === 0) return '(空目录)'
        return entries.map(formatEntryLine).join('\n')
      },
    }),
    defineTool({
      name: 'stat_path',
      description: '查询路径类型、大小、可写性',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: { path: { type: 'string' } },
      },
      execute: async (args) => {
        const path = resolveReadPath(asString(args.path))
        const entry = await filesStat(path)
        if (!entry) return `不存在: ${path}`
        return [
          `path: ${entry.path}`,
          `kind: ${entry.kind}`,
          `size: ${entry.byteSize}`,
          `writable: ${entry.writable}`,
        ].join('\n')
      },
    }),
    defineTool({
      name: 'read_file',
      description: '读取文本文件；可用 start_line / end_line（1-based，含两端）读取片段',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { type: 'string' },
          start_line: { type: 'number' },
          end_line: { type: 'number' },
        },
      },
      execute: async (args) => {
        const path = resolveReadPath(asString(args.path))
        const ctx = host.getContext()
        const openTab = ctx.tabs.find((tab) => tab.path === path && !tab.binaryPrompt)
        const full = openTab ? openTab.text : await filesReadText(path)
        const startLine =
          typeof args.start_line === 'number' ? Math.floor(args.start_line) : undefined
        const endLine = typeof args.end_line === 'number' ? Math.floor(args.end_line) : undefined
        const slice =
          startLine !== undefined || endLine !== undefined
            ? sliceLines(full, startLine, endLine)
            : full
        if (slice.length > MAX_READ_CHARS) {
          return `${slice.slice(0, MAX_READ_CHARS)}\n…（已截断，请分段读取）`
        }
        return slice
      },
    }),
    defineTool({
      name: 'grep_workspace',
      description: '在工作区中搜索文本（尊重 gitignore 与默认排除）',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: {
          query: { type: 'string' },
          files_to_include: { type: 'string' },
        },
      },
      execute: async (args) => {
        const query = asString(args.query).trim()
        if (!query) return 'query 为空'
        const ctx = host.getContext()
        if (!ctx.workspaceFolder) return '无匹配'
        const openFiles = host.getOpenFilesForSearch()
        const openHits = matchVscodeOpenFiles(query, openFiles, {
          isCaseSensitive: false,
          isRegex: false,
          matchWholeWord: false,
          workspaceFolder: ctx.workspaceFolder,
        }).hits
        const skipPaths = new Set(openFiles.map((file) => file.path))
        const workspaceResult = await searchVfsText({
          query,
          rootPath: ctx.workspaceFolder,
          skipPaths,
          isCaseSensitive: false,
          isRegex: false,
          matchWholeWord: false,
          useExcludeSettingsAndIgnoreFiles: true,
          filesToInclude: asString(args.files_to_include) || undefined,
          maxMatches: 80,
        })
        const hits = [
          ...openHits.map((hit) => ({
            path: hit.path,
            line: hit.line,
            column: hit.column,
            preview: hit.preview,
          })),
          ...workspaceResult.matches.map((match) => ({
            path: match.path,
            line: match.line,
            column: match.column,
            preview: match.preview,
          })),
        ].slice(0, 80)
        if (hits.length === 0) return '无匹配'
        return hits
          .map((hit) => `${hit.path}:${hit.line}:${hit.column}\t${hit.preview}`)
          .join('\n')
      },
    }),
    defineTool({
      name: 'list_problems',
      description: '列出当前编辑器 Problems（错误/警告）',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: '可选，限定文件路径' },
        },
      },
      execute: async (args) => {
        const filterPath = asString(args.path).trim()
        const problems = host.getProblems().filter((problem) => {
          if (!filterPath) return true
          return problem.path === filterPath
        })
        if (problems.length === 0) return '无 Problems'
        return problems
          .slice(0, 60)
          .map(
            (problem) =>
              `${problem.severity}\t${problem.path ?? problem.resourceLabel}:${problem.startLineNumber}\t${problem.message}`,
          )
          .join('\n')
      },
    }),
  ]

  const askRunTools: AgentTool[] =
    mode === 'ask' || mode === 'plan'
      ? [
          defineTool({
            name: 'run_in_terminal',
            description:
              '在本对话绑定的只读终端执行一段 JavaScript（自动执行，无需确认）。同对话复用同一终端；若用户已关闭该终端会自动新开并在结果中标明 rebuilt。文件系统为只读：用 fs 读文件、列目录、stat 等；写/删/建会失败（EACCES），但可写 os.tmpdir()（session 临时目录）。搜索文本用 globalThis.instant.grep(...)。工具返回超过约 16000 字符（16K）时会自动 spill 到 tmp 并预览开头；后续可用 instant.grep 或 fs.slice 分段读取。必须传 description（短句说明本步意图，供界面展示）。',
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
                runTerminalLine: (cmd) =>
                  runVscodeAiTerminalLine(host.runCommandHost, cmd),
              })
            },
          }),
        ]
      : []

  const planWriteTools: AgentTool[] =
    mode === 'plan'
      ? [
          defineTool({
            name: 'write_plan',
            description:
              '将完整计划 Markdown 写入工作区 .vscode/plans/ 并打开该文件。这是 Plan 模式唯一允许的写出口；不要用终端写文件。正文须含 # 标题、overview、实现要点、todos checklist；选定一种方案写死。',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'markdown'],
              properties: {
                name: {
                  type: 'string',
                  description: '短名称（用于文件名 slug，英文或中文均可）',
                },
                markdown: {
                  type: 'string',
                  description: '完整 Markdown 计划正文',
                },
              },
            },
            execute: async (args) => {
              const workspace = host.getContext().workspaceFolder?.trim()
              if (!workspace) {
                throw new Error('未打开工作区文件夹，无法写入计划。请先打开文件夹。')
              }
              const slug = slugifyPlanName(asString(args.name))
              const shortId = Math.random().toString(36).slice(2, 8)
              const plansRoot = `${workspace.replace(/\/+$/, '')}/.vscode/plans`
              const path = `${plansRoot}/${slug}-${shortId}.md`
              if (!path.startsWith(`${plansRoot}/`)) {
                throw new Error('计划路径不合法')
              }
              const markdown = asString(args.markdown)
              if (!markdown.trim()) {
                throw new Error('计划内容为空')
              }
              await ensureParentDirs(path)
              const existing = await filesStat(path)
              if (existing) {
                await filesWriteText(path, markdown)
              } else {
                await filesCreateText(path, markdown)
              }
              if (host.openPlanFile) {
                await host.openPlanFile(path)
              }
              return `已写入计划并打开：${path}`
            },
          }),
        ]
      : []

  const editTools: AgentTool[] =
    mode === 'edit'
      ? [
          defineTool({
            name: 'propose_file_edit',
            description:
              '提交文件修改提案（完整新内容）。用户确认后才会写入磁盘；不要假设已生效。',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['path', 'text'],
              properties: {
                path: { type: 'string' },
                text: { type: 'string', description: '修改后的完整文件内容' },
              },
            },
            execute: async (args) => {
              const path = resolveWritePath(asString(args.path))
              const nextText = asString(args.text)
              const ctx = host.getContext()
              const openTab = ctx.tabs.find((tab) => tab.path === path && !tab.binaryPrompt)
              const previousText = openTab
                ? openTab.text
                : await filesReadText(path).catch(() => '')
              const edit: VscodeAiPendingEdit = {
                id: `vscode-edit-${osNowMs()}-${Math.random().toString(36).slice(2, 8)}`,
                path,
                previousText,
                nextText,
                status: 'pending',
              }
              host.onProposeEdit(edit)
              return `已提交修改提案：${path}（等待用户确认）`
            },
          }),
        ]
      : []

  const agentRunTools: AgentTool[] =
    mode === 'agent'
      ? [
          defineTool({
            name: 'run_in_terminal',
            description:
              '在本对话绑定的受控终端执行一段 JavaScript（自动执行，无需确认）。同对话复用同一终端；若用户已关闭该终端会自动新开并在结果中标明 rebuilt。读/写/删/建文件用 fs；搜索文本用 globalThis.instant.grep(...)；打开应用/路径/URL 或操纵窗口用 globalThis.instant（openApp / openPath / openUrl / listApps / focus / close 等）；打开/读取/操作真实网页用 globalThis.webview（create → wait → snapshot / markdown / eval + __vcRef / show / navigate 等，默认离屏）。大文本可写 os.tmpdir()；工具返回超过约 16000 字符（16K）时会自动 spill 到 tmp 并预览开头；后续可用 instant.grep 或 fs.slice 分段读取。多文件改动尽量合并进同一次执行以便整轮回滚。必须传 description（短句说明本步意图，供界面展示）。',
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
                runTerminalLine: (cmd) =>
                  runVscodeAiTerminalLine(host.runCommandHost, cmd),
              })
            },
          }),
          defineTool({
            name: 'npm_run',
            description: '在工作区以受控模式运行 package.json scripts（自动执行；改动可回滚）',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['script'],
              properties: {
                script: { type: 'string' },
                args: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
            execute: async (args) => {
              const script = asString(args.script).trim()
              const extra =
                Array.isArray(args.args) && args.args.every((item) => typeof item === 'string')
                  ? (args.args as string[])
                  : undefined
              return runVscodeAiNpmScript(host.runCommandHost, script, extra)
            },
          }),
          defineTool({
            name: 'npx',
            description: '在工作区以受控模式运行 npx（自动执行；改动可回滚）',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['package'],
              properties: {
                package: { type: 'string' },
                args: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
            execute: async (args) => {
              const pkg = asString(args.package).trim()
              const extra =
                Array.isArray(args.args) && args.args.every((item) => typeof item === 'string')
                  ? (args.args as string[])
                  : undefined
              return runVscodeAiNpx(host.runCommandHost, pkg, extra)
            },
          }),
          defineTool({
            name: 'get_terminal_changes',
            description: '查看最近一次受控终端 / npm / npx 执行产生的文件系统变更清单',
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
            description: '整轮回滚最近一次受控终端 / npm / npx 的文件系统改动（自动执行）',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: {},
            },
            execute: async () => revertVscodeAiLastChanges(host.runCommandHost),
          }),
        ]
      : []

  if (mode === 'ask') return askRunTools
  if (mode === 'plan') return [...askRunTools, ...planWriteTools]
  if (mode === 'edit') return [...readTools, ...editTools]
  return agentRunTools
}

export const VSCODE_AI_TOOL_LABELS: Record<string, string> = {
  get_workspace_info: '查看工作区',
  list_dir: '列出目录',
  stat_path: '查看路径',
  read_file: '读取文件',
  grep_workspace: '搜索工作区',
  list_problems: '查看问题',
  propose_file_edit: '提交修改提案',
  write_plan: '写入计划',
  run_in_terminal: '使用终端',
  npm_run: '运行 npm script',
  npx: '运行 npx',
  get_terminal_changes: '查看终端变更',
  revert_terminal_changes: '撤销终端变更',
  compact_context: '压缩上下文',
}
