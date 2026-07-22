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

  onProgress?.('刷新提交历史…')
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
