import { osNowMs } from '../../os/os-clock.ts'
import {
  githubCreateBlob,
  githubCreateCommit,
  githubCreateTree,
  githubGetCommitTreeSha,
  githubUpdateBranchRef,
} from './github-api.ts'
import {
  buildFileIndex,
  saveGithubRepoMeta,
  type GithubRepoSyncMeta,
} from './github-sync-meta.ts'
import {
  collectWorkingTreeFiles,
  detectGithubChanges,
  readWorkingTreeBytes,
  type GithubChange,
} from './github-changes.ts'

export async function commitAndPushGithubChanges(params: {
  meta: GithubRepoSyncMeta
  message: string
  selectedPaths?: ReadonlySet<string>
}): Promise<GithubRepoSyncMeta> {
  const message = params.message.trim()
  if (!message) {
    throw new Error('请填写提交说明')
  }

  const allChanges = await detectGithubChanges(params.meta)
  const changes = params.selectedPaths
    ? allChanges.filter((change) => params.selectedPaths!.has(change.path))
    : allChanges

  if (changes.length === 0) {
    throw new Error('没有可提交的变更')
  }

  const { owner, repo } = params.meta
  const baseTreeSha = await githubGetCommitTreeSha(owner, repo, params.meta.headSha)

  const treeEntries: Array<
    | { path: string; mode: '100644'; type: 'blob'; sha: string }
    | { path: string; mode: '100644'; type: 'blob'; sha: null }
  > = []

  for (const change of changes) {
    if (change.kind === 'deleted') {
      treeEntries.push({ path: change.path, mode: '100644', type: 'blob', sha: null })
      continue
    }
    const bytes = await readWorkingTreeBytes(change.absolutePath)
    const blobSha = await githubCreateBlob(owner, repo, bytes, 'base64')
    treeEntries.push({ path: change.path, mode: '100644', type: 'blob', sha: blobSha })
  }

  const treeSha = await githubCreateTree(owner, repo, baseTreeSha, treeEntries)
  const commitSha = await githubCreateCommit(owner, repo, {
    message,
    treeSha,
    parentSha: params.meta.headSha,
  })
  await githubUpdateBranchRef(owner, repo, params.meta.currentBranch, commitSha)

  // 提交成功后以「当前工作树全量」刷新快照（与 tip 对齐）
  const working = await collectWorkingTreeFiles(owner, repo)
  const fileIndex = await buildFileIndex(working)
  const next: GithubRepoSyncMeta = {
    ...params.meta,
    headSha: commitSha,
    fileIndex,
    updatedAt: osNowMs(),
  }
  await saveGithubRepoMeta(next)
  return next
}

export function summarizeChanges(changes: readonly GithubChange[]): string {
  const added = changes.filter((c) => c.kind === 'added').length
  const modified = changes.filter((c) => c.kind === 'modified').length
  const deleted = changes.filter((c) => c.kind === 'deleted').length
  const parts: string[] = []
  if (added) parts.push(`${added} 新增`)
  if (modified) parts.push(`${modified} 修改`)
  if (deleted) parts.push(`${deleted} 删除`)
  return parts.join(' · ') || '无变更'
}
