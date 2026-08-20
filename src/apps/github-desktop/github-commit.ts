import { osNowMs } from '../../os/os-clock.ts'
import {
  githubCreateBlob,
  githubCreateCommit,
  githubCreateTree,
  githubGetCommitTreeSha,
  githubUpdateBranchRef,
} from './github-api.ts'
import { readBaselineBytes, readBaselineText } from './github-baseline.ts'
import { githubGetFileContent } from './github-api.ts'
import { resolveGithubCommitAuthor } from './github-desktop-prefs.ts'
import {
  appendGithubLocalCommit,
  createLocalCommitSha,
  currentBranchPushedSha,
  currentFileIndex,
  currentHeadSha,
  finalizePushedLocalCommits,
  isLocalCommitSha,
  listUnpushedLocalCommits,
  listGithubLocalCommits,
  saveGithubRepoMeta,
  withBranchSnapshot,
  withRemoteBranchTip,
  type GithubCachedCommitDetail,
  type GithubLocalCommit,
  type GithubRepoSyncMeta,
  type GithubFileIndexEntry,
} from './github-sync-meta.ts'
import type { GithubChangePreview } from './github-changes.ts'
import {
  detectGithubChanges,
  persistBaselineForCommittedChanges,
  persistBaselineFromWorkingTree,
  type GithubChange,
} from './github-changes.ts'
import { rebaseUnpushedOntoRemoteTip } from './github-rebase.ts'
import type { GithubProgress } from './github-progress.ts'

/** 仅本地 commit：更新 fileIndex / tip，不调用 GitHub API */
export async function commitGithubChanges(params: {
  meta: GithubRepoSyncMeta
  message: string
  selectedPaths?: ReadonlySet<string>
}): Promise<GithubRepoSyncMeta> {
  const message = params.message.trim()
  if (!message) {
    throw new Error('请填写 commit 说明')
  }

  const allChanges = await detectGithubChanges(params.meta)
  const changes = params.selectedPaths
    ? allChanges.filter((change) => params.selectedPaths!.has(change.path))
    : allChanges

  if (changes.length === 0) {
    throw new Error('没有可 commit 的变更')
  }

  const author = resolveGithubCommitAuthor()
  if (!author) {
    throw new Error('尚未配置 commit 身份。请在设置 → Git 中填写姓名与邮箱，或先刷新账户信息。')
  }

  const { owner, repo } = params.meta
  const parentSha = currentHeadSha(params.meta)
  if (!parentSha) {
    throw new Error('当前分支缺少 tip，请重新克隆或拉取')
  }

  const commitSha = createLocalCommitSha()
  const previousIndex = currentFileIndex(params.meta)
  const isPartialCommit = changes.length < allChanges.length
  const fileIndex = isPartialCommit
    ? await persistBaselineForCommittedChanges(owner, repo, changes, previousIndex)
    : await persistBaselineFromWorkingTree(owner, repo, previousIndex)
  const snap = params.meta.branches[params.meta.currentBranch]
  const next = withBranchSnapshot(params.meta, params.meta.currentBranch, {
    tipSha: commitSha,
    fileIndex,
    baselineComplete: snap?.baselineComplete,
    pushedTipSha: snap?.pushedTipSha ?? currentBranchPushedSha(params.meta),
  })
  next.updatedAt = osNowMs()
  await saveGithubRepoMeta(next)
  await appendGithubLocalCommit(owner, repo, {
    sha: commitSha,
    message,
    parentSha,
    author: author.name,
    committedAt: osNowMs(),
    branch: params.meta.currentBranch,
    changes: changes.map((change) => ({ path: change.path, kind: change.kind })),
    fileIndexBefore: previousIndex,
    fileIndexAfter: fileIndex,
  })
  return next
}

async function pushLocalCommitToRemote(
  meta: GithubRepoSyncMeta,
  commit: GithubLocalCommit,
  parentSha: string,
  onProgress?: GithubProgress,
): Promise<string> {
  const author = resolveGithubCommitAuthor()
  if (!author) {
    throw new Error('尚未配置 commit 身份。请在设置 → Git 中填写姓名与邮箱，或先刷新账户信息。')
  }
  const changes = commit.changes ?? []
  if (changes.length === 0) {
    throw new Error('本地 commit 缺少变更记录，无法推送')
  }
  const fileIndexAfter = commit.fileIndexAfter
  if (!fileIndexAfter) {
    throw new Error('本地 commit 缺少快照，无法推送')
  }

  const { owner, repo } = meta
  onProgress?.('读取远端 tree…')
  const baseTreeSha = await githubGetCommitTreeSha(owner, repo, parentSha)
  const treeEntries: Array<
    | { path: string; mode: '100644'; type: 'blob'; sha: string }
    | { path: string; mode: '100644'; type: 'blob'; sha: null }
  > = []

  const uploadTotal = changes.filter((change) => change.kind !== 'deleted').length
  let uploaded = 0
  for (const change of changes) {
    if (change.kind === 'deleted') {
      treeEntries.push({ path: change.path, mode: '100644', type: 'blob', sha: null })
      continue
    }
    const entry = fileIndexAfter[change.path]
    if (!entry) {
      throw new Error(`本地 commit 快照缺少文件 ${change.path}`)
    }
    const bytes = await readBaselineBytes(entry.hash)
    if (bytes === undefined) {
      throw new Error(`本地基线缺少文件 ${change.path}`)
    }
    uploaded += 1
    onProgress?.(
      `上传文件 ${uploaded}/${uploadTotal}…`,
      uploadTotal > 0 ? { fraction: uploaded / uploadTotal } : undefined,
    )
    const blobSha = await githubCreateBlob(owner, repo, bytes, 'base64')
    treeEntries.push({ path: change.path, mode: '100644', type: 'blob', sha: blobSha })
  }

  onProgress?.('创建 commit…')
  const treeSha = await githubCreateTree(owner, repo, baseTreeSha, treeEntries)
  return githubCreateCommit(owner, repo, {
    message: commit.message,
    treeSha,
    parentSha,
    author,
  })
}

/** 将尚未推送的本地 commit 链推送到远端分支 */
export async function pushGithubBranch(
  meta: GithubRepoSyncMeta,
  onProgress?: GithubProgress,
): Promise<GithubRepoSyncMeta> {
  // 远端若已超前：先把未推送链接到 live tip，避免非快进 422
  const synced = await rebaseUnpushedOntoRemoteTip({ meta, onProgress })

  const unpushed = await listUnpushedLocalCommits(
    synced.owner,
    synced.repo,
    synced.currentBranch,
  )
  if (unpushed.length === 0) {
    throw new Error('没有可推送的 commit')
  }

  let parentSha = currentBranchPushedSha(synced)
  if (!parentSha || isLocalCommitSha(parentSha)) {
    throw new Error('无法推送：缺少已同步到远端的基点，请先获取或拉取')
  }

  const commitTotal = unpushed.length
  const mappings: Array<{ localSha: string; remoteSha: string }> = []
  for (let index = 0; index < unpushed.length; index += 1) {
    const commit = unpushed[index]!
    onProgress?.(
      `推送 commit ${index + 1}/${commitTotal}…`,
      { fraction: index / Math.max(commitTotal, 1) },
    )
    const remoteSha = await pushLocalCommitToRemote(synced, commit, parentSha, onProgress)
    mappings.push({ localSha: commit.sha, remoteSha })
    parentSha = remoteSha
  }

  onProgress?.('更新远端分支…')
  const remoteTipSha = parentSha
  await githubUpdateBranchRef(synced.owner, synced.repo, synced.currentBranch, remoteTipSha)
  await finalizePushedLocalCommits(synced.owner, synced.repo, mappings)

  const snap = synced.branches[synced.currentBranch]
  const next = withRemoteBranchTip(
    withBranchSnapshot(synced, synced.currentBranch, {
      tipSha: remoteTipSha,
      fileIndex: snap?.fileIndex ?? {},
      baselineComplete: snap?.baselineComplete,
      pushedTipSha: remoteTipSha,
    }),
    synced.currentBranch,
    remoteTipSha,
  )
  next.updatedAt = osNowMs()
  await saveGithubRepoMeta(next)
  onProgress?.('推送完成', { fraction: 1 })
  return next
}

export async function commitAndPushGithubChanges(params: {
  meta: GithubRepoSyncMeta
  message: string
  selectedPaths?: ReadonlySet<string>
}): Promise<GithubRepoSyncMeta> {
  const committed = await commitGithubChanges(params)
  return pushGithubBranch(committed)
}

export function buildLocalCommitDetail(commit: GithubLocalCommit): GithubCachedCommitDetail {
  const statusByKind = {
    added: 'added',
    modified: 'modified',
    deleted: 'removed',
  } as const
  return {
    sha: commit.sha,
    message: commit.message,
    authorName: commit.author,
    authorDate: new Date(commit.committedAt).toISOString(),
    files: (commit.changes ?? []).map((change) => ({
      filename: change.path,
      status: statusByKind[change.kind],
    })),
  }
}

async function readIndexedFileText(
  index: Record<string, GithubFileIndexEntry> | undefined,
  path: string,
): Promise<string | undefined> {
  const entry = index?.[path]
  if (!entry) return undefined
  return readBaselineText(entry.hash)
}

async function resolveParentFileIndex(
  owner: string,
  repo: string,
  parentSha: string | undefined,
): Promise<Record<string, GithubFileIndexEntry> | undefined> {
  if (!parentSha) return undefined
  if (isLocalCommitSha(parentSha)) {
    const commits = await listGithubLocalCommits(owner, repo)
    return commits.find((item) => item.sha === parentSha)?.fileIndexAfter
  }
  return undefined
}

async function readRemoteParentFileText(
  owner: string,
  repo: string,
  parentSha: string,
  path: string,
): Promise<string | undefined> {
  try {
    const bytes = await githubGetFileContent(owner, repo, path, parentSha)
    return new TextDecoder().decode(bytes)
  } catch {
    return undefined
  }
}

/** 本地 commit 的文件 diff：不依赖 GitHub patch API */
export async function buildLocalCommitFilePreview(
  owner: string,
  repo: string,
  commit: GithubLocalCommit,
  path: string,
): Promise<GithubChangePreview> {
  const change = commit.changes?.find((item) => item.path === path)
  if (!change) {
    return {
      path,
      original: '',
      modified: '',
      notice: '找不到此文件的变更记录。',
    }
  }

  const beforeIndex =
    commit.fileIndexBefore ??
    (await resolveParentFileIndex(owner, repo, commit.parentSha))

  if (change.kind === 'added') {
    const modified = await readIndexedFileText(commit.fileIndexAfter, path)
    if (modified === undefined) {
      return { path, original: '', modified: '', notice: '无法读取新增文件内容。' }
    }
    return { path, original: '', modified }
  }

  if (change.kind === 'deleted') {
    let original = await readIndexedFileText(beforeIndex, path)
    if (original === undefined && commit.parentSha && !isLocalCommitSha(commit.parentSha)) {
      original = await readRemoteParentFileText(owner, repo, commit.parentSha, path)
    }
    if (original === undefined) {
      return { path, original: '', modified: '', notice: '无法读取删除前的文件内容。' }
    }
    return { path, original, modified: '' }
  }

  let original = await readIndexedFileText(beforeIndex, path)
  if (original === undefined && commit.parentSha && !isLocalCommitSha(commit.parentSha)) {
    original = await readRemoteParentFileText(owner, repo, commit.parentSha, path)
  }
  const modified = await readIndexedFileText(commit.fileIndexAfter, path)
  if (original === undefined || modified === undefined) {
    return {
      path,
      original: original ?? '',
      modified: modified ?? '',
      notice: '无法读取本地 commit 的对比内容。',
    }
  }
  return { path, original, modified }
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

export function formatStagedChangesSummary(
  stagedChanges: readonly GithubChange[],
  totalCount: number,
): string {
  const summary = summarizeChanges(stagedChanges)
  if (totalCount === 0 || stagedChanges.length === 0 || stagedChanges.length === totalCount) {
    return summary
  }
  return `已选 ${stagedChanges.length}/${totalCount} · ${summary}`
}
