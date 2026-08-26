import { osNowMs } from '../../os/os-clock.ts'
import {
  githubCompare,
  githubDownloadZipball,
  githubGetBranchTip,
  githubGetFileContent,
  type GithubCompareFile,
} from './github-api.ts'
import {
  persistBaselineFromFiles,
  writeBaselineBlobIfMissing,
} from './github-baseline.ts'
import { detectGithubChanges } from './github-changes.ts'
import type { GithubProgress } from './github-progress.ts'
import {
  currentBranchPushedSha,
  currentFileIndex,
  currentHeadSha,
  hashBytes,
  isLocalCommitSha,
  listUnpushedLocalCommits,
  replaceUnpushedLocalCommits,
  saveGithubRepoMeta,
  withBranchSnapshot,
  withRemoteBranchTip,
  type GithubFileIndexEntry,
  type GithubLocalCommit,
  type GithubRepoSyncMeta,
} from './github-sync-meta.ts'
import { syncWorkingTreeToFileIndex, unzipGithubZipball } from './github-working-tree.ts'

/** 变更文件数超过此阈值时回退整包 zip */
const INCREMENTAL_FILE_LIMIT = 80

/** 收集未推送本地 commit 触及的全部路径 */
export function collectUnpushedChangePaths(
  commits: ReadonlyArray<GithubLocalCommit>,
): Set<string> {
  const paths = new Set<string>()
  for (const commit of commits) {
    for (const change of commit.changes ?? []) {
      paths.add(change.path)
    }
  }
  return paths
}

/** 远端自 base→tip 改过的路径与本地未推送变更路径的交集（已排序） */
export function findRebaseConflictPaths(
  remoteChangedPaths: ReadonlyArray<string>,
  localChangePaths: ReadonlySet<string>,
): string[] {
  const conflicts: string[] = []
  for (const path of remoteChangedPaths) {
    if (localChangePaths.has(path)) conflicts.push(path)
  }
  conflicts.sort((a, b) => a.localeCompare(b))
  return conflicts
}

/** 错误文案用的路径预览 */
export function formatPathList(paths: ReadonlyArray<string>): string {
  const sorted = [...paths].sort((a, b) => a.localeCompare(b))
  const preview = sorted.slice(0, 8).join('、')
  const more = sorted.length > 8 ? ` 等 ${sorted.length} 个文件` : ''
  return `${preview}${more}`
}

function throwIfDirtyOverlapsRemote(
  remotePaths: ReadonlyArray<string>,
  dirtyPaths: ReadonlySet<string>,
): void {
  const overlaps = findRebaseConflictPaths(remotePaths, dirtyPaths)
  if (overlaps.length === 0) return
  throw new Error(
    `无法同步：未 commit 的本地修改与远端即将写入的文件冲突（${formatPathList(overlaps)}）。请先 commit 或丢弃这些文件后再试。`,
  )
}

/**
 * 将单个本地 commit 的路径变更应用到基线 fileIndex。
 * blob 来自 commit.fileIndexAfter（删除则去掉路径）。
 */
export function applyLocalCommitChangesToFileIndex(
  baseIndex: Record<string, GithubFileIndexEntry>,
  commit: GithubLocalCommit,
): Record<string, GithubFileIndexEntry> {
  const next: Record<string, GithubFileIndexEntry> = { ...baseIndex }
  const changes = commit.changes ?? []
  const after = commit.fileIndexAfter
  for (const change of changes) {
    if (change.kind === 'deleted') {
      delete next[change.path]
      continue
    }
    const entry = after?.[change.path]
    if (!entry) {
      throw new Error(`本地 commit 快照缺少文件 ${change.path}`)
    }
    next[change.path] = { ...entry }
  }
  return next
}

/** 把未推送链接到新的远端 tip fileIndex 上，重算 parent / fileIndex* */
export function rebaseLocalCommitChainOntoFileIndex(
  remoteTipIndex: Record<string, GithubFileIndexEntry>,
  commits: ReadonlyArray<GithubLocalCommit>,
  liveTipSha: string,
): { commits: GithubLocalCommit[]; tipFileIndex: Record<string, GithubFileIndexEntry> } {
  let running = { ...remoteTipIndex }
  const rewritten: GithubLocalCommit[] = []
  for (let i = 0; i < commits.length; i += 1) {
    const commit = commits[i]!
    const fileIndexBefore = { ...running }
    const fileIndexAfter = applyLocalCommitChangesToFileIndex(running, commit)
    rewritten.push({
      ...commit,
      parentSha: i === 0 ? liveTipSha : commits[i - 1]!.sha,
      fileIndexBefore,
      fileIndexAfter,
    })
    running = fileIndexAfter
  }
  return { commits: rewritten, tipFileIndex: running }
}

function cloneFileIndex(
  index: Record<string, GithubFileIndexEntry>,
): Record<string, GithubFileIndexEntry> {
  const next: Record<string, GithubFileIndexEntry> = {}
  for (const [path, entry] of Object.entries(index)) {
    next[path] = { ...entry }
  }
  return next
}

/** 在本地基点 fileIndex 上应用远端 compare 中、且不在 protected 集合内的文件 */
export async function applyRemoteCompareToFileIndex(params: {
  baseIndex: Record<string, GithubFileIndexEntry>
  files: ReadonlyArray<GithubCompareFile>
  protectedPaths: ReadonlySet<string>
  owner: string
  repo: string
  remoteSha: string
  onProgress?: GithubProgress
}): Promise<Record<string, GithubFileIndexEntry>> {
  const next = cloneFileIndex(params.baseIndex)
  let applied = 0
  const total = params.files.length
  for (const file of params.files) {
    if (params.protectedPaths.has(file.filename)) continue
    if (file.status === 'removed') {
      delete next[file.filename]
    } else {
      const bytes = await githubGetFileContent(
        params.owner,
        params.repo,
        file.filename,
        params.remoteSha,
      )
      const hash = await hashBytes(bytes)
      await writeBaselineBlobIfMissing(hash, bytes)
      next[file.filename] = { hash, byteSize: bytes.byteLength }
    }
    applied += 1
    if (applied % 10 === 0) {
      params.onProgress?.(`合并远端变更 ${applied}/${total}…`)
    }
  }
  return next
}

export async function rematerializeBranchFromZip(params: {
  meta: GithubRepoSyncMeta
  ref: string
  headSha: string
  branch?: string
  onProgress?: GithubProgress
}): Promise<GithubRepoSyncMeta> {
  const { meta, onProgress } = params
  const branch = params.branch ?? meta.currentBranch
  onProgress?.('下载压缩包…')
  const zip = await githubDownloadZipball(meta.owner, meta.repo, params.ref, onProgress)
  const files = await unzipGithubZipball(zip)
  onProgress?.('写入基线快照…')
  const fileIndex = await persistBaselineFromFiles(files)
  const fromIndex = currentFileIndex(meta)
  onProgress?.('增量同步工作区…')
  await syncWorkingTreeToFileIndex(
    meta.owner,
    meta.repo,
    fromIndex,
    fileIndex,
    onProgress,
  )
  const next = withBranchSnapshot(
    meta,
    branch,
    {
      tipSha: params.headSha,
      fileIndex,
      baselineComplete: true,
      pushedTipSha: params.headSha,
    },
    { currentBranch: branch },
  )
  next.updatedAt = osNowMs()
  await saveGithubRepoMeta(next)
  return next
}

async function fastForwardToRemoteTip(params: {
  meta: GithubRepoSyncMeta
  baseSha: string
  remoteSha: string
  onProgress?: GithubProgress
}): Promise<GithubRepoSyncMeta> {
  const { meta, baseSha, remoteSha, onProgress } = params
  onProgress?.('比较本地与远端差异…')
  const compare = await githubCompare(meta.owner, meta.repo, baseSha, remoteSha)
  const remotePaths = compare.files.map((file) => file.filename)

  onProgress?.('检查未 commit 变更是否与远端冲突…')
  const dirty = await detectGithubChanges(meta)
  throwIfDirtyOverlapsRemote(
    remotePaths,
    new Set(dirty.map((change) => change.path)),
  )

  if (compare.files.length > INCREMENTAL_FILE_LIMIT) {
    onProgress?.(`变更文件较多（${compare.files.length}），改用完整压缩包…`)
    return rematerializeBranchFromZip({
      meta,
      ref: meta.currentBranch,
      headSha: remoteSha,
      onProgress,
    })
  }

  const fromIndex = currentFileIndex(meta)
  onProgress?.('合并远端变更…')
  const nextIndex = await applyRemoteCompareToFileIndex({
    baseIndex: fromIndex,
    files: compare.files,
    protectedPaths: new Set(),
    owner: meta.owner,
    repo: meta.repo,
    remoteSha,
    onProgress,
  })
  onProgress?.('同步工作区…')
  await syncWorkingTreeToFileIndex(
    meta.owner,
    meta.repo,
    fromIndex,
    nextIndex,
    onProgress,
  )
  const next = withRemoteBranchTip(
    withBranchSnapshot(meta, meta.currentBranch, {
      tipSha: remoteSha,
      fileIndex: nextIndex,
      baselineComplete: true,
      pushedTipSha: remoteSha,
    }),
    meta.currentBranch,
    remoteSha,
  )
  next.updatedAt = osNowMs()
  await saveGithubRepoMeta(next)
  return next
}

async function rebaseUnpushedChain(params: {
  meta: GithubRepoSyncMeta
  baseSha: string
  remoteSha: string
  unpushed: GithubLocalCommit[]
  onProgress?: GithubProgress
}): Promise<GithubRepoSyncMeta> {
  const { meta, baseSha, remoteSha, unpushed, onProgress } = params
  const localPaths = collectUnpushedChangePaths(unpushed)

  onProgress?.('比较本地基点与远端差异…')
  const compare = await githubCompare(meta.owner, meta.repo, baseSha, remoteSha)
  const remotePaths = compare.files.map((file) => file.filename)
  const conflicts = findRebaseConflictPaths(remotePaths, localPaths)
  if (conflicts.length > 0) {
    throw new Error(
      `无法自动变基：远端与本地未推送 commit 修改了同一文件（${formatPathList(conflicts)}）。请先处理冲突后再推送或拉取。`,
    )
  }

  onProgress?.('检查未 commit 变更是否与远端冲突…')
  const dirty = await detectGithubChanges(meta)
  throwIfDirtyOverlapsRemote(
    remotePaths,
    new Set(dirty.map((change) => change.path)),
  )

  let remoteTipIndex: Record<string, GithubFileIndexEntry>
  const first = unpushed[0]!
  const baseIndex = first.fileIndexBefore

  if (compare.files.length > INCREMENTAL_FILE_LIMIT || !baseIndex) {
    onProgress?.('下载远端 tip 压缩包以变基…')
    const zip = await githubDownloadZipball(
      meta.owner,
      meta.repo,
      meta.currentBranch,
      onProgress,
    )
    const files = await unzipGithubZipball(zip)
    remoteTipIndex = await persistBaselineFromFiles(files)
  } else {
    onProgress?.('合并远端独有变更到基点…')
    remoteTipIndex = await applyRemoteCompareToFileIndex({
      baseIndex,
      files: compare.files,
      protectedPaths: localPaths,
      owner: meta.owner,
      repo: meta.repo,
      remoteSha,
      onProgress,
    })
  }

  onProgress?.('将未推送 commit 接到远端 tip…')
  const { commits: rewritten, tipFileIndex } = rebaseLocalCommitChainOntoFileIndex(
    remoteTipIndex,
    unpushed,
    remoteSha,
  )

  const tipSha = rewritten[rewritten.length - 1]!.sha
  const fromIndex = currentFileIndex(meta)
  onProgress?.('同步工作区…')
  await syncWorkingTreeToFileIndex(
    meta.owner,
    meta.repo,
    fromIndex,
    tipFileIndex,
    onProgress,
  )
  const rewrittenWithTipIndex = rewritten.map((commit, index) => {
    if (index !== rewritten.length - 1) return commit
    return { ...commit, fileIndexAfter: tipFileIndex }
  })

  await replaceUnpushedLocalCommits(meta.owner, meta.repo, rewrittenWithTipIndex)

  const next = withRemoteBranchTip(
    withBranchSnapshot(meta, meta.currentBranch, {
      tipSha,
      fileIndex: tipFileIndex,
      baselineComplete: true,
      pushedTipSha: remoteSha,
    }),
    meta.currentBranch,
    remoteSha,
  )
  next.updatedAt = osNowMs()
  await saveGithubRepoMeta(next)
  return next
}

/**
 * 若远端 tip 超前于本地已推送基点：快进或把未推送本地 commit 变基到远端 tip。
 * Push / Pull 共用；仅当未 commit WIP 与远端写入路径冲突时拒绝（对齐 git）。
 */
export async function rebaseUnpushedOntoRemoteTip(params: {
  meta: GithubRepoSyncMeta
  onProgress?: GithubProgress
}): Promise<GithubRepoSyncMeta> {
  const { meta, onProgress } = params

  const baseSha = currentBranchPushedSha(meta)
  if (!baseSha || isLocalCommitSha(baseSha)) {
    throw new Error('无法同步：缺少已同步到远端的基点，请先获取或重新克隆')
  }

  onProgress?.('检查远端分支…')
  const remoteSha = await githubGetBranchTip(meta.owner, meta.repo, meta.currentBranch)
  if (remoteSha === baseSha) {
    onProgress?.('已是最新')
    return meta
  }

  const head = currentHeadSha(meta)
  if (head === remoteSha && !isLocalCommitSha(head)) {
    onProgress?.('已是最新')
    return meta
  }

  const unpushed = await listUnpushedLocalCommits(
    meta.owner,
    meta.repo,
    meta.currentBranch,
  )

  if (unpushed.length === 0) {
    return fastForwardToRemoteTip({
      meta,
      baseSha,
      remoteSha,
      onProgress,
    })
  }

  return rebaseUnpushedChain({
    meta,
    baseSha,
    remoteSha,
    unpushed,
    onProgress,
  })
}
