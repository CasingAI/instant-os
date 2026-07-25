import type { TerminalReplHandle } from '../terminal/terminal-repl-panel.tsx'
import { runNpmScript, runNpx } from '../../packages/package-public.ts'
import type { QuickJsEvalResult } from '../../quickjs/quickjs-instance-types.ts'
import {
  formatTerminalChangeSummary,
  type TerminalChangeSet,
} from '../../terminal/terminal-changeset.ts'
import { revertTerminalChangeSet } from '../../terminal/terminal-changeset-journal.ts'
import { loadTerminalChangeSession } from '../../terminal/terminal-changeset-store.ts'
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

export type VscodeAiLastChangeSource = 'terminal' | 'npm'

export type VscodeAiRunCommandHost = {
  workspaceFolder: string | undefined
  /** 本对话 npm/npx 最近一次有 fs 改动的 ChangeSet（内嵌终端走 handle） */
  npmLastChanges: { current: TerminalChangeSet | undefined }
  /** 本对话最近一次产生非空 fs 改动的来源 */
  lastChangeSource: { current: VscodeAiLastChangeSource | undefined }
  /** 本轮 Agent 产生的全部非空 ChangeSet（按时间序；send 开始时清空） */
  turnChangeSessions: { current: TerminalChangeSet[] }
  onChangesAvailable?: (available: boolean) => void
  ensureAgentTerminal: () => Promise<VscodeAgentTerminalEnsureResult>
  getAgentTerminalHandle: () => TerminalReplHandle | undefined
  getAgentTerminalSnapshot: () => VscodeAgentTerminalSnapshot
}

function pushTurnChangeSession(host: VscodeAiRunCommandHost, changeSet: TerminalChangeSet): void {
  const list = host.turnChangeSessions.current
  if (list.some((item) => item.sessionId === changeSet.sessionId)) return
  list.push(changeSet)
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

function terminalHasChanges(host: VscodeAiRunCommandHost): boolean {
  return (host.getAgentTerminalHandle()?.getLastChanges()?.changes.length ?? 0) > 0
}

function npmHasChanges(host: Pick<VscodeAiRunCommandHost, 'npmLastChanges'>): boolean {
  return (host.npmLastChanges.current?.changes.length ?? 0) > 0
}

function notifyChangesAvailable(host: VscodeAiRunCommandHost): void {
  host.onChangesAvailable?.(terminalHasChanges(host) || npmHasChanges(host))
}

function rememberNpmChanges(
  host: VscodeAiRunCommandHost,
  changeSet: TerminalChangeSet | undefined,
): void {
  if (changeSet && changeSet.changes.length > 0) {
    host.npmLastChanges.current = changeSet
    host.lastChangeSource.current = 'npm'
    pushTurnChangeSession(host, changeSet)
  }
  notifyChangesAvailable(host)
}

function rememberTerminalFsChanges(
  host: VscodeAiRunCommandHost,
  before: TerminalChangeSet | undefined,
  after: TerminalChangeSet | undefined,
): void {
  // 仅当本轮 seal 出了新的非空 ChangeSet 时更新来源（空命令不得覆盖 npm）
  if (after && after.changes.length > 0 && after !== before) {
    host.lastChangeSource.current = 'terminal'
    pushTurnChangeSession(host, after)
  }
  notifyChangesAvailable(host)
}

export function collectPathsFromChangeSets(changeSets: readonly TerminalChangeSet[]): string[] {
  const paths = new Set<string>()
  for (const changeSet of changeSets) {
    for (const entry of changeSet.changes) {
      paths.add(entry.path)
      if (entry.fromPath) paths.add(entry.fromPath)
    }
  }
  return [...paths]
}

/** 倒序回滚多个 ChangeSet session（后发生的先撤） */
export async function revertVscodeAiChangeSessions(
  host: VscodeAiRunCommandHost,
  sessionIds: readonly string[],
): Promise<void> {
  const seen = new Set<string>()
  for (let index = sessionIds.length - 1; index >= 0; index -= 1) {
    const sessionId = sessionIds[index]
    if (!sessionId || seen.has(sessionId)) continue
    seen.add(sessionId)
    await revertVscodeAiTerminalChangeReview(host, {
      sessionId,
      source: host.lastChangeSource.current ?? 'terminal',
    })
  }
}

export function getVscodeAiLastChangeSet(
  host: VscodeAiRunCommandHost,
): TerminalChangeSet | undefined {
  const source = host.lastChangeSource.current
  if (source === 'npm') {
    const npm = host.npmLastChanges.current
    if (npm && npm.changes.length > 0) return npm
  }
  if (source === 'terminal') {
    const terminalChanges = host.getAgentTerminalHandle()?.getLastChanges()
    if (terminalChanges && terminalChanges.changes.length > 0) return terminalChanges
  }

  const terminalChanges = host.getAgentTerminalHandle()?.getLastChanges()
  if (terminalChanges && terminalChanges.changes.length > 0) return terminalChanges
  const npm = host.npmLastChanges.current
  if (npm && npm.changes.length > 0) return npm
  return undefined
}

/** 按审查卡 session 回滚（优先走 host 当前 last，否则按 session 加载） */
export async function revertVscodeAiTerminalChangeReview(
  host: VscodeAiRunCommandHost,
  review: { sessionId: string; source: VscodeAiLastChangeSource },
): Promise<string> {
  const last = getVscodeAiLastChangeSet(host)
  if (last && last.sessionId === review.sessionId) {
    return revertVscodeAiLastChanges(host)
  }

  const changeSet = await loadTerminalChangeSession(review.sessionId)
  if (!changeSet || changeSet.changes.length === 0) {
    return '找不到可撤销的变更会话（可能已被撤销）'
  }

  await revertTerminalChangeSet(changeSet)

  const terminal = host.getAgentTerminalHandle()
  const terminalChanges = terminal?.getLastChanges()
  if (terminal && terminalChanges?.sessionId === review.sessionId) {
    terminal.clearLastChanges()
  }
  if (host.npmLastChanges.current?.sessionId === review.sessionId) {
    host.npmLastChanges.current = undefined
  }
  if (host.lastChangeSource.current === review.source) {
    host.lastChangeSource.current = terminalHasChanges(host)
      ? 'terminal'
      : npmHasChanges(host)
        ? 'npm'
        : undefined
  }
  notifyChangesAvailable(host)
  return `已撤销本轮改动（${formatTerminalChangeSummary(changeSet)}）`
}

export async function revertVscodeAiLastChanges(host: VscodeAiRunCommandHost): Promise<string> {
  const source = host.lastChangeSource.current
  const preferNpm = source === 'npm'

  if (preferNpm) {
    const npm = host.npmLastChanges.current
    if (npm && npm.changes.length > 0) {
      await revertTerminalChangeSet(npm)
      host.npmLastChanges.current = undefined
      host.lastChangeSource.current = terminalHasChanges(host) ? 'terminal' : undefined
      notifyChangesAvailable(host)
      return `已撤销 npm/npx 改动（${formatTerminalChangeSummary(npm)}）`
    }
  }

  const terminal = host.getAgentTerminalHandle()
  const terminalChanges = terminal?.getLastChanges()
  if (terminal && terminalChanges && terminalChanges.changes.length > 0) {
    const ok = await terminal.revertLastChanges()
    if (!ok) return '撤销失败'
    host.lastChangeSource.current = npmHasChanges(host) ? 'npm' : undefined
    notifyChangesAvailable(host)
    return `已撤销终端改动（${formatTerminalChangeSummary(terminalChanges)}）`
  }

  const npm = host.npmLastChanges.current
  if (npm && npm.changes.length > 0) {
    await revertTerminalChangeSet(npm)
    host.npmLastChanges.current = undefined
    host.lastChangeSource.current = undefined
    notifyChangesAvailable(host)
    return `已撤销 npm/npx 改动（${formatTerminalChangeSummary(npm)}）`
  }

  return '无可撤销变更'
}

/** 菜单「撤销上一轮」：针对指定 handle + 对应对话的 npm / lastChangeSource */
export async function revertVscodeTerminalAndNpmChanges(params: {
  terminalRepl: TerminalReplHandle | undefined
  npmLastChanges: { current: TerminalChangeSet | undefined }
  lastChangeSource?: { current: VscodeAiLastChangeSource | undefined }
  onChangesAvailable?: (available: boolean) => void
}): Promise<string> {
  const hostLike: VscodeAiRunCommandHost = {
    workspaceFolder: undefined,
    npmLastChanges: params.npmLastChanges,
    lastChangeSource: params.lastChangeSource ?? { current: undefined },
    turnChangeSessions: { current: [] },
    onChangesAvailable: params.onChangesAvailable,
    ensureAgentTerminal: async () => {
      throw new Error('unused')
    },
    getAgentTerminalHandle: () => params.terminalRepl,
    getAgentTerminalSnapshot: () => ({ status: 'none' }),
  }
  return revertVscodeAiLastChanges(hostLike)
}

export async function runVscodeAiTerminalLine(
  host: VscodeAiRunCommandHost,
  line: string,
): Promise<string> {
  const trimmed = line.trim()
  if (!trimmed) return '命令为空'

  const ensured = await host.ensureAgentTerminal()
  const banner = formatTerminalBanner(ensured)
  const beforeChanges = ensured.handle.getLastChanges()
  const output = await ensured.handle.runCode(trimmed, { source: 'program' })
  const changes = ensured.handle.getLastChanges()
  rememberTerminalFsChanges(host, beforeChanges, changes)
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
