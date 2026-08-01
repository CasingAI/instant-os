import { osNowMs } from '../../os/os-clock.ts'
import { githubCreateBranchRef } from './github-api.ts'
import {
  currentBranchPushedSha,
  currentBranchSnapshot,
  currentFileIndex,
  currentHeadSha,
  isLocalCommitSha,
  listUnpushedLocalCommits,
  reassignUnpushedLocalCommitsBranch,
  saveGithubRepoMeta,
  touchRecentBranch,
  withBranchSnapshot,
  withRemoteBranchTip,
  type GithubRepoSyncMeta,
} from './github-sync-meta.ts'

const BRANCH_NAME_RE = /^(?!.*\.\.)[a-zA-Z0-9][a-zA-Z0-9._/-]*$/

/** 校验本地/远端分支名（简化 git 规则） */
export function validateGithubBranchName(name: string): string | undefined {
  const trimmed = name.trim()
  if (!trimmed) return '请输入分支名'
  if (trimmed.length > 200) return '分支名过长'
  if (trimmed.endsWith('.') || trimmed.endsWith('/')) return '分支名不能以 . 或 / 结尾'
  if (trimmed.includes(' ')) return '分支名不能包含空格'
  if (!BRANCH_NAME_RE.test(trimmed)) {
    return '分支名只能包含字母、数字、. _ / -，且不能包含 ..'
  }
  return undefined
}

export async function createGithubBranch(params: {
  meta: GithubRepoSyncMeta
  name: string
  checkout?: boolean
  publish?: boolean
}): Promise<GithubRepoSyncMeta> {
  const name = params.name.trim()
  const invalid = validateGithubBranchName(name)
  if (invalid) throw new Error(invalid)

  if (name === params.meta.currentBranch) {
    throw new Error('新分支名不能与当前分支相同')
  }
  if (params.meta.branches[name] || params.meta.remoteBranches?.some((b) => b.name === name)) {
    throw new Error(`分支 ${name} 已存在`)
  }

  const from = params.meta.currentBranch
  const snap = currentBranchSnapshot(params.meta)
  const tipSha = currentHeadSha(params.meta)
  if (!tipSha) {
    throw new Error('当前分支缺少 tip，无法创建分支')
  }

  const checkout = params.checkout !== false
  const unpushed = await listUnpushedLocalCommits(params.meta.owner, params.meta.repo, from)

  let branchTipSha = tipSha
  let branchFileIndex = { ...currentFileIndex(params.meta) }
  const branchPushed = snap.pushedTipSha ?? currentBranchPushedSha(params.meta)

  if (!checkout && unpushed.length > 0) {
    // 不切换时未推送 commit 仍挂在原分支：新分支只指到已推送基点
    const first = unpushed[0]!
    if (!first.fileIndexBefore) {
      throw new Error('有未推送 commit 时请切换到新分支，或先推送后再创建')
    }
    branchTipSha = branchPushed
    branchFileIndex = { ...first.fileIndexBefore }
  }

  let next = withBranchSnapshot(
    params.meta,
    name,
    {
      tipSha: branchTipSha,
      fileIndex: branchFileIndex,
      baselineComplete: snap.baselineComplete,
      pushedTipSha: branchPushed,
    },
    checkout ? { currentBranch: name } : undefined,
  )

  if (checkout && unpushed.length > 0) {
    await reassignUnpushedLocalCommitsBranch(params.meta.owner, params.meta.repo, from, name)
  }

  if (checkout) {
    next = touchRecentBranch(next, name)
  }

  if (params.publish) {
    const publishSha = branchPushed
    if (!publishSha || isLocalCommitSha(publishSha)) {
      throw new Error('无法发布分支：缺少已同步到远端的基点，请先推送或拉取')
    }
    await githubCreateBranchRef(params.meta.owner, params.meta.repo, name, publishSha)
    next = withRemoteBranchTip(next, name, publishSha)
  }

  next.updatedAt = osNowMs()
  await saveGithubRepoMeta(next)
  return next
}
