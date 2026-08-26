import { osNowMs } from '../../os/os-clock.ts'
import { joinFilesAbsolutePath } from '../files/files-path.ts'
import { filesRemoveBatch } from '../files/files-api.ts'
import { readBaselineBytes, writeBaselineBlobIfMissing } from './github-baseline.ts'
import {
  detectGithubChanges,
} from './github-changes.ts'
import { discardGithubChanges } from './github-discard.ts'
import { githubRepoRootPath } from './github-repo-paths.ts'
import type { GithubProgress } from './github-progress.ts'
import {
  currentFileIndex,
  currentHeadSha,
  hashBytes,
  listGithubStashes,
  pushGithubStashEntry,
  removeGithubStashEntry,
  saveGithubRepoMeta,
  withBranchSnapshot,
  type GithubFileIndexEntry,
  type GithubRepoSyncMeta,
  type GithubStashEntry,
} from './github-sync-meta.ts'
import { writeWorkingTreeFile, readWorkingTreeBytes } from './github-working-tree.ts'

function createStashId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function stashSaveGithubChanges(params: {
  meta: GithubRepoSyncMeta
  message?: string
  onProgress?: GithubProgress
}): Promise<{ meta: GithubRepoSyncMeta; stash: GithubStashEntry }> {
  const { meta, onProgress } = params
  const changes = await detectGithubChanges(meta)
  if (changes.length === 0) {
    throw new Error('没有可贮藏的本地变更')
  }

  onProgress?.('保存贮藏快照…')
  const root = githubRepoRootPath(meta.owner, meta.repo)
  const blobs: Record<string, GithubFileIndexEntry> = {}
  const stashChanges: GithubStashEntry['changes'] = []

  for (const change of changes) {
    stashChanges.push({ path: change.path, kind: change.kind })
    if (change.kind === 'deleted') continue
    const absolute =
      change.absolutePath || joinFilesAbsolutePath(root, ...change.path.split('/'))
    const bytes = await readWorkingTreeBytes(absolute)
    const hash = await hashBytes(bytes)
    await writeBaselineBlobIfMissing(hash, bytes)
    blobs[change.path] = { hash, byteSize: bytes.byteLength }
  }

  const stash: GithubStashEntry = {
    id: createStashId(),
    branch: meta.currentBranch,
    createdAt: osNowMs(),
    message: params.message?.trim() || undefined,
    changes: stashChanges,
    blobs,
  }
  await pushGithubStashEntry(meta.owner, meta.repo, stash)

  onProgress?.('清空工作区变更…')
  const next = await discardGithubChanges({
    meta,
    changes,
    discardAll: true,
    onProgress,
  })
  return { meta: next, stash }
}

export async function stashListGithub(meta: GithubRepoSyncMeta): Promise<GithubStashEntry[]> {
  return listGithubStashes(meta.owner, meta.repo)
}

export async function stashDropGithub(
  meta: GithubRepoSyncMeta,
  stashId: string,
): Promise<void> {
  const removed = await removeGithubStashEntry(meta.owner, meta.repo, stashId)
  if (!removed) throw new Error('找不到该贮藏条目')
}

/** 弹出贮藏：写回工作区，不改 tip；弹出后从列表移除 */
export async function stashPopGithubChanges(params: {
  meta: GithubRepoSyncMeta
  stashId?: string
  onProgress?: GithubProgress
}): Promise<GithubRepoSyncMeta> {
  const { meta, onProgress } = params
  const list = await listGithubStashes(meta.owner, meta.repo)
  if (list.length === 0) {
    throw new Error('没有可弹出的贮藏')
  }
  const stash = params.stashId
    ? list.find((item) => item.id === params.stashId)
    : list[0]
  if (!stash) {
    throw new Error('找不到该贮藏条目')
  }

  const dirty = await detectGithubChanges(meta)
  if (dirty.length > 0) {
    throw new Error('工作区有未 commit 变更，请先 commit、丢弃或贮藏后再弹出')
  }

  onProgress?.(`弹出贮藏（${stash.changes.length} 个文件）…`)
  const root = githubRepoRootPath(meta.owner, meta.repo)
  const removeAbs: string[] = []
  let applied = 0

  for (const change of stash.changes) {
    const absolute = joinFilesAbsolutePath(root, ...change.path.split('/'))
    if (change.kind === 'deleted') {
      removeAbs.push(absolute)
    } else {
      const entry = stash.blobs[change.path]
      if (!entry) {
        throw new Error(`贮藏缺少文件内容：${change.path}`)
      }
      const bytes = await readBaselineBytes(entry.hash)
      if (bytes === undefined) {
        throw new Error(`贮藏基线缺失：${change.path}`)
      }
      await writeWorkingTreeFile(absolute, bytes)
    }
    applied += 1
    if (applied % 10 === 0) {
      onProgress?.(`恢复文件 ${applied}/${stash.changes.length}…`, {
        fraction: applied / stash.changes.length,
      })
    }
  }

  if (removeAbs.length > 0) {
    await filesRemoveBatch(removeAbs, { skipMissing: true })
  }

  await removeGithubStashEntry(meta.owner, meta.repo, stash.id)

  // tip 不变；工作区内容已与基线 hash 一致，纯 hash 检测不会误报
  const fileIndex = currentFileIndex(meta)
  const next = withBranchSnapshot(meta, meta.currentBranch, {
    tipSha: currentHeadSha(meta),
    fileIndex,
    baselineComplete: meta.branches[meta.currentBranch]?.baselineComplete,
    pushedTipSha: meta.branches[meta.currentBranch]?.pushedTipSha,
  })
  next.updatedAt = osNowMs()
  await saveGithubRepoMeta(next)
  onProgress?.('已弹出贮藏')
  return next
}
