/**
 * AI / 宿主用的结构化 GitHub 工作树门面（非真实 git）。
 * 复用 GitHub Desktop 同步层；强制遵守 TerminalFsMode。
 */
import { osNowMs } from '../../os/os-clock.ts'
import type { TerminalFsMode } from '../../terminal/terminal-fs-mode.ts'
import {
  formatTerminalChangeSummary,
  type TerminalChangeEntry,
  type TerminalChangeSet,
} from '../../terminal/terminal-changeset.ts'
import {
  putBeforeBlobFromPath,
  saveTerminalChangeSession,
} from '../../terminal/terminal-changeset-store.ts'
import { filesListSubtreeFiles, filesReadBlob } from '../files/files-api.ts'
import { detectGithubChanges, buildChangePreview, type GithubChange } from './github-changes.ts'
import { commitGithubChanges, pushGithubBranch, summarizeChanges } from './github-commit.ts'
import { discardGithubChanges } from './github-discard.ts'
import { applyGithubFetchResult, fetchGithubRemote } from './github-fetch.ts'
import type { GithubProgress } from './github-progress.ts'
import { pullGithubRepository, switchGithubBranch } from './github-pull.ts'
import {
  githubRepoRootPath,
  parseGithubRepoUrl,
  resolveGithubRepoFromCwd,
} from './github-repo-paths.ts'
import {
  branchHasUnpushedCommits,
  buildRepoBranchList,
  currentHeadSha,
  hashBytes,
  listGithubLocalCommits,
  getCachedGithubCommitList,
  type GithubRepoSyncMeta,
} from './github-sync-meta.ts'
import { cloneGithubRepository } from './github-working-tree.ts'
import { amendUnpushedCommit, undoLastUnpushedCommit } from './github-local-history.ts'
import { createGithubBranch } from './github-branch.ts'
import {
  stashPopGithubChanges,
  stashSaveGithubChanges,
  stashListGithub,
} from './github-stash.ts'

export const GITHUB_GIT_READONLY_MUTATION_MESSAGE =
  '当前终端为只读模式，无法执行会修改仓库的 Git 操作'

export type GithubGitContext = {
  cwd: string
  fsMode: TerminalFsMode
  /** controlled 下用于 ChangeSet sessionId；与 npm/终端同类 */
  terminalSessionId?: string
}

export type GithubGitResult = {
  summary: string
  changeSet?: TerminalChangeSet
}

export function assertGithubGitMutationAllowed(fsMode: TerminalFsMode): void {
  if (fsMode === 'readonly') {
    throw new Error(GITHUB_GIT_READONLY_MUTATION_MESSAGE)
  }
}

function shortSha(sha: string | undefined): string {
  if (!sha) return '（无）'
  return sha.length > 12 ? sha.slice(0, 12) : sha
}

async function resolveMeta(ctx: GithubGitContext): Promise<GithubRepoSyncMeta> {
  const cwd = ctx.cwd.trim()
  if (!cwd) {
    throw new Error('未指定工作区路径，无法定位 GitHub 仓库')
  }
  return resolveGithubRepoFromCwd(cwd)
}

async function captureRepoFileHashes(
  repoRoot: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  let files: Awaited<ReturnType<typeof filesListSubtreeFiles>>
  try {
    files = await filesListSubtreeFiles(repoRoot)
  } catch {
    return map
  }
  for (const file of files) {
    try {
      const blob = await filesReadBlob(file.path)
      const bytes = new Uint8Array(await blob.arrayBuffer())
      map.set(file.path, await hashBytes(bytes))
    } catch {
      // 跳过无法读取的文件
    }
  }
  return map
}

async function withControlledWorkingTreeMutation<T>(
  ctx: GithubGitContext,
  repoRoot: string,
  run: () => Promise<T>,
): Promise<{ result: T; changeSet?: TerminalChangeSet }> {
  if (ctx.fsMode !== 'controlled' || !ctx.terminalSessionId) {
    return { result: await run() }
  }

  const before = await captureRepoFileHashes(repoRoot)
  const beforeBlobs = new Map<string, { blobId: string; byteSize: number }>()
  for (const path of before.keys()) {
    const stored = await putBeforeBlobFromPath(path).catch(() => undefined)
    if (stored) beforeBlobs.set(path, stored)
  }

  const result = await run()
  const after = await captureRepoFileHashes(repoRoot)

  const changes: TerminalChangeEntry[] = []
  for (const [path, beforeHash] of before) {
    const afterHash = after.get(path)
    const blob = beforeBlobs.get(path)
    if (afterHash === undefined) {
      changes.push({
        path,
        kind: 'deleted',
        beforeBlobId: blob?.blobId,
        meta: blob ? { byteSize: blob.byteSize } : undefined,
      })
    } else if (afterHash !== beforeHash) {
      changes.push({
        path,
        kind: 'modified',
        beforeBlobId: blob?.blobId,
        meta: blob ? { byteSize: blob.byteSize } : undefined,
      })
    }
  }
  for (const [path] of after) {
    if (!before.has(path)) {
      changes.push({ path, kind: 'added' })
    }
  }

  if (changes.length === 0) {
    return { result }
  }

  const changeSet: TerminalChangeSet = {
    sessionId: ctx.terminalSessionId,
    createdAt: osNowMs(),
    sealedAt: osNowMs(),
    changes,
  }
  await saveTerminalChangeSession(changeSet)
  return { result, changeSet }
}

function appendChangeSummary(text: string, changeSet?: TerminalChangeSet): string {
  if (!changeSet || changeSet.changes.length === 0) return text
  return `${text}\n${formatTerminalChangeSummary(changeSet)}`
}

export async function githubGitStatus(ctx: GithubGitContext): Promise<GithubGitResult> {
  const meta = await resolveMeta(ctx)
  const changes = await detectGithubChanges(meta)
  const head = currentHeadSha(meta)
  const unpushed = branchHasUnpushedCommits(meta)
  const lines = [
    `仓库 ${meta.owner}/${meta.repo}`,
    `分支 ${meta.currentBranch} · tip ${shortSha(head)}${unpushed ? ' · 有未推送本地 commit' : ''}`,
    changes.length === 0
      ? '工作区干净'
      : `变更 ${changes.length} 项（${summarizeChanges(changes)}）：`,
    ...changes.slice(0, 40).map((c) => `  ${c.kind}\t${c.path}`),
  ]
  if (changes.length > 40) {
    lines.push(`  …另有 ${changes.length - 40} 项`)
  }
  return { summary: lines.join('\n') }
}

export async function githubGitDiff(
  ctx: GithubGitContext,
  path?: string,
): Promise<GithubGitResult> {
  const meta = await resolveMeta(ctx)
  const changes = await detectGithubChanges(meta)
  const target = path?.trim()
  const filtered = target
    ? changes.filter((c) => c.path === target || c.path.endsWith(`/${target}`))
    : changes

  if (filtered.length === 0) {
    return { summary: target ? `无变更：${target}` : '工作区无变更' }
  }

  const parts: string[] = []
  const limit = target ? filtered : filtered.slice(0, 8)
  for (const change of limit) {
    const preview = await buildChangePreview(meta, change)
    if (preview.notice) {
      parts.push(`## ${change.path} (${change.kind})\n${preview.notice}`)
      continue
    }
    parts.push(
      `## ${change.path} (${change.kind})\n--- original ---\n${preview.original.slice(0, 4000)}\n--- modified ---\n${preview.modified.slice(0, 4000)}`,
    )
  }
  if (!target && filtered.length > 8) {
    parts.push(`…另有 ${filtered.length - 8} 个文件未展开，可传 path 查看单个文件`)
  }
  return { summary: parts.join('\n\n') }
}

export async function githubGitLog(
  ctx: GithubGitContext,
  limit = 20,
): Promise<GithubGitResult> {
  const meta = await resolveMeta(ctx)
  const n = Math.min(Math.max(1, Math.floor(limit)), 50)
  const local = await listGithubLocalCommits(meta.owner, meta.repo)
  const remoteRecord = await getCachedGithubCommitList(meta.owner, meta.repo)
  const remoteCached = remoteRecord?.commits ?? []

  const lines: string[] = [`仓库 ${meta.owner}/${meta.repo} · ${meta.currentBranch}`]
  if (local.length > 0) {
    lines.push('本地 commit：')
    for (const c of local.slice(0, n)) {
      lines.push(`  ${shortSha(c.sha)}  ${c.message.split('\n')[0] ?? ''}`)
    }
  }
  if (remoteCached.length > 0) {
    lines.push('远端缓存历史：')
    for (const c of remoteCached.slice(0, n)) {
      lines.push(`  ${shortSha(c.sha)}  ${c.message.split('\n')[0] ?? ''}`)
    }
  }
  if (local.length === 0 && remoteCached.length === 0) {
    lines.push('暂无历史。可先 await instant.git.fetch() 刷新远端缓存。')
  }

  const branches = buildRepoBranchList(meta)
  if (branches.length > 0) {
    lines.push('分支：')
    for (const b of branches.slice(0, 30)) {
      const mark = b.name === meta.currentBranch ? '*' : ' '
      lines.push(`  ${mark} ${b.name}  ${shortSha(b.localTipSha || b.commitSha)}`)
    }
  }

  return { summary: lines.join('\n') }
}

export async function githubGitClone(
  ctx: GithubGitContext,
  input: { url?: string; owner?: string; repo?: string; branch?: string },
  onProgress?: GithubProgress,
): Promise<GithubGitResult> {
  assertGithubGitMutationAllowed(ctx.fsMode)

  let owner = input.owner?.trim()
  let repo = input.repo?.trim()
  if (input.url?.trim()) {
    const parsed = parseGithubRepoUrl(input.url.trim())
    if (!parsed) {
      throw new Error('无法解析仓库 URL（仅支持 github.com HTTPS / SSH）')
    }
    owner = parsed.owner
    repo = parsed.repo
  }
  if (!owner || !repo) {
    throw new Error('请提供 url，或同时提供 owner 与 repo')
  }

  const repoRoot = githubRepoRootPath(owner, repo)
  const { result: meta, changeSet } = await withControlledWorkingTreeMutation(
    ctx,
    repoRoot,
    () =>
      cloneGithubRepository({
        owner,
        repo,
        branch: input.branch,
        onProgress,
      }),
  )

  return {
    summary: appendChangeSummary(
      `已克隆 ${meta.owner}/${meta.repo} → ${repoRoot}\n分支 ${meta.currentBranch} · tip ${shortSha(currentHeadSha(meta))}`,
      changeSet,
    ),
    changeSet,
  }
}

export async function githubGitCommit(
  ctx: GithubGitContext,
  options: { message: string; paths?: string[]; all?: boolean },
): Promise<GithubGitResult> {
  assertGithubGitMutationAllowed(ctx.fsMode)
  const meta = await resolveMeta(ctx)
  const message = options.message.trim()
  if (!message) throw new Error('请提供 commit message')

  const allChanges = await detectGithubChanges(meta)
  let selectedPaths: Set<string> | undefined
  if (options.all) {
    selectedPaths = undefined
  } else if (options.paths && options.paths.length > 0) {
    selectedPaths = new Set(options.paths.map((p) => p.trim()).filter(Boolean))
  } else {
    throw new Error('请指定 paths，或传 all: true 提交全部变更（无 git add 暂存区）')
  }

  // commit 主要改 meta / baseline，工作区文件内容通常不变；仍包一层以便受控会话一致
  const repoRoot = githubRepoRootPath(meta.owner, meta.repo)
  const { result: next, changeSet } = await withControlledWorkingTreeMutation(
    ctx,
    repoRoot,
    () =>
      commitGithubChanges({
        meta,
        message,
        selectedPaths,
      }),
  )

  const committed = selectedPaths
    ? allChanges.filter((c) => selectedPaths!.has(c.path))
    : allChanges

  return {
    summary: appendChangeSummary(
      `已本地 commit ${shortSha(currentHeadSha(next))}：${message}\n${summarizeChanges(committed)}（尚未 push）`,
      changeSet,
    ),
    changeSet,
  }
}

export async function githubGitPush(ctx: GithubGitContext): Promise<GithubGitResult> {
  assertGithubGitMutationAllowed(ctx.fsMode)
  const meta = await resolveMeta(ctx)
  const next = await pushGithubBranch(meta)
  return {
    summary: `已推送 ${next.owner}/${next.repo} · ${next.currentBranch} → ${shortSha(currentHeadSha(next))}`,
  }
}

export async function githubGitPull(
  ctx: GithubGitContext,
  onProgress?: GithubProgress,
): Promise<GithubGitResult> {
  assertGithubGitMutationAllowed(ctx.fsMode)
  const meta = await resolveMeta(ctx)
  const repoRoot = githubRepoRootPath(meta.owner, meta.repo)
  const { result: next, changeSet } = await withControlledWorkingTreeMutation(
    ctx,
    repoRoot,
    () => pullGithubRepository({ meta, onProgress }),
  )
  return {
    summary: appendChangeSummary(
      `已拉取 ${next.owner}/${next.repo} · ${next.currentBranch} · tip ${shortSha(currentHeadSha(next))}`,
      changeSet,
    ),
    changeSet,
  }
}

export async function githubGitFetch(ctx: GithubGitContext): Promise<GithubGitResult> {
  assertGithubGitMutationAllowed(ctx.fsMode)
  const meta = await resolveMeta(ctx)
  const result = await fetchGithubRemote({ meta })
  const next = await applyGithubFetchResult(meta, result)
  return {
    summary: [
      `已 fetch ${next.owner}/${next.repo} · ${next.currentBranch}`,
      `本地 tip ${shortSha(result.localSha)} · 远端 tip ${shortSha(result.remoteSha)}`,
      result.upToDate ? '已与远端 tip 一致' : '远端有新提交（工作区未改；可用 await instant.git.pull() 更新）',
      `远端分支 ${result.branches.length} 个 · 历史缓存 ${result.commits.length} 条`,
    ].join('\n'),
  }
}

export async function githubGitSwitchBranch(
  ctx: GithubGitContext,
  branch: string,
  onProgress?: GithubProgress,
): Promise<GithubGitResult> {
  assertGithubGitMutationAllowed(ctx.fsMode)
  const meta = await resolveMeta(ctx)
  const name = branch.trim()
  if (!name) throw new Error('请提供分支名')
  const repoRoot = githubRepoRootPath(meta.owner, meta.repo)
  const { result, changeSet } = await withControlledWorkingTreeMutation(ctx, repoRoot, () =>
    switchGithubBranch({ meta, branch: name, onProgress }),
  )
  return {
    summary: appendChangeSummary(
      `已切换到 ${result.meta.currentBranch} · tip ${shortSha(currentHeadSha(result.meta))}${
        result.syncedWithRemote ? '（已与远端同步）' : '（本地快照）'
      }`,
      changeSet,
    ),
    changeSet,
  }
}

export async function githubGitDiscard(
  ctx: GithubGitContext,
  paths: string[],
): Promise<GithubGitResult> {
  assertGithubGitMutationAllowed(ctx.fsMode)
  const meta = await resolveMeta(ctx)
  const wanted = new Set(paths.map((p) => p.trim()).filter(Boolean))
  if (wanted.size === 0) {
    throw new Error('请提供要丢弃的 paths')
  }
  const all = await detectGithubChanges(meta)
  const changes: GithubChange[] = all.filter((c) => wanted.has(c.path))
  if (changes.length === 0) {
    throw new Error('指定路径没有可丢弃的变更')
  }

  const repoRoot = githubRepoRootPath(meta.owner, meta.repo)
  const { result: next, changeSet } = await withControlledWorkingTreeMutation(
    ctx,
    repoRoot,
    () =>
      discardGithubChanges({
        meta,
        changes,
        discardAll: false,
      }),
  )

  return {
    summary: appendChangeSummary(
      `已丢弃 ${changes.length} 项变更（${summarizeChanges(changes)}）\n仓库 ${next.owner}/${next.repo}`,
      changeSet,
    ),
    changeSet,
  }
}

export async function githubGitUndo(ctx: GithubGitContext): Promise<GithubGitResult> {
  assertGithubGitMutationAllowed(ctx.fsMode)
  const meta = await resolveMeta(ctx)
  const next = await undoLastUnpushedCommit(meta)
  return {
    summary: `已撤销最近一次未推送 commit · tip ${shortSha(currentHeadSha(next))}`,
  }
}

export async function githubGitAmend(
  ctx: GithubGitContext,
  message: string,
): Promise<GithubGitResult> {
  assertGithubGitMutationAllowed(ctx.fsMode)
  const meta = await resolveMeta(ctx)
  const next = await amendUnpushedCommit({ meta, message })
  return {
    summary: `已 amend 未推送 commit · tip ${shortSha(currentHeadSha(next))}`,
  }
}

export async function githubGitCreateBranch(
  ctx: GithubGitContext,
  name: string,
  options?: { checkout?: boolean; publish?: boolean },
): Promise<GithubGitResult> {
  assertGithubGitMutationAllowed(ctx.fsMode)
  const meta = await resolveMeta(ctx)
  const next = await createGithubBranch({
    meta,
    name,
    checkout: options?.checkout,
    publish: options?.publish,
  })
  return {
    summary: `已创建分支 ${name}${options?.publish ? '（已发布）' : ''}${
      options?.checkout === false ? '' : ` · 当前 ${next.currentBranch}`
    }`,
  }
}

export async function githubGitStashSave(
  ctx: GithubGitContext,
  message?: string,
): Promise<GithubGitResult> {
  assertGithubGitMutationAllowed(ctx.fsMode)
  const meta = await resolveMeta(ctx)
  const repoRoot = githubRepoRootPath(meta.owner, meta.repo)
  const { result, changeSet } = await withControlledWorkingTreeMutation(ctx, repoRoot, async () => {
    const saved = await stashSaveGithubChanges({ meta, message })
    return saved
  })
  return {
    summary: appendChangeSummary(
      `已贮藏 ${result.stash.changes.length} 项变更${
        result.stash.message ? `（${result.stash.message}）` : ''
      }`,
      changeSet,
    ),
    changeSet,
  }
}

export async function githubGitStashPop(ctx: GithubGitContext): Promise<GithubGitResult> {
  assertGithubGitMutationAllowed(ctx.fsMode)
  const meta = await resolveMeta(ctx)
  const repoRoot = githubRepoRootPath(meta.owner, meta.repo)
  const { result: next, changeSet } = await withControlledWorkingTreeMutation(
    ctx,
    repoRoot,
    () => stashPopGithubChanges({ meta }),
  )
  const remaining = await stashListGithub(next)
  return {
    summary: appendChangeSummary(
      `已弹出贮藏 · 剩余 ${remaining.length} 条`,
      changeSet,
    ),
    changeSet,
  }
}
