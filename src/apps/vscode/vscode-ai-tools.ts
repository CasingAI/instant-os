import { defineTool, type AgentTool } from '../../ai/agent-tool.ts'
import {
  filesCreateText,
  filesMkdir,
  filesStat,
  filesWriteText,
} from '../files/files-api.ts'
import { workspaceAppTmpDir, workspaceTmpRoot } from '../files/files-tmp.ts'
import { osNowMs } from '../../os/os-clock.ts'
import type { TerminalReplHandle } from '../terminal/terminal-repl-panel.tsx'
import type { VscodeAiMode } from './vscode-ai-mode.ts'
import type { VscodeAiContextInput } from './vscode-ai-context.ts'
import type {
  VscodeAiRunCommandHost,
  VscodeAgentTerminalEnsureResult,
} from './vscode-ai-run-command.ts'
import {
  getVscodeAiLastChangeSet,
  revertVscodeAiLastChanges,
  runVscodeAiNpmScript,
  runVscodeAiNpx,
  runVscodeAiTerminalLine,
} from './vscode-ai-run-command.ts'
import {
  runVscodeAiGithubClone,
  runVscodeAiGithubCommit,
  runVscodeAiGithubDiff,
  runVscodeAiGithubDiscard,
  runVscodeAiGithubFetch,
  runVscodeAiGithubLog,
  runVscodeAiGithubPull,
  runVscodeAiGithubPush,
  runVscodeAiGithubStatus,
  runVscodeAiGithubSwitchBranch,
} from './vscode-ai-github.ts'
import { maybeSpillToolOutput } from './vscode-ai-output-spill.ts'
import { formatTerminalChangeSummary } from '../../terminal/terminal-changeset.ts'
import type {
  VscodeAgentTerminalSnapshot,
  VscodeAiTerminalKind,
} from './vscode-terminal-sessions.ts'

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

/**
 * 确保工作区容器元信息存在并刷新访问时间：
 * - config.json（容器根）：{ workspace, createdAt }，仅首次创建
 * - meta.json（应用分区）：{ createdAt, lastAccess }，每次写入刷新 lastAccess
 */
async function ensureWorkspaceMeta(appRoot: string, workspace: string): Promise<void> {
  const configPath = `${workspaceTmpRoot(workspace)}/config.json`
  await ensureParentDirs(configPath)
  await ensureParentDirs(`${appRoot}/meta.json`)
  const now = osNowMs()
  const configExisting = await filesStat(configPath)
  if (!configExisting) {
    await filesCreateText(
      configPath,
      JSON.stringify({ workspace, createdAt: now }, null, 2),
    )
  }

  const metaPath = `${appRoot}/meta.json`
  const metaExisting = await filesStat(metaPath)
  if (metaExisting) {
    await filesWriteText(
      metaPath,
      JSON.stringify(
        { createdAt: metaExisting.updatedAt ?? now, lastAccess: now },
        null,
        2,
      ),
    )
  } else {
    await filesCreateText(
      metaPath,
      JSON.stringify({ createdAt: now, lastAccess: now }, null, 2),
    )
  }
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
  /** 主聊天 sessionId；Sub Agent 终端以之为 parentChatId */
  chatSessionId?: string
  ensureAiTerminal?: (
    kind: VscodeAiTerminalKind,
    ownerId: string,
    title: string,
    options?: { parentChatId?: string },
  ) => Promise<VscodeAgentTerminalEnsureResult>
  getAiTerminalHandle?: (
    kind: VscodeAiTerminalKind,
    ownerId: string,
  ) => TerminalReplHandle | undefined
  getAiTerminalSnapshot?: (
    kind: VscodeAiTerminalKind,
    ownerId: string,
  ) => VscodeAgentTerminalSnapshot
  closeAiTerminal?: (kind: VscodeAiTerminalKind, ownerId: string) => void
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
              '将完整计划 Markdown 写入工作区临时容器 /tmp/Workspace/{hash}/vscode/plans/ 并打开该文件（不在工作区 Git 内，不污染 git status）。这是 Plan 模式唯一允许的写出口；不要用终端写文件。正文须含 # 标题、overview、实现要点、todos checklist；选定一种方案写死。',
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
              const appRoot = workspaceAppTmpDir(workspace, 'vscode')
              const plansRoot = `${appRoot}/plans`
              const slug = slugifyPlanName(asString(args.name))
              const shortId = Math.random().toString(36).slice(2, 8)
              const path = `${plansRoot}/${slug}-${shortId}.md`
              if (!path.startsWith('/tmp/Workspace/')) {
                throw new Error('计划路径不合法')
              }
              const markdown = asString(args.markdown)
              if (!markdown.trim()) {
                throw new Error('计划内容为空')
              }
              await ensureParentDirs(path)
              await ensureWorkspaceMeta(appRoot, workspace)
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

  const githubReadTools: AgentTool[] = [
    defineTool({
      name: 'github_status',
      description:
        '查看当前工作区对应的 GitHub 工作树状态（非真实 git；路径须为 /dev/github/{owner}/{repo}）。只读。受终端 FS 模式约束。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      execute: async () => runVscodeAiGithubStatus(host.runCommandHost),
    }),
    defineTool({
      name: 'github_diff',
      description: '查看 GitHub 工作树相对已 commit 基线的文件差异（可传 path）。只读。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: '仓库内相对路径；省略则预览多个变更文件' },
        },
      },
      execute: async (args) => {
        const path = asString(args.path).trim() || undefined
        return runVscodeAiGithubDiff(host.runCommandHost, path)
      },
    }),
    defineTool({
      name: 'github_log',
      description: '查看本地/缓存的 commit 历史与分支列表。只读。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          limit: { type: 'number', description: '条数上限，默认 20，最大 50' },
        },
      },
      execute: async (args) => {
        const limit =
          typeof args.limit === 'number' && Number.isFinite(args.limit) ? args.limit : undefined
        return runVscodeAiGithubLog(host.runCommandHost, limit)
      },
    }),
  ]

  const githubWriteTools: AgentTool[] =
    mode === 'agent'
      ? [
          defineTool({
            name: 'github_clone',
            description:
              '克隆 GitHub 仓库到 /dev/github/{owner}/{repo}（zipball + API；需 PAT 与代理）。只读终端会拒绝。',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                url: { type: 'string', description: 'github.com HTTPS 或 SSH URL' },
                owner: { type: 'string' },
                repo: { type: 'string' },
                branch: { type: 'string' },
              },
            },
            execute: async (args) =>
              runVscodeAiGithubClone(host.runCommandHost, {
                url: asString(args.url).trim() || undefined,
                owner: asString(args.owner).trim() || undefined,
                repo: asString(args.repo).trim() || undefined,
                branch: asString(args.branch).trim() || undefined,
              }),
          }),
          defineTool({
            name: 'github_commit',
            description:
              '本地 commit 工作树变更（不调用 GitHub 直到 push）。须 all:true 或提供 paths；无 git add 暂存区。',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['message'],
              properties: {
                message: { type: 'string' },
                paths: { type: 'array', items: { type: 'string' } },
                all: { type: 'boolean', description: '提交全部变更' },
              },
            },
            execute: async (args) => {
              const paths =
                Array.isArray(args.paths) && args.paths.every((item) => typeof item === 'string')
                  ? (args.paths as string[])
                  : undefined
              return runVscodeAiGithubCommit(host.runCommandHost, {
                message: asString(args.message),
                paths,
                all: args.all === true,
              })
            },
          }),
          defineTool({
            name: 'github_push',
            description: '将未推送的本地 commit 推到 GitHub 远端分支。',
            parameters: { type: 'object', additionalProperties: false, properties: {} },
            execute: async () => runVscodeAiGithubPush(host.runCommandHost),
          }),
          defineTool({
            name: 'github_pull',
            description: '拉取远端并更新工作树（有未 commit 变更时会失败）。',
            parameters: { type: 'object', additionalProperties: false, properties: {} },
            execute: async () => runVscodeAiGithubPull(host.runCommandHost),
          }),
          defineTool({
            name: 'github_fetch',
            description: '刷新远端分支与历史缓存，不改工作树。只读终端会拒绝。',
            parameters: { type: 'object', additionalProperties: false, properties: {} },
            execute: async () => runVscodeAiGithubFetch(host.runCommandHost),
          }),
          defineTool({
            name: 'github_switch_branch',
            description: '切换分支（有未 commit 变更时会失败）。',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['branch'],
              properties: { branch: { type: 'string' } },
            },
            execute: async (args) =>
              runVscodeAiGithubSwitchBranch(host.runCommandHost, asString(args.branch)),
          }),
          defineTool({
            name: 'github_discard',
            description: '丢弃工作树中指定路径的未 commit 变更（还原到当前 tip 基线）。',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['paths'],
              properties: {
                paths: { type: 'array', items: { type: 'string' } },
              },
            },
            execute: async (args) => {
              const paths =
                Array.isArray(args.paths) && args.paths.every((item) => typeof item === 'string')
                  ? (args.paths as string[])
                  : []
              return runVscodeAiGithubDiscard(host.runCommandHost, paths)
            },
          }),
        ]
      : []

  if (mode === 'ask') return [...askRunTools, ...githubReadTools]
  if (mode === 'plan') return [...askRunTools, ...planWriteTools, ...githubReadTools]
  return [...agentRunTools, ...githubReadTools, ...githubWriteTools]
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
  followup_subagent: '追问 Sub Agent',
  github_status: 'GitHub 状态',
  github_diff: 'GitHub 差异',
  github_log: 'GitHub 历史',
  github_clone: '克隆仓库',
  github_commit: '提交',
  github_push: '推送',
  github_pull: '拉取',
  github_fetch: 'Fetch',
  github_switch_branch: '切换分支',
  github_discard: '丢弃变更',
}
