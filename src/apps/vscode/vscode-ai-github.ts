/**
 * VS Code Agent → github-git 门面薄包装。
 */
import type { AgentToolStructuredResult } from '../../ai/agent-tool.ts'
import { formatCalendarInstantLabel, getOsNowInstant } from '../../os/os-clock.ts'
import {
  githubGitClone,
  githubGitCommit,
  githubGitDiff,
  githubGitDiscard,
  githubGitFetch,
  githubGitLog,
  githubGitPull,
  githubGitPush,
  githubGitStatus,
  githubGitSwitchBranch,
  type GithubGitContext,
  type GithubGitResult,
} from '../github-desktop/github-git.ts'
import { maybeSpillToolOutput } from './vscode-ai-output-spill.ts'
import {
  rememberGithubChanges,
  runVscodeAiTerminalLine,
  type VscodeAiRunCommandHost,
} from './vscode-ai-run-command.ts'

function formatElapsedShort(elapsedMs: number): string {
  if (elapsedMs < 1000) return `${Math.max(0, Math.round(elapsedMs))}ms`
  if (elapsedMs < 10_000) return `${(elapsedMs / 1000).toFixed(1)}s`
  return `${Math.round(elapsedMs / 1000)}s`
}

function withCommandTiming(body: string, elapsedMs: number): string {
  const at = formatCalendarInstantLabel(getOsNowInstant())
  const timing = `[at=${at} · elapsed=${formatElapsedShort(elapsedMs)}]`
  const trimmed = body.trimEnd()
  if (!trimmed) return timing
  return `${timing}\n${trimmed}`
}

function buildContext(host: VscodeAiRunCommandHost): GithubGitContext {
  const cwd = host.workspaceFolder?.trim() || ''
  const handle = host.getAgentTerminalHandle()
  return {
    cwd,
    fsMode: host.getFsMode(),
    terminalSessionId: handle?.getTerminalSessionId(),
  }
}

async function runGithubGit(
  host: VscodeAiRunCommandHost,
  exec: (ctx: GithubGitContext) => Promise<GithubGitResult>,
  options?: { ensureTerminal?: boolean },
): Promise<string | AgentToolStructuredResult> {
  const startedAt = performance.now()
  try {
    if (options?.ensureTerminal) {
      await host.ensureAgentTerminal()
    }
    const result = await exec(buildContext(host))
    if (result.changeSet && result.changeSet.changes.length > 0) {
      rememberGithubChanges(host, result.changeSet)
    }
    const elapsedMs = performance.now() - startedAt
    const fullText = withCommandTiming(result.summary, elapsedMs)
    const tmpDir = host.getAgentTerminalHandle()?.getTmpDir()
    if (!tmpDir) return fullText
    return maybeSpillToolOutput(fullText, {
      tmpDir,
      runTerminalLine: (cmd) => runVscodeAiTerminalLine(host, cmd),
    })
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export function runVscodeAiGithubStatus(
  host: VscodeAiRunCommandHost,
): Promise<string | AgentToolStructuredResult> {
  return runGithubGit(host, (ctx) => githubGitStatus(ctx))
}

export function runVscodeAiGithubDiff(
  host: VscodeAiRunCommandHost,
  path?: string,
): Promise<string | AgentToolStructuredResult> {
  return runGithubGit(host, (ctx) => githubGitDiff(ctx, path))
}

export function runVscodeAiGithubLog(
  host: VscodeAiRunCommandHost,
  limit?: number,
): Promise<string | AgentToolStructuredResult> {
  return runGithubGit(host, (ctx) => githubGitLog(ctx, limit))
}

export function runVscodeAiGithubClone(
  host: VscodeAiRunCommandHost,
  input: { url?: string; owner?: string; repo?: string; branch?: string },
): Promise<string | AgentToolStructuredResult> {
  return runGithubGit(host, (ctx) => githubGitClone(ctx, input), { ensureTerminal: true })
}

export function runVscodeAiGithubCommit(
  host: VscodeAiRunCommandHost,
  options: { message: string; paths?: string[]; all?: boolean },
): Promise<string | AgentToolStructuredResult> {
  return runGithubGit(host, (ctx) => githubGitCommit(ctx, options), { ensureTerminal: true })
}

export function runVscodeAiGithubPush(
  host: VscodeAiRunCommandHost,
): Promise<string | AgentToolStructuredResult> {
  return runGithubGit(host, (ctx) => githubGitPush(ctx), { ensureTerminal: true })
}

export function runVscodeAiGithubPull(
  host: VscodeAiRunCommandHost,
): Promise<string | AgentToolStructuredResult> {
  return runGithubGit(host, (ctx) => githubGitPull(ctx), { ensureTerminal: true })
}

export function runVscodeAiGithubFetch(
  host: VscodeAiRunCommandHost,
): Promise<string | AgentToolStructuredResult> {
  return runGithubGit(host, (ctx) => githubGitFetch(ctx), { ensureTerminal: true })
}

export function runVscodeAiGithubSwitchBranch(
  host: VscodeAiRunCommandHost,
  branch: string,
): Promise<string | AgentToolStructuredResult> {
  return runGithubGit(host, (ctx) => githubGitSwitchBranch(ctx, branch), {
    ensureTerminal: true,
  })
}

export function runVscodeAiGithubDiscard(
  host: VscodeAiRunCommandHost,
  paths: string[],
): Promise<string | AgentToolStructuredResult> {
  return runGithubGit(host, (ctx) => githubGitDiscard(ctx, paths), { ensureTerminal: true })
}
