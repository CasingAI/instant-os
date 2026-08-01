import { osNowMs } from '../../os/os-clock.ts'
import { resolveGithubCommitAuthor } from './github-desktop-prefs.ts'
import {
  detectGithubChanges,
  persistBaselineForCommittedChanges,
  persistBaselineFromWorkingTree,
} from './github-changes.ts'
import {
  appendGithubLocalCommit,
  createLocalCommitSha,
  currentBranchPushedSha,
  currentBranchSnapshot,
  currentFileIndex,
  currentHeadSha,
  listUnpushedLocalCommits,
  removeGithubLocalCommit,
  saveGithubRepoMeta,
  withBranchSnapshot,
  type GithubLocalCommit,
  type GithubLocalCommitChange,
  type GithubRepoSyncMeta,
} from './github-sync-meta.ts'

/** 当前分支栈顶未推送 commit（最新一条）；无则 undefined */
export async function getTipUnpushedCommit(
  meta: GithubRepoSyncMeta,
): Promise<GithubLocalCommit | undefined> {
  const unpushed = await listUnpushedLocalCommits(
    meta.owner,
    meta.repo,
    meta.currentBranch,
  )
  if (unpushed.length === 0) return undefined
  return unpushed[unpushed.length - 1]
}

/**
 * 撤销当前分支最近一次未推送 commit：tip/fileIndex 回退，工作区不动，变更回到 Changes。
 */
export async function undoLastUnpushedCommit(
  meta: GithubRepoSyncMeta,
): Promise<GithubRepoSyncMeta> {
  const top = await getTipUnpushedCommit(meta)
  if (!top) {
    throw new Error('没有可撤销的未推送 commit')
  }
  const head = currentHeadSha(meta)
  if (head !== top.sha) {
    throw new Error('当前 tip 不是最近一次未推送 commit，无法撤销')
  }
  const parentSha = top.parentSha
  const fileIndex = top.fileIndexBefore
  if (!parentSha || !fileIndex) {
    throw new Error('该本地 commit 缺少父提交或基线快照，无法撤销')
  }

  const snap = currentBranchSnapshot(meta)
  const next = withBranchSnapshot(meta, meta.currentBranch, {
    tipSha: parentSha,
    fileIndex,
    baselineComplete: snap.baselineComplete,
    pushedTipSha: snap.pushedTipSha ?? currentBranchPushedSha(meta),
  })
  next.updatedAt = osNowMs()
  await saveGithubRepoMeta(next)
  await removeGithubLocalCommit(meta.owner, meta.repo, top.sha)
  return next
}

/**
 * 修改最近一次未推送 commit：把当前工作区相对「该 commit 之前」的变更重新封进 tip，可改 message。
 */
export async function amendUnpushedCommit(params: {
  meta: GithubRepoSyncMeta
  message: string
  selectedPaths?: ReadonlySet<string>
}): Promise<GithubRepoSyncMeta> {
  const message = params.message.trim()
  if (!message) {
    throw new Error('请填写 commit 说明')
  }

  const top = await getTipUnpushedCommit(params.meta)
  if (!top) {
    throw new Error('没有可 amend 的未推送 commit')
  }
  const head = currentHeadSha(params.meta)
  if (head !== top.sha) {
    throw new Error('当前 tip 不是最近一次未推送 commit，无法 amend')
  }
  const parentSha = top.parentSha
  const fileIndexBefore = top.fileIndexBefore
  if (!parentSha || !fileIndexBefore) {
    throw new Error('该本地 commit 缺少父提交或基线快照，无法 amend')
  }

  const author = resolveGithubCommitAuthor()
  if (!author) {
    throw new Error('尚未配置 commit 身份。请在设置 → Git 中填写姓名与邮箱，或先刷新账户信息。')
  }

  // 临时把 tip 指回 parent，使 detect 得到「原 commit + 新 dirty」相对基线的完整 diff
  const probeMeta = withBranchSnapshot(params.meta, params.meta.currentBranch, {
    tipSha: parentSha,
    fileIndex: fileIndexBefore,
    baselineComplete: currentBranchSnapshot(params.meta).baselineComplete,
    pushedTipSha:
      currentBranchSnapshot(params.meta).pushedTipSha ??
      currentBranchPushedSha(params.meta),
  })

  const allChanges = await detectGithubChanges(probeMeta)
  const changes = params.selectedPaths
    ? allChanges.filter((change) => params.selectedPaths!.has(change.path))
    : allChanges

  if (changes.length === 0) {
    throw new Error('没有可写入 amend 的变更')
  }

  const { owner, repo } = params.meta
  const isPartial = changes.length < allChanges.length
  // persist 时 meta tip 仍是旧 tip；用 probe 的 fileIndexBefore 作为 previous
  const fileIndex = isPartial
    ? await persistBaselineForCommittedChanges(owner, repo, changes, fileIndexBefore)
    : await persistBaselineFromWorkingTree(owner, repo, fileIndexBefore)

  const commitSha = createLocalCommitSha()
  const snap = currentBranchSnapshot(params.meta)
  const next = withBranchSnapshot(params.meta, params.meta.currentBranch, {
    tipSha: commitSha,
    fileIndex,
    baselineComplete: snap.baselineComplete,
    pushedTipSha: snap.pushedTipSha ?? currentBranchPushedSha(params.meta),
  })
  next.updatedAt = osNowMs()
  await saveGithubRepoMeta(next)
  await removeGithubLocalCommit(owner, repo, top.sha)
  await appendGithubLocalCommit(owner, repo, {
    sha: commitSha,
    message,
    parentSha,
    author: author.name,
    committedAt: osNowMs(),
    branch: params.meta.currentBranch,
    changes: changes.map(
      (change): GithubLocalCommitChange => ({ path: change.path, kind: change.kind }),
    ),
    fileIndexBefore,
    fileIndexAfter: fileIndex,
  })
  return next
}

export function isTipUnpushedSha(
  tipSha: string | undefined,
  tipUnpushed: GithubLocalCommit | undefined,
): boolean {
  return Boolean(tipSha && tipUnpushed && tipSha === tipUnpushed.sha)
}
