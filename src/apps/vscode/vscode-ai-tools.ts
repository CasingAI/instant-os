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
import {
  resolveSwitchModeTarget,
  VSCODE_AI_MODE_LABELS,
  VSCODE_AI_SWITCH_MODE_TARGETS,
} from './vscode-ai-mode.ts'
import type { VscodeAiContextInput } from './vscode-ai-context.ts'
import {
  assertVscodePlanPath,
  resolveVscodePlansDir,
  validatePlanMarkdown,
  VSCODE_AI_PLAN_FORMAT_HINT,
  VSCODE_AI_PLAN_MARKDOWN_SKELETON,
} from './vscode-ai-plan.ts'
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
  /** 当前主 Agent 模式（续跑循环中可变）；缺省时用 createVscodeAiTools 的 mode 参数 */
  getCurrentMode?: () => VscodeAiMode
  /**
   * 用户确认是否切换模式。
   * approved 时宿主应同步 UI prefs；agent 层会 stopRun 并以新模式续跑。
   */
  requestModeSwitch?: (input: {
    target: VscodeAiMode
    explanation?: string
  }) => Promise<'approved' | 'denied'>
  /** 同意切换后写入目标模式，供续跑循环读取 */
  setPendingModeSwitch?: (target: VscodeAiMode | undefined) => void
}

export function createVscodeAiTools(
  mode: VscodeAiMode,
  host: VscodeAiToolsHost,
): AgentTool[] {
  const allowedTargets = VSCODE_AI_SWITCH_MODE_TARGETS[mode]
  const switchModeTools: AgentTool[] =
    allowedTargets.length > 0 && host.requestModeSwitch
      ? [
          defineTool({
            name: 'switch_mode',
            description:
              `请求切换 AI 模式（需用户确认）。当前为 ${VSCODE_AI_MODE_LABELS[mode]}，可切到：${allowedTargets
                .map((item) => `${item}（${VSCODE_AI_MODE_LABELS[item]}）`)
                .join('、')}。` +
              '复杂/多方案/架构决策切 Plan；计划就绪或需改代码切 Agent。' +
              '同意后本轮会结束并以新模式自动续跑；拒绝则继续当前模式。',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['target_mode_id'],
              properties: {
                target_mode_id: {
                  type: 'string',
                  enum: [...allowedTargets],
                  description: `目标模式：${allowedTargets.join(' | ')}`,
                },
                explanation: {
                  type: 'string',
                  description: '简短说明为何切换（展示给用户确认）',
                },
              },
            },
            execute: async (args) => {
              const current = host.getCurrentMode?.() ?? mode
              const resolved = resolveSwitchModeTarget(current, args.target_mode_id)
              if (!resolved.ok) {
                return resolved.error
              }
              const explanation =
                typeof args.explanation === 'string' ? args.explanation.trim() : ''
              const request = host.requestModeSwitch
              if (!request) {
                return '当前环境不支持切换模式。'
              }
              const decision = await request({
                target: resolved.target,
                explanation: explanation || undefined,
              })
              if (decision !== 'approved') {
                return `用户拒绝切换到 ${VSCODE_AI_MODE_LABELS[resolved.target]}，请继续当前模式（${VSCODE_AI_MODE_LABELS[current]}）。`
              }
              host.setPendingModeSwitch?.(resolved.target)
              return {
                content: `已切换到 ${VSCODE_AI_MODE_LABELS[resolved.target]}。将以新模式继续处理。`,
                stopRun: true,
              }
            },
          }),
        ]
      : []

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
                notifyTerminal: (message) => {
                  host.runCommandHost.getAgentTerminalHandle()?.appendInfo(message)
                },
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
              '将完整计划 Markdown 写入工作区临时容器 /tmp/Workspace/{hash}/vscode/plans/ 并打开该文件（不在工作区 Git 内，不污染 git status）。这是 Plan 模式唯一允许的写出口；不要用终端写文件。' +
              VSCODE_AI_PLAN_FORMAT_HINT +
              '选定一种方案写死。骨架示例：\n' +
              VSCODE_AI_PLAN_MARKDOWN_SKELETON,
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
                  description:
                    '完整 Markdown 计划正文。' +
                    VSCODE_AI_PLAN_FORMAT_HINT +
                    '示例：\n' +
                    VSCODE_AI_PLAN_MARKDOWN_SKELETON,
                },
              },
            },
            execute: async (args) => {
              const workspace = host.getContext().workspaceFolder?.trim()
              if (!workspace) {
                throw new Error('未打开工作区文件夹，无法写入计划。请先打开文件夹。')
              }
              const appRoot = workspaceAppTmpDir(workspace, 'vscode')
              const plansRoot = resolveVscodePlansDir(workspace)
              const slug = slugifyPlanName(asString(args.name))
              const shortId = Math.random().toString(36).slice(2, 8)
              const path = `${plansRoot}/${slug}-${shortId}.md`
              assertVscodePlanPath(path, workspace)
              const markdown = asString(args.markdown)
              validatePlanMarkdown(markdown)
              await ensureParentDirs(path)
              await ensureWorkspaceMeta(appRoot, workspace)
              const existing = await filesStat(path)
              if (existing) {
                await filesWriteText(path, markdown)
              } else {
                await filesCreateText(path, markdown)
              }
              try {
                await host.openPlanFile?.(path)
              } catch {
                // 打开失败不影响落盘成功
              }
              return `已写入计划并打开：${path}`
            },
          }),
        ]
      : []

  const planUpdateTools: AgentTool[] =
    mode === 'agent'
      ? [
          defineTool({
            name: 'update_plan',
            description:
              '覆盖更新已有计划 Markdown（/tmp/Workspace/{hash}/vscode/plans/*.md）。' +
              '实施计划时每完成一项 Todo，调用本工具将对应 `- [ ]` 改为 `- [x]`，并传入完整文件内容；保持其余正文稳定。' +
              VSCODE_AI_PLAN_FORMAT_HINT +
              '不要用终端写计划文件。',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['path', 'markdown'],
              properties: {
                path: {
                  type: 'string',
                  description: '计划绝对路径（须为当前工作区 vscode/plans 下的 .md）',
                },
                markdown: {
                  type: 'string',
                  description:
                    '完整 Markdown 计划正文（含已勾选进度）。' + VSCODE_AI_PLAN_FORMAT_HINT,
                },
              },
            },
            execute: async (args) => {
              const workspace = host.getContext().workspaceFolder?.trim()
              if (!workspace) {
                throw new Error('未打开工作区文件夹，无法更新计划。请先打开文件夹。')
              }
              const path = assertVscodePlanPath(asString(args.path), workspace)
              const markdown = asString(args.markdown)
              validatePlanMarkdown(markdown)
              const existing = await filesStat(path)
              if (!existing || existing.kind !== 'file') {
                throw new Error(
                  `计划文件不存在：${path}。请先用 Plan 模式 write_plan 生成计划。`,
                )
              }
              await filesWriteText(path, markdown)
              return `已更新计划：${path}`
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
                notifyTerminal: (message) => {
                  host.runCommandHost.getAgentTerminalHandle()?.appendInfo(message)
                },
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

  if (mode === 'ask') return [...switchModeTools, ...askRunTools]
  if (mode === 'plan') return [...switchModeTools, ...askRunTools, ...planWriteTools]
  return [...switchModeTools, ...agentRunTools, ...planUpdateTools]
}

export const VSCODE_AI_TOOL_LABELS: Record<string, string> = {
  switch_mode: '切换模式',
  write_plan: '写入计划',
  update_plan: '更新计划',
  run_in_terminal: '使用终端',
  npm_run: '运行 npm script',
  npx: '运行 npx',
  get_terminal_changes: '查看终端变更',
  revert_terminal_changes: '撤销终端变更',
  compact_context: '压缩上下文',
  delegate_subagent: '委派 Sub Agent',
  followup_subagent: '追问 Sub Agent',
}
