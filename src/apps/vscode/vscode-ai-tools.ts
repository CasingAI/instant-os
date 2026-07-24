import { defineTool, type AgentTool } from '../../ai/agent-tool.ts'
import {
  filesCopy,
  filesCreateText,
  filesList,
  filesMkdir,
  filesMove,
  filesReadText,
  filesRename,
  filesStat,
  filesWriteText,
} from '../files/files-api.ts'
import {
  createTerminalPrivilegeId,
  type TerminalPrivilegeSource,
} from '../../terminal/terminal-privilege-types.ts'
import { runTerminalPrivilege } from '../../terminal/terminal-privilege.ts'
import { osNowMs } from '../../os/os-clock.ts'
import type { VscodeAiMode } from './vscode-ai-mode.ts'
import {
  collectAllowedReadRoots,
  isPathAllowedForRead,
  isPathAllowedForWrite,
  type VscodeAiContextInput,
} from './vscode-ai-context.ts'
import {
  matchVscodeOpenFiles,
  searchVscodeWorkspaceFilesDetailed,
  type VscodeWorkspaceSearchOpenFile,
} from './vscode-workspace-search.ts'
import type { MonacoProblem } from '../../monaco/monaco-markers.ts'
import type { VscodeAiPendingEdit } from './vscode-ai-chat-storage.ts'
import type { VscodeAiRunCommandHost } from './vscode-ai-run-command.ts'
import {
  runVscodeAiNpmScript,
  runVscodeAiNpx,
  runVscodeAiTerminalLine,
} from './vscode-ai-run-command.ts'

const MAX_READ_CHARS = 48_000

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
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
  privilegeSource?: TerminalPrivilegeSource
  privilegeActorLabel?: string
}

export function createVscodeAiTools(
  mode: VscodeAiMode,
  host: VscodeAiToolsHost,
): AgentTool[] {
  const privilegeSource = host.privilegeSource ?? 'user'
  const privilegeActorLabel = host.privilegeActorLabel?.trim() || 'VS Code AI'

  const resolveReadPath = (raw: string) => {
    const path = raw.trim()
    const allowed = collectAllowedReadRoots(host.getContext())
    if (!isPathAllowedForRead(path, allowed)) {
      throw new Error(`路径不在允许读取范围内: ${path}`)
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
        const openFiles = host.getOpenFilesForSearch()
        const openHits = matchVscodeOpenFiles(query, openFiles, {
          isCaseSensitive: false,
          isRegex: false,
          matchWholeWord: false,
          workspaceFolder: ctx.workspaceFolder,
        }).hits
        const skipPaths = new Set(openFiles.map((file) => file.path))
        const workspaceResult = await searchVscodeWorkspaceFilesDetailed({
          query,
          workspaceFolder: ctx.workspaceFolder,
          skipPaths,
          isCaseSensitive: false,
          isRegex: false,
          matchWholeWord: false,
          useExcludeSettingsAndIgnoreFiles: true,
          filesToInclude: asString(args.files_to_include) || undefined,
        })
        const hits = [...openHits, ...workspaceResult.hits].slice(0, 80)
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

  const agentWriteTools: AgentTool[] =
    mode === 'agent'
      ? [
          defineTool({
            name: 'write_file',
            description: '覆写已存在的文本文件',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['path', 'text'],
              properties: {
                path: { type: 'string' },
                text: { type: 'string' },
              },
            },
            execute: async (args) => {
              const path = resolveWritePath(asString(args.path))
              const entry = await filesWriteText(path, asString(args.text))
              return `已写入 ${entry.path} (${entry.byteSize} bytes)`
            },
          }),
          defineTool({
            name: 'create_file',
            description: '新建文本文件（路径不得已存在）',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['path'],
              properties: {
                path: { type: 'string' },
                text: { type: 'string' },
              },
            },
            execute: async (args) => {
              const path = resolveWritePath(asString(args.path))
              const entry = await filesCreateText(path, asString(args.text, ''))
              return `已创建 ${entry.path}`
            },
          }),
          defineTool({
            name: 'mkdir',
            description: '新建文件夹',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['path'],
              properties: { path: { type: 'string' } },
            },
            execute: async (args) => {
              const path = resolveWritePath(asString(args.path))
              const entry = await filesMkdir(path)
              return `已创建目录 ${entry.path}`
            },
          }),
          defineTool({
            name: 'rename',
            description: '在同一父目录下重命名',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['path', 'next_name'],
              properties: {
                path: { type: 'string' },
                next_name: { type: 'string' },
              },
            },
            execute: async (args) => {
              const path = resolveWritePath(asString(args.path))
              const entry = await filesRename(path, asString(args.next_name))
              return `已重命名为 ${entry.path}`
            },
          }),
          defineTool({
            name: 'move',
            description: '移动到目标目录',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['source', 'dest_dir'],
              properties: {
                source: { type: 'string' },
                dest_dir: { type: 'string' },
              },
            },
            execute: async (args) => {
              const source = resolveWritePath(asString(args.source))
              const destDir = resolveWritePath(asString(args.dest_dir))
              const entry = await filesMove(source, destDir)
              return `已移动到 ${entry.path}`
            },
          }),
          defineTool({
            name: 'copy',
            description: '复制到目标目录',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['source', 'dest_dir'],
              properties: {
                source: { type: 'string' },
                dest_dir: { type: 'string' },
              },
            },
            execute: async (args) => {
              const source = resolveReadPath(asString(args.source))
              const destDir = resolveWritePath(asString(args.dest_dir))
              const entry = await filesCopy(source, destDir)
              return `已复制到 ${entry.path}`
            },
          }),
          defineTool({
            name: 'remove',
            description: '删除文件或文件夹（会弹确认）',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['path'],
              properties: { path: { type: 'string' } },
            },
            execute: async (args) => {
              const path = resolveWritePath(asString(args.path))
              const entry = await filesStat(path)
              if (!entry) return `路径不存在: ${path}`
              const result = await runTerminalPrivilege({
                id: createTerminalPrivilegeId(),
                kind: 'fs.remove',
                source: privilegeSource,
                actorLabel: privilegeActorLabel,
                summary: '',
                args: {
                  fsPath: path,
                  fsKind: entry.kind === 'folder' ? 'folder' : 'file',
                },
              })
              if (result.cancelled) return '用户取消删除'
              return result.message
            },
          }),
        ]
      : []

  const agentRunTools: AgentTool[] =
    mode === 'agent'
      ? [
          defineTool({
            name: 'run_in_terminal',
            description: '在 VS Code 内嵌终端执行一行命令（需用户确认）',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['command'],
              properties: { command: { type: 'string' } },
            },
            execute: async (args) =>
              runVscodeAiTerminalLine(host.runCommandHost, asString(args.command)),
          }),
          defineTool({
            name: 'npm_run',
            description: '在工作区运行 package.json scripts（需用户确认）',
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
            description: '在工作区运行 npx（需用户确认）',
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
        ]
      : []

  if (mode === 'ask') return readTools
  if (mode === 'edit') return [...readTools, ...editTools]
  return [...readTools, ...agentWriteTools, ...agentRunTools]
}

export const VSCODE_AI_TOOL_LABELS: Record<string, string> = {
  get_workspace_info: '查看工作区',
  list_dir: '列出目录',
  stat_path: '查看路径',
  read_file: '读取文件',
  grep_workspace: '搜索工作区',
  list_problems: '查看问题',
  propose_file_edit: '提交修改提案',
  write_file: '写入文件',
  create_file: '新建文件',
  mkdir: '创建目录',
  rename: '重命名',
  move: '移动',
  copy: '复制',
  remove: '删除',
  run_in_terminal: '运行终端命令',
  npm_run: '运行 npm script',
  npx: '运行 npx',
}
