import { defineTool, type AgentTool } from '../../ai/agent-tool.ts'
import {
  filesCreateText,
  filesMkdir,
  filesStat,
  filesWriteText,
} from '../files/files-api.ts'
import type { VscodeAiMode } from './vscode-ai-mode.ts'
import type { VscodeAiContextInput } from './vscode-ai-context.ts'
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

export type VscodeAiToolsHost = {
  getContext: () => VscodeAiContextInput
  runCommandHost: VscodeAiRunCommandHost
  /** Plan 模式写完计划后打开文件 */
  openPlanFile?: (path: string) => Promise<void>
}

export function createVscodeAiTools(
  mode: VscodeAiMode,
  host: VscodeAiToolsHost,
): AgentTool[] {
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

  const agentRunTools: AgentTool[] =
    mode === 'agent'
      ? [
          defineTool({
            name: 'run_in_terminal',
            description:
              '在本对话绑定的受控终端执行一段 JavaScript（自动执行，无需确认）。同对话复用同一终端；若用户已关闭该终端会自动新开并在结果中标明 rebuilt。读/写/删/建文件用 fs；搜索文本用 globalThis.instant.grep(...)；打开应用/路径/URL 或操纵窗口用 globalThis.instant（openApp / openPath / openUrl / listApps / focus / close 等）；打开/读取/操作真实网页用 globalThis.webview（先 listUnits，有则 navigate/openTab 复用，否则 create → wait → snapshot / markdown / eval + __vcRef；默认离屏 960×720，show 仅当用户要求可见，可用 hide 收回；navigate 等，详见壳层）。大文本可写 os.tmpdir()；工具返回超过约 16000 字符（16K）时会自动 spill 到 tmp 并预览开头；后续可用 instant.grep 或 fs.slice 分段读取。多文件改动尽量合并进同一次执行以便整轮回滚。必须传 description（短句说明本步意图，供界面展示）。',
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
  return agentRunTools
}

export const VSCODE_AI_TOOL_LABELS: Record<string, string> = {
  write_plan: '写入计划',
  run_in_terminal: '使用终端',
  npm_run: '运行 npm script',
  npx: '运行 npx',
  get_terminal_changes: '查看终端变更',
  revert_terminal_changes: '撤销终端变更',
  compact_context: '压缩上下文',
  delegate_subagent: '委派 Sub Agent',
}
