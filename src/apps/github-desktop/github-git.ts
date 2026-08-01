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

/**
 * 门面结果：summary 给人读；data 为客侧结构化字段；changeSet 仅宿主撤销用。
 */
export type GithubGitResult<T extends Record<string, unknown> = Record<string, unknown>> = {
  summary: string
  data: T
  changeSet?: TerminalChangeSet
}

/** 剥掉 changeSet，展平为客侧 `{ summary, ...data }`。 */
export function flattenGithubGitResultForGuest<T extends Record<string, unknown>>(
  result: GithubGitResult<T>,
): { summary: string } & T {
  return { summary: result.summary, ...result.data }
}

function headShaOrNull(sha: string | undefined): string | null {
  return sha && sha.length > 0 ? sha : null
}

function toGitChanges(changes: GithubChange[]): Array<{ path: string; kind: GithubChange['kind'] }> {
  return changes.map((c) => ({ path: c.path, kind: c.kind }))
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

export async function githubGitStatus(ctx: GithubGitContext): Promise<
  GithubGitResult<{
    owner: string
    repo: string
    branch: string
    head: string | null
    clean: boolean
    hasUnpushedCommits: boolean
    changes: Array<{ path: string; kind: GithubChange['kind'] }>
  }>
> {
  const meta = await resolveMeta(ctx)
  const changes = await detectGithubChanges(meta)
  const head = headShaOrNull(currentHeadSha(meta))
  const unpushed = branchHasUnpushedCommits(meta)
  const lines = [
    `仓库 ${meta.owner}/${meta.repo}`,
    `分支 ${meta.currentBranch} · tip ${shortSha(head ?? undefined)}${unpushed ? ' · 有未推送本地 commit' : ''}`,
    changes.length === 0
      ? '工作区干净'
      : `变更 ${changes.length} 项（${summarizeChanges(changes)}）：`,
    ...changes.slice(0, 40).map((c) => `  ${c.kind}\t${c.path}`),
  ]
  if (changes.length > 40) {
    lines.push(`  …另有 ${changes.length - 40} 项`)
  }
  return {
    summary: lines.join('\n'),
    data: {
      owner: meta.owner,
      repo: meta.repo,
      branch: meta.currentBranch,
      head,
      clean: changes.length === 0,
      hasUnpushedCommits: unpushed,
      changes: toGitChanges(changes),
    },
  }
}

export async function githubGitDiff(
  ctx: GithubGitContext,
  path?: string,
): Promise<
  GithubGitResult<{
    files: Array<{
      path: string
      kind: GithubChange['kind']
      notice?: string
      original?: string
      modified?: string
    }>
    truncated: boolean
  }>
> {
  const meta = await resolveMeta(ctx)
  const changes = await detectGithubChanges(meta)
  const target = path?.trim()
  const filtered = target
    ? changes.filter((c) => c.path === target || c.path.endsWith(`/${target}`))
    : changes

  if (filtered.length === 0) {
    return {
      summary: target ? `无变更：${target}` : '工作区无变更',
      data: { files: [], truncated: false },
    }
  }

  const parts: string[] = []
  const limit = target ? filtered : filtered.slice(0, 8)
  const truncated = !target && filtered.length > 8
  const files: Array<{
    path: string
    kind: GithubChange['kind']
    notice?: string
    original?: string
    modified?: string
  }> = []

  for (const change of limit) {
    const preview = await buildChangePreview(meta, change)
    if (preview.notice) {
      parts.push(`## ${change.path} (${change.kind})\n${preview.notice}`)
      files.push({ path: change.path, kind: change.kind, notice: preview.notice })
      continue
    }
    const original = preview.original.slice(0, 4000)
    const modified = preview.modified.slice(0, 4000)
    parts.push(
      `## ${change.path} (${change.kind})\n--- original ---\n${original}\n--- modified ---\n${modified}`,
    )
    files.push({ path: change.path, kind: change.kind, original, modified })
  }
  if (truncated) {
    parts.push(`…另有 ${filtered.length - 8} 个文件未展开，可传 path 查看单个文件`)
  }
  return {
    summary: parts.join('\n\n'),
    data: { files, truncated },
  }
}

export async function githubGitLog(
  ctx: GithubGitContext,
  limit = 20,
): Promise<
  GithubGitResult<{
    owner: string
    repo: string
    branch: string
    head: string | null
    localCommits: Array<{ sha: string; message: string }>
    remoteCommits: Array<{ sha: string; message: string }>
    branches: Array<{ name: string; tip: string | null; current: boolean }>
  }>
> {
  const meta = await resolveMeta(ctx)
  const n = Math.min(Math.max(1, Math.floor(limit)), 50)
  const local = await listGithubLocalCommits(meta.owner, meta.repo)
  const remoteRecord = await getCachedGithubCommitList(meta.owner, meta.repo)
  const remoteCached = remoteRecord?.commits ?? []

  const localCommits = local.slice(0, n).map((c) => ({
    sha: c.sha,
    message: c.message.split('\n')[0] ?? '',
  }))
  const remoteCommits = remoteCached.slice(0, n).map((c) => ({
    sha: c.sha,
    message: c.message.split('\n')[0] ?? '',
  }))

  const lines: string[] = [`仓库 ${meta.owner}/${meta.repo} · ${meta.currentBranch}`]
  if (localCommits.length > 0) {
    lines.push('本地 commit：')
    for (const c of localCommits) {
      lines.push(`  ${shortSha(c.sha)}  ${c.message}`)
    }
  }
  if (remoteCommits.length > 0) {
    lines.push('远端缓存历史：')
    for (const c of remoteCommits) {
      lines.push(`  ${shortSha(c.sha)}  ${c.message}`)
    }
  }
  if (localCommits.length === 0 && remoteCommits.length === 0) {
    lines.push('暂无历史。可先 await instant.git.fetch() 刷新远端缓存。')
  }

  const branchList = buildRepoBranchList(meta)
  const branches = branchList.slice(0, 30).map((b) => ({
    name: b.name,
    tip: headShaOrNull(b.localTipSha || b.commitSha),
    current: b.name === meta.currentBranch,
  }))
  if (branches.length > 0) {
    lines.push('分支：')
    for (const b of branches) {
      const mark = b.current ? '*' : ' '
      lines.push(`  ${mark} ${b.name}  ${shortSha(b.tip ?? undefined)}`)
    }
  }

  return {
    summary: lines.join('\n'),
    data: {
      owner: meta.owner,
      repo: meta.repo,
      branch: meta.currentBranch,
      head: headShaOrNull(currentHeadSha(meta)),
      localCommits,
      remoteCommits,
      branches,
    },
  }
}

export async function githubGitClone(
  ctx: GithubGitContext,
  input: { url?: string; owner?: string; repo?: string; branch?: string },
  onProgress?: GithubProgress,
): Promise<
  GithubGitResult<{
    owner: string
    repo: string
    branch: string
    head: string | null
    repoRoot: string
  }>
> {
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

  const head = headShaOrNull(currentHeadSha(meta))
  return {
    summary: appendChangeSummary(
      `已克隆 ${meta.owner}/${meta.repo} → ${repoRoot}\n分支 ${meta.currentBranch} · tip ${shortSha(head ?? undefined)}`,
      changeSet,
    ),
    data: {
      owner: meta.owner,
      repo: meta.repo,
      branch: meta.currentBranch,
      head,
      repoRoot,
    },
    changeSet,
  }
}

export async function githubGitCommit(
  ctx: GithubGitContext,
  options: { message: string; paths?: string[]; all?: boolean },
): Promise<
  GithubGitResult<{
    owner: string
    repo: string
    branch: string
    head: string | null
    message: string
    changes: Array<{ path: string; kind: GithubChange['kind'] }>
  }>
> {
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
  const head = headShaOrNull(currentHeadSha(next))

  return {
    summary: appendChangeSummary(
      `已本地 commit ${shortSha(head ?? undefined)}：${message}\n${summarizeChanges(committed)}（尚未 push）`,
      changeSet,
    ),
    data: {
      owner: next.owner,
      repo: next.repo,
      branch: next.currentBranch,
      head,
      message,
      changes: toGitChanges(committed),
    },
    changeSet,
  }
}

export async function githubGitPush(ctx: GithubGitContext): Promise<
  GithubGitResult<{
    owner: string
    repo: string
    branch: string
    head: string | null
  }>
> {
  assertGithubGitMutationAllowed(ctx.fsMode)
  const meta = await resolveMeta(ctx)
  const next = await pushGithubBranch(meta)
  const head = headShaOrNull(currentHeadSha(next))
  return {
    summary: `已推送 ${next.owner}/${next.repo} · ${next.currentBranch} → ${shortSha(head ?? undefined)}`,
    data: {
      owner: next.owner,
      repo: next.repo,
      branch: next.currentBranch,
      head,
    },
  }
}

export async function githubGitPull(
  ctx: GithubGitContext,
  onProgress?: GithubProgress,
): Promise<
  GithubGitResult<{
    owner: string
    repo: string
    branch: string
    head: string | null
  }>
> {
  assertGithubGitMutationAllowed(ctx.fsMode)
  const meta = await resolveMeta(ctx)
  const repoRoot = githubRepoRootPath(meta.owner, meta.repo)
  const { result: next, changeSet } = await withControlledWorkingTreeMutation(
    ctx,
    repoRoot,
    () => pullGithubRepository({ meta, onProgress }),
  )
  const head = headShaOrNull(currentHeadSha(next))
  return {
    summary: appendChangeSummary(
      `已拉取 ${next.owner}/${next.repo} · ${next.currentBranch} · tip ${shortSha(head ?? undefined)}`,
      changeSet,
    ),
    data: {
      owner: next.owner,
      repo: next.repo,
      branch: next.currentBranch,
      head,
    },
    changeSet,
  }
}

export async function githubGitFetch(ctx: GithubGitContext): Promise<
  GithubGitResult<{
    owner: string
    repo: string
    branch: string
    head: string | null
    localSha: string | null
    remoteSha: string | null
    upToDate: boolean
    branchCount: number
    cachedCommitCount: number
  }>
> {
  assertGithubGitMutationAllowed(ctx.fsMode)
  const meta = await resolveMeta(ctx)
  const result = await fetchGithubRemote({ meta })
  const next = await applyGithubFetchResult(meta, result)
  const localSha = headShaOrNull(result.localSha)
  const remoteSha = headShaOrNull(result.remoteSha)
  return {
    summary: [
      `已 fetch ${next.owner}/${next.repo} · ${next.currentBranch}`,
      `本地 tip ${shortSha(localSha ?? undefined)} · 远端 tip ${shortSha(remoteSha ?? undefined)}`,
      result.upToDate ? '已与远端 tip 一致' : '远端有新提交（工作区未改；可用 await instant.git.pull() 更新）',
      `远端分支 ${result.branches.length} 个 · 历史缓存 ${result.commits.length} 条`,
    ].join('\n'),
    data: {
      owner: next.owner,
      repo: next.repo,
      branch: next.currentBranch,
      head: headShaOrNull(currentHeadSha(next)),
      localSha,
      remoteSha,
      upToDate: result.upToDate,
      branchCount: result.branches.length,
      cachedCommitCount: result.commits.length,
    },
  }
}

export async function githubGitSwitchBranch(
  ctx: GithubGitContext,
  branch: string,
  onProgress?: GithubProgress,
): Promise<
  GithubGitResult<{
    owner: string
    repo: string
    branch: string
    head: string | null
    syncedWithRemote: boolean
  }>
> {
  assertGithubGitMutationAllowed(ctx.fsMode)
  const meta = await resolveMeta(ctx)
  const name = branch.trim()
  if (!name) throw new Error('请提供分支名')
  const repoRoot = githubRepoRootPath(meta.owner, meta.repo)
  const { result, changeSet } = await withControlledWorkingTreeMutation(ctx, repoRoot, () =>
    switchGithubBranch({ meta, branch: name, onProgress }),
  )
  const head = headShaOrNull(currentHeadSha(result.meta))
  return {
    summary: appendChangeSummary(
      `已切换到 ${result.meta.currentBranch} · tip ${shortSha(head ?? undefined)}${
        result.syncedWithRemote ? '（已与远端同步）' : '（本地快照）'
      }`,
      changeSet,
    ),
    data: {
      owner: result.meta.owner,
      repo: result.meta.repo,
      branch: result.meta.currentBranch,
      head,
      syncedWithRemote: result.syncedWithRemote,
    },
    changeSet,
  }
}

export async function githubGitDiscard(
  ctx: GithubGitContext,
  paths: string[],
): Promise<
  GithubGitResult<{
    owner: string
    repo: string
    branch: string
    head: string | null
    discarded: Array<{ path: string; kind: GithubChange['kind'] }>
  }>
> {
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
    data: {
      owner: next.owner,
      repo: next.repo,
      branch: next.currentBranch,
      head: headShaOrNull(currentHeadSha(next)),
      discarded: toGitChanges(changes),
    },
    changeSet,
  }
}

export async function githubGitUndo(ctx: GithubGitContext): Promise<
  GithubGitResult<{ head: string | null }>
> {
  assertGithubGitMutationAllowed(ctx.fsMode)
  const meta = await resolveMeta(ctx)
  const next = await undoLastUnpushedCommit(meta)
  const head = headShaOrNull(currentHeadSha(next))
  return {
    summary: `已撤销最近一次未推送 commit · tip ${shortSha(head ?? undefined)}`,
    data: { head },
  }
}

export async function githubGitAmend(
  ctx: GithubGitContext,
  message: string,
): Promise<GithubGitResult<{ head: string | null }>> {
  assertGithubGitMutationAllowed(ctx.fsMode)
  const meta = await resolveMeta(ctx)
  const next = await amendUnpushedCommit({ meta, message })
  const head = headShaOrNull(currentHeadSha(next))
  return {
    summary: `已 amend 未推送 commit · tip ${shortSha(head ?? undefined)}`,
    data: { head },
  }
}

export async function githubGitCreateBranch(
  ctx: GithubGitContext,
  name: string,
  options?: { checkout?: boolean; publish?: boolean },
): Promise<
  GithubGitResult<{
    branch: string
    currentBranch: string
    head: string | null
    published: boolean
    checkedOut: boolean
  }>
> {
  assertGithubGitMutationAllowed(ctx.fsMode)
  const meta = await resolveMeta(ctx)
  const next = await createGithubBranch({
    meta,
    name,
    checkout: options?.checkout,
    publish: options?.publish,
  })
  const checkedOut = options?.checkout !== false
  const published = options?.publish === true
  return {
    summary: `已创建分支 ${name}${published ? '（已发布）' : ''}${
      checkedOut ? ` · 当前 ${next.currentBranch}` : ''
    }`,
    data: {
      branch: name,
      currentBranch: next.currentBranch,
      head: headShaOrNull(currentHeadSha(next)),
      published,
      checkedOut,
    },
  }
}

export async function githubGitStashSave(
  ctx: GithubGitContext,
  message?: string,
): Promise<
  GithubGitResult<{
    stashedCount: number
    message?: string
  }>
> {
  assertGithubGitMutationAllowed(ctx.fsMode)
  const meta = await resolveMeta(ctx)
  const repoRoot = githubRepoRootPath(meta.owner, meta.repo)
  const { result, changeSet } = await withControlledWorkingTreeMutation(ctx, repoRoot, async () => {
    const saved = await stashSaveGithubChanges({ meta, message })
    return saved
  })
  const stashMessage = result.stash.message || undefined
  return {
    summary: appendChangeSummary(
      `已贮藏 ${result.stash.changes.length} 项变更${
        stashMessage ? `（${stashMessage}）` : ''
      }`,
      changeSet,
    ),
    data: {
      stashedCount: result.stash.changes.length,
      ...(stashMessage ? { message: stashMessage } : {}),
    },
    changeSet,
  }
}

export async function githubGitStashPop(ctx: GithubGitContext): Promise<
  GithubGitResult<{ remainingStashCount: number }>
> {
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
    data: { remainingStashCount: remaining.length },
    changeSet,
  }
}

export async function githubGitStashList(ctx: GithubGitContext): Promise<
  GithubGitResult<{
    stashes: Array<{
      id: string
      branch: string
      createdAt: number
      message?: string
      changeCount: number
    }>
  }>
> {
  const meta = await resolveMeta(ctx)
  const list = await stashListGithub(meta)
  const stashes = list.map((entry) => ({
    id: entry.id,
    branch: entry.branch,
    createdAt: entry.createdAt,
    ...(entry.message ? { message: entry.message } : {}),
    changeCount: entry.changes.length,
  }))
  const lines = [
    `仓库 ${meta.owner}/${meta.repo} · 贮藏 ${stashes.length} 条`,
    ...stashes.slice(0, 30).map((entry) => {
      const note = entry.message ? `  ${entry.message}` : ''
      return `  ${entry.id.slice(0, 8)}  ${entry.branch}  ${entry.changeCount} 项${note}`
    }),
  ]
  if (stashes.length > 30) {
    lines.push(`  …另有 ${stashes.length - 30} 条`)
  }
  return {
    summary: lines.join('\n'),
    data: { stashes },
  }
}
