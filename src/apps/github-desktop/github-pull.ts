import { osNowMs } from '../../os/os-clock.ts'
import { githubGetBranchTip } from './github-api.ts'
import { baselineBlobsAbsentForIndex } from './github-baseline.ts'
import { detectGithubChanges, stampFileIndexRevisionIdsFromWorkingTree } from './github-changes.ts'
import type { GithubProgress } from './github-progress.ts'
import {
  rebaseUnpushedOntoRemoteTip,
  rematerializeBranchFromZip,
} from './github-rebase.ts'
import {
  branchBaselineTrusted,
  currentFileIndex,
  saveGithubRepoMeta,
  touchRecentBranch,
  withBranchSnapshot,
  withRemoteBranchTip,
  type GithubRepoSyncMeta,
} from './github-sync-meta.ts'
import { syncWorkingTreeToFileIndex } from './github-working-tree.ts'

export async function pullGithubRepository(params: {
  meta: GithubRepoSyncMeta
  onProgress?: GithubProgress
}): Promise<GithubRepoSyncMeta> {
  return rebaseUnpushedOntoRemoteTip(params)
}

export type SwitchGithubBranchResult = {
  meta: GithubRepoSyncMeta
  /** 本次是否从 GitHub 拉取并物化了分支（非本地快照切换） */
  syncedWithRemote: boolean
}

export async function switchGithubBranch(params: {
  meta: GithubRepoSyncMeta
  branch: string
  onProgress?: GithubProgress
}): Promise<SwitchGithubBranchResult> {
  const branch = params.branch.trim()
  if (!branch) throw new Error('分支名无效')
  if (branch === params.meta.currentBranch) {
    return { meta: params.meta, syncedWithRemote: false }
  }

  params.onProgress?.('检查本地是否有未 commit 变更…')
  const localChanges = await detectGithubChanges(params.meta)
  if (localChanges.length > 0) {
  throw new Error('本地有未 commit 变更，请先 commit、丢弃或贮藏后再切换分支')
}

  params.onProgress?.(`切换到 ${branch}…`)

  const cached = params.meta.branches[branch]
  let baselineAbsent = true
  if (cached) {
    if (branchBaselineTrusted(cached)) {
      baselineAbsent = false
    } else {
      baselineAbsent = await baselineBlobsAbsentForIndex(cached.fileIndex)
    }
  }
  if (cached && !baselineAbsent) {
    const fromIndex = currentFileIndex(params.meta)
    params.onProgress?.('从本地快照增量同步工作区…')
    await syncWorkingTreeToFileIndex(
      params.meta.owner,
      params.meta.repo,
      fromIndex,
      cached.fileIndex,
      params.onProgress,
    )
    const stampedIndex = await stampFileIndexRevisionIdsFromWorkingTree(
      params.meta.owner,
      params.meta.repo,
      cached.fileIndex,
    )
    const next = touchRecentBranch(
      withBranchSnapshot(
        params.meta,
        branch,
        { tipSha: cached.tipSha, fileIndex: stampedIndex, baselineComplete: true },
        { currentBranch: branch },
      ),
      branch,
    )
    next.updatedAt = osNowMs()
    await saveGithubRepoMeta(next)
    return { meta: next, syncedWithRemote: false }
  }

  const headSha = await githubGetBranchTip(params.meta.owner, params.meta.repo, branch)
  const next = withRemoteBranchTip(
    await rematerializeBranchFromZip({
      meta: params.meta,
      ref: branch,
      branch,
      headSha,
      onProgress: params.onProgress,
    }),
    branch,
    headSha,
  )
  const withRecent = touchRecentBranch(next, branch)
  if (withRecent !== next) {
    withRecent.updatedAt = osNowMs()
    await saveGithubRepoMeta(withRecent)
    return { meta: withRecent, syncedWithRemote: true }
  }
  return { meta: next, syncedWithRemote: true }
}
