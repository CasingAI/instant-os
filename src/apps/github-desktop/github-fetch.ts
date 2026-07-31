import {
  githubGetBranchTip,
  githubGetRepo,
  githubListBranches,
  githubListCommits,
  type GithubBranch,
  type GithubCommitSummary,
  type GithubRepoSummary,
} from './github-api.ts'
import {
  currentHeadSha,
  putCachedGithubCommitList,
  saveGithubRepoMeta,
  stampGithubStoredRemoteRepo,
  type GithubRepoSyncMeta,
} from './github-sync-meta.ts'
import type { GithubProgress } from './github-progress.ts'

/** Fetch 时从 GitHub API 拉取的远端提交历史上限（单页，无翻页） */
export const GITHUB_REMOTE_COMMIT_LIST_LIMIT = 50

export type GithubFetchResult = {
  localSha: string
  remoteSha: string
  upToDate: boolean
  branches: GithubBranch[]
  commits: GithubCommitSummary[]
  remote: GithubRepoSummary
}

/**
 * 从 GitHub 获取远端信息：分支列表 + 以远端 tip 为准的 History 列表缓存。
 * 不改写工作区，不推进本地 tip / fileIndex / baseline。
 * 有未提交本地变更时也可调用。
 */
export async function fetchGithubRemote(params: {
  meta: GithubRepoSyncMeta
  onProgress?: GithubProgress
}): Promise<GithubFetchResult> {
  const { meta, onProgress } = params
  const localSha = currentHeadSha(meta)

  onProgress?.('读取仓库信息…')
  const remote = await githubGetRepo(meta.owner, meta.repo)

  onProgress?.('检查远端分支 tip…')
  const remoteSha = await githubGetBranchTip(meta.owner, meta.repo, meta.currentBranch)

  onProgress?.('刷新分支列表…')
  const branches = await githubListBranches(meta.owner, meta.repo)

  onProgress?.('刷新 commit 历史…')
  const commits = await githubListCommits(
    meta.owner,
    meta.repo,
    remoteSha,
    GITHUB_REMOTE_COMMIT_LIST_LIMIT,
  )
  await putCachedGithubCommitList(meta.owner, meta.repo, remoteSha, commits)

  return {
    localSha,
    remoteSha,
    upToDate: Boolean(localSha) && localSha === remoteSha,
    branches,
    commits,
    remote,
  }
}

/**
 * 将 Fetch 结果写入仓库 meta（远端信息 / 分支列表 / lastFetchedAt）。
 * 不改工作区；供 GitHub Desktop UI 与 Agent 门面共用。
 */
export async function applyGithubFetchResult(
  meta: GithubRepoSyncMeta,
  result: GithubFetchResult,
  fetchedAt = Date.now(),
): Promise<GithubRepoSyncMeta> {
  const nextMeta: GithubRepoSyncMeta = {
    ...meta,
    defaultBranch: result.remote.defaultBranch,
    remote: stampGithubStoredRemoteRepo(result.remote, fetchedAt),
    remoteBranches: result.branches.map((branch) => ({
      name: branch.name,
      commitSha: branch.commitSha,
      protected: branch.protected,
    })),
    lastFetchedAt: fetchedAt,
    updatedAt: fetchedAt,
  }
  await saveGithubRepoMeta(nextMeta)
  return nextMeta
}
