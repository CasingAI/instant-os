import type { TerminalReplHandle } from '../terminal/terminal-repl-panel.tsx'
import { runNpmScript, runNpx } from '../../packages/package-public.ts'
import type { QuickJsEvalResult } from '../../quickjs/quickjs-instance-types.ts'
import {
  formatTerminalChangeSummary,
  type TerminalChangeSet,
} from '../../terminal/terminal-changeset.ts'
import { revertTerminalChangeSet } from '../../terminal/terminal-changeset-journal.ts'
import type {
  VscodeAgentTerminalEnsureReason,
  VscodeAgentTerminalSnapshot,
} from './vscode-terminal-sessions.ts'

export type VscodeAgentTerminalEnsureResult = {
  handle: TerminalReplHandle
  sessionId: string
  created: boolean
  reason: VscodeAgentTerminalEnsureReason
}

export type VscodeAiRunCommandHost = {
  workspaceFolder: string | undefined
  /** npm/npx 等独立实例最近一次受控 ChangeSet（内嵌终端走 handle） */
  npmLastChanges: { current: TerminalChangeSet | undefined }
  onChangesAvailable?: (available: boolean) => void
  ensureAgentTerminal: () => Promise<VscodeAgentTerminalEnsureResult>
  getAgentTerminalHandle: () => TerminalReplHandle | undefined
  getAgentTerminalSnapshot: () => VscodeAgentTerminalSnapshot
}

const OUTPUT_LINE_LIMIT = 120
const OUTPUT_CHAR_LIMIT = 12_000

function truncateOutput(text: string): string {
  const lines = text.split('\n')
  const sliced =
    lines.length > OUTPUT_LINE_LIMIT ? lines.slice(-OUTPUT_LINE_LIMIT).join('\n') : text
  if (sliced.length <= OUTPUT_CHAR_LIMIT) return sliced
  return `…（输出已截断）\n${sliced.slice(-OUTPUT_CHAR_LIMIT)}`
}

function formatQuickJsResult(result: QuickJsEvalResult): string {
  const consoleText = result.consoleLines.map((line) => line.text).join('\n')
  if (!result.ok) {
    return [result.error, consoleText].filter(Boolean).join('\n')
  }
  const status = result.exitCode === 0 ? '退出码 0' : `退出码 ${result.exitCode}`
  return [status, consoleText].filter(Boolean).join('\n')
}

function appendChangeSummary(base: string, changeSet: TerminalChangeSet | undefined): string {
  if (!changeSet || changeSet.changes.length === 0) return base
  return `${base}\n${formatTerminalChangeSummary(changeSet)}`
}

function formatTerminalBanner(result: VscodeAgentTerminalEnsureResult): string {
  const cwd = result.handle.getCwd()
  if (result.reason === 'reused') {
    return `[terminal session=${result.sessionId} kind=reused] cwd=${cwd}`
  }
  if (result.reason === 'rebuilt') {
    return `[terminal session=${result.sessionId} kind=rebuilt] 上一会话已关闭，已新开；cwd 已重置为 ${cwd}`
  }
  return `[terminal session=${result.sessionId} kind=new] 已新开 Agent 终端；cwd=${cwd}`
}

function rememberNpmChanges(
  host: VscodeAiRunCommandHost,
  changeSet: TerminalChangeSet | undefined,
): void {
  host.npmLastChanges.current =
    changeSet && changeSet.changes.length > 0 ? changeSet : undefined
  const terminalHas =
    (host.getAgentTerminalHandle()?.getLastChanges()?.changes.length ?? 0) > 0
  const npmHas = host.npmLastChanges.current !== undefined
  host.onChangesAvailable?.(terminalHas || npmHas)
}

export function getVscodeAiLastChangeSet(
  host: VscodeAiRunCommandHost,
): TerminalChangeSet | undefined {
  const terminalChanges = host.getAgentTerminalHandle()?.getLastChanges()
  if (terminalChanges && terminalChanges.changes.length > 0) {
    return terminalChanges
  }
  const npm = host.npmLastChanges.current
  if (npm && npm.changes.length > 0) return npm
  return undefined
}

export async function revertVscodeAiLastChanges(host: VscodeAiRunCommandHost): Promise<string> {
  const terminal = host.getAgentTerminalHandle()
  const terminalChanges = terminal?.getLastChanges()
  if (terminal && terminalChanges && terminalChanges.changes.length > 0) {
    const ok = await terminal.revertLastChanges()
    if (!ok) return '撤销失败'
    const npmHas = (host.npmLastChanges.current?.changes.length ?? 0) > 0
    host.onChangesAvailable?.(npmHas)
    return `已撤销终端改动（${formatTerminalChangeSummary(terminalChanges)}）`
  }

  const npm = host.npmLastChanges.current
  if (npm && npm.changes.length > 0) {
    await revertTerminalChangeSet(npm)
    host.npmLastChanges.current = undefined
    host.onChangesAvailable?.(false)
    return `已撤销 npm/npx 改动（${formatTerminalChangeSummary(npm)}）`
  }

  return '无可撤销变更'
}

/** 菜单「撤销上一轮」：针对指定 handle（当前活动终端）+ npm */
export async function revertVscodeTerminalAndNpmChanges(params: {
  terminalRepl: TerminalReplHandle | undefined
  npmLastChanges: { current: TerminalChangeSet | undefined }
  onChangesAvailable?: (available: boolean) => void
}): Promise<string> {
  const terminal = params.terminalRepl
  const terminalChanges = terminal?.getLastChanges()
  if (terminal && terminalChanges && terminalChanges.changes.length > 0) {
    const ok = await terminal.revertLastChanges()
    if (!ok) return '撤销失败'
    const npmHas = (params.npmLastChanges.current?.changes.length ?? 0) > 0
    params.onChangesAvailable?.(npmHas)
    return `已撤销终端改动（${formatTerminalChangeSummary(terminalChanges)}）`
  }

  const npm = params.npmLastChanges.current
  if (npm && npm.changes.length > 0) {
    await revertTerminalChangeSet(npm)
    params.npmLastChanges.current = undefined
    params.onChangesAvailable?.(false)
    return `已撤销 npm/npx 改动（${formatTerminalChangeSummary(npm)}）`
  }

  return '无可撤销变更'
}

export async function runVscodeAiTerminalLine(
  host: VscodeAiRunCommandHost,
  line: string,
): Promise<string> {
  const trimmed = line.trim()
  if (!trimmed) return '命令为空'

  const ensured = await host.ensureAgentTerminal()
  const banner = formatTerminalBanner(ensured)
  const output = await ensured.handle.runCode(trimmed, { source: 'program' })
  const changes = ensured.handle.getLastChanges()
  const npmHas = (host.npmLastChanges.current?.changes.length ?? 0) > 0
  host.onChangesAvailable?.((changes?.changes.length ?? 0) > 0 || npmHas)
  return truncateOutput(
    `${banner}\n${appendChangeSummary(output || '（无输出）', changes)}`,
  )
}

export async function runVscodeAiNpmScript(
  host: VscodeAiRunCommandHost,
  scriptName: string,
  extraArgs: string[] | undefined,
): Promise<string> {
  const root = host.workspaceFolder?.trim()
  if (!root) return '未打开工作区文件夹，无法运行 npm script'

  try {
    const result = await runNpmScript({
      projectRoot: root,
      scriptName,
      extraArgs,
      fsMode: 'controlled',
      onConsole: () => undefined,
    })
    rememberNpmChanges(host, result.changes)
    return truncateOutput(
      appendChangeSummary(formatQuickJsResult(result) || '（无输出）', result.changes),
    )
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export async function runVscodeAiNpx(
  host: VscodeAiRunCommandHost,
  packageSpec: string,
  extraArgs: string[] | undefined,
): Promise<string> {
  const root = host.workspaceFolder?.trim()
  if (!root) return '未打开工作区文件夹，无法运行 npx'

  try {
    const result = await runNpx({
      projectRoot: root,
      packageSpec,
      args: extraArgs,
      fsMode: 'controlled',
      onConsole: () => undefined,
    })
    rememberNpmChanges(host, result.changes)
    return truncateOutput(
      appendChangeSummary(formatQuickJsResult(result) || '（无输出）', result.changes),
    )
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
